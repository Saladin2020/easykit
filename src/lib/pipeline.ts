import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { assembleGodot } from "./godot.js";
import { assemblePixi } from "./pixi.js";
import { copyTree, exists, readJson, rng, writeJson } from "./fsutil.js";
import { ToolMcp, runCli, type ToolEnv } from "./runner.js";
import { BUILD_IDS, CORE_TOOL_IDS, TOOLS, TOOL_IDS, kitRoot, loadKitConfig, resolveAll, type KitConfig, type ResolvedTool, type ToolId } from "./tools.js";
import { doctor } from "./doctor.js";

export const TEMPLATES = ["village_delivery"] as const;
export type TemplateId = (typeof TEMPLATES)[number];
export const ENGINES = ["godot", "pixi", "both"] as const;
export type Engine = (typeof ENGINES)[number];

export interface CastMember {
  id: string;
  base: string;
  recolor?: string;
  map?: string;
  at?: [number, number];
  facing?: string;
}

export interface Template {
  id: TemplateId;
  name: Record<"th" | "en" | "ms", string>;
  summary: string;
  viewport: { width: number; height: number };
  palette: string[];
  sprite: { player: string; cast: CastMember[]; side: CastMember[] };
  scene: { id: string; cameraRange: [number, number]; actor: string };
  tilemap: { map: string };
  dialogue: { id: string; style: string; segments: string[] };
  quest: { id: string; main: string };
  ui: { doc: string; theme: string };
  sfx: { bank: string; seeded: Array<{ id: string; preset: string }> };
  fx: { seeded: Array<{ id: string; from: string }>; export: string[] };
  music: { seeded: Array<{ id: string; from: string }>; export: string[]; world: string; shop: string };
  anim: { cutscene: string };
  items: { shop: string };
  save: { schema: string };
  npcs: Record<string, { role: "quest" | "shop" | "bark"; speaker?: string; shop?: string }>;
  /** Easy Portrait: town_* sets rebuilt from the generated cast (replace Easy Dialogue's samples); keep = sample ids kept. */
  portrait?: { sets: Array<{ id: string; from: string; th: string; en: string; ms: string }>; keep?: string[] };
  /** Easy NPC: kit map name → Easy NPC id (these villagers follow their daily schedule); clock start + speed. */
  npc?: { map: Record<string, string>; start?: string; secondsPerMinute?: number };
  /** Easy Font ids for the HUD, small text and the dialogue box. */
  font?: { hud: string; small: string; dialogue: string };
  /** Easy Battle: encounter table, the field zone in tiles [x0, y0, x1, y1], party and hero sheets from Easy Sprite. */
  battle?: { table: string; zone: [number, number, number, number]; culture: string; ground: string; party: Array<{ id: string; level: number }>; heroSheets?: Record<string, string>; firstSeed?: number };
}

export function templateDir(id: string): string {
  return path.join(kitRoot(), "templates", id);
}

export async function loadTemplate(id: string): Promise<Template> {
  if (!(TEMPLATES as readonly string[]).includes(id)) throw new Error(`Unknown template "${id}" (have: ${TEMPLATES.join(", ")})`);
  return readJson<Template>(path.join(templateDir(id), "template.json"));
}

export interface NewProjectOptions {
  name: string;
  /** Parent folder (the project is created at <dir>/<name>). */
  dir?: string;
  template?: string;
  engine?: Engine;
  seed?: number;
  /** Replace an existing project folder. */
  force?: boolean;
  cfg?: KitConfig;
  log?: (line: string) => void;
}

export interface StepResult {
  tool: ToolId | "kit";
  title: string;
  ok: boolean;
  ms: number;
  outputs: string[];
  notes: string[];
  error?: string;
}

export interface ProjectManifest {
  format: "easykit-project/1";
  name: string;
  id: string;
  template: TemplateId;
  engine: Engine;
  seed: number;
  createdAt: string;
  kit: { version: string };
  tools: Record<string, { version: string | null; commit: string | null; dirty: boolean; home: string | null }>;
  choices: Record<string, unknown>;
  steps: StepResult[];
  godot?: Awaited<ReturnType<typeof assembleGodot>>;
  web?: Awaited<ReturnType<typeof assemblePixi>>;
  ok: boolean;
}

