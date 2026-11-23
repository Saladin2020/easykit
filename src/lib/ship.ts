import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { findGodot } from "./doctor.js";
import { exists } from "./fsutil.js";
import { runCli, type ToolEnv } from "./runner.js";
import { loadKitConfig, resolveTool, type KitConfig } from "./tools.js";

/** Builds Easy Ship can make from an Easy Kit project. Web is the default; desktop needs Godot export templates. */
export const SHIP_TARGETS = ["web", "windows", "linux", "android"] as const;

export interface ShipOptions {
  /** Build + package locally (releases/ in the ship workspace). Default: plan only (writes nothing but the configs). */
  build?: boolean;
  /** Godot targets, e.g. "web,linux,windows" (the Pixi build is always web). Default "web". */
  targets?: string;
  version?: string;
  /** itch.io user/game for later manual uploads; Easy Kit never uploads. */
  itch?: string;
  /** Android application id for the Godot build (default app.easysuite.<name>); used only when targets include android. */
  androidPackage?: string;
  cfg?: KitConfig;
}

export interface ShipConfig {
  id: string;
  engine: "godot" | "pixi";
  source: string;
  targets: string;
  created: boolean;
}

export interface ShipResult {
  ok: boolean;
  workspace: string;
  mode: "plan" | "build";
  configs: ShipConfig[];
  runs: Array<{ id: string; command: string; ok: boolean; output: string }>;
  /** Always false: uploads to itch.io are a separate, explicit `easyship ship <id> --upload` by the user. */
  uploaded: false;
}

/** A valid Android application id from a project name: app.easysuite.<letters/digits/_>. */
export function androidPackageFor(name: string): string {
  let seg = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!seg) seg = "game";
  if (!/^[a-z]/.test(seg)) seg = `g${seg}`;
  return `app.easysuite.${seg}`;
}

export const ANDROID_PACKAGE_RE = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/;

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "game";

/** Godot / Pixi ship configs for an Easy Kit project, then `easyship plan` (default) or `easyship ship --build`. Never uploads. */
export async function shipProject(root: string, opts: ShipOptions = {}): Promise<ShipResult> {
  const mpath = path.join(root, "easykit.project.json");
  if (!(await exists(mpath))) throw new Error(`${root} is not an Easy Kit project (no easykit.project.json)`);
  const m = JSON.parse(await readFile(mpath, "utf8")) as { name: string };
  const tool = resolveTool("ship", opts.cfg ?? loadKitConfig().config);
  if (!tool.home) throw new Error("Easy Ship is not installed (set EASYSHIP_HOME or put easyship next to Easy Kit) — run `easykit doctor`");
  const targets = (opts.targets ?? "web").split(",").map((t) => t.trim()).filter(Boolean);
  const bad = targets.filter((t) => !(SHIP_TARGETS as readonly string[]).includes(t));
  if (bad.length) throw new Error(`unknown ship target(s): ${bad.join(", ")} (use ${SHIP_TARGETS.join(", ")})`);
  const androidPkg = targets.includes("android") ? opts.androidPackage ?? androidPackageFor(m.name) : undefined;
  if (androidPkg && !ANDROID_PACKAGE_RE.test(androidPkg)) throw new Error(`bad Android package "${androidPkg}" (e.g. app.studio.mygame: dot-separated, each part starts with a letter)`);
  const workspace = path.join(root, ".easy", "ship");
  await mkdir(workspace, { recursive: true });
  const env: ToolEnv = { home: tool.home, workspace, allowed: [root] };
  // Easy Ship finds Godot through EASYSHIP_GODOT; hand it the binary Easy Kit already uses for checks.
  const cfg = opts.cfg ?? loadKitConfig().config;
  const godot = process.env.EASYSHIP_GODOT ?? findGodot(cfg);
  const extraEnv: NodeJS.ProcessEnv = godot ? { EASYSHIP_GODOT: godot } : {};
  const kitJson = async (dir: string) => {
    for (const p of [path.join(root, dir, "kit", "kit.json")]) if (await exists(p)) return JSON.parse(await readFile(p, "utf8")) as { title?: Record<string, string> };
    return {};
  };
  const id = slug(m.name);
  const configs: ShipConfig[] = [];
  if (await exists(path.join(root, "godot", "project.godot"))) configs.push({ id, engine: "godot", source: path.join(root, "godot"), targets: targets.join(","), created: false });
  if (await exists(path.join(root, "web", "index.html"))) configs.push({ id: `${id}-web`, engine: "pixi", source: path.join(root, "web"), targets: "web", created: false });
  if (!configs.length) throw new Error(`${root} has no godot/ or web/ build — run \`easykit build\` first`);
  const runs: ShipResult["runs"] = [];
  const run = async (cid: string, args: string[]) => {
    try {
      const r = await runCli("ship", env, args, { timeoutMs: 900_000, env: extraEnv });
      runs.push({ id: cid, command: `easyship ${args.join(" ")}`, ok: true, output: (r.stdout + r.stderr).trim() });
      return true;
    } catch (e) {
      const detail = (e as { detail?: string }).detail ?? "";
      runs.push({ id: cid, command: `easyship ${args.join(" ")}`, ok: false, output: `${e instanceof Error ? e.message : String(e)}\n${detail}`.trim() });
      return false;
    }
  };
  for (const c of configs) {
    const title = (await kitJson(c.engine === "godot" ? "godot" : "web")).title ?? {};
    if (!(await exists(path.join(workspace, "ships", `${c.id}.easyship.json`)))) {
      // (no --version here: easyship's program-level -V/--version swallows it; the version is written below)
      const args = ["new", c.id, "--source", c.source, "--engine", c.engine, "--targets", c.targets];
      for (const l of ["th", "en", "ms"] as const) args.push(`--${l}`, title[l] ?? m.name);
      if (opts.itch) args.push("--itch", opts.itch);
      if (c.engine === "godot" && androidPkg) args.push("--android-package", androidPkg);
      c.created = await run(c.id, args);
      const cfgPath = path.join(workspace, "ships", `${c.id}.easyship.json`);
      if (c.created && opts.version && (await exists(cfgPath))) {
        const j = JSON.parse(await readFile(cfgPath, "utf8")) as { version?: string };
        j.version = opts.version;
        await writeFile(cfgPath, JSON.stringify(j, null, 2) + "\n");
      }
    } else if (c.engine === "godot" && androidPkg) {
      // an existing config made before android was asked for: add the package (and the target) once, keep the rest
      const cfgPath = path.join(workspace, "ships", `${c.id}.easyship.json`);
      const j = JSON.parse(await readFile(cfgPath, "utf8")) as { targets?: string[]; android?: { package?: string } };
      let changed = false;
      if (!j.android?.package) {
        j.android = { ...(j.android ?? {}), package: androidPkg };
        changed = true;
      }
      if (Array.isArray(j.targets) && !j.targets.includes("android")) {
        j.targets.push("android");
        changed = true;
      }
      if (changed) await writeFile(cfgPath, JSON.stringify(j, null, 2) + "\n");
    }
    // `ship` without --upload: a plan is a dry run, --build builds and zips locally. --upload is never passed here.
    await run(c.id, opts.build ? ["ship", c.id, "--build", "--targets", c.targets] : ["plan", c.id, "--targets", c.targets]);
  }
  return { ok: runs.every((r) => r.ok), workspace, mode: opts.build ? "build" : "plan", configs, runs, uploaded: false };
}
