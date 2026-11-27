import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { systemsData } from "./systems.js";
import path from "node:path";
import { copyTree, exists, mergeTree, readJson, walk, writeJson, type CopyReport } from "./fsutil.js";
import { LOCALES, localizeDialogue, mergeTables, segmentDialogue, typesetDialogue, type StringTable } from "./localize.js";
import type { Ctx } from "./pipeline.js";
import { DEFAULT_DELIVERIES, templateDir } from "./pipeline.js";
import type { ToolId } from "./tools.js";

/** Files every Easy export ships for its own demo; the kit writes its own versions. */
const DEMO_FILES = new Set(["project.godot", "main.tscn", "main.gd", "README.txt", "README.md", "icon.svg", "screenshot.gd", "capture.gd", "export_presets.cfg"]);

export function isDemoFile(rel: string): boolean {
  if (rel.startsWith(".godot/") || rel.endsWith(".import")) return true;
  if (rel.includes("/")) return false;
  return DEMO_FILES.has(rel) || /^test_.*\.gd$/.test(rel);
}

/** `Name="*res://…"` lines from a project.godot [autoload] section. */
export function parseAutoloads(projectGodot: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  let inSection = false;
  for (const line of projectGodot.split(/\r?\n/)) {
    const t = line.trim();
    if (t.startsWith("[")) inSection = t === "[autoload]";
    else if (inSection) {
      const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"(.*)"$/.exec(t);
      if (m) out.push([m[1]!, m[2]!]);
    }
  }
  return out;
}

export interface GodotExportSource {
  tool: ToolId;
  dir: string;
  /** Exports of the optional tools (portrait, npc, font, battle): skipped when the tool was not installed. */
  optional?: boolean;
}

/** Optional tools whose exports this project has, per engine. */
export type Features = { portrait: boolean; npc: boolean; font: boolean; battle: boolean };

export async function features(c: Ctx, engine: "godot" | "pixi"): Promise<Features> {
  const has = (tool: ToolId, dir: string) => exists(path.join(c.ws(tool), "exports", dir));
  return {
    portrait: !!c.tpl.portrait && (await has("portrait", `easyportrait-${engine}`)),
    npc: !!c.tpl.npc && (await has("npc", `easynpc-${engine}`)),
    font: !!c.tpl.font && (await has("font", `easyfont-${engine}`)) && (await has("font", "easyfont-pixi")),
    battle: !!c.tpl.battle && (await has("battle", `easybattle-${engine}`)),
  };
}

/** Easy Font's shaper (easyfont-core.js, the same code the CLI and the Pixi runtime use). */
export async function loadShaper(c: Ctx): Promise<(s: string) => string> {
  const core = path.join(c.ws("font"), "exports", "easyfont-pixi", "easyfont-core.js");
  const mod = (await import(pathToFileURL(core).href)) as { shapeThai: (s: string) => string };
  return mod.shapeThai;
}

/** Native size + line height of an Easy Font bitmap font (bitmap fonts must render at their own size). */
export async function fontMetrics(c: Ctx, id: string): Promise<{ size: number; line: number }> {
  const j = JSON.parse(await readFile(path.join(c.ws("font"), "exports", "easyfont-godot", "easyfont", "fonts.json"), "utf8")) as { fonts: Array<{ id: string; size: number; line: number }> };
  const f = j.fonts.find((x) => x.id === id);
  if (!f) throw new Error(`Easy Font has no font ${id}`);
  return { size: f.size, line: f.line };
}

/** Dialogue-box layout for a pixel font: text, name plate and choices at the font's native size and line height.
 *  The box grows upwards (bottom edge kept) when its lines no longer fit, e.g. มะขาม 16's 22 px line. */
