/**
 * game.easy.json — one project manifest for all 18 Easy tools.
 *
 * The manifest says *what* the game is (title, engine, font) and which content each tool contributes, by id:
 * the tilemap, the title scene, the cast (Easy Sprite), portraits, NPC schedules, the dialogue, the quest, the item
 * database and shop, battle (table, enemies, turn / ATB timing), UI, FX, SFX, music, cutscene, save schema and ship
 * targets. Each section references the tool's own documents (by id) in the tool workspace `.easy/<tool>/`; project-
 * owned documents listed in `sources` are copied into that workspace before the tool runs.
 *
 * `easy build` (src/lib/build.ts) turns the manifest into the existing pipeline steps, `easy validate`
 * (src/lib/validate.ts) checks it and every id it references.
 */
import path from "node:path";
import { z } from "zod";
import { exists, readJson } from "./fsutil.js";
import type { Template } from "./pipeline.js";
import { TOOL_IDS, type ToolId } from "./tools.js";

export const MANIFEST_FILE = "game.easy.json";
export const MANIFEST_FORMAT = "easy-game/1";

const ID = /^[a-z0-9][a-z0-9_-]*$/;
const id = () => z.string().regex(ID, "lowercase id: a-z 0-9 _ -");
const name3 = z.object({ th: z.string().min(1), en: z.string().min(1), ms: z.string().optional() });
const name3full = z.object({ th: z.string().min(1), en: z.string().min(1), ms: z.string().min(1) });
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);

const cast = z.object({
  id: id(),
  /** Easy Sprite project id this character starts from (the sample projects in .easy/sprite/projects). */
  base: id(),
  /** Colour slot recoloured with the seeded palette colour (player shirt). */
  recolor: z.string().optional(),
  /** Character name on the tilemap (default: id). */
  map: z.string().optional(),
  at: z.tuple([z.number(), z.number()]).optional(),
  facing: z.enum(["front", "back", "left", "right"]).optional(),
});

/** Paths relative to the project; `*` is allowed in the file name (e.g. content/items/*.easyitems.json). */
const sources = z.array(z.string().min(1)).optional();

export const GameManifestSchema = z
  .object({
    $schema: z.string().optional(),
    format: z.literal(MANIFEST_FORMAT),
    game: z.object({
      /** Project / folder name (ASCII). */
      name: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,47}$/),
      title: name3full,
      /** Where the game is set; th must be written in Thai script. */
      setting: name3.optional(),
      engine: z.enum(["godot", "pixi", "both"]).default("both"),
      /** Easy Font id for the HUD and dialogue (small labels keep makham-8). */
      font: id().default("makham-16"),
      seed: z.number().int().min(0).default(1),
      viewport: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).default({ width: 480, height: 270 }),
      /** Kit glue (game scripts) the build uses; the only one today is village_delivery. */
      base: z.literal("village_delivery").default("village_delivery"),
      locales: z.array(z.enum(["th", "en", "ms"])).default(["th", "en", "ms"]),
    }),
    sprites: z.object({
      player: id(),
      palette: z.array(color).min(1),
      cast: z.array(cast).min(1),
      side: z.array(cast).default([]),
      sources,
    }),
    portraits: z.object({ sets: z.array(z.object({ id: id(), from: id(), th: z.string(), en: z.string(), ms: z.string() })), keep: z.array(id()).default([]), sources }).optional(),
    scenes: z.object({ title: z.object({ id: id(), cameraRange: z.tuple([z.number(), z.number()]), actor: id() }), sources }),
    tilemaps: z.object({
      main: id(),
      /** Map characters to take off the map (replace one with a new cast member placed with `at`). */
      remove: z.array(z.string()).optional(),
      sources,
    }),
    npcs: z.object({
      /** Who stands where and what they do when you talk: quest (dialogue speaker), shop (Easy Items shop) or bark. */
      roles: z.record(z.string(), z.object({ role: z.enum(["quest", "shop", "bark"]), speaker: id().optional(), shop: id().optional() })),
      /** Easy NPC schedules: tilemap character name → Easy NPC id. */
      schedules: z.record(z.string(), id()).optional(),
      start: z.string().regex(/^\d\d:\d\d$/).optional(),
      secondsPerMinute: z.number().positive().optional(),
      sources,
    }),
    dialogue: z.object({ main: id(), style: id().default("teak"), segments: z.array(id()).min(1), sources }),
    quests: z.object({
      main: id(),
      quest: id().optional(),
      /** The main quest's delivery stops: talk to dialogue `speaker` during quest step `step` (also the dialogue segment) to hand over `item`. Default: the base's. */
      deliveries: z.array(z.object({ speaker: id(), step: id(), item: id() })).min(1).optional(),
      sources,
    }),
    items: z.object({
      shop: id(),
      /** Shops that must only stock halal goods (Muslim stalls); checked against Easy Items' shop + item data. */
      halalShops: z.array(id()).default([]),
      sources,
    }),
    battle: z
      .object({
        table: id(),
        enemies: z.array(id()).default([]),
        zone: z.tuple([z.number(), z.number(), z.number(), z.number()]),
        culture: z.string().default("thai"),
        ground: z.string().default("C"),
        party: z.array(z.object({ id: id(), level: z.number().int().min(1).max(99) })).min(1),
        heroSheets: z.record(z.string(), id()).default({}),
        firstSeed: z.number().int().optional(),
        timing: z.enum(["turn", "atb"]).default("turn"),
        atbMode: z.enum(["wait", "active"]).default("wait"),
        layout: z.enum(["classic", "backview"]).default("classic"),
        status: z.enum(["rows", "cards", "none"]).optional(),
        sources,
      })
      .optional(),
    ui: z.object({ screen: id(), theme: id().default("teak"), sources }),
    fx: z.object({ seeded: z.array(z.object({ id: id(), from: id() })).default([]), export: z.array(id()).min(1), sources }),
    sfx: z.object({ bank: id(), seeded: z.array(z.object({ id: id(), preset: id() })).default([]), sources }),
    music: z.object({ seeded: z.array(z.object({ id: id(), from: id() })).default([]), export: z.array(id()).min(1), world: id(), shop: id(), sources }),
    anim: z.object({ cutscene: id(), sources }),
    save: z.object({
      schema: id(),
      /** Keep only this game's text in the th / en / ms string tables (drops Easy Save's sample dialogue / quest strings). */
      gameStringsOnly: z.boolean().optional(),
      sources,
    }),
    ship: z
      .object({
        targets: z.array(z.enum(["web", "windows", "linux", "android"])).default(["web"]),
        release: z.string().default("0.1.0"),
        itch: z.string().regex(/^[a-z0-9_-]+\/[a-z0-9_-]+$/i).optional(),
        androidPackage: z.string().optional(),
      })
      .optional(),
  })
  .strict();

