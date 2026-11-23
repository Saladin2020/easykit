import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { TOOLS, TOOL_IDS, cliPath, loadKitConfig, mcpServerPath, resolveAll, type KitConfig, type ToolId } from "./tools.js";

export interface ToolReport {
  id: ToolId;
  name: string;
  pkg: string;
  installed: boolean;
  home: string | null;
  source: string;
  version: string | null;
  git: { commit: string; branch: string; dirty: boolean } | null;
  built: boolean;
  cli: boolean;
  mcp: boolean;
  deps: boolean;
  ports: { serve?: number; mcp: number; vite: number };
  problems: string[];
}

export interface EngineReport {
  node: string;
  godot: { path: string | null; version: string | null };
  chrome: { path: string | null };
  xvfb: boolean;
}

export interface DoctorReport {
  ok: boolean;
  config: string | null;
  tools: ToolReport[];
  engines: EngineReport;
  summary: string;
}

function git(home: string): ToolReport["git"] {
  if (!existsSync(path.join(home, ".git"))) return null;
  try {
    const run = (...a: string[]) => execFileSync("git", ["-C", home, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return { commit: run("rev-parse", "--short", "HEAD"), branch: run("rev-parse", "--abbrev-ref", "HEAD"), dirty: run("status", "--porcelain").length > 0 };
  } catch {
    return null;
  }
}

function which(bin: string): string | null {
  try {
    return execFileSync("sh", ["-c", `command -v ${bin}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch {
    return null;
  }
}

/** Godot binary: $EASYKIT_GODOT / $GODOT → config.godot → godot4 / godot on PATH → <suite>/tools-godot/Godot_v4*. */
export function findGodot(cfg: KitConfig = loadKitConfig().config, env: NodeJS.ProcessEnv = process.env): string | null {
  const direct = [env.EASYKIT_GODOT, env.GODOT, cfg.godot].filter(Boolean) as string[];
  for (const p of direct) if (existsSync(p)) return p;
  for (const b of ["godot4", "godot"]) {
    const w = which(b);
    if (w) return w;
  }
  const suite = cfg.suiteDir ?? env.EASYKIT_SUITE_DIR ?? "/workspace";
  for (const p of [path.join(suite, "tools-godot", "Godot_v4.3-stable_linux.x86_64"), "/workspace/tools-godot/Godot_v4.3-stable_linux.x86_64"]) if (existsSync(p)) return p;
  return null;
}

export function findChrome(cfg: KitConfig = loadKitConfig().config, env: NodeJS.ProcessEnv = process.env): string | null {
  for (const p of [env.EASYKIT_CHROME, env.CHROME_PATH, cfg.chrome].filter(Boolean) as string[]) if (existsSync(p)) return p;
  for (const b of ["google-chrome", "chromium", "chromium-browser"]) {
    const w = which(b);
    if (w) return w;
  }
  return null;
}

function godotVersion(bin: string | null): string | null {
  if (!bin) return null;
  try {
    return execFileSync(bin, ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 15_000 }).trim().split("\n").pop() ?? null;
  } catch {
    return null;
  }
}

export function doctor(opts: { cfg?: KitConfig; configPath?: string | null; env?: NodeJS.ProcessEnv; engines?: boolean } = {}): DoctorReport {
  const loaded = opts.cfg ? { path: opts.configPath ?? null, config: opts.cfg } : loadKitConfig();
  const resolved = resolveAll(loaded.config, opts.env);
  const tools: ToolReport[] = TOOL_IDS.map((id) => {
    const r = resolved[id];
    const problems: string[] = [];
    if (!r.home) {
      problems.push(`not found (tried ${r.tried.join(", ")}); set ${r.spec.env}_HOME or tools.${id} in easykit.config.json`);
      return { id, name: r.spec.name, pkg: r.spec.pkg, installed: false, home: null, source: r.source, version: null, git: null, built: false, cli: false, mcp: false, deps: false, ports: r.spec.ports, problems };
    }
    const pkg = JSON.parse(readFileSync(path.join(r.home, "package.json"), "utf8")) as { version?: string };
    const cli = existsSync(cliPath(r.home));
    const mcp = existsSync(mcpServerPath(r.home));
    const deps = existsSync(path.join(r.home, "node_modules"));
    if (!cli) problems.push("dist/cli.js missing — run npm run build in the tool repo");
    if (!mcp) problems.push("dist/mcp/server.js missing — run npm run build in the tool repo");
    if (!deps) problems.push("node_modules missing — run npm install in the tool repo");
    return { id, name: r.spec.name, pkg: r.spec.pkg, installed: true, home: r.home, source: r.source, version: pkg.version ?? null, git: git(r.home), built: cli && mcp, cli, mcp, deps, ports: r.spec.ports, problems };
  });
  const godot = opts.engines === false ? null : findGodot(loaded.config, opts.env);
  const engines: EngineReport = {
    node: process.version,
    godot: { path: godot, version: opts.engines === false ? null : godotVersion(godot) },
    chrome: { path: opts.engines === false ? null : findChrome(loaded.config, opts.env) },
    xvfb: opts.engines === false ? false : which("xvfb-run") !== null,
  };
  const ready = tools.filter((t) => t.installed && t.built && t.deps).length;
  // The first twelve are required; the optional five only count against `ok` when installed but not built.
  const blocking = tools.filter((t) => !(t.installed && t.built && t.deps) && (t.installed || !TOOLS[t.id].optional));
  return { ok: blocking.length === 0, config: loaded.path, tools, engines, summary: `${ready}/${tools.length} Easy tools ready` };
}

export function formatDoctor(r: DoctorReport): string {
  const rows = r.tools.map((t) => {
    const mark = t.installed && t.built && t.deps ? "ok " : t.installed ? "!! " : TOOLS[t.id].optional ? "-  " : "-- ";
    const ver = t.version ? `v${t.version}` : "";
    const g = t.git ? `${t.git.commit}${t.git.dirty ? "*" : ""} ${t.git.branch}` : "";
    return `${mark} ${t.name.padEnd(14)} ${ver.padEnd(8)} ${g.padEnd(20)} ${t.home ?? "(missing)"}${t.problems.length ? `\n      ${t.problems.join("\n      ")}` : ""}`;
  });
  return [
    `Easy Kit doctor — ${r.summary}${r.config ? ` (config ${r.config})` : ""}`,
    ...rows,
    "",
    `node    ${r.engines.node}`,
    `godot   ${r.engines.godot.path ? `${r.engines.godot.version ?? "?"}  ${r.engines.godot.path}` : "not found (set EASYKIT_GODOT) — Godot checks skipped"}`,
    `chrome  ${r.engines.chrome.path ?? "not found — web screenshot skipped"}`,
    `xvfb    ${r.engines.xvfb ? "yes" : "no"}`,
  ].join("\n");
}
