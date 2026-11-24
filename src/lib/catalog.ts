/** What each tool workspace (<project>/.easy/<tool>) contains, by id — the targets of manifest cross-references. */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { exists, readJson } from "./fsutil.js";
import { runCli, type ToolEnv } from "./runner.js";
import type { ToolId } from "./tools.js";

export interface QuestInfo {
  id: string;
  dialogue: string | null;
  declaredItems: string[];
  /** give / take / reward item ids with their line numbers */
  usedItems: Array<{ item: string; line: number }>;
  givers: string[];
  steps: string[];
}
export interface ItemInfo {
  id: string;
  category?: string;
  tags: string[];
  halal?: boolean;
}
export interface ShopInfo {
  id: string;
  halal: boolean;
  stock: string[];
}

export interface Catalog {
  /** Which workspaces were readable (cross-references into the others are not checked). */
  ready: Set<ToolId>;
  spriteProjects: Set<string>;
  portraits: Set<string>;
  scenes: Set<string>;
  maps: Map<string, { characters: Set<string>; spawns: Set<string> }>;
  dialogues: Map<string, { chars: Map<string, string | null> }>;
  npcs: Map<string, { sprite: string | null }>;
  /** Easy NPC top-down sheets (characters/<id>.png). */
  npcSheets: Set<string>;
  quests: Map<string, QuestInfo[]>;
  items: Map<string, ItemInfo>;
  shops: Map<string, ShopInfo>;
  battle: { enemies: Set<string>; heroes: Set<string>; encounters: Set<string> };
  uiScreens: Set<string>;
  fx: Set<string>;
  sfxBanks: Map<string, Set<string>>;
  sfxPresets: Set<string>;
  music: Set<string>;
  cutscenes: Set<string>;
  saveSchemas: Set<string>;
  fonts: Set<string>;
}

const files = async (dir: string, ext: string) => (await readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith(ext)).sort();
const stem = (f: string, ext: string) => f.slice(0, -ext.length);
const dirs = async (dir: string) => (await readdir(dir, { withFileTypes: true }).catch(() => [])).filter((d) => d.isDirectory()).map((d) => d.name);

export function parseEzq(text: string): QuestInfo[] {
  const out: QuestInfo[] = [];
  let dialogue: string | null = null;
  const declared: string[] = [];
  let cur: QuestInfo | null = null;
  text.split("\n").forEach((raw, i) => {
    const line = raw.replace(/\/\/.*$/, "").trim();
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^@dialogue\s+(\S+)/))) dialogue = m[1]!;
    else if ((m = line.match(/^@item\s+([a-z0-9_-]+)/))) declared.push(m[1]!);
    else if ((m = line.match(/^===\s+([a-z0-9_-]+)/))) {
      cur = { id: m[1]!, dialogue, declaredItems: declared, usedItems: [], givers: [], steps: [] };
      out.push(cur);
    } else if (cur && (m = line.match(/^giver\s+(\S+)/))) cur.givers.push(m[1]!);
    else if (cur && (m = line.match(/^(?:step|bonus)\s+([a-z0-9_-]+)/))) cur.steps.push(m[1]!);
    else if (cur && (m = line.match(/^(?:give|take|has)\s+([a-z0-9_-]+)/))) cur.usedItems.push({ item: m[1]!, line: i + 1 });
  });
  return out;
}

