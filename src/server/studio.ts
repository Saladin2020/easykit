/**
 * Easy Studio API — a local web UI over game.easy.json + `easy build`.
 * Mounted by createApp() under /api/studio. Binds wherever the dashboard binds (`easy studio` forces 127.0.0.1).
 * Never uploads anything: Ship runs Easy Ship in local build mode only.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { buildProject, reportMarkdown, validateProject, type BuildReport } from "../lib/build.js";
import { checkGodot, checkWeb, screenshotGodot, type CheckRun } from "../lib/check.js";
import { findAseprite, findGodot } from "../lib/doctor.js";
import { initManifest } from "../lib/init.js";
import { MANIFEST_FILE, manifestJsonSchema, parseManifest } from "../lib/manifest.js";
import { NAME_RE, TEMPLATES } from "../lib/pipeline.js";
import { shipProject } from "../lib/ship.js";
import { loadKitConfig } from "../lib/tools.js";

/** Folder names a Studio URL may address (no separators, no leading dot, so no traversal). */
export const DIR_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/;
const IMAGE_EXT = new Set([".png", ".gif", ".jpg", ".jpeg", ".webp"]);
const ASEPRITE_EXT = new Set([".png", ".aseprite", ".ase", ".gif"]);

export type Launcher = (bin: string, args: string[], cwd: string) => void;