export const NAME_RE = /^[A-Za-z][A-Za-z0-9_-]{0,47}$/;

export function projectId(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .toLowerCase()
    .replace(/^_+|_+$/g, "");
}

export interface Ctx {
  root: string;
  name: string;
  id: string;
  seed: number;
  engine: Engine;
  tpl: Template;
  tools: Record<ToolId, ResolvedTool>;
  env: (tool: ToolId) => ToolEnv;
  ws: (tool: ToolId) => string;
  assets: string;
  choices: Record<string, unknown>;
  log: (line: string) => void;
}

/** What each step makes (Easy Ship is not a build step: see `easykit ship`). */
export const STEP_TITLES: Record<ToolId, string> = {
  sprite: "characters → top-down + side-view sheets",
  portrait: "dialogue portraits from the cast (blink + talk)",
  npc: "villager schedules + day clock",
  font: "มะขาม pixel font for HUD + dialogue",
  battle: "paddy-field encounters + party",
  ship: "release builds (easykit ship)",
  scene: "title backdrop from a side-view scene",
  tilemap: "village map with the generated cast",
  dialogue: "NPC dialogue + dialogue box",
  quest: "quest graph + quest manager",
  ui: "UI theme + HUD",
  sfx: "sound bank (seeded coin)",
  fx: "particle effects (seeded coin burst)",
  music: "background music (seeded village theme)",
  anim: "intro cutscene with the generated actors",
  items: "item database + shop",
  save: "save schema + th/en/ms string tables",
};

const cli = (c: Ctx, tool: ToolId, args: string[], workspaceFlag = true) => runCli(tool, c.env(tool), args, { workspaceFlag });

async function initTool(c: Ctx, tool: ToolId): Promise<void> {
  await mkdir(c.ws(tool), { recursive: true });
  // Easy Sprite's init works on the current folder; the others take --workspace.
  await cli(c, tool, ["init"], tool !== "sprite");
}

type StepFn = (c: Ctx, notes: string[]) => Promise<string[]>;

