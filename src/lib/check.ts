import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { findChrome, findGodot, which } from "./doctor.js";
import { kitRoot, loadKitConfig } from "./tools.js";

export interface CheckRun {
  name: string;
  ok: boolean;
  skipped?: string;
  code: number | null;
  ms: number;
  tail: string;
}

export interface CommandResult {
  code: number | null;
  out: string;
  ms: number;
}

export type CommandRunner = (cmd: string, args: string[], opts: { cwd: string; timeoutMs: number; env?: NodeJS.ProcessEnv }) => Promise<CommandResult>;

export function runCommand(cmd: string, args: string[], opts: { cwd: string; timeoutMs: number; env?: NodeJS.ProcessEnv }): Promise<CommandResult> {
  const t0 = Date.now();
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, env: { ...process.env, ...opts.env }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const timer = setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: -1, out: String(e), ms: Date.now() - t0 });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, out, ms: Date.now() - t0 });
    });
  });
}

const tail = (s: string, n = 40) => s.trim().split("\n").slice(-n).join("\n");

const XVFB_ARGS = ["-a", "-s", "-screen 0 1280x800x24"];

/** Godot under xvfb with the OpenGL 3 driver. Vulkan hangs on some hosts. */
export function xvfbGodot(godot: string, godotArgs: string[], useXvfb = true): { cmd: string; args: string[] } {
  const args = ["--rendering-driver", "opengl3", ...godotArgs];
  if (useXvfb) return { cmd: "xvfb-run", args: [...XVFB_ARGS, godot, ...args] };
  return { cmd: godot, args };
}

function hasXvfb(): boolean {
  return process.platform === "linux" && which("xvfb-run") !== null;
}

async function godotOnce(run: CommandRunner, godot: string, dir: string, godotArgs: string[], timeoutMs: number, useXvfb: boolean): Promise<CommandResult> {
  const { cmd, args } = xvfbGodot(godot, ["--headless", "--path", dir, ...godotArgs], useXvfb);
  return run(cmd, args, { cwd: dir, timeoutMs });
}

/** One Godot invocation, retried once on a non-zero exit (first headless import is flaky on 4.3). */
async function godotWithRetry(run: CommandRunner, godot: string, dir: string, godotArgs: string[], timeoutMs: number, useXvfb: boolean): Promise<{ result: CommandResult; attempts: number }> {
  const first = await godotOnce(run, godot, dir, godotArgs, timeoutMs, useXvfb);
  if (first.code === 0) return { result: first, attempts: 1 };
  const second = await godotOnce(run, godot, dir, godotArgs, timeoutMs, useXvfb);
  return { result: second, attempts: 2 };
}

export interface CheckGodotOpts {
  godot?: string | null;
  /** Injected runner (tests). Defaults to spawn. */
  run?: CommandRunner;
  /** Wrap Godot in xvfb-run. Defaults to whether `xvfb-run` is on PATH. */
  useXvfb?: boolean;
}

/**
 * Headless Godot check: a warm-up `--import` (failure is tolerated — Godot 4.3's first
 * headless import is flaky; it is retried once), a settling `--import` that must succeed
 * (also retried once), then the kit's headless test. Every Godot process runs with
 * `--rendering-driver opengl3`, under xvfb when available (Vulkan hangs on some hosts).
 */
export async function checkGodot(project: string, opts: CheckGodotOpts = {}): Promise<CheckRun[]> {
  const dir = path.join(project, "godot");
  const godot = opts.godot !== undefined ? opts.godot : findGodot(loadKitConfig().config);
  if (!existsSync(path.join(dir, "project.godot"))) return [{ name: "godot", ok: false, skipped: "no godot/ build", code: null, ms: 0, tail: "" }];
  if (!godot) return [{ name: "godot", ok: true, skipped: "Godot not found (set EASYKIT_GODOT)", code: null, ms: 0, tail: "" }];
  const run = opts.run ?? runCommand;
  const useXvfb = opts.useXvfb ?? hasXvfb();
  const runs: CheckRun[] = [];
  // Warm-up import: retry once, but a failure here does not fail the check.
  await godotWithRetry(run, godot, dir, ["--import"], 600_000, useXvfb);
  const settled = await godotWithRetry(run, godot, dir, ["--import"], 600_000, useXvfb);
  runs.push({ name: "godot import", ok: settled.result.code === 0, code: settled.result.code, ms: settled.result.ms, tail: tail(settled.result.out, 8) });
  const t = await godotOnce(run, godot, dir, ["--script", "res://kit/test_game.gd"], 300_000, useXvfb);
  runs.push({ name: "godot headless test", ok: t.code === 0 && /EASYKIT TEST OK/.test(t.out), code: t.code, ms: t.ms, tail: tail(t.out, 80) });
  return runs;
}

export async function screenshotGodot(project: string, out: string, opts: { godot?: string | null; frames?: boolean; run?: CommandRunner; useXvfb?: boolean } = {}): Promise<CheckRun> {
  const dir = path.join(project, "godot");
  const godot = opts.godot !== undefined ? opts.godot : findGodot(loadKitConfig().config);
  if (!godot) return { name: "godot screenshots", ok: true, skipped: "Godot not found", code: null, ms: 0, tail: "" };
  const useXvfb = opts.useXvfb ?? true;
  const { cmd, args } = xvfbGodot(godot, ["--path", dir, "--resolution", "960x540", "--script", "res://kit/screenshot_game.gd", "--", "--out", out, ...(opts.frames ? ["--frames"] : [])], useXvfb);
  const r = await (opts.run ?? runCommand)(cmd, args, { cwd: dir, timeoutMs: 300_000 });
  return { name: "godot screenshots", ok: r.code === 0, code: r.code, ms: r.ms, tail: tail(r.out, 20) };
}

/** scripts/check-web.py: serve web/, drive the game in headless Chrome, screenshots. */
export async function checkWeb(project: string, opts: { out?: string; port?: number; frames?: boolean; run?: CommandRunner } = {}): Promise<CheckRun> {
  const script = path.join(kitRoot(), "scripts", "check-web.py");
  if (!existsSync(path.join(project, "web", "index.html"))) return { name: "web", ok: false, skipped: "no web/ build", code: null, ms: 0, tail: "" };
  const args = [script, project, "--port", String(opts.port ?? 8989), ...(opts.out ? ["--out", opts.out] : []), ...(opts.frames ? ["--frames"] : [])];
  // Windows ships `python` (or the `py` launcher), not `python3`; override with EASYKIT_PYTHON.
  const python = process.env.EASYKIT_PYTHON ?? (process.platform === "win32" ? "python" : "python3");
  const chrome = findChrome();
  const r = await (opts.run ?? runCommand)(python, args, { cwd: project, timeoutMs: 300_000, env: chrome ? { EASYKIT_CHROME: chrome } : undefined });
  if (r.code === -1 && /ENOENT/.test(r.out)) return { name: "web headless check", ok: true, skipped: `${python} not found (set EASYKIT_PYTHON)`, code: r.code, ms: r.ms, tail: tail(r.out, 5) };
  if (/No module named 'playwright'/.test(r.out)) return { name: "web headless check", ok: true, skipped: "python playwright not installed", code: r.code, ms: r.ms, tail: tail(r.out, 5) };
  return { name: "web headless check", ok: r.code === 0 && /EASYKIT WEB OK/.test(r.out), code: r.code, ms: r.ms, tail: tail(r.out, 60) };
}
