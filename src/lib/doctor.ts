import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { probeSystems, type SystemReport } from "./systems.js";
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
  aseprite: { path: string | null };
  xvfb: boolean;
}

export interface DoctorReport {
  ok: boolean;
  config: string | null;
  tools: ToolReport[];
  engines: EngineReport;
  /** Game systems the installed tool runtimes provide (informational; never blocks `ok`). */
  systems: SystemReport[];
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

/** First `bin` on PATH (Windows: also tries PATHEXT extensions). Pure Node, no shell. */
export function which(bin: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const win = process.platform === "win32";
  const exts = win ? ["", ...(env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").map((e) => e.toLowerCase())] : [""];
  for (const dir of (env.PATH ?? env.Path ?? "").split(path.delimiter).filter(Boolean))
    for (const ext of exts) {
      const p = path.join(dir, bin + ext);
      try {
        if (existsSync(p) && statSync(p).isFile()) return p;
      } catch {
        /* unreadable PATH entry */
      }
    }
  return null;
}

/** Well-known install locations (checked after env / config / PATH). */
const GODOT_DEFAULTS = ["C:\\ProgramData\\chocolatey\\bin\\godot.exe", "C:\\Program Files\\Godot\\godot.exe", "/Applications/Godot.app/Contents/MacOS/Godot"];
const CHROME_DEFAULTS = ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
const ASEPRITE_DEFAULTS = [
  "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Aseprite\\Aseprite.exe",
  "C:\\Program Files\\Aseprite\\Aseprite.exe",
  "/Applications/Aseprite.app/Contents/MacOS/aseprite",
];

/** Aseprite binary: $ASEPRITE_BIN / $EASYKIT_ASEPRITE → config.aseprite → aseprite on PATH → the usual Windows / macOS installs. */
export function findAseprite(cfg: KitConfig = loadKitConfig().config, env: NodeJS.ProcessEnv = process.env): string | null {
  for (const p of [env.ASEPRITE_BIN, env.EASYKIT_ASEPRITE, cfg.aseprite].filter(Boolean) as string[]) if (existsSync(p)) return p;
  return which("aseprite", env) ?? ASEPRITE_DEFAULTS.find((p) => existsSync(p)) ?? null;
}

/** Godot binary: $EASYKIT_GODOT / $GODOT → config.godot → godot4 / godot on PATH → <suite>/tools-godot/Godot_v4*. */
export function findGodot(cfg: KitConfig = loadKitConfig().config, env: NodeJS.ProcessEnv = process.env): string | null {
  const direct = [env.EASYKIT_GODOT, env.GODOT_BIN, env.GODOT, cfg.godot].filter(Boolean) as string[];
  for (const p of direct) if (existsSync(p)) return p;
  for (const b of ["godot4", "godot"]) {
    const w = which(b, env);
    if (w) return w;
  }
  const known = GODOT_DEFAULTS.find((p) => existsSync(p));
  if (known) return known;
  const suite = cfg.suiteDir ?? env.EASYKIT_SUITE_DIR ?? "/workspace";
  for (const p of [path.join(suite, "tools-godot", "Godot_v4.3-stable_linux.x86_64"), "/workspace/tools-godot/Godot_v4.3-stable_linux.x86_64"]) if (existsSync(p)) return p;
  return null;
}

export function findChrome(cfg: KitConfig = loadKitConfig().config, env: NodeJS.ProcessEnv = process.env): string | null {
  for (const p of [env.EASYKIT_CHROME, env.CHROME_PATH, cfg.chrome].filter(Boolean) as string[]) if (existsSync(p)) return p;
  for (const b of ["google-chrome", "chromium", "chromium-browser"]) {
    const w = which(b, env);
    if (w) return w;
  }
  return CHROME_DEFAULTS.find((p) => existsSync(p)) ?? null;
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
    aseprite: { path: opts.engines === false ? null : findAseprite(loaded.config, opts.env) },
    xvfb: opts.engines === false ? false : which("xvfb-run", opts.env) !== null,
  };
  const ready = tools.filter((t) => t.installed && t.built && t.deps).length;
  // The first twelve are required; the optional five only count against `ok` when installed but not built.
  const blocking = tools.filter((t) => !(t.installed && t.built && t.deps) && (t.installed || !TOOLS[t.id].optional));
  const systems = probeSystems((t) => resolved[t]?.home ?? null);
  return { ok: blocking.length === 0, config: loaded.path, tools, engines, systems, summary: `${ready}/${tools.length} Easy tools ready` };
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
    `godot   ${r.engines.godot.path ? `${r.engines.godot.version ?? "?"}  ${r.engines.godot.path}` : "not found (set GODOT_BIN or EASYKIT_GODOT) — Godot checks skipped"}`,
    `chrome  ${r.engines.chrome.path ?? "not found — web screenshot skipped"}`,
    `aseprite ${r.engines.aseprite.path ?? "not found (optional; set ASEPRITE_BIN)"}`,
    `xvfb    ${r.engines.xvfb ? "yes" : "no"}`,
    "",
    `systems ${r.systems.filter((s) => s.ok).length}/${r.systems.length}  ${r.systems.map((s) => `${s.ok ? "ok" : "--"} ${s.id}`).join(" · ")}`,
    ...r.systems.filter((s) => !s.ok && s.tools.length).map((s) => `        ${s.id}: ${s.missing.join("; ")} (update the tool)`),
  ].join("\n");
}