const STEPS: Record<ToolId, StepFn> = {
  async sprite(c, notes) {
    await initTool(c, "sprite");
    const ws = c.ws("sprite");
    const r = rng(c.seed);
    const shirt = c.tpl.palette[Math.floor(r() * c.tpl.palette.length)] ?? "#3a7bd5";
    c.choices.playerShirt = shirt;
    const mcp = new ToolMcp("sprite", c.env("sprite"));
    const outputs: string[] = [];
    try {
      const make = async (m: CastMember, sub: string) => {
        const base = await readJson<Record<string, any>>(path.join(ws, "projects", `${m.base}.json`));
        const id = `kit_${m.id}`;
        const colors = { ...(base.colors ?? {}) };
        if (m.recolor) colors[m.recolor] = shirt;
        await writeJson(path.join(ws, "projects", `${id}.json`), { ...base, id, name: `${base.name} (${c.name})`, colors, updatedAt: new Date().toISOString() });
        const res = await mcp.call<{ paths: string[]; warnings: string[] }>("export_character", { projectId: id, preset: "native", dir: path.join(c.assets, sub), baseName: m.id });
        if (res.warnings?.length) notes.push(`${m.id}: ${res.warnings.join("; ")}`);
        outputs.push(...res.paths.map((p) => path.relative(c.root, p)));
      };
      for (const m of c.tpl.sprite.cast) await make(m, "sprites");
      for (const m of c.tpl.sprite.side) await make(m, "sprites/side");
    } finally {
      await mcp.close();
    }
    notes.push(`player shirt ${shirt} (seed ${c.seed})`, `${c.tpl.sprite.cast.length} top-down + ${c.tpl.sprite.side.length} side-view sheets`);
    return outputs;
  },

  async scene(c, notes) {
    await initTool(c, "scene");
    const [lo, hi] = c.tpl.scene.cameraRange;
    const r = rng(c.seed * 7 + 3);
    const cam = Math.round(lo + r() * (hi - lo));
    const actor = path.join(c.assets, "sprites", "side", `${c.tpl.scene.actor}.png`);
    const out = path.join(c.assets, "scene", "title.png");
    await mkdir(path.dirname(out), { recursive: true });
    await cli(c, "scene", ["render", "--id", c.tpl.scene.id, "--mode", "viewport", "--camera", String(cam), "--character", `${actor}:${cam + 120}:right:idle`, "--out", out]);
    c.choices.titleCamera = cam;
    notes.push(`${c.tpl.scene.id} viewport at x=${cam} with the player's side sheet`);
    return [path.relative(c.root, out)];
  },

  async tilemap(c, notes) {
    await initTool(c, "tilemap");
    const ws = c.ws("tilemap");
    const map = c.tpl.tilemap.map;
    const doc = await readJson<{ characters: Array<{ name: string; x: number; y: number; facing?: string; anim?: string; patrol?: { path: number[][]; speed: number } }> }>(path.join(ws, "maps", `${map}.json`));
    for (const m of c.tpl.sprite.cast) {
      for (const ext of ["png", "json"]) await copyFile(path.join(c.assets, "sprites", `${m.id}.${ext}`), path.join(ws, "characters", `kit_${m.id}.${ext}`));
      const prev = doc.characters.find((ch) => ch.name === (m.map ?? m.id));
      const at = m.at ?? (prev ? [prev.x, prev.y] : null);
      if (!at) {
        notes.push(`${m.id}: no map position, skipped`);
        continue;
      }
      const args = ["character", map, "--sheet", `characters/kit_${m.id}.png`, "--at", `${at[0]},${at[1]}`, "--name", m.map ?? m.id, "--facing", m.facing ?? prev?.facing ?? "front"];
      if (prev?.patrol) args.push("--anim", "walk", "--patrol", prev.patrol.path.map((p) => p.join(",")).join(";"), "--speed", String(prev.patrol.speed));
      await cli(c, "tilemap", args);
    }
    await cli(c, "tilemap", ["export", map, "--preset", "all"]);
    notes.push(`${map}: ${c.tpl.sprite.cast.length} characters from Easy Sprite (others keep the tilemap's own sheets)`);
    return [`.easy/tilemap/exports/${map}-godot`, `.easy/tilemap/exports/${map}-pixi`, `.easy/tilemap/exports/${map}-png`];
  },

  async dialogue(c, notes) {
    await initTool(c, "dialogue");
    const id = c.tpl.dialogue.id;
    // Easy Portrait sets (made from this game's cast) replace the sample portraits of the same ids.
    const made = path.join(c.ws("portrait"), "exports", "kit-dialogue-portraits");
    if (await exists(made)) {
      const ids = (await readdir(made, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
      for (const pid of ids) {
        await rm(path.join(c.ws("dialogue"), "portraits", pid), { recursive: true, force: true });
        await copyTree(path.join(made, pid), path.join(c.ws("dialogue"), "portraits", pid));
      }
      notes.push(`portraits from Easy Portrait: ${ids.join(", ")}`);
    }
    await cli(c, "dialogue", ["export", id, "--preset", "godot", "--style", c.tpl.dialogue.style]);
    await cli(c, "dialogue", ["export", id, "--preset", "pixi", "--style", c.tpl.dialogue.style]);
    await cli(c, "dialogue", ["export", id, "--preset", "json"]);
    return [`.easy/dialogue/exports/${id}-godot`, `.easy/dialogue/exports/${id}-pixi`, `.easy/dialogue/exports/${id}-json`];
  },

  async portrait(c, notes) {
    const spec = c.tpl.portrait;
    if (!spec) return [];
    await initTool(c, "portrait");
    const ws = c.ws("portrait");
    await mkdir(path.join(ws, "sprites"), { recursive: true });
    for (const set of spec.sets) {
      const src = path.join(c.ws("sprite"), "projects", `kit_${set.from}.json`);
      if (!(await exists(src))) {
        notes.push(`${set.id}: no Easy Sprite project kit_${set.from}, sample kept`);
        continue;
      }
      await copyFile(src, path.join(ws, "sprites", `kit_${set.from}.json`));
      await cli(c, "portrait", ["from-sprite", `kit_${set.from}`, "--id", set.id, "--th", set.th, "--en", set.en, "--ms", set.ms]);
    }
    const ids = [...spec.sets.map((s) => s.id), ...(spec.keep ?? [])].join(",");
    await cli(c, "portrait", ["export", "--preset", "dialogue", "--ids", ids, "--out", path.join(ws, "exports", "kit-dialogue-portraits")]);
    await cli(c, "portrait", ["export", "--preset", "godot", "--ids", ids]);
    await cli(c, "portrait", ["export", "--preset", "pixi", "--ids", ids]);
    notes.push(`${spec.sets.length} portraits from the generated cast (${spec.sets.map((s) => s.th).join(", ")}) + ${(spec.keep ?? []).join(", ") || "no samples"}`);
    return [".easy/portrait/exports/kit-dialogue-portraits", ".easy/portrait/exports/easyportrait-godot", ".easy/portrait/exports/easyportrait-pixi"];
  },

  async npc(c, notes) {
    if (!c.tpl.npc) return [];
    await initTool(c, "npc");
    await cli(c, "npc", ["export", "--preset", "godot"]);
    await cli(c, "npc", ["export", "--preset", "pixi"]);
    notes.push(`${Object.keys(c.tpl.npc.map).length} villagers on their daily schedule (${Object.values(c.tpl.npc.map).join(", ")}); quest NPCs stay put`);
    return [".easy/npc/exports/easynpc-godot", ".easy/npc/exports/easynpc-pixi"];
  },

  async font(c, notes) {
    if (!c.tpl.font) return [];
    await initTool(c, "font");
    await cli(c, "font", ["check"]);
    await cli(c, "font", ["export", "--preset", "godot"]);
    await cli(c, "font", ["export", "--preset", "pixi"]);
    notes.push(`${c.tpl.font.hud} (HUD + dialogue), ${c.tpl.font.small} (small labels); Thai text pre-shaped at build time`);
    return [".easy/font/exports/easyfont-godot", ".easy/font/exports/easyfont-pixi"];
  },

  async battle(c, notes) {
    const b = c.tpl.battle;
    if (!b) return [];
    await initTool(c, "battle");
    const ws = c.ws("battle");
    await mkdir(path.join(ws, "sprites"), { recursive: true });
    for (const [hero, sheet] of Object.entries(b.heroSheets ?? {})) {
      const src = path.join(c.assets, "sprites", "side", `${sheet}.png`);
      if (await exists(src)) await copyFile(src, path.join(ws, "sprites", `${hero}.png`));
    }
    await cli(c, "battle", ["check"]);
    await cli(c, "battle", ["export", "--preset", "godot"]);
    await cli(c, "battle", ["export", "--preset", "pixi"]);
    notes.push(`${b.table} in tiles ${b.zone.join(",")}; party ${b.party.map((p) => `${p.id} L${p.level}`).join(", ")}; heroes use the generated side-view sheets`);
    return [".easy/battle/exports/easybattle-godot", ".easy/battle/exports/easybattle-pixi"];
  },

  async ship() {
    return [];
  },

  async quest(c) {
    await initTool(c, "quest");
    await cli(c, "quest", ["export", c.tpl.quest.id, "--preset", "all"]);
    return [`.easy/quest/exports/${c.tpl.quest.id}-godot`, `.easy/quest/exports/${c.tpl.quest.id}-pixi`];
  },

  async ui(c) {
    await initTool(c, "ui");
    await cli(c, "ui", ["export", c.tpl.ui.doc, "--preset", "all"]);
    return [`.easy/ui/exports/${c.tpl.ui.doc}-godot`, `.easy/ui/exports/${c.tpl.ui.doc}-pixi`];
  },

  async sfx(c, notes) {
    await initTool(c, "sfx");
    for (const s of c.tpl.sfx.seeded) {
      await cli(c, "sfx", ["add", s.id, "--preset", s.preset, "--seed", String(c.seed), "--bank", c.tpl.sfx.bank]);
      notes.push(`${s.id}: ${s.preset} preset, seed ${c.seed}`);
    }
    await cli(c, "sfx", ["export", c.tpl.sfx.bank, "--preset", "all"]);
    return [`.easy/sfx/exports/${c.tpl.sfx.bank}-godot`, `.easy/sfx/exports/${c.tpl.sfx.bank}-pixi`];
  },

  async fx(c, notes) {
    await initTool(c, "fx");
    for (const f of c.tpl.fx.seeded) {
      await cli(c, "fx", ["new", f.id, "--from", f.from, "--set", `seed=${c.seed}`, "--force"]);
      notes.push(`${f.id}: ${f.from} preset, seed ${c.seed}`);
    }
    await cli(c, "fx", ["export", ...c.tpl.fx.export, "--preset", "all"]);
    return [".easy/fx/exports/easyfx-godot", ".easy/fx/exports/easyfx-pixi"];
  },

  async music(c, notes) {
    await initTool(c, "music");
    for (const m of c.tpl.music.seeded) {
      await cli(c, "music", ["new", m.id, "--from", m.from, "--set", `seed=${c.seed}`, "--force"]);
      notes.push(`${m.id}: ${m.from} preset, seed ${c.seed}`);
    }
    await cli(c, "music", ["export", ...c.tpl.music.export, "--preset", "godot"]);
    await cli(c, "music", ["export", ...c.tpl.music.export, "--preset", "web"]);
    return [".easy/music/exports/easymusic-godot", ".easy/music/exports/easymusic-web"];
  },

  async anim(c, notes) {
    await initTool(c, "anim");
    const sprites = path.join(c.ws("anim"), "sprites");
    await mkdir(sprites, { recursive: true });
    for (const m of c.tpl.sprite.side) await copyFile(path.join(c.assets, "sprites", "side", `${m.id}.png`), path.join(sprites, `${m.id}.png`));
    await cli(c, "anim", ["export", "--preset", "godot"]);
    await cli(c, "anim", ["export", "--preset", "pixi"]);
    notes.push(`${c.tpl.anim.cutscene}: actors use the ${c.tpl.sprite.side.length} generated side-view sheets`);
    return [".easy/anim/exports/easyanim-godot", ".easy/anim/exports/easyanim-pixi"];
  },

  async items(c) {
    await initTool(c, "items");
    await cli(c, "items", ["export", "--preset", "godot"]);
    await cli(c, "items", ["export", "--preset", "pixi"]);
    return [".easy/items/exports/easyitems-godot", ".easy/items/exports/easyitems-pixi"];
  },

  async save(c, notes) {
    await initTool(c, "save");
    const ws = c.ws("save");
    // The game's own sources (same docs the other tools exported) replace the sample copies.
    const src = (tool: ToolId, rel: string) => path.join(c.ws(tool), rel);
    const pairs: Array<[string, string]> = [
      [src("dialogue", `dialogues/${c.tpl.dialogue.id}.ezd`), `sources/dialogues/${c.tpl.dialogue.id}.ezd`],
      [src("quest", `quests/${c.tpl.quest.id}.ezq`), `sources/quests/${c.tpl.quest.id}.ezq`],
      [src("ui", `screens/${c.tpl.ui.doc}.easyui.json`), `sources/ui/${c.tpl.ui.doc}.easyui.json`],
    ];
    for (const [from, to] of pairs) if (await exists(from)) await copyFile(from, path.join(ws, to));
    for (const f of await readdir(path.join(c.ws("items"), "items")).catch(() => [] as string[])) if (f.endsWith(".easyitems.json")) await copyFile(path.join(c.ws("items"), "items", f), path.join(ws, "sources", "items", f));
    // Kit strings (prompts, NPC names, barks) for th / en / ms.
    await copyFile(path.join(templateDir(c.tpl.id), "strings", "kit.easyi18n.json"), path.join(ws, "strings", "kit.easyi18n.json"));
    // Sample save files belong to the Easy Save demo, not to a new game.
    await rm(path.join(ws, "saves"), { recursive: true, force: true });
    await mkdir(path.join(ws, "saves"), { recursive: true });
    await cli(c, "save", ["extract"]);
    await cli(c, "save", ["export", "--preset", "all"]);
    notes.push("sources re-extracted from this project's dialogue / quest / ui / items docs; kit table added");
    return [".easy/save/exports/easysave-godot", ".easy/save/exports/easysave-web", ".easy/save/exports/easysave-strings"];
  },
};

function makeCtx(o: { root: string; name: string; seed: number; engine: Engine; tpl: Template; tools: Record<ToolId, ResolvedTool>; log: (l: string) => void; choices?: Record<string, unknown> }): Ctx {
  return {
    root: o.root,
    name: o.name,
    id: projectId(o.name),
    seed: o.seed,
    engine: o.engine,
    tpl: o.tpl,
    tools: o.tools,
    ws: (t) => path.join(o.root, ".easy", t),
    env: (t) => ({ home: o.tools[t].home!, workspace: path.join(o.root, ".easy", t), allowed: [o.root] }),
    assets: path.join(o.root, "assets"),
    choices: o.choices ?? {},
    log: o.log,
  };
}

/** Re-assemble godot/ and/or web/ from the tool exports already in <project>/.easy (after editing glue or exports). */
export async function rebuildProject(root: string, opts: { engine?: Engine; cfg?: KitConfig; log?: (l: string) => void } = {}): Promise<ProjectManifest> {
  const mpath = path.join(root, "easykit.project.json");
  if (!(await exists(mpath))) throw new Error(`${root} is not an Easy Kit project (no easykit.project.json)`);
  const m = await readJson<ProjectManifest>(mpath);
  const tpl = await loadTemplate(m.template);
  const engine = opts.engine ?? m.engine;
  const ctx = makeCtx({ root, name: m.name, seed: m.seed, engine, tpl, tools: resolveAll(opts.cfg ?? loadKitConfig().config), log: opts.log ?? (() => undefined), choices: m.choices });
  m.steps = m.steps.filter((s) => s.tool !== "kit");
  if (engine === "godot" || engine === "both") {
    const t0 = Date.now();
    await rm(path.join(root, "godot"), { recursive: true, force: true });
    m.godot = await assembleGodot(ctx);
    m.steps.push({ tool: "kit", title: "assemble Godot 4.3+ project", ok: true, ms: Date.now() - t0, outputs: ["godot/"], notes: [`${m.godot.files} files, ${m.godot.collisions.length} collisions`] });
  }
  if (engine === "pixi" || engine === "both") {
    const t0 = Date.now();
    await rm(path.join(root, "web"), { recursive: true, force: true });
    m.web = await assemblePixi(ctx);
    m.steps.push({ tool: "kit", title: "assemble PixiJS web build", ok: true, ms: Date.now() - t0, outputs: ["web/"], notes: [`${m.web.files} files`] });
  }
  await writeJson(mpath, m);
  return m;
}

export async function newProject(opts: NewProjectOptions): Promise<ProjectManifest> {
  if (!NAME_RE.test(opts.name)) throw new Error(`Project name must match ${NAME_RE} (got "${opts.name}")`);
  const log = opts.log ?? (() => undefined);
  const cfg = opts.cfg ?? loadKitConfig().config;
  const tpl = await loadTemplate(opts.template ?? "village_delivery");
  const engine = opts.engine ?? "both";
  if (!(ENGINES as readonly string[]).includes(engine)) throw new Error(`--engine must be godot, pixi or both`);
  const seed = Math.max(0, Math.floor(opts.seed ?? 1));
  const root = path.resolve(opts.dir ?? process.cwd(), opts.name);
  if (await exists(root)) {
    if (!opts.force) throw new Error(`${root} already exists (use --force to replace it)`);
    await rm(root, { recursive: true, force: true });
  }
  const tools = resolveAll(cfg);
  const missing = CORE_TOOL_IDS.filter((t) => !tools[t].home);
  if (missing.length) throw new Error(`Missing Easy tools: ${missing.map((t) => `${TOOLS[t].name} (set ${TOOLS[t].env}_HOME)`).join(", ")} — run \`easykit doctor\``);
  await mkdir(root, { recursive: true });

  const ctx = makeCtx({ root, name: opts.name, seed, engine, tpl, tools, log });

  const rep = doctor({ cfg, engines: false });
  const manifest: ProjectManifest = {
    format: "easykit-project/1",
    name: opts.name,
    id: ctx.id,
    template: tpl.id,
    engine,
    seed,
    createdAt: new Date().toISOString(),
    kit: { version: (await readJson<{ version: string }>(path.join(kitRoot(), "package.json"))).version },
    tools: Object.fromEntries(rep.tools.map((t) => [t.id, { version: t.version, commit: t.git?.commit ?? null, dirty: t.git?.dirty ?? false, home: t.home }])),
    choices: ctx.choices,
    steps: [],
    ok: false,
  };

  for (const tool of BUILD_IDS) {
    const t0 = Date.now();
    const notes: string[] = [];
    if (!tools[tool].home) {
      manifest.steps.push({ tool, title: STEP_TITLES[tool], ok: true, ms: 0, outputs: [], notes: [`skipped: ${TOOLS[tool].name} not installed (set ${TOOLS[tool].env}_HOME)`] });
      log(`[${TOOLS[tool].name}] not installed, skipped`);
      continue;
    }
    log(`[${TOOLS[tool].name}] ${STEP_TITLES[tool]}…`);
    try {
      const outputs = await STEPS[tool](ctx, notes);
      manifest.steps.push({ tool, title: STEP_TITLES[tool], ok: true, ms: Date.now() - t0, outputs, notes });
    } catch (e) {
      const err = e as Error & { detail?: string };
      manifest.steps.push({ tool, title: STEP_TITLES[tool], ok: false, ms: Date.now() - t0, outputs: [], notes, error: `${err.message}${err.detail ? `\n${err.detail}` : ""}` });
      await writeJson(path.join(root, "easykit.project.json"), manifest);
      throw new Error(`${TOOLS[tool].name} step failed: ${err.message}${err.detail ? `\n${err.detail}` : ""}`);
    }
  }

  if (engine === "godot" || engine === "both") {
    const t0 = Date.now();
    log("[Easy Kit] assembling the Godot project…");
    manifest.godot = await assembleGodot(ctx);
    manifest.steps.push({ tool: "kit", title: "assemble Godot 4.3+ project", ok: true, ms: Date.now() - t0, outputs: ["godot/"], notes: [`${manifest.godot.files} files, ${manifest.godot.collisions.length} collisions`] });
  }
  if (engine === "pixi" || engine === "both") {
    const t0 = Date.now();
    log("[Easy Kit] assembling the Pixi web build…");
    manifest.web = await assemblePixi(ctx);
    manifest.steps.push({ tool: "kit", title: "assemble PixiJS web build", ok: true, ms: Date.now() - t0, outputs: ["web/"], notes: [`${manifest.web.files} files`] });
  }
  manifest.ok = manifest.steps.every((s) => s.ok);
  await writeJson(path.join(root, "easykit.project.json"), manifest);
  await writeProjectReadme(ctx, manifest);
  await writeFile(path.join(root, ".gitignore"), ".easy/*/exports/\n.easy/*/node_modules/\ngodot/.godot/\n*.import\n");
  return manifest;
}

async function writeProjectReadme(c: Ctx, m: ProjectManifest): Promise<void> {
  const lines = [
    `# ${c.name}`,
    "",
    `${c.tpl.name.en} · ${c.tpl.name.th} · ${c.tpl.name.ms}`,
    "",
    `Made with Easy Kit ${m.kit.version}: \`easykit new ${c.name} --template ${c.tpl.id} --engine ${c.engine} --seed ${c.seed}\`.`,
    "",
    c.tpl.summary,
    "",
    "## Run",
    "",
    m.godot ? "- Godot 4.3+: open `godot/project.godot` (or `godot --path godot`). Headless test: `godot --headless --path godot --script res://kit/test_game.gd`." : "",
    m.web ? "- Web: serve `web/` (e.g. `npx serve web` or `python3 -m http.server -d web`) and open it in a browser." : "",
    "",
    "Keys: arrows / WASD walk · E or Enter talk · L language (th → en → ms) · F5 quick save · F9 quick load · Esc skip cutscene / close shop.",
    "",
    "## What each Easy tool made",
    "",
    "| Tool | Step | Notes |",
    "|---|---|---|",
    ...m.steps.filter((s) => s.tool !== "kit").map((s) => `| ${TOOLS[s.tool as ToolId].name} ${m.tools[s.tool]?.version ? `v${m.tools[s.tool]!.version}` : ""} | ${s.title} | ${s.notes.join("; ")} |`),
    "",
    "Generated sheets live in `assets/` and the tool workspaces in `.easy/<tool>/` — edit them with each tool, then re-export.",
    "Character sheets are generated into this project only; Easy Kit never ships them.",
    "",
  ];
  await writeFile(path.join(c.root, "README.md"), lines.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n"));
}

export async function projectStatus(root: string): Promise<{ root: string; manifest: ProjectManifest | null; godot: boolean; web: boolean }> {
  const p = path.join(root, "easykit.project.json");
  const manifest = (await exists(p)) ? await readJson<ProjectManifest>(p) : null;
  return { root, manifest, godot: await exists(path.join(root, "godot", "project.godot")), web: await exists(path.join(root, "web", "index.html")) };
}

export { copyTree, readFile };
