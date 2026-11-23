#!/usr/bin/env node
/**
 * Easy Kit unified MCP server (stdio by default; optional Streamable HTTP on 8909).
 *
 *   npx tsx src/mcp/server.ts [--workspace <dir>] [--project <dir>]
 *   npx tsx src/mcp/server.ts --http --port 8909
 *
 * Kit tools: new_project, build_project, check_project, doctor, status, list_tools.
 * Every Easy tool's own MCP tools are proxied under `<tool>__<name>` (sprite__list_parts,
 * tilemap__edit_map, …). Each tool server starts lazily on first use, with its workspace at
 * <workspace>/<tool> (or <project>/.easy/<tool> with --project).
 *
 * Env: EASYKIT_WORKSPACE, EASYKIT_MCP_TOOLS (comma list to proxy, default all; "none" = kit tools only),
 *      EASY<NAME>_HOME per tool (see `easykit doctor`).
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool } from "@modelcontextprotocol/sdk/types.js";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { checkGodot, checkWeb } from "../lib/check.js";
import { doctor } from "../lib/doctor.js";
import { exists } from "../lib/fsutil.js";
import { ENGINES, TEMPLATES, newProject, projectStatus, rebuildProject, type Engine } from "../lib/pipeline.js";
import { shipProject } from "../lib/ship.js";
import { ToolMcp, runCli } from "../lib/runner.js";
import { KIT_PORTS, TOOLS, TOOL_IDS, isToolId, loadKitConfig, resolveAll, type ToolId } from "../lib/tools.js";
import { checkRequest, resolveToken } from "../shared/requestGuard.js";

export const KIT_TOOL_NAMES = ["new_project", "build_project", "check_project", "ship_plan", "doctor", "status", "list_tools"] as const;
export const SEP = "__";

const text = (data: unknown) => ({ content: [{ type: "text" as const, text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] });
const err = (message: string) => ({ isError: true as const, content: [{ type: "text" as const, text: message }] });
const msg = (e: unknown) => (e instanceof Error ? `${e.message}${(e as { detail?: string }).detail ? `\n${(e as { detail?: string }).detail}` : ""}` : String(e));

const KIT_TOOLS: Tool[] = [
  {
    name: "new_project",
    title: "New game project",
    description: `Scaffold a playable game by driving the Easy tools (sprite → portrait → scene → tilemap → dialogue → npc → quest → font → ui → sfx → fx → music → anim → items → battle → save; Portrait, NPC, Font and Battle are optional and skipped when not installed) and assembling a Godot 4.3+ project and/or a PixiJS web build. Template ${TEMPLATES.join(", ")}: walkable Thai + Malay-Muslim village, NPC dialogue, delivery quest, halal stall shop, intro cutscene, music, FX, save slots, th/en/ms, plus animated dialogue portraits, villagers on daily schedules with a clock, the มะขาม Thai pixel font and paddy-field battles when those tools are installed. Takes ~50 s.`,
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Project name / folder, e.g. VillageDemo" },
        dir: { type: "string", description: "Parent folder (default: the kit workspace)" },
        template: { type: "string", enum: [...TEMPLATES] },
        engine: { type: "string", enum: [...ENGINES], description: "godot | pixi | both (default both)" },
        seed: { type: "integer", minimum: 0, description: "Variation seed (player colours, coin sound / FX, music)" },
        force: { type: "boolean", description: "Replace an existing folder" },
      },
      required: ["name"],
    },
  },
  {
    name: "build_project",
    title: "Rebuild project",
    description: "Re-assemble godot/ and web/ of an Easy Kit project from the exports in <project>/.easy (after re-exporting a tool). The project keeps its pixel font; pass font (e.g. makham-16) to opt in to another one.",
    inputSchema: { type: "object", properties: { project: { type: "string" }, engine: { type: "string", enum: [...ENGINES] }, font: { type: "string", pattern: "^[a-z0-9][a-z0-9_-]*$" } }, required: ["project"] },
  },
  {
    name: "check_project",
    title: "Check project",
    description: "Godot import + headless gameplay test and the headless-Chrome web check for a project (skips engines that are not installed).",
    inputSchema: { type: "object", properties: { project: { type: "string" }, godot: { type: "boolean" }, web: { type: "boolean" } }, required: ["project"] },
  },
  {
    name: "ship_plan",
    title: "Ship plan",
    description: "Easy Ship: create release configs for a project's Godot and web builds (in <project>/.easy/ship) and return the plan — every step and command a build would run. Plan only: building is `easykit ship <project> --build` on the CLI and uploads to itch.io are never done by Easy Kit.",
    inputSchema: { type: "object", properties: { project: { type: "string" }, targets: { type: "string", description: "Godot targets: web, windows, linux, android (comma-separated; default web)" } }, required: ["project"] },
  },
  { name: "doctor", title: "Doctor", description: "Which Easy tools are installed (home, version, git commit, built, MCP server) and which engines exist for checks.", inputSchema: { type: "object", properties: {} } },
  {
    name: "status",
    title: "Status",
    description: "Kit status: tool readiness, proxied tool servers that are running, and Easy Kit projects in a folder (or one project's manifest).",
    inputSchema: { type: "object", properties: { path: { type: "string", description: "Project or folder (default: the kit workspace)" } } },
  },
  { name: "list_tools", title: "List Easy tools", description: "The 17 Easy tools with role, ports and the prefix their MCP tools use here.", inputSchema: { type: "object", properties: {} } },
];

export interface KitMcpOptions {
  workspace: string;
  project?: string;
  /** Tools to proxy (default all installed; [] = kit tools only). */
  proxy?: ToolId[];
}