export type GameManifest = z.infer<typeof GameManifestSchema>;
export type GameManifestInput = z.input<typeof GameManifestSchema>;

/** Manifest section → the Easy tool it configures (for sources and error messages). */
export const SECTION_TOOL: Record<string, ToolId> = {
  sprites: "sprite", portraits: "portrait", scenes: "scene", tilemaps: "tilemap", npcs: "npc", dialogue: "dialogue", quests: "quest",
  items: "items", battle: "battle", ui: "ui", fx: "fx", sfx: "sfx", music: "music", anim: "anim", save: "save", ship: "ship",
};

/** Folder inside a tool workspace where project `sources` go. */
export const SOURCE_DIR: Partial<Record<ToolId, string>> = {
  sprite: "projects", portrait: "portraits", scene: "scenes", tilemap: "maps", npc: "npcs", dialogue: "dialogues", quest: "quests",
  items: "items", battle: "battles", ui: "screens", fx: "effects", sfx: "banks", music: "songs", anim: "cutscenes", save: "schemas",
};

export function manifestJsonSchema(): Record<string, unknown> {
  const s = z.toJSONSchema(GameManifestSchema, { io: "input" }) as Record<string, unknown>;
  return { ...s, $id: "https://github.com/Saladin2020/easykit/schema/game.easy.schema.json", title: "Easy Suite game manifest (game.easy.json)" };
}

export interface Issue {
  severity: "error" | "warning";
  code: string;
  /** JSON path in the manifest, e.g. battle.enemies[2] */
  path: string;
  th: string;
  en: string;
}

export function parseManifest(raw: unknown): { manifest: GameManifest | null; issues: Issue[] } {
  const r = GameManifestSchema.safeParse(raw);
  if (r.success) return { manifest: r.data, issues: [] };
  const issues = r.error.issues.map<Issue>((i) => {
    const p = i.path.map((k) => (typeof k === "number" ? `[${k}]` : `.${String(k)}`)).join("").replace(/^\./, "") || "(root)";
    return { severity: "error", code: `schema.${i.code}`, path: p, th: `รูปแบบไม่ถูกต้อง: ${i.message}`, en: `Invalid: ${i.message}` };
  });
  return { manifest: null, issues };
}

export async function loadManifest(root: string): Promise<{ file: string; raw: unknown; manifest: GameManifest | null; issues: Issue[] }> {
  const file = path.join(root, MANIFEST_FILE);
  if (!(await exists(file))) throw new Error(`${root} has no ${MANIFEST_FILE} (create one with \`easy init --from <project>\` or \`easy init <dir>\`)`);
  let raw: unknown;
  try {
    raw = await readJson(file);
  } catch (e) {
    return { file, raw: null, manifest: null, issues: [{ severity: "error", code: "json", path: "(file)", th: `อ่าน JSON ไม่ได้: ${(e as Error).message}`, en: `Not valid JSON: ${(e as Error).message}` }] };
  }
  return { file, raw, ...parseManifest(raw) };
}

