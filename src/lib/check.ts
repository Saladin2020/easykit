import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { findGodot } from "./doctor.js";
import { kitRoot, loadKitConfig } from "./tools.js";

export interface CheckRun {
  name: string;
  ok: boolean;
  skipped?: string;
  code: number | null;
  ms: number;
  tail: string;
}

function run(cmd: string, args: string[], opts: { cwd: string; timeoutMs: number; env?: NodeJS.ProcessEnv }): Promise<{ code: number | null; out: string; ms: number }> {
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

/** godot --headless --import (twice: first pass imports, second settles scripts) then the kit's headless test. */
export async function checkGodot(project: string, opts: { godot?: string | null } = {}): Promise<CheckRun[]> {
  const dir = path.join(project, "godot");
  const godot = opts.godot ?? findGodot(loadKitConfig().config);
  if (!existsSync(path.join(dir, "project.godot"))) return [{ name: "godot", ok: false, skipped: "no godot/ build", code: null, ms: 0, tail: "" }];
  if (!godot) return [{ name: "godot", ok: true, skipped: "Godot not found (set EASYKIT_GODOT)", code: null, ms: 0, tail: "" }];
  const runs: CheckRun[] = [];
  for (const pass of [1, 2]) {
    const r = await run(godot, ["--headless", "--path", dir, "--import"], { cwd: dir, timeoutMs: 600_000 });
    runs.push({ name: `godot import ${pass}`, ok: r.code === 0, code: r.code, ms: r.ms, tail: tail(r.out, 8) });
  }
  const t = await run(godot, ["--headless", "--path", dir, "--script", "res://kit/test_game.gd"], { cwd: dir, timeoutMs: 300_000 });
  runs.push({ name: "godot headless test", ok: t.code === 0 && /EASYKIT TEST OK/.test(t.out), code: t.code, ms: t.ms, tail: tail(t.out, 80) });
  return runs;
}

export async function screenshotGodot(project: string, out: string, opts: { godot?: string | null; frames?: boolean } = {}): Promise<CheckRun> {
  const dir = path.join(project, "godot");
  const godot = opts.godot ?? findGodot(loadKitConfig().config);
  if (!godot) return { name: "godot screenshots", ok: true, skipped: "Godot not found", code: null, ms: 0, tail: "" };
  const args = ["-a", "-s", "-screen 0 1280x800x24", godot, "--path", dir, "--rendering-driver", "opengl3", "--resolution", "960x540", "--script", "res://kit/screenshot_game.gd", "--", "--out", out, ...(opts.frames ? ["--frames"] : [])];
  const r = await run("xvfb-run", args, { cwd: dir, timeoutMs: 300_000 });
  return { name: "godot screenshots", ok: r.code === 0, code: r.code, ms: r.ms, tail: tail(r.out, 20) };
}

/** scripts/check-web.py: serve web/, drive the game in headless Chrome, screenshots. */
export async function checkWeb(project: string, opts: { out?: string; port?: number; frames?: boolean } = {}): Promise<CheckRun> {
  const script = path.join(kitRoot(), "scripts", "check-web.py");
  if (!existsSync(path.join(project, "web", "index.html"))) return { name: "web", ok: false, skipped: "no web/ build", code: null, ms: 0, tail: "" };
  const args = [script, project, "--port", String(opts.port ?? 8989), ...(opts.out ? ["--out", opts.out] : []), ...(opts.frames ? ["--frames"] : [])];
  const r = await run("python3", args, { cwd: project, timeoutMs: 300_000 });
  if (/No module named 'playwright'/.test(r.out)) return { name: "web headless check", ok: true, skipped: "python playwright not installed", code: r.code, ms: r.ms, tail: tail(r.out, 5) };
  return { name: "web headless check", ok: r.code === 0 && /EASYKIT WEB OK/.test(r.out), code: r.code, ms: r.ms, tail: tail(r.out, 60) };
}