export function proxyListFromEnv(env = process.env): ToolId[] | undefined {
  const v = env.EASYKIT_MCP_TOOLS?.trim();
  if (!v) return undefined;
  if (v === "none") return [];
  return v.split(",").map((s) => s.trim()).filter(isToolId);
}

export function createKitMcp(opts: KitMcpOptions) {
  const server = new Server({ name: "easykit", version: "0.1.0" }, { capabilities: { tools: {} } });
  const cfg = loadKitConfig().config;
  const homes = resolveAll(cfg);
  const proxied = (opts.proxy ?? TOOL_IDS.filter((t) => homes[t].home)).filter((t) => homes[t].home);
  const clients = new Map<ToolId, ToolMcp>();
  const listed = new Map<ToolId, Tool[]>();
  const failures = new Map<ToolId, string>();
  // Paths from MCP clients must stay inside the workspace, the project or EASYKIT_ALLOWED_DIRS.
  const roots = [opts.workspace, ...(opts.project ? [opts.project] : []), ...(process.env.EASYKIT_ALLOWED_DIRS ?? "").split(path.delimiter).filter(Boolean)].map((r) => path.resolve(r));
  const safe = (p: unknown, fallback = "."): string => {
    const abs = path.resolve(opts.workspace, String(p ?? fallback));
    if (!roots.some((r) => abs === r || abs.startsWith(r + path.sep))) throw new Error(`${abs} is outside the kit workspace (add it to EASYKIT_ALLOWED_DIRS)`);
    return abs;
  };
  const wsOf = (t: ToolId) => (opts.project ? path.join(opts.project, ".easy", t) : path.join(opts.workspace, t));

  async function client(t: ToolId): Promise<ToolMcp> {
    const have = clients.get(t);
    if (have) return have;
    const ws = wsOf(t);
    const env = { home: homes[t].home!, workspace: ws, allowed: [opts.project ?? opts.workspace] };
    if (!(await exists(ws))) {
      await mkdir(ws, { recursive: true });
      await runCli(t, env, ["init"], { workspaceFlag: t !== "sprite" }).catch(() => undefined);
    }
    const c = new ToolMcp(t, env);
    clients.set(t, c);
    return c;
  }

  async function toolsOf(t: ToolId): Promise<Tool[]> {
    const cached = listed.get(t);
    if (cached) return cached;
    try {
      const tools = (await (await client(t)).listTools()) as Tool[];
      const named = tools.map((x) => ({ ...x, name: `${t}${SEP}${x.name}`, description: `[${TOOLS[t].name}] ${x.description ?? ""}` }));
      listed.set(t, named);
      failures.delete(t);
      return named;
    } catch (e) {
      failures.set(t, msg(e));
      clients.delete(t);
      return [];
    }
  }

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const proxiedTools = (await Promise.all(proxied.map(toolsOf))).flat();
    return { tools: [...KIT_TOOLS, ...proxiedTools] };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name } = req.params;
    const args = (req.params.arguments ?? {}) as Record<string, any>;
    const i = name.indexOf(SEP);
    if (i > 0) {
      const t = name.slice(0, i);
      if (!isToolId(t) || !proxied.includes(t)) return err(`Unknown or disabled tool namespace "${t}"`);
      try {
        const res = await (await client(t)).raw(name.slice(i + SEP.length), args);
        return res as any;
      } catch (e) {
        return err(msg(e));
      }
    }
    try {
      switch (name) {
        case "new_project": {
          const dir = safe(args.dir);
          const m = await newProject({ name: String(args.name), dir, template: args.template, engine: args.engine as Engine | undefined, seed: args.seed, force: !!args.force });
          return text({ root: path.join(dir, String(args.name)), ok: m.ok, steps: m.steps.map((s) => ({ tool: s.tool, ok: s.ok, ms: s.ms, notes: s.notes })), godot: m.godot && { files: m.godot.files, autoloads: m.godot.autoloads, collisions: m.godot.collisions, dialogue: m.godot.dialogue }, web: m.web && { files: m.web.files, pixi: m.web.pixi } });
        }
        case "build_project": {
          const m = await rebuildProject(safe(args.project), { engine: args.engine, font: typeof args.font === "string" ? args.font : undefined });
          return text(m.steps.filter((s) => s.tool === "kit"));
        }
        case "check_project": {
          const root = safe(args.project);
          const runs = [...(args.godot === false ? [] : await checkGodot(root)), ...(args.web === false ? [] : [await checkWeb(root)])];
          return text({ ok: runs.every((r) => r.ok), runs });
        }
        case "ship_plan": {
          const r = await shipProject(safe(args.project), { targets: args.targets, cfg });
          return text(r);
        }
        case "doctor":
          return text(doctor({ cfg }));
        case "status": {
          const p = safe(args.path);
          const one = await projectStatus(p);
          const r = doctor({ cfg, engines: false });
          return text({
            workspace: opts.workspace,
            project: opts.project ?? null,
            tools: r.summary,
            proxy: proxied.map((t) => ({ tool: t, running: clients.has(t), tools: listed.get(t)?.length ?? null, error: failures.get(t) ?? null })),
            projects: one.manifest ? [one] : null,
          });
        }
        case "list_tools":
          return text({ kit: { ports: KIT_PORTS, tools: KIT_TOOL_NAMES }, tools: TOOL_IDS.map((t) => ({ ...TOOLS[t], home: homes[t].home, prefix: `${t}${SEP}`, proxied: proxied.includes(t) })) });
        default:
          return err(`Unknown tool ${name}`);
      }
    } catch (e) {
      return err(msg(e));
    }
  });

  return {
    server,
    proxied,
    async close() {
      await Promise.all([...clients.values()].map((c) => c.close()));
      clients.clear();
      await server.close().catch(() => undefined);
    },
  };
}