export function pixelFontLayout(doc: any, id: string, m: { size: number; line: number }): void {
  const L = doc.ui?.layout;
  if (L?.text) Object.assign(L.text, { fontSize: m.size, lineHeight: Math.max(m.line, L.text.lineHeight ?? 0) });
  if (L?.plate) Object.assign(L.plate, { fontSize: m.size, h: Math.max(L.plate.h ?? 0, m.line + 2) });
  if (L?.choices) Object.assign(L.choices, { fontSize: m.size, rowH: Math.max(L.choices.rowH ?? 0, m.line) });
  if (L?.box && L?.text) {
    const need = dialogueTextHeight(L);
    if (L.box.h < need) {
      const bottom = L.box.y + L.box.h;
      L.box.h = need;
      L.box.y = Math.max(0, bottom - need);
    }
    const issues = dialogueFitIssues(L);
    if (issues.length) throw new Error(`dialogue box does not fit ${id} (${m.line} px lines): ${issues.join("; ")}`);
  }
  doc.ui = { ...(doc.ui ?? {}), kitFont: id };
}

/** Height the dialogue text needs: top and bottom padding plus maxLines lines. */
export function dialogueTextHeight(L: any): number {
  const t = L.text ?? {};
  return 2 * (t.padY ?? 0) + (t.maxLines ?? 3) * (t.lineHeight ?? 0);
}

/** Problems with a dialogue layout at its font's line height (empty = it fits). */
export function dialogueFitIssues(L: any): string[] {
  const out: string[] = [];
  if (!L?.box || !L?.text) return ["no box / text layout"];
  const need = dialogueTextHeight(L);
  if (L.box.h < need) out.push(`text needs ${need} px but the box is ${L.box.h} px`);
  const vh = L.viewport?.height ?? 270, vw = L.viewport?.width ?? 480;
  if (L.box.y < 0 || L.box.y + L.box.h > vh) out.push(`box ${L.box.y}..${L.box.y + L.box.h} leaves the ${vh} px viewport`);
  if (L.box.x < 0 || L.box.x + L.box.w > vw) out.push(`box ${L.box.x}..${L.box.x + L.box.w} leaves the ${vw} px viewport`);
  if (L.plate && L.plate.h < L.text.lineHeight + 2) out.push(`name plate ${L.plate.h} px is shorter than a line (${L.text.lineHeight} px) + 2`);
  if (L.choices && L.choices.rowH < L.text.lineHeight) out.push(`choice rows ${L.choices.rowH} px are shorter than a line (${L.text.lineHeight} px)`);
  return out;
}

/** kit.json blocks for the optional tools (null when the tool is not part of this build). */
export function featureData(c: Ctx, f: Features) {
  return {
    features: f,
    portraits: f.portrait ? { ids: [...(c.tpl.portrait?.sets ?? []).map((s) => s.id), ...(c.tpl.portrait?.keep ?? [])] } : null,
    npcSchedule: f.npc ? c.tpl.npc : null,
    font: f.font ? c.tpl.font : null,
    battle: f.battle ? c.tpl.battle : null,
  };
}

export function godotSources(c: Ctx): GodotExportSource[] {
  const e = (tool: ToolId, rel: string) => ({ tool, dir: path.join(c.ws(tool), "exports", rel) });
  return [
    e("tilemap", `${c.tpl.tilemap.map}-godot`),
    e("dialogue", `${c.tpl.dialogue.id}-godot`),
    e("quest", `${c.tpl.quest.id}-godot`),
    e("ui", `${c.tpl.ui.doc}-godot`),
    e("sfx", `${c.tpl.sfx.bank}-godot`),
    e("fx", "easyfx-godot"),
    e("music", "easymusic-godot"),
    e("anim", "easyanim-godot"),
    e("items", "easyitems-godot"),
    e("save", "easysave-godot"),
    { ...e("portrait", "easyportrait-godot"), optional: true },
    { ...e("npc", "easynpc-godot"), optional: true },
    { ...e("font", "easyfont-godot"), optional: true },
    { ...e("battle", "easybattle-godot"), optional: true },
  ];
}

/** key=value lines of one [section] in a project.godot. */
export function parseSection(projectGodot: string, section: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  let inSection = false;
  for (const line of projectGodot.split(/\r?\n/)) {
    const t = line.trim();
    if (t.startsWith("[")) inSection = t === `[${section}]`;
    else if (inSection) {
      const i = t.indexOf("=");
      if (i > 0) out.push([t.slice(0, i), t.slice(i + 1)]);
    }
  }
  return out;
}

