import { serveStatic } from "@hono/node-server/serve-static";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { doctor } from "../lib/doctor.js";
import { ENGINES, NAME_RE, TEMPLATES, loadTemplate, newProject, projectStatus, type Engine } from "../lib/pipeline.js";
import { KIT_PORTS, TOOLS, TOOL_IDS } from "../lib/tools.js";
import { DEV_UI_ORIGINS, checkRequest, resolveToken } from "../shared/requestGuard.js";
import { DIR_RE, mountStudio, type Launcher } from "./studio.js";

export interface CreateAppOptions {
  projects: string;
  webRoot?: string;
  dev?: boolean;
  host?: string;
  token?: string;
  /** Desktop-app launcher for Studio "open in Godot / Aseprite" (tests inject a fake). */
  launch?: Launcher;
  env?: NodeJS.ProcessEnv;
}

const TOKEN_COOKIE = "easykit_token";
const fail = (e: unknown) => (e instanceof Error ? e.message : String(e));

function tokenPage(): string {
  return `<!doctype html><meta charset="utf-8"><title>Easy Kit</title>
<body style="font-family:system-ui;background:#11161d;color:#e6edf5;padding:2rem">
<h1>Easy Kit token required</h1><p>Paste the token printed in the terminal that started Easy Kit.</p>
<form method="get"><input name="token" autocomplete="off" style="width:22rem"> <button>Open</button></form></body>`;
}

