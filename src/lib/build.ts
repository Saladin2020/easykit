/**
 * `easy build` / `easy validate` over game.easy.json: prepare the 17 tool workspaces, copy project sources in,
 * check every cross-reference, run each tool's step in dependency order (skipping steps whose inputs are unchanged),
 * assemble the Godot / Pixi games and write a build report. Running it twice in a row does nothing the second time.
 */
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { assembleGodot } from "./godot.js";
import { assemblePixi } from "./pixi.js";
import { readCatalog } from "./catalog.js";
import { doctor } from "./doctor.js";
import { exists, readJson, walk, writeJson } from "./fsutil.js";
import { SOURCE_DIR, loadManifest, manifestToTemplate, parseManifest, type GameManifest, type Issue } from "./manifest.js";
import { STEPS, STEP_TITLES, initTool, loadTemplate, makeCtx, templateDir, type Ctx, type ProjectManifest, type StepResult, type Template } from "./pipeline.js";
import { shipProject } from "./ship.js";
import { BUILD_IDS, TOOLS, kitRoot, loadKitConfig, resolveAll, type KitConfig, type ToolId } from "./tools.js";
import { crossCheck } from "./validate.js";

/** Which other steps' output each step reads (everything else is independent). */
export const STEP_DEPS: Record<ToolId, ToolId[]> = {
  sprite: [],
  portrait: ["sprite"],
  scene: ["sprite"],
  tilemap: ["sprite"],
  dialogue: ["portrait"],
  npc: [],
  quest: ["dialogue"],
  font: [],
  ui: [],
  sfx: [],
  fx: [],
  music: [],
  anim: ["sprite"],
  items: [],
  battle: ["sprite"],
  save: ["dialogue", "quest", "ui", "items"],
  action: ["battle"],
  interior: ["scene"],
  ship: [],
};

/** The template keys each step reads (so editing one section rebuilds only what uses it). */
const STEP_INPUTS: Record<ToolId, Array<keyof Template>> = {
  sprite: ["sprite", "palette"],
  portrait: ["portrait"],
  scene: ["scene"],
  tilemap: ["tilemap", "sprite"],
  dialogue: ["dialogue", "portrait"],
  npc: ["npc", "systems"],
  quest: ["quest", "dialogue"],
  font: ["font"],
  ui: ["ui", "viewport"],
  sfx: ["sfx"],
  fx: ["fx"],
  music: ["music"],
  anim: ["anim", "sprite"],
  items: ["items"],
  battle: ["battle"],
  save: ["save", "dialogue", "quest", "ui"],
  action: ["action", "systems", "battle"],
  interior: ["scene"],
  ship: [],
};

/** Dependency order: a stable topological sort (ties keep pipeline order). Throws on a cycle. */
export function buildOrder(tools: readonly ToolId[], deps: Record<ToolId, ToolId[]> = STEP_DEPS): ToolId[] {
  const want = new Set(tools);
  const done: ToolId[] = [];
  const left = [...tools];
  while (left.length) {
    const i = left.findIndex((t) => deps[t].every((d) => !want.has(d) || done.includes(d)));
    if (i < 0) throw new Error(`dependency cycle among: ${left.join(", ")}`);
    done.push(left.splice(i, 1)[0]!);
  }
  return done;
}

const sha = (x: unknown) => createHash("sha256").update(typeof x === "string" ? x : JSON.stringify(x)).digest("hex");

/** Content hash of a folder (skips exports/, node_modules/, .godot/). */
async function hashDir(dir: string): Promise<string> {
  if (!(await exists(dir))) return "none";
  const h = createHash("sha256");
  for (const rel of (await walk(dir)).filter((r) => !/(^|\/)(exports|node_modules|\.godot)(\/|$)/.test(r)).sort()) {
    h.update(rel + "\0");
    h.update(await readFile(path.join(dir, rel)));
  }
  return h.digest("hex");
}

