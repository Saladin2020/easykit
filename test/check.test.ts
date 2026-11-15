import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkGodot, xvfbGodot, type CommandRunner } from "../src/lib/check.js";
import { NAME_RE } from "../src/lib/pipeline.js";
import { tempDir } from "./helpers.js";

const GODOT = "/opt/Godot_v4.3-stable_linux.x86_64";

function scripted(exits: Array<{ code: number | null; out?: string }>): { run: CommandRunner; calls: Array<{ cmd: string; args: string[]; cwd: string }> } {
  const calls: Array<{ cmd: string; args: string[]; cwd: string }> = [];
  const run: CommandRunner = async (cmd, args, opts) => {
    const i = calls.length;
    calls.push({ cmd, args, cwd: opts.cwd });
    const step = exits[i];
    if (!step) throw new Error(`unexpected command ${cmd} ${args.join(" ")} (call ${i + 1})`);
    return { code: step.code, out: step.out ?? "", ms: 1 };
  };
  return { run, calls };
}

async function fakeProject(): Promise<{ dir: string; godot: string; cleanup: () => Promise<void> }> {
  const t = await tempDir("easykit-check-");
  const godot = path.join(t.dir, "godot");
  await mkdir(godot, { recursive: true });
  await writeFile(path.join(godot, "project.godot"), "config_version=5\n");
  return { dir: t.dir, godot, cleanup: t.cleanup };
}

function importCall(call: { cmd: string; args: string[] }, godotDir: string) {
  expect(call.cmd).toBe("xvfb-run");
  expect(call.args.slice(0, 3)).toEqual(["-a", "-s", "-screen 0 1280x800x24"]);
  expect(call.args).toContain(GODOT);
  expect(call.args).toContain("--headless");
  expect(call.args).toEqual(expect.arrayContaining(["--rendering-driver", "opengl3"]));
  expect(call.args).toEqual(expect.arrayContaining(["--path", godotDir]));
  expect(call.args).toContain("--import");
  expect(call.args).not.toContain("--script");
}

function testCall(call: { cmd: string; args: string[] }, godotDir: string) {
  expect(call.cmd).toBe("xvfb-run");
  expect(call.args).toEqual(expect.arrayContaining(["--rendering-driver", "opengl3"]));
  expect(call.args).toContain("--headless");
  expect(call.args).toEqual(expect.arrayContaining(["--path", godotDir]));
  expect(call.args).toContain("res://kit/test_game.gd");
  expect(call.args).not.toContain("--import");
}