export function projectGodot(o: { name: string; autoloads: Array<[string, string]>; width: number; height: number; translations?: string[] }): string {
  return `; Engine configuration file. Generated by Easy Kit.
config_version=5

[application]

config/name="${o.name.replace(/"/g, "")}"
run/main_scene="res://kit/main.tscn"
config/features=PackedStringArray("4.3", "GL Compatibility")
config/icon="res://icon.svg"

[autoload]

${o.autoloads.map(([k, v]) => `${k}="${v}"`).join("\n")}

[display]

window/size/viewport_width=${o.width}
window/size/viewport_height=${o.height}
window/size/window_width_override=${o.width * 2}
window/size/window_height_override=${o.height * 2}
window/stretch/mode="viewport"

[gui]

theme/custom_font="res://fonts/Kanit-Regular.ttf"

[internationalization]

${o.translations?.length ? `locale/translations=PackedStringArray(${o.translations.map((t) => `"${t}"`).join(", ")})\n` : ""}locale/fallback="en"
locale/include_text_server_data=true

[rendering]

textures/canvas_textures/default_texture_filter=0
renderer/rendering_method="gl_compatibility"
renderer/rendering_method.mobile="gl_compatibility"
2d/snap/snap_2d_transforms_to_pixel=true
`;
}

export const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 16 16" shape-rendering="crispEdges"><rect width="16" height="16" fill="#1b2a3a"/><rect x="2" y="2" width="12" height="12" fill="#5fd3f3"/><rect x="4" y="4" width="3" height="8" fill="#1b2a3a"/><rect x="7" y="7" width="2" height="2" fill="#1b2a3a"/><rect x="9" y="4" width="3" height="3" fill="#1b2a3a"/><rect x="9" y="9" width="3" height="3" fill="#1b2a3a"/></svg>\n`;

export async function loadGameStrings(c: Ctx): Promise<StringTable> {
  const dir = path.join(c.ws("save"), "strings");
  const files = (await walk(dir)).filter((f) => f.endsWith(".easyi18n.json"));
  return mergeTables(await Promise.all(files.map((f) => readJson<{ strings: StringTable }>(path.join(dir, f)))));
}

export interface DialogueBuild {
  segmentsCut: number;
  coverage: Record<string, { total: number; translated: number; missing: number }>;
}

/** Writes <dir>/<id>.<locale>.dialogue.json (segmented + localized) from the compiled dialogue. With `font`, the text
 *  is pre-shaped for the Easy Font pixel font and the box is pointed at it. */
export async function writeLocalizedDialogues(c: Ctx, compiled: string, outDir: string, strings: StringTable, font?: { shape: (s: string) => string; assets: (doc: any) => void }): Promise<DialogueBuild> {
  const doc = await readJson(compiled);
  const seg = segmentDialogue(doc, c.tpl.dialogue.segments);
  const coverage: DialogueBuild["coverage"] = {};
  for (const loc of LOCALES) {
    const r = localizeDialogue(seg.doc, strings, loc);
    coverage[loc] = { total: r.total, translated: r.translated, missing: r.missing.length };
    let out: any = r.doc;
    if (font) {
      out = typesetDialogue(out, font.shape).doc;
      font.assets(out);
    }
    await writeJson(path.join(outDir, `${c.tpl.dialogue.id}.${loc}.dialogue.json`), out);
  }
  return { segmentsCut: seg.cut, coverage };
}

export function kitData(c: Ctx, engine: "godot" | "pixi") {
  const res = (p: string) => (engine === "godot" ? `res://${p}` : p);
  return {
    format: "easykit-game/1",
    name: c.name,
    id: c.id,
    seed: c.seed,
    template: c.tpl.id,
    title: c.tpl.name,
    locales: LOCALES,
    player: c.tpl.sprite.player,
    npcs: c.tpl.npcs,
    quest: { id: c.tpl.quest.id, main: c.tpl.quest.main },
    deliveries: c.tpl.deliveries ?? DEFAULT_DELIVERIES,
    dialogue: { id: c.tpl.dialogue.id, segments: c.tpl.dialogue.segments },
    shop: c.tpl.items.shop,
    music: { world: c.tpl.music.world, shop: c.tpl.music.shop },
    cutscene: c.tpl.anim.cutscene,
    fx: c.tpl.fx.export,
    titleImage: res("kit/title.png"),
    playerShirt: c.choices.playerShirt ?? null,
    defaultLocale: "th",
  };
}