/** Start a desktop app detached from the server (no shell for .exe; Windows .cmd/.bat shims go through cmd.exe). */
export const defaultLauncher: Launcher = (bin, args, cwd) => {
  const isCmd = process.platform === "win32" && /\.(cmd|bat)$/i.test(bin);
  const child = isCmd
    ? spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", [bin, ...args].map((a) => `"${a.replace(/"/g, "")}"`).join(" ")], { cwd, detached: true, stdio: "ignore", windowsVerbatimArguments: true })
    : spawn(bin, args, { cwd, detached: true, stdio: "ignore" });
  child.on("error", () => undefined);
  child.unref();
};

export interface StudioOptions {
  projects: string;
  launch?: Launcher;
  env?: NodeJS.ProcessEnv;
}

const fail = (e: unknown) => (e instanceof Error ? e.message : String(e));
const readJsonFile = async <T>(f: string): Promise<T | null> => {
  try {
    return JSON.parse(await readFile(f, "utf8")) as T;
  } catch {
    return null;
  }
};

/** Absolute path of `rel` inside `base`, or null when it escapes. */
export function inside(base: string, rel: string): string | null {
  const file = path.resolve(base, rel);
  return file === base || file.startsWith(base + path.sep) ? file : null;
}

async function listFiles(dir: string, exts: Set<string>, max = 400, base = dir): Promise<string[]> {
  const out: string[] = [];
  const walk = async (d: string): Promise<void> => {
    for (const e of await readdir(d, { withFileTypes: true }).catch(() => [])) {
      if (out.length >= max) return;
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (exts.has(path.extname(e.name).toLowerCase())) out.push(path.relative(base, p).split(path.sep).join("/"));
    }
  };
  await walk(dir);
  return out.sort();
}

export interface StudioProject {
  dir: string;
  root: string;
  manifest: boolean;
  legacy: boolean;
  name: string;
  title: { th: string; en: string; ms?: string } | null;
  engine: string | null;
  built: { godot: boolean; web: boolean };
  lastBuild: { ok: boolean; ms: number; startedAt: string; built: number; skipped: number; failed: number } | null;
  thumb: string | null;
  error?: string;
}

export const SHOTS_DIR = path.join(".easy", "shots");

export async function shotsOf(root: string): Promise<string[]> {
  return (await listFiles(path.join(root, SHOTS_DIR), IMAGE_EXT, 60)).filter((f) => !f.includes("/frames"));
}

export async function listStudioProjects(rootDir: string): Promise<StudioProject[]> {
  const dirs = (await readdir(rootDir, { withFileTypes: true }).catch(() => [])).filter((d) => d.isDirectory() && DIR_RE.test(d.name));
  const out: StudioProject[] = [];
  for (const d of dirs) {
    const root = path.join(rootDir, d.name);
    const hasManifest = existsSync(path.join(root, MANIFEST_FILE));
    const legacy = existsSync(path.join(root, "easykit.project.json"));
    if (!hasManifest && !legacy) continue;
    const p: StudioProject = { dir: d.name, root, manifest: hasManifest, legacy, name: d.name, title: null, engine: null, built: { godot: existsSync(path.join(root, "godot", "project.godot")), web: existsSync(path.join(root, "web", "index.html")) }, lastBuild: null, thumb: null };
    if (hasManifest) {
      const raw = await readJsonFile<{ game?: { name?: string; title?: StudioProject["title"]; engine?: string } }>(path.join(root, MANIFEST_FILE));
      if (!raw) p.error = `${MANIFEST_FILE} is not valid JSON`;
      p.name = raw?.game?.name ?? d.name;
      p.title = raw?.game?.title ?? null;
      p.engine = raw?.game?.engine ?? "both";
    } else {
      const pm = await readJsonFile<{ name?: string; engine?: string }>(path.join(root, "easykit.project.json"));
      p.name = pm?.name ?? d.name;
      p.engine = pm?.engine ?? null;
    }
    const rep = await readJsonFile<BuildReport>(path.join(root, ".easy", "build-report.json"));
    if (rep) {
      const n = (s: string) => rep.steps.filter((x) => x.status === s).length;
      p.lastBuild = { ok: rep.ok, ms: rep.ms, startedAt: rep.startedAt, built: n("built"), skipped: n("skipped"), failed: n("failed") };
    }
    p.thumb = (await shotsOf(root))[0] ?? null;
    out.push(p);
  }
  return out.sort((a, b) => Number(b.manifest) - Number(a.manifest) || a.dir.localeCompare(b.dir));
}

/** Mount the Studio routes on `app`. */
export function mountStudio(app: Hono, o: StudioOptions): void {
  const projects = path.resolve(o.projects);
  const launch = o.launch ?? defaultLauncher;
  const env = o.env ?? process.env;
  const busy = new Map<string, string>();
  const rootOf = (dir: string) => (DIR_RE.test(dir) ? path.join(projects, dir) : null);
  const claim = (dir: string, what: string) => {
    if (busy.has(dir)) return `${dir} is busy (${busy.get(dir)})`;
    busy.set(dir, what);
    return null;
  };

  app.get("/api/studio/info", (c) => {
    const cfg = loadKitConfig().config;
    return c.json({ projects, templates: TEMPLATES, platform: process.platform, godot: findGodot(cfg, env), aseprite: findAseprite(cfg, env), busy: Object.fromEntries(busy) });
  });
  app.get("/api/studio/schema", (c) => c.json(manifestJsonSchema()));
  app.get("/api/studio/projects", async (c) => c.json({ root: projects, projects: await listStudioProjects(projects), busy: Object.fromEntries(busy) }));

  // New manifest project, or `init --from` an existing Easy Kit project folder (in place).
  app.post("/api/studio/projects", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { name?: string; from?: string; template?: string };
    try {
      if (body.from) {
        const root = rootOf(body.from);
        if (!root || !existsSync(path.join(root, "easykit.project.json"))) return c.json({ error: `${body.from} is not an Easy Kit project in ${projects}` }, 400);
        await initManifest({ dir: root, from: root });
        return c.json({ ok: true, dir: body.from });
      }
      const name = String(body.name ?? "");
      if (!NAME_RE.test(name)) return c.json({ error: `name must match ${NAME_RE}` }, 400);
      const root = path.join(projects, name);
      if (existsSync(root)) return c.json({ error: `${root} already exists` }, 409);
      await mkdir(root, { recursive: true });
      await initManifest({ dir: root, name, template: body.template });
      return c.json({ ok: true, dir: name });
    } catch (e) {
      return c.json({ error: fail(e) }, 400);
    }
  });

  app.get("/api/studio/p/:dir/manifest", async (c) => {
    const root = rootOf(c.req.param("dir"));
    const file = root && path.join(root, MANIFEST_FILE);
    if (!file || !existsSync(file)) return c.json({ error: "no game.easy.json" }, 404);
    const text = await readFile(file, "utf8");
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* raw text still returned */
    }
    return c.json({ file, text, json });
  });

  app.put("/api/studio/p/:dir/manifest", async (c) => {
    const root = rootOf(c.req.param("dir"));
    if (!root || !existsSync(path.join(root, MANIFEST_FILE))) return c.json({ error: "no game.easy.json" }, 404);
    const body = (await c.req.json().catch(() => null)) as { manifest?: unknown } | null;
    const m = body?.manifest;
    if (!m || typeof m !== "object" || Array.isArray(m)) return c.json({ error: "body.manifest must be a JSON object" }, 400);
    await writeFile(path.join(root, MANIFEST_FILE), `${JSON.stringify(m, null, 2)}\n`);
    return c.json({ ok: true, issues: parseManifest(m).issues });
  });

  app.post("/api/studio/p/:dir/validate", async (c) => {
    const dir = c.req.param("dir");
    const root = rootOf(dir);
    if (!root || !existsSync(path.join(root, MANIFEST_FILE))) return c.json({ error: "no game.easy.json" }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { manifest?: unknown };
    try {
      // While a build runs, do not touch the tool workspaces (no source copy / init).
      return c.json(await validateProject(root, { draft: body.manifest, init: !busy.has(dir) }));
    } catch (e) {
      return c.json({ error: fail(e) }, 400);
    }
  });

  app.post("/api/studio/p/:dir/build", async (c) => {
    const dir = c.req.param("dir");
    const root = rootOf(dir);
    if (!root || !existsSync(path.join(root, MANIFEST_FILE))) return c.json({ error: "no game.easy.json" }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { force?: boolean; engine?: "godot" | "pixi" | "both"; ship?: boolean };
    const denied = claim(dir, "build");
    if (denied) return c.json({ error: denied }, 409);
    return streamSSE(c, async (s) => {
      const send = (event: string, data: unknown) => s.writeSSE({ event, data: JSON.stringify(data) }).catch(() => undefined);
      try {
        await send("hello", { dir });
        const report = await buildProject(root, {
          force: !!body.force,
          engine: body.engine,
          ship: !!body.ship,
          log: (l) => void send("log", l),
          onStart: (tool, title, reason) => void send("start", { tool, title, reason }),
          onStep: (st) => void send("step", st),
        });
        await send("done", { report, markdown: reportMarkdown(report) });
      } catch (e) {
        await send("fail", { error: fail(e) });
      } finally {
        busy.delete(dir);
      }
    });
  });

  app.get("/api/studio/p/:dir/report", async (c) => {
    const root = rootOf(c.req.param("dir"));
    const rep = root && (await readJsonFile<BuildReport>(path.join(root, ".easy", "build-report.json")));
    if (!rep) return c.json({ error: "not built yet" }, 404);
    return c.json({ report: rep, markdown: reportMarkdown(rep) });
  });

  app.get("/api/studio/p/:dir/shots", async (c) => {
    const root = rootOf(c.req.param("dir"));
    if (!root) return c.json({ error: "bad project" }, 400);
    const shots = await shotsOf(root);
    const times = await Promise.all(shots.map((f) => stat(path.join(root, SHOTS_DIR, f)).then((s) => s.mtime.toISOString(), () => null)));
    return c.json({ shots: shots.map((f, i) => ({ file: f, url: `/api/studio/p/${c.req.param("dir")}/shot/${f}`, mtime: times[i] })) });
  });

  app.get("/api/studio/p/:dir/shot/*", async (c) => {
    const dir = c.req.param("dir");
    const root = rootOf(dir);
    const rel = decodeURIComponent(c.req.path.slice(`/api/studio/p/${dir}/shot/`.length));
    const file = root && inside(path.join(root, SHOTS_DIR), rel);
    if (!file || !IMAGE_EXT.has(path.extname(file).toLowerCase()) || !existsSync(file)) return c.text("not found", 404);
    return new Response(new Uint8Array(await readFile(file)), { headers: { "Content-Type": path.extname(file) === ".gif" ? "image/gif" : "image/png", "Cache-Control": "no-store" } });
  });

  // Headless checks (Godot import + test, web headless Chrome) with screenshots into .easy/shots/.
  app.post("/api/studio/p/:dir/check", async (c) => {
    const dir = c.req.param("dir");
    const root = rootOf(dir);
    if (!root || !existsSync(root)) return c.json({ error: "bad project" }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { godot?: boolean; web?: boolean };
    const denied = claim(dir, "check");
    if (denied) return c.json({ error: denied }, 409);
    try {
      const shots = path.join(root, SHOTS_DIR);
      const runs: CheckRun[] = [];
      if (body.godot !== false && existsSync(path.join(root, "godot", "project.godot"))) {
        runs.push(...(await checkGodot(root)));
        await rm(path.join(shots, "godot"), { recursive: true, force: true });
        runs.push(await screenshotGodot(root, path.join(shots, "godot")));
      }
      if (body.web !== false && existsSync(path.join(root, "web", "index.html"))) {
        await rm(path.join(shots, "web"), { recursive: true, force: true });
        runs.push(await checkWeb(root, { out: path.join(shots, "web") }));
      }
      return c.json({ ok: runs.every((r) => r.ok), runs });
    } catch (e) {
      return c.json({ error: fail(e) }, 500);
    } finally {
      busy.delete(dir);
    }
  });

  app.get("/api/studio/p/:dir/assets", async (c) => {
    const root = rootOf(c.req.param("dir"));
    if (!root) return c.json({ error: "bad project" }, 400);
    const lists = await Promise.all(["assets", "content"].map(async (sub) => (await listFiles(path.join(root, sub), ASEPRITE_EXT, 300)).map((f) => `${sub}/${f}`)));
    return c.json({ assets: lists.flat() });
  });

  // Open the Godot project in the Godot editor, or an asset in Aseprite (desktop apps on this machine).
  app.post("/api/studio/p/:dir/open", async (c) => {
    const root = rootOf(c.req.param("dir"));
    if (!root || !existsSync(root)) return c.json({ error: "bad project" }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { app?: string; file?: string };
    const cfg = loadKitConfig().config;
    if (body.app === "godot") {
      const bin = findGodot(cfg, env);
      if (!bin) return c.json({ error: "Godot not found — set GODOT_BIN (e.g. C:\\ProgramData\\chocolatey\\bin\\godot.exe)" }, 404);
      const dir = path.join(root, "godot");
      if (!existsSync(path.join(dir, "project.godot"))) return c.json({ error: "no Godot build yet — run Build first" }, 400);
      launch(bin, ["--editor", "--path", dir], dir);
      return c.json({ ok: true, bin, args: ["--editor", "--path", dir] });
    }
    if (body.app === "aseprite") {
      const bin = findAseprite(cfg, env);
      if (!bin) return c.json({ error: "Aseprite not found — set ASEPRITE_BIN (e.g. C:\\Program Files (x86)\\Steam\\steamapps\\common\\Aseprite\\Aseprite.exe)" }, 404);
      const file = inside(root, String(body.file ?? ""));
      if (!file || !ASEPRITE_EXT.has(path.extname(file).toLowerCase()) || !existsSync(file)) return c.json({ error: "file must be an image/.aseprite inside the project" }, 400);
      launch(bin, [file], root);
      return c.json({ ok: true, bin, args: [file] });
    }
    return c.json({ error: "app must be godot or aseprite" }, 400);
  });

  // Ship locally: Easy Ship build + zip into .easy/ship/releases. Never uploads.
  app.post("/api/studio/p/:dir/ship", async (c) => {
    const dir = c.req.param("dir");
    const root = rootOf(dir);
    if (!root || !existsSync(path.join(root, MANIFEST_FILE))) return c.json({ error: "no game.easy.json" }, 404);
    const parsed = parseManifest(await readJsonFile(path.join(root, MANIFEST_FILE)));
    if (!parsed.manifest) return c.json({ error: "game.easy.json is invalid", issues: parsed.issues }, 400);
    const ship = parsed.manifest.ship;
    if (!ship) return c.json({ error: "add a ship section (targets) to game.easy.json first" }, 400);
    if (!existsSync(path.join(root, "easykit.project.json"))) return c.json({ error: "build the game first" }, 400);
    const denied = claim(dir, "ship");
    if (denied) return c.json({ error: denied }, 409);
    try {
      const r = await shipProject(root, { build: true, targets: ship.targets.join(","), version: ship.release, itch: ship.itch, androidPackage: ship.androidPackage });
      const releases = await listFiles(path.join(r.workspace, "releases"), new Set([".zip", ".apk", ".aab", ".exe", ".x86_64", ".html"]), 100);
      return c.json({ ok: r.ok, uploaded: false, workspace: r.workspace, releases, runs: r.runs.map((x) => ({ id: x.id, ok: x.ok, command: x.command, output: x.output.slice(-1500) })) });
    } catch (e) {
      return c.json({ error: fail(e) }, 500);
    } finally {
      busy.delete(dir);
    }
  });
}