describe("checkGodot", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()!();
  });

  async function setup() {
    const p = await fakeProject();
    cleanups.push(p.cleanup);
    return p;
  }

  it("skips when godot/project.godot is missing or Godot is not installed", async () => {
    const empty = await tempDir("easykit-empty-");
    cleanups.push(empty.cleanup);
    const missingBuild = await checkGodot(empty.dir, { godot: GODOT, useXvfb: true, run: async () => ({ code: 0, out: "", ms: 0 }) });
    expect(missingBuild).toEqual([{ name: "godot", ok: false, skipped: "no godot/ build", code: null, ms: 0, tail: "" }]);

    const p = await setup();
    const missingBin = await checkGodot(p.dir, { godot: null, useXvfb: true, run: async () => ({ code: 0, out: "", ms: 0 }) });
    expect(missingBin).toEqual([{ name: "godot", ok: true, skipped: "Godot not found (set EASYKIT_GODOT)", code: null, ms: 0, tail: "" }]);
  });

  it("runs a settling import and the headless test under xvfb + opengl3 when the first import succeeds", async () => {
    const p = await setup();
    const { run, calls } = scripted([
      { code: 0, out: "import 1" },
      { code: 0, out: "import 2" },
      { code: 0, out: "EASYKIT TEST OK\n52 checks\n" },
    ]);
    const runs = await checkGodot(p.dir, { godot: GODOT, run, useXvfb: true });
    expect(runs.map((r) => ({ name: r.name, ok: r.ok }))).toEqual([
      { name: "godot import", ok: true },
      { name: "godot headless test", ok: true },
    ]);
    expect(calls).toHaveLength(3);
    importCall(calls[0]!, p.godot);
    importCall(calls[1]!, p.godot);
    testCall(calls[2]!, p.godot);
  });

  it("retries a failed first import once and still passes the check when the retry and settle succeed", async () => {
    const p = await setup();
    const { run, calls } = scripted([
      { code: 1, out: "first import flake" },
      { code: 0, out: "import retry" },
      { code: 0, out: "settle" },
      { code: 0, out: "EASYKIT TEST OK" },
    ]);
    const runs = await checkGodot(p.dir, { godot: GODOT, run, useXvfb: true });
    expect(runs.every((r) => r.ok)).toBe(true);
    expect(runs[0]?.name).toBe("godot import");
    expect(calls).toHaveLength(4);
    importCall(calls[0]!, p.godot);
    importCall(calls[1]!, p.godot);
    importCall(calls[2]!, p.godot);
    testCall(calls[3]!, p.godot);
  });

  it("tolerates a warm-up import that fails twice if the settling import succeeds", async () => {
    const p = await setup();
    const { run, calls } = scripted([
      { code: 1, out: "warmup 1" },
      { code: 1, out: "warmup 2" },
      { code: 0, out: "settle" },
      { code: 0, out: "EASYKIT TEST OK" },
    ]);
    const runs = await checkGodot(p.dir, { godot: GODOT, run, useXvfb: true });
    expect(runs.every((r) => r.ok)).toBe(true);
    expect(calls).toHaveLength(4);
  });

  it("retries a failed settling import once", async () => {
    const p = await setup();
    const { run, calls } = scripted([
      { code: 0, out: "warmup" },
      { code: 1, out: "settle flake" },
      { code: 0, out: "settle retry" },
      { code: 0, out: "EASYKIT TEST OK" },
    ]);
    const runs = await checkGodot(p.dir, { godot: GODOT, run, useXvfb: true });
    expect(runs.every((r) => r.ok)).toBe(true);
    expect(calls).toHaveLength(4);
    expect(calls[1]?.args).toContain("--import");
    expect(calls[2]?.args).toContain("--import");
  });

  it("fails the import run when the settling import and its retry both fail", async () => {
    const p = await setup();
    const { run, calls } = scripted([
      { code: 0, out: "warmup" },
      { code: 1, out: "settle 1" },
      { code: 1, out: "settle 2" },
      { code: 1, out: "no test ok" },
    ]);
    const runs = await checkGodot(p.dir, { godot: GODOT, run, useXvfb: true });
    expect(runs[0]).toMatchObject({ name: "godot import", ok: false, code: 1 });
    expect(runs[1]).toMatchObject({ name: "godot headless test", ok: false });
    expect(calls).toHaveLength(4);
  });

  it("treats a zero-exit test without EASYKIT TEST OK as a failure", async () => {
    const p = await setup();
    const { run } = scripted([
      { code: 0 },
      { code: 0 },
      { code: 0, out: "ran but no marker" },
    ]);
    const runs = await checkGodot(p.dir, { godot: GODOT, run, useXvfb: true });
    expect(runs[1]).toMatchObject({ name: "godot headless test", ok: false, code: 0 });
  });
});

describe("xvfbGodot", () => {
  it("prefixes xvfb-run and injects the OpenGL 3 driver", () => {
    expect(xvfbGodot("/g", ["--headless", "--import"], true)).toEqual({
      cmd: "xvfb-run",
      args: ["-a", "-s", "-screen 0 1280x800x24", "/g", "--rendering-driver", "opengl3", "--headless", "--import"],
    });
    expect(xvfbGodot("/g", ["--headless"], false)).toEqual({
      cmd: "/g",
      args: ["--rendering-driver", "opengl3", "--headless"],
    });
  });
});

describe("install-plan/PLAN.md", () => {
  it("uses a valid project name in the smoke steps", async () => {
    const text = await readFile(path.join(import.meta.dirname, "..", "install-plan", "PLAN.md"), "utf8");
    const names = [...text.matchAll(/\b(?:new|projects\/|delete `?)([A-Za-z_][A-Za-z0-9_-]*)/g)].map((m) => m[1]!);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(NAME_RE.test(name), name).toBe(true);
    expect(text).not.toMatch(/_SmokeKit/);
  });
});