export function parseEzdChars(text: string): Map<string, string | null> {
  const chars = new Map<string, string | null>();
  for (const m of text.matchAll(/^@char\s+([a-z0-9_-]+)\s+"[^"]*"([^\n]*)$/gm)) chars.set(m[1]!, /portrait=([a-z0-9_-]+)/.exec(m[2]!)?.[1] ?? null);
  return chars;
}

/** `<tool> list --json` style calls are optional: a tool without them just yields an empty set. */
async function cliIds(tool: ToolId, env: ToolEnv | null, args: string[], pick: (j: any) => string[]): Promise<string[]> {
  if (!env) return [];
  try {
    const r = await runCli(tool, env, args, { timeoutMs: 60_000 });
    return pick(JSON.parse(r.stdout));
  } catch {
    return [];
  }
}

export async function readCatalog(ws: (t: ToolId) => string, env: (t: ToolId) => ToolEnv | null): Promise<Catalog> {
  const ready = new Set<ToolId>();
  const mark = async (t: ToolId) => {
    if (await exists(ws(t))) ready.add(t);
  };
  for (const t of ["sprite", "portrait", "scene", "tilemap", "dialogue", "npc", "quest", "items", "battle", "ui", "fx", "sfx", "music", "anim", "save", "font"] as ToolId[]) await mark(t);

  const c: Catalog = {
    ready,
    spriteProjects: new Set((await files(path.join(ws("sprite"), "projects"), ".json")).map((f) => stem(f, ".json"))),
    portraits: new Set(await dirs(path.join(ws("dialogue"), "portraits"))),
    scenes: new Set((await files(path.join(ws("scene"), "scenes"), ".json")).map((f) => stem(f, ".json"))),
    maps: new Map(),
    dialogues: new Map(),
    npcs: new Map(),
    npcSheets: new Set((await files(path.join(ws("npc"), "characters"), ".png")).map((f) => stem(f, ".png"))),
    quests: new Map(),
    items: new Map(),
    shops: new Map(),
    battle: { enemies: new Set(), heroes: new Set(), encounters: new Set() },
    uiScreens: new Set((await files(path.join(ws("ui"), "screens"), ".easyui.json")).map((f) => stem(f, ".easyui.json"))),
    fx: new Set((await files(path.join(ws("fx"), "effects"), ".easyfx.json")).map((f) => stem(f, ".easyfx.json"))),
    sfxBanks: new Map(),
    sfxPresets: new Set(),
    music: new Set((await files(path.join(ws("music"), "songs"), ".easymusic.json")).map((f) => stem(f, ".easymusic.json"))),
    cutscenes: new Set((await files(path.join(ws("anim"), "cutscenes"), ".easyanim.json")).map((f) => stem(f, ".easyanim.json"))),
    saveSchemas: new Set((await files(path.join(ws("save"), "schemas"), ".easysave.json")).map((f) => stem(f, ".easysave.json"))),
    fonts: new Set((await files(path.join(ws("font"), "fonts"), ".easyfont")).map((f) => stem(f, ".easyfont"))),
  };
  // Easy Portrait sets (built into dialogue portraits by the build) count as portraits too.
  for (const f of await files(path.join(ws("portrait"), "portraits"), ".easyportrait.json")) {
    const d = await readJson<{ portraits?: Array<{ id: string }> }>(path.join(ws("portrait"), "portraits", f)).catch(() => ({ portraits: [] }));
    for (const p of d.portraits ?? []) c.portraits.add(p.id);
  }
  for (const f of await files(path.join(ws("tilemap"), "maps"), ".json")) {
    const d = await readJson<{ characters?: Array<{ name: string }>; spawns?: Array<{ name: string }> }>(path.join(ws("tilemap"), "maps", f)).catch(() => ({}) as { characters?: Array<{ name: string }>; spawns?: Array<{ name: string }> });
    c.maps.set(stem(f, ".json"), { characters: new Set((d.characters ?? []).map((x) => x.name)), spawns: new Set((d.spawns ?? []).map((x) => x.name)) });
  }
  for (const f of await files(path.join(ws("dialogue"), "dialogues"), ".ezd")) c.dialogues.set(stem(f, ".ezd"), { chars: parseEzdChars(await readFile(path.join(ws("dialogue"), "dialogues", f), "utf8")) });
  for (const f of await files(path.join(ws("npc"), "npcs"), ".easynpc.json")) {
    const d = await readJson<{ npcs?: Array<{ id: string; sprite?: string }> }>(path.join(ws("npc"), "npcs", f)).catch(() => ({}) as { npcs?: Array<{ id: string; sprite?: string }> });
    for (const n of d.npcs ?? []) c.npcs.set(n.id, { sprite: n.sprite ?? null });
  }
  for (const f of await files(path.join(ws("quest"), "quests"), ".ezq")) c.quests.set(stem(f, ".ezq"), parseEzq(await readFile(path.join(ws("quest"), "quests", f), "utf8")));
  for (const f of await files(path.join(ws("items"), "items"), ".easyitems.json")) {
    const d = await readJson<{ items?: Array<{ id: string; category?: string; tags?: string[]; halal?: boolean }>; shops?: Array<{ id: string; halal?: boolean; stock?: Array<{ item: string }> }> }>(path.join(ws("items"), "items", f)).catch(() => ({}) as Record<string, never>);
    for (const i of d.items ?? []) c.items.set(i.id, { id: i.id, category: i.category, tags: i.tags ?? [], halal: i.halal });
    for (const s of d.shops ?? []) c.shops.set(s.id, { id: s.id, halal: !!s.halal, stock: (s.stock ?? []).map((x) => x.item) });
  }
  for (const f of await files(path.join(ws("battle"), "battles"), ".easybattle.json")) {
    const d = await readJson<{ enemies?: Array<{ id: string }>; heroes?: Array<{ id: string }>; encounters?: Array<{ id: string }> }>(path.join(ws("battle"), "battles", f)).catch(() => ({}) as Record<string, never>);
    for (const e of d.enemies ?? []) c.battle.enemies.add(e.id);
    for (const e of d.heroes ?? []) c.battle.heroes.add(e.id);
    for (const e of d.encounters ?? []) c.battle.encounters.add(e.id);
  }
  for (const f of await files(path.join(ws("sfx"), "banks"), ".easysfx.json")) {
    const d = await readJson<{ sounds?: Record<string, unknown> }>(path.join(ws("sfx"), "banks", f)).catch(() => ({}) as { sounds?: Record<string, unknown> });
    c.sfxBanks.set(stem(f, ".easysfx.json"), new Set(Object.keys(d.sounds ?? {})));
  }
  // Built-in presets (not files in the workspace): ask the tools.
  if (ready.has("fx")) for (const x of await cliIds("fx", env("fx"), ["list", "--json"], (j) => (j.effects ?? []).map((e: { id: string }) => e.id))) c.fx.add(x);
  if (ready.has("music")) for (const x of await cliIds("music", env("music"), ["list", "--json"], (j) => (j.songs ?? []).map((e: { id: string }) => e.id))) c.music.add(x);
  for (const x of await cliIds("sfx", env("sfx"), ["presets", "--json"], (j) => Object.keys(j.presets ?? {}))) c.sfxPresets.add(x);
  return c;
}