/** `content/items/*.easyitems.json` → matching files (a `*` is allowed in the file name only). */
export async function expandSources(root: string, patterns: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const p of patterns) {
    const abs = path.resolve(root, p);
    const base = path.basename(abs);
    if (!base.includes("*")) {
      if (!(await exists(abs))) throw new Error(`source not found: ${p}`);
      out.push(abs);
      continue;
    }
    const re = new RegExp(`^${base.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
    const hits = (await readdir(path.dirname(abs)).catch(() => [] as string[])).filter((f) => re.test(f)).sort();
    if (!hits.length) throw new Error(`no files match source ${p}`);
    out.push(...hits.map((f) => path.join(path.dirname(abs), f)));
  }
  return out;
}

/** Workspace folder for one source file: the tool's documents folder, or strings/ for Easy Save string tables (th / en / ms translations). */
export function sourceDir(tool: ToolId, file: string): string | undefined {
  if (tool === "save" && file.endsWith(".easyi18n.json")) return "strings";
  return SOURCE_DIR[tool];
}

const SECTION_OF: Partial<Record<ToolId, keyof GameManifest>> = {
  sprite: "sprites", portrait: "portraits", scene: "scenes", tilemap: "tilemaps", npc: "npcs", dialogue: "dialogue", quest: "quests",
  items: "items", battle: "battle", ui: "ui", fx: "fx", sfx: "sfx", music: "music", anim: "anim", save: "save", action: "action",
};
export function sourcesOf(m: GameManifest, tool: ToolId): string[] {
  const s = SECTION_OF[tool] ? (m[SECTION_OF[tool]!] as { sources?: string[] } | undefined) : undefined;
  return s?.sources ?? [];
}

export interface BuildState {
  format: "easy-build-state/1";
  steps: Partial<Record<ToolId, { hash: string; post: string; outputs: string[]; notes: string[] }>>;
  assemble: Partial<Record<"godot" | "pixi", { hash: string; report: unknown }>>;
  choices: Record<string, unknown>;
}

export interface BuildStepReport {
  tool: ToolId | "kit";
  title: string;
  status: "built" | "skipped" | "failed" | "not-installed";
  reason: string;
  ms: number;
  outputs: string[];
  notes: string[];
  error?: string;
}
export interface BuildReport {
  format: "easy-build-report/1";
  game: { name: string; title: GameManifest["game"]["title"]; engine: string };
  startedAt: string;
  ms: number;
  ok: boolean;
  order: ToolId[];
  steps: BuildStepReport[];
  issues: Issue[];
  ship?: unknown;
}

export interface Prepared {
  root: string;
  manifest: GameManifest;
  tpl: Template;
  ctx: Ctx;
  issues: Issue[];
  /** Tools that are not installed (their steps are skipped). */
  absent: ToolId[];
}

/** Load + schema-check the manifest, init missing workspaces, copy sources in, then cross-check every id. */
export async function prepare(
  root: string,
  opts: { cfg?: KitConfig; log?: (l: string) => void; init?: boolean; engine?: GameManifest["game"]["engine"]; state?: BuildState; /** validate this (unsaved) manifest instead of the file */ draft?: unknown } = {},
): Promise<{ issues: Issue[]; prepared: Prepared | null }> {
  root = path.resolve(root);
  const log = opts.log ?? (() => undefined);
  const loaded = opts.draft !== undefined ? parseManifest(opts.draft) : await loadManifest(root);
  if (!loaded.manifest) return { issues: loaded.issues, prepared: null };
  const m = loaded.manifest;
  const tpl = manifestToTemplate(m, await loadTemplate(m.game.base));
  const tools = resolveAll(opts.cfg ?? loadKitConfig().config);
  const ctx = makeCtx({ root, name: m.game.name, seed: m.game.seed, engine: opts.engine ?? m.game.engine, tpl, tools, log, choices: { ...(opts.state?.choices ?? {}) } });
  ctx.choices.font = tpl.font;
  const absent = BUILD_IDS.filter((t) => !tools[t].home);
  const issues: Issue[] = [];
  if (opts.init !== false) {
    for (const t of BUILD_IDS) {
      if (absent.includes(t)) continue;
      await initTool(ctx, t);
      const files = await expandSources(root, sourcesOf(m, t)).catch((e: Error) => {
        issues.push({ severity: "error", code: "sources", path: `${SECTION_OF[t]}.sources`, th: `ไม่พบไฟล์ต้นฉบับ: ${e.message}`, en: e.message });
        return [] as string[];
      });
      for (const f of files) {
        const into = sourceDir(t, f);
        if (!into) continue;
        await mkdir(path.join(ctx.ws(t), into), { recursive: true });
        await copyFile(f, path.join(ctx.ws(t), into, path.basename(f)));
      }
    }
  }
  const catalog = await readCatalog(ctx.ws, (t) => (tools[t].home ? ctx.env(t) : null));
  issues.push(...crossCheck(m, catalog));
  for (const t of absent) issues.push({ severity: "warning", code: "tool.absent", path: SECTION_OF[t] ?? t, th: `ไม่ได้ติดตั้ง ${TOOLS[t].name} (ตั้งค่า ${TOOLS[t].env}_HOME) จะข้ามขั้นตอนนี้`, en: `${TOOLS[t].name} is not installed (set ${TOOLS[t].env}_HOME); its step is skipped` });
  return { issues, prepared: { root, manifest: m, tpl, ctx, issues, absent } };
}

export async function validateProject(root: string, opts: { cfg?: KitConfig; init?: boolean; draft?: unknown } = {}): Promise<{ ok: boolean; issues: Issue[] }> {
  const { issues } = await prepare(root, opts);
  return { ok: !issues.some((i) => i.severity === "error"), issues };
}

function toolStamp(c: Ctx, t: ToolId, rep: ReturnType<typeof doctor>): unknown {
  const r = rep.tools.find((x) => x.id === t);
  return { version: r?.version ?? null, commit: r?.git?.commit ?? null, dirty: r?.git?.dirty ?? false };
}

export interface BuildOptions {
  cfg?: KitConfig;
  log?: (l: string) => void;
  engine?: GameManifest["game"]["engine"];
  /** Rebuild every step even if unchanged. */
  force?: boolean;
  /** Only these tools (plus nothing else; their inputs must already be built). */
  only?: ToolId[];
  /** Run Easy Ship (local packaging only) for manifest.ship.targets after assembling. */
  ship?: boolean;
  /** Called when a step starts running (not for skipped steps). */
  onStart?: (tool: string, title: string, reason: string) => void;
  /** Called with every step result as soon as it is known (built / skipped / failed / not-installed). */
  onStep?: (step: BuildStepReport) => void;
}

export async function buildProject(rootIn: string, opts: BuildOptions = {}): Promise<BuildReport> {
  const t0 = Date.now();
  const root = path.resolve(rootIn);
  const log = opts.log ?? (() => undefined);
  const statePath = path.join(root, ".easy", "build-state.json");
  const state: BuildState = (await exists(statePath)) ? await readJson<BuildState>(statePath) : { format: "easy-build-state/1", steps: {}, assemble: {}, choices: {} };
  const { issues, prepared } = await prepare(root, { ...opts, state });
  const report: BuildReport = {
    format: "easy-build-report/1",
    game: prepared ? { name: prepared.manifest.game.name, title: prepared.manifest.game.title, engine: prepared.ctx.engine } : { name: path.basename(root), title: { th: "", en: "", ms: "" }, engine: "" },
    startedAt: new Date(t0).toISOString(),
    ms: 0,
    ok: false,
    order: [],
    steps: [],
    issues,
  };
  const finish = async () => {
    report.ms = Date.now() - t0;
    report.ok = !report.issues.some((i) => i.severity === "error") && report.steps.every((s) => s.status !== "failed");
    await writeJson(path.join(root, ".easy", "build-report.json"), report);
    await writeFile(path.join(root, "BUILD-REPORT.md"), reportMarkdown(report));
    return report;
  };
  const pushStep = (st: BuildStepReport) => {
    report.steps.push(st);
    opts.onStep?.(st);
  };
  if (!prepared || issues.some((i) => i.severity === "error")) return finish();

  const { ctx, tpl, manifest: m } = prepared;
  const rep = doctor({ cfg: opts.cfg, engines: false });
  const kitVersion = (await readJson<{ version: string }>(path.join(kitRoot(), "package.json"))).version;
  const order = buildOrder(BUILD_IDS);
  report.order = order;
  const hashes: Partial<Record<ToolId, string>> = {};
  const pm: ProjectManifest = {
    format: "easykit-project/1",
    name: m.game.name,
    id: ctx.id,
    template: m.game.base,
    engine: ctx.engine,
    seed: m.game.seed,
    createdAt: new Date(t0).toISOString(),
    kit: { version: kitVersion },
    tools: Object.fromEntries(rep.tools.map((t) => [t.id, { version: t.version, commit: t.git?.commit ?? null, dirty: t.git?.dirty ?? false, home: t.home }])),
    choices: ctx.choices,
    steps: [],
    ok: false,
  };
  const old = (await exists(path.join(root, "easykit.project.json"))) ? await readJson<ProjectManifest>(path.join(root, "easykit.project.json")).catch(() => null) : null;
  if (old?.createdAt) pm.createdAt = old.createdAt;

  for (const tool of order) {
    const title = STEP_TITLES[tool];
    if (prepared.absent.includes(tool)) {
      pushStep({ tool, title, status: "not-installed", reason: `${TOOLS[tool].env}_HOME not set`, ms: 0, outputs: [], notes: [] });
      continue;
    }
    const hash = sha({
      tool,
      kit: kitVersion,
      seed: m.game.seed,
      inputs: STEP_INPUTS[tool].map((k) => tpl[k] ?? null),
      stamp: toolStamp(ctx, tool, rep),
      upstream: STEP_DEPS[tool].map((d) => hashes[d] ?? null),
    });
    // downstream steps see this step's inputs *and* its resulting workspace (so an edited source rebuilds its dependants)
    const settle = () => (hashes[tool] = sha([hash, state.steps[tool]?.post ?? null]));
    const prev = state.steps[tool];
    const s0 = Date.now();
    const selected = !opts.only || opts.only.includes(tool);
    let reason = opts.force ? "--force" : !prev ? "first build" : prev.hash !== hash ? "inputs changed" : "";
    if (!reason && prev) {
      if ((await hashDir(ctx.ws(tool))) !== prev.post) reason = "workspace edited";
      else if (!(await Promise.all(prev.outputs.map((o) => exists(path.join(root, o))))).every(Boolean)) reason = "outputs missing";
    }
    if (!reason || !selected) {
      pushStep({ tool, title, status: "skipped", reason: selected ? "unchanged" : "not in --only", ms: 0, outputs: prev?.outputs ?? [], notes: prev?.notes ?? [] });
      pm.steps.push({ tool, title, ok: true, ms: 0, outputs: prev?.outputs ?? [], notes: prev?.notes ?? [] });
      settle();
      continue;
    }
    log(`[${TOOLS[tool].name}] ${title} (${reason})…`);
    opts.onStart?.(tool, title, reason);
    const notes: string[] = [];
    try {
      const outputs = await STEPS[tool](ctx, notes);
      state.steps[tool] = { hash, post: await hashDir(ctx.ws(tool)), outputs, notes };
      state.choices = { ...ctx.choices };
      settle();
      pushStep({ tool, title, status: "built", reason, ms: Date.now() - s0, outputs, notes });
      pm.steps.push({ tool, title, ok: true, ms: Date.now() - s0, outputs, notes });
      await writeJson(statePath, state);
    } catch (e) {
      const err = e as Error & { detail?: string };
      delete state.steps[tool];
      await writeJson(statePath, state);
      const error = `${err.message}${err.detail ? `\n${err.detail}` : ""}`;
      pushStep({ tool, title, status: "failed", reason, ms: Date.now() - s0, outputs: [], notes, error });
      pm.steps.push({ tool, title, ok: false, ms: Date.now() - s0, outputs: [], notes, error });
      await writeJson(path.join(root, "easykit.project.json"), pm);
      return finish();
    }
  }

  // Assembly: the kit glue (template dir) + every step + the whole template.
  const glue = await hashDir(templateDir(m.game.base));
  for (const [engine, dir, fn, title] of [
    ["godot", "godot", assembleGodot, "assemble Godot 4.3+ project"],
    ["pixi", "web", assemblePixi, "assemble PixiJS web build"],
  ] as const) {
    if (ctx.engine !== engine && ctx.engine !== "both") continue;
    const hash = sha({ engine, kit: kitVersion, glue, tpl, choices: ctx.choices, steps: hashes, posts: Object.fromEntries(Object.entries(state.steps).map(([k, v]) => [k, v?.post])) });
    const prev = state.assemble[engine];
    const marker = path.join(root, dir, engine === "godot" ? "project.godot" : "index.html");
    const s0 = Date.now();
    let reason = opts.force ? "--force" : !prev ? "first build" : prev.hash !== hash ? "inputs changed" : !(await exists(marker)) ? "output missing" : "";
    if (!reason && prev) {
      pushStep({ tool: "kit", title, status: "skipped", reason: "unchanged", ms: 0, outputs: [`${dir}/`], notes: [] });
      if (engine === "godot") pm.godot = prev.report as ProjectManifest["godot"];
      else pm.web = prev.report as ProjectManifest["web"];
      pm.steps.push({ tool: "kit", title, ok: true, ms: 0, outputs: [`${dir}/`], notes: ["unchanged"] });
      continue;
    }
    log(`[Easy Kit] ${title} (${reason})…`);
    opts.onStart?.("kit", title, reason);
    // keep Godot's import cache (.godot/) so a rebuild does not re-import every texture
    if (engine === "godot") {
      for (const f of await readdir(path.join(root, dir)).catch(() => [] as string[])) if (f !== ".godot") await rm(path.join(root, dir, f), { recursive: true, force: true });
    } else await rm(path.join(root, dir), { recursive: true, force: true });
    const r = await fn(ctx);
    if (engine === "godot") pm.godot = r as ProjectManifest["godot"];
    else pm.web = r as ProjectManifest["web"];
    state.assemble[engine] = { hash, report: r };
    await writeJson(statePath, state);
    pushStep({ tool: "kit", title, status: "built", reason, ms: Date.now() - s0, outputs: [`${dir}/`], notes: [`${r.files} files`] });
    pm.steps.push({ tool: "kit", title, ok: true, ms: Date.now() - s0, outputs: [`${dir}/`], notes: [`${r.files} files`] });
  }
  pm.choices = ctx.choices;
  pm.ok = pm.steps.every((s) => s.ok);
  await writeJson(path.join(root, "easykit.project.json"), pm);
  if (!(await exists(path.join(root, ".gitignore")))) await writeFile(path.join(root, ".gitignore"), ".easy/*/exports/\n.easy/*/node_modules/\n.easy/build-state.json\ngodot/.godot/\n*.import\n");

  if (opts.ship && m.ship && !prepared.absent.includes("ship")) {
    const s0 = Date.now();
    opts.onStart?.("ship", "package releases (local only, never uploads)", "--ship");
    try {
      report.ship = await shipProject(root, { build: true, targets: m.ship.targets.join(","), version: m.ship.release, itch: m.ship.itch, androidPackage: m.ship.androidPackage, cfg: opts.cfg });
      pushStep({ tool: "ship", title: "package releases (local only, never uploads)", status: "built", reason: "--ship", ms: Date.now() - s0, outputs: [".easy/ship/releases/"], notes: [m.ship.targets.join(", ")] });
    } catch (e) {
      pushStep({ tool: "ship", title: "package releases", status: "failed", reason: "--ship", ms: Date.now() - s0, outputs: [], notes: [], error: (e as Error).message });
    }
  }
  return finish();
}

export function reportMarkdown(r: BuildReport): string {
  const icon = { built: "✅ built", skipped: "⏭ skipped", failed: "❌ failed", "not-installed": "➖ not installed" } as const;
  const lines = [
    `# Build report — ${r.game.title.th} / ${r.game.title.en}`,
    "",
    `${r.ok ? "✅ OK" : "❌ FAILED"} · engine ${r.game.engine || "-"} · ${(r.ms / 1000).toFixed(1)} s · ${r.startedAt}`,
    "",
  ];
  if (r.issues.length) {
    lines.push("## Issues / ปัญหา", "");
    for (const i of r.issues) lines.push(`- ${i.severity === "error" ? "❌" : "⚠️"} \`${i.path}\` — ${i.th}  `, `  ${i.en}`);
    lines.push("");
  }
  if (r.steps.length) {
    lines.push("## Steps", "", "| # | Tool | Step | Status | Why | Time | Notes |", "|---|---|---|---|---|---|---|");
    r.steps.forEach((s, n) => lines.push(`| ${n + 1} | ${s.tool === "kit" ? "Easy Kit" : TOOLS[s.tool].name} | ${s.title} | ${icon[s.status]} | ${s.reason} | ${(s.ms / 1000).toFixed(1)} s | ${(s.error ?? s.notes.join("; ")).replace(/\|/g, "\\|").replace(/\n/g, " ").slice(0, 300)} |`));
    lines.push("");
  }
  return lines.join("\n");
}