export interface GodotBuild {
  dir: string;
  files: number;
  autoloads: Array<[string, string]>;
  collisions: CopyReport["collisions"];
  merged: Record<string, number>;
  dialogue: DialogueBuild;
}

export async function assembleGodot(c: Ctx): Promise<GodotBuild> {
  const dest = path.join(c.root, "godot");
  await mkdir(dest, { recursive: true });
  const owners = new Map<string, string>();
  const autoloads: Array<[string, string]> = [];
  const collisions: CopyReport["collisions"] = [];
  const merged: Record<string, number> = {};
  const translations: string[] = [];
  for (const s of godotSources(c)) {
    if (!(await exists(s.dir))) {
      if (s.optional) continue;
      throw new Error(`missing Godot export ${s.dir}`);
    }
    const r = await mergeTree(s.dir, dest, { exclude: isDemoFile, owner: s.tool, owners });
    merged[s.tool] = r.copied;
    collisions.push(...r.collisions);
    const pg = path.join(s.dir, "project.godot");
    if (await exists(pg)) {
      const text = await readFile(pg, "utf8");
      for (const a of parseAutoloads(text)) if (!autoloads.some(([k]) => k === a[0])) autoloads.push(a);
      for (const [k, v] of parseSection(text, "internationalization")) if (k === "locale/translations") for (const m of v.matchAll(/"([^"]+)"/g)) if (!translations.includes(m[1]!)) translations.push(m[1]!);
    }
  }
  // Kit glue: game scripts, scenes, headless test, screenshot helper.
  merged.kit = await copyTree(path.join(templateDir(c.tpl.id), "godot"), dest);
  await mkdir(path.join(dest, "kit"), { recursive: true });
  await copyFile(path.join(c.assets, "scene", "title.png"), path.join(dest, "kit", "title.png"));
  const strings = await loadGameStrings(c);
  const feat = await features(c, "godot");
  const fontId = c.tpl.font?.dialogue;
  const font = feat.font && fontId
    ? await (async () => {
        const m = await fontMetrics(c, fontId);
        return { shape: await loadShaper(c), assets: (doc: any) => { doc.assets = { ...(doc.assets ?? {}), fontFiles: { body: `res://easyfont/${fontId}.fnt`, name: `res://easyfont/${fontId}.fnt` } }; pixelFontLayout(doc, fontId, m); } };
      })()
    : undefined;
  const dialogue = await writeLocalizedDialogues(c, path.join(dest, "dialogue", `${c.tpl.dialogue.id}.dialogue.json`), path.join(dest, "dialogue"), strings, font);
  await writeJson(path.join(dest, "kit", "kit.json"), {
    ...kitData(c, "godot"),
    ...featureData(c, feat),
    world: `res://${c.tpl.tilemap.map}.tscn`,
    questFile: `res://quests/${c.tpl.quest.id}.quests.json`,
    dialogueFiles: Object.fromEntries(LOCALES.map((l) => [l, `res://dialogue/${c.tpl.dialogue.id}.${l}.dialogue.json`])),
    cutsceneScene: `res://easyanim/scenes/${c.tpl.anim.cutscene}.tscn`,
    hudScene: "res://scenes/hud.tscn",
    shopScene: "res://easyitems/shop_ui.tscn",
    dialogueBox: "res://addons/easydialogue/dialogue_box.tscn",
    theme: `res://easyui/themes/${c.tpl.ui.theme}.tres`,
    systemsFile: "res://kit/systems.json",
  });
  await writeJson(path.join(dest, "kit", "systems.json"), systemsData(c.tpl.systems, c.tpl.fx.export));
  await writeFile(path.join(dest, "icon.svg"), ICON_SVG);
  await writeFile(path.join(dest, "project.godot"), projectGodot({ name: c.name, autoloads, width: c.tpl.viewport.width, height: c.tpl.viewport.height, translations }));
  const files = (await walk(dest)).filter((f) => !f.startsWith(".godot/")).length;
  return { dir: "godot", files, autoloads, collisions, merged, dialogue };
}