export interface StartOptions {
  http: boolean;
  port: number;
  host: string;
  workspace: string;
  project?: string;
}

function parseArgs(argv: string[]): StartOptions {
  const out: StartOptions = { http: false, port: KIT_PORTS.mcp, host: "127.0.0.1", workspace: process.env.EASYKIT_WORKSPACE ?? process.cwd() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--http") out.http = true;
    else if (a === "--port") out.port = Number(argv[++i] ?? out.port);
    else if (a === "--host") out.host = argv[++i] ?? out.host;
    else if (a === "--workspace") out.workspace = path.resolve(argv[++i] ?? out.workspace);
    else if (a === "--project") out.project = path.resolve(argv[++i] ?? "");
  }
  return out;
}

export async function startMcp(o: StartOptions): Promise<void> {
  await mkdir(o.workspace, { recursive: true });
  if (!o.http) {
    const kit = createKitMcp({ workspace: o.workspace, project: o.project, proxy: proxyListFromEnv() });
    await kit.server.connect(new StdioServerTransport());
    const bye = () => void kit.close().finally(() => process.exit(0));
    process.on("SIGINT", bye);
    process.on("SIGTERM", bye);
    return;
  }
  const { StreamableHTTPServerTransport } = await import("@modelcontextprotocol/sdk/server/streamableHttp.js");
  const sessions = new Map<string, { transport: InstanceType<typeof StreamableHTTPServerTransport>; close: () => Promise<void> }>();
  const token = resolveToken(o.host);
  if (token) console.error(`Non-loopback host: send "Authorization: Bearer <token>" — token printed once: ${token}`);
  const httpServer = createServer(async (req, res) => {
    const auth = req.headers.authorization;
    const denied = checkRequest({ bindHost: o.host, token }, { method: req.method ?? "GET", host: req.headers.host, origin: req.headers.origin, token: auth?.startsWith("Bearer ") ? auth.slice(7) : (req.headers["x-easykit-token"] as string | undefined) });
    if (denied) {
      res.writeHead(denied.status, { "Content-Type": "application/json" }).end(JSON.stringify({ error: denied.error }));
      return;
    }
    const url = new URL(req.url ?? "/", `http://${o.host}:${o.port}`);
    if (url.pathname !== "/mcp") {
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ name: "easykit", transport: "streamable-http", endpoint: `http://${o.host}:${o.port}/mcp`, workspace: o.workspace }));
      return;
    }
    const sid = req.headers["mcp-session-id"] as string | undefined;
    try {
      if (req.method === "POST") {
        let s = sid ? sessions.get(sid) : undefined;
        if (!s) {
          const kit = createKitMcp({ workspace: o.workspace, project: o.project, proxy: proxyListFromEnv() });
          const transport: InstanceType<typeof StreamableHTTPServerTransport> = new StreamableHTTPServerTransport({ sessionIdGenerator: () => crypto.randomUUID(), onsessioninitialized: (id: string) => void sessions.set(id, { transport, close: kit.close }) });
          transport.onclose = () => {
            const id = transport.sessionId;
            if (id) sessions.get(id)?.close();
            if (id) sessions.delete(id);
          };
          await kit.server.connect(transport);
          s = { transport, close: kit.close };
        }
        await s.transport.handleRequest(req, res);
        return;
      }
      if (req.method === "GET" || req.method === "DELETE") {
        const s = sid ? sessions.get(sid) : undefined;
        if (!s) {
          res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Invalid or missing mcp-session-id" }));
          return;
        }
        await s.transport.handleRequest(req, res);
        return;
      }
      res.writeHead(405).end();
    } catch (e) {
      if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ error: msg(e) }));
    }
  });
  httpServer.listen(o.port, o.host, () => {
    console.error(`Easy Kit MCP (HTTP) http://${o.host}:${o.port}/mcp`);
    console.error(`Workspace ${o.workspace}`);
  });
}

function entryIndex(): number {
  return process.argv.findIndex((arg) => /(?:^|[/\\])mcp[/\\]server\.(?:ts|js|mjs)$/i.test(arg));
}

if (entryIndex() >= 0) {
  await startMcp(parseArgs(process.argv.slice(entryIndex() + 1)));
}