/** Manifest → the pipeline's Template (the steps and the Godot / Pixi assembly read this). */
export function manifestToTemplate(m: GameManifest, base: Template): Template {
  const b = m.battle;
  return {
    ...base,
    name: { th: m.game.title.th, en: m.game.title.en, ms: m.game.title.ms },
    viewport: m.game.viewport,
    palette: m.sprites.palette,
    sprite: { player: m.sprites.player, cast: m.sprites.cast, side: m.sprites.side },
    portrait: m.portraits ? { sets: m.portraits.sets, keep: m.portraits.keep } : undefined,
    scene: m.scenes.title,
    tilemap: { map: m.tilemaps.main, ...(m.tilemaps.remove?.length ? { remove: m.tilemaps.remove } : {}) },
    dialogue: { id: m.dialogue.main, style: m.dialogue.style, segments: m.dialogue.segments },
    npc: m.npcs.schedules ? { map: m.npcs.schedules, start: m.npcs.start, secondsPerMinute: m.npcs.secondsPerMinute } : undefined,
    npcs: m.npcs.roles,
    quest: { id: m.quests.main, main: m.quests.quest ?? m.quests.main },
    ...(m.quests.deliveries ? { deliveries: m.quests.deliveries } : {}),
    font: { hud: m.game.font, small: "makham-8", dialogue: m.game.font },
    ui: { doc: m.ui.screen, theme: m.ui.theme },
    sfx: { bank: m.sfx.bank, seeded: m.sfx.seeded },
    fx: { seeded: m.fx.seeded, export: m.fx.export },
    music: { seeded: m.music.seeded, export: m.music.export, world: m.music.world, shop: m.music.shop },
    anim: { cutscene: m.anim.cutscene },
    items: { shop: m.items.shop },
    battle: b ? { table: b.table, zone: b.zone, culture: b.culture, ground: b.ground, party: b.party, heroSheets: b.heroSheets, firstSeed: b.firstSeed, screen: { timing: b.timing, atbMode: b.atbMode, layout: b.layout, status: b.status } } : undefined,
    save: { schema: m.save.schema, ...(m.save.gameStringsOnly ? { gameStringsOnly: true } : {}) },
  };
}

/** Template (+ an existing project's choices) → a manifest that builds the same game. */
export function templateToManifest(t: Template, o: { name: string; engine: "godot" | "pixi" | "both"; seed: number; font?: string; ship?: GameManifest["ship"] }): GameManifestInput {
  const src = <T extends object>(x: T) => x;
  return {
    $schema: "./node_modules/easykit/schema/game.easy.schema.json",
    format: MANIFEST_FORMAT,
    game: { name: o.name, title: t.name, engine: o.engine, font: o.font ?? t.font?.dialogue ?? "makham-16", seed: o.seed, viewport: t.viewport, base: t.id },
    sprites: { player: t.sprite.player, palette: t.palette, cast: t.sprite.cast as GameManifestInput["sprites"]["cast"], side: t.sprite.side as GameManifestInput["sprites"]["cast"] },
    ...(t.portrait ? { portraits: { sets: t.portrait.sets, keep: t.portrait.keep ?? [] } } : {}),
    scenes: { title: src(t.scene) },
    tilemaps: { main: t.tilemap.map, ...(t.tilemap.remove ? { remove: t.tilemap.remove } : {}) },
    npcs: { roles: t.npcs, ...(t.npc ? { schedules: t.npc.map, start: t.npc.start, secondsPerMinute: t.npc.secondsPerMinute } : {}) },
    dialogue: { main: t.dialogue.id, style: t.dialogue.style, segments: t.dialogue.segments },
    quests: { main: t.quest.id, ...(t.quest.main !== t.quest.id ? { quest: t.quest.main } : {}), ...(t.deliveries ? { deliveries: t.deliveries } : {}) },
    items: { shop: t.items.shop, halalShops: [] },
    ...(t.battle ? { battle: { table: t.battle.table, zone: t.battle.zone, culture: t.battle.culture, ground: t.battle.ground, party: t.battle.party, heroSheets: t.battle.heroSheets ?? {}, ...(t.battle.firstSeed !== undefined ? { firstSeed: t.battle.firstSeed } : {}), timing: t.battle.screen?.timing ?? "turn", atbMode: t.battle.screen?.atbMode ?? "wait", layout: t.battle.screen?.layout ?? "classic" } } : {}),
    ui: { screen: t.ui.doc, theme: t.ui.theme },
    fx: { seeded: t.fx.seeded, export: t.fx.export },
    sfx: { bank: t.sfx.bank, seeded: t.sfx.seeded },
    music: { seeded: t.music.seeded, export: t.music.export, world: t.music.world, shop: t.music.shop },
    anim: { cutscene: t.anim.cutscene },
    save: { schema: t.save.schema, ...(t.save.gameStringsOnly ? { gameStringsOnly: true } : {}) },
    ...(o.ship ? { ship: o.ship } : {}),
  };
}

export const MANIFEST_SECTIONS = Object.keys(SECTION_TOOL);
export { TOOL_IDS };