export async function listProjects(root: string) {
  const dirs = (await readdir(root, { withFileTypes: true }).catch(() => [])).filter((d) => d.isDirectory());
  const all = await Promise.all(dirs.map((d) => projectStatus(path.join(root, d.name))));
  return all
    .filter((s) => s.manifest)
    .map((s) => ({ name: s.manifest!.name, root: s.root, template: s.manifest!.template, engine: s.manifest!.engine, seed: s.manifest!.seed, ok: s.manifest!.ok, createdAt: s.manifest!.createdAt, godot: s.godot, web: s.web, steps: s.manifest!.steps, tools: s.manifest!.tools }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function createApp(options: CreateAppOptions): Hono {
  const app = new Hono();
  const { projects, webRoot, dev, host = "127.0.0.1", token } = options;
  const guard = { bindHost: host, token, extraOrigins: dev ? DEV_UI_ORIGINS : [] };
  const busy = new Set<string>();

  app.use("*", async (c, next) => {
    const queryToken = c.req.query("token");
    const provided = c.req.header("x-easykit-token") ?? queryToken ?? getCookie(c, TOKEN_COOKIE);
    const denied = checkRequest(guard, { method: c.req.method, host: c.req.header("host"), origin: c.req.header("origin"), token: provided });
    if (denied) {
      if (denied.status === 401 && c.req.method === "GET" && !c.req.path.startsWith("/api/")) return c.html(tokenPage(), 401);
      return c.json({ error: denied.error }, denied.status);
    }
    if (token && queryToken) setCookie(c, TOKEN_COOKIE, queryToken, { httpOnly: true, sameSite: "Strict", path: "/", maxAge: 60 * 60 * 24 * 365 });
    await next();
  });

  app.get("/api/health", (c) => c.json({ ok: true, projects }));
  app.get("/api/doctor", (c) => c.json(doctor({ engines: c.req.query("engines") !== "0" })));
  app.get("/api/tools", (c) => c.json({ tools: TOOL_IDS.map((id) => TOOLS[id]), kit: KIT_PORTS }));
  app.get("/api/templates", async (c) => c.json(await Promise.all(TEMPLATES.map(loadTemplate))));
  app.get("/api/projects", async (c) => c.json({ root: projects, projects: await listProjects(projects), busy: [...busy] }));
  app.post("/api/projects", async (c) => {
    let body: { name?: string; template?: string; engine?: string; seed?: number; force?: boolean };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "JSON body required" }, 400);
    }
    const name = String(body.name ?? "");
    if (!NAME_RE.test(name)) return c.json({ error: `name must match ${NAME_RE}` }, 400);
    if (body.engine && !(ENGINES as readonly string[]).includes(body.engine)) return c.json({ error: "engine must be godot, pixi or both" }, 400);
    if (busy.has(name)) return c.json({ error: `${name} is already being built` }, 409);
    busy.add(name);
    try {
      const m = await newProject({ name, dir: projects, template: body.template, engine: body.engine as Engine | undefined, seed: Number(body.seed ?? 1), force: !!body.force });
      return c.json({ ok: m.ok, manifest: m });
    } catch (e) {
      return c.json({ error: fail(e) }, 400);
    } finally {
      busy.delete(name);
    }
  });

  mountStudio(app, { projects, launch: options.launch, env: options.env });

  // Play a project's web build inside the dashboard: /play/<name>/…
  app.get("/play/:name/*", async (c) => {
    const name = c.req.param("name");
    if (!DIR_RE.test(name)) return c.text("bad project name", 400);
    const base = path.join(projects, name, "web");
    const rel = decodeURIComponent(c.req.path.slice(`/play/${name}/`.length)) || "index.html";
    const file = path.resolve(base, rel);
    if (!file.startsWith(base + path.sep) || !existsSync(file)) return c.text("not found", 404);
    const type = MIME[path.extname(file)] ?? "application/octet-stream";
    return new Response(new Uint8Array(await readFile(file)), { headers: { "Content-Type": type, "Cache-Control": "no-store" } });
  });

  if (!dev && webRoot) {
    app.use("/*", serveStatic({ root: path.relative(process.cwd(), webRoot) || "." }));
    app.get("*", async (c) => {
      try {
        return c.html((await readFile(path.join(webRoot, "index.html"))).toString("utf8"));
      } catch {
        return c.text("Dashboard not built yet. Run npm run build:web or start with --dev.", 503);
      }
    });
  } else if (dev) {
    app.get("/", (c) => c.html(`<!doctype html><meta charset="utf-8"><title>Easy Kit (dev)</title><body style="font-family:system-ui;background:#11161d;color:#e6edf5;padding:2rem"><h1>Easy Kit API is running</h1><p>Projects: <code>${projects}</code></p><p>Open the Vite UI at <a href="http://127.0.0.1:${KIT_PORTS.vite}" style="color:#9fd0c0">http://127.0.0.1:${KIT_PORTS.vite}</a></p></body>`));
  }
  return app;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".ttf": "font/ttf",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".css": "text/css; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

export function defaultWebRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [path.resolve(here, "../web/dist"), path.resolve(here, "../../web/dist")];
  return candidates.find((p) => existsSync(path.join(p, "index.html"))) ?? candidates[1]!;
}

export async function startServer(o: { port: number; host: string; projects: string; dev?: boolean; studio?: boolean; open?: boolean }): Promise<void> {
  const token = resolveToken(o.host);
  const app = createApp({ projects: o.projects, webRoot: defaultWebRoot(), dev: o.dev, host: o.host, token });
  serve({ fetch: app.fetch, port: o.port, hostname: o.host }, () => {
    const url = `http://${o.host}:${o.port}/${o.studio ? "#/studio" : ""}${token ? `?token=${token}` : ""}`;
    console.error(`${o.studio ? "Easy Studio" : "Easy Kit dashboard"} ${url}`);
    if (o.open) openBrowser(url);
    console.error(`Projects ${o.projects}`);
  });
}

/** Open `url` in the default browser (Windows / macOS / Linux), best effort. */
export function openBrowser(url: string): void {
  const [cmd, args] = process.platform === "win32" ? ["explorer.exe", [url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try {
    const child = spawn(cmd, args as string[], { detached: true, stdio: "ignore" });
    child.on("error", () => undefined);
    child.unref();
  } catch {
    /* no browser available */
  }
}
