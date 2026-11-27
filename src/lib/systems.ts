/**
 * Game systems on top of the Easy tools: what `systems` in game.easy.json turns on, how it is checked against the
 * tool workspaces, what the games read (kit/systems.json) and which installed tool versions provide each system
 * (`easy doctor`).
 *
 *   calendar      Easy NPC   days / weeks / seasons / years, date events (market day, kite festival …)
 *   weather       Easy NPC + Easy FX   deterministic daily weather → overlay (rain, storm_rain, fog_drift, wind_gust)
 *   lifeSkills    Easy Items farming / fishing / cooking XP + levels
 *   skillTrees    Easy Battle hero skill trees + points
 *   relationships Easy NPC   hearts + heart events (dialogue / quest)
 *   achievements  Easy Quest @achievement
 *   followers     Easy Tilemap party followers on the overworld
 *   minimap       Easy Tilemap minimap + world map
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Catalog } from "./catalog.js";
import type { GameManifest, Issue } from "./manifest.js";
import type { ToolId } from "./tools.js";

export type Systems = NonNullable<GameManifest["systems"]>;
export const SYSTEM_IDS = ["calendar", "weather", "lifeSkills", "skillTrees", "relationships", "achievements", "followers", "minimap", "platformer", "actionCombat"] as const;
export type SystemId = (typeof SYSTEM_IDS)[number];

export const SYSTEM_NAMES: Record<SystemId, { th: string; en: string }> = {
  calendar: { th: "ปฏิทิน ฤดูกาล เทศกาล", en: "Calendar, seasons, date events" },
  weather: { th: "สภาพอากาศ", en: "Weather" },
  lifeSkills: { th: "ทักษะชีวิต (ปลูก ตกปลา ทำอาหาร)", en: "Life skills (farming, fishing, cooking)" },
  skillTrees: { th: "ต้นไม้ทักษะฮีโร่", en: "Hero skill trees" },
  relationships: { th: "ความสัมพันธ์ หัวใจ อีเวนต์", en: "Relationships, hearts, heart events" },
  achievements: { th: "ความสำเร็จ", en: "Achievements" },
  followers: { th: "เพื่อนร่วมทางเดินตาม", en: "Party followers" },
  minimap: { th: "มินิแมป / แผนที่โลก", en: "Minimap / world map" },
  platformer: { th: "กระโดด ปีน (ด้านข้าง)", en: "Side-view platforming" },
  actionCombat: { th: "ต่อสู้แบบเรียลไทม์", en: "Real-time action combat" },
};

/** Which tool provides a system and a marker in its installed runtime that proves the version has it. */
export const SYSTEM_PROBES: Record<SystemId, Array<{ tool: ToolId; file: string; marker: RegExp }>> = {
  calendar: [{ tool: "npc", file: "runtime/pixi/easynpc-core.js", marker: /function weatherOn\b/ }],
  weather: [
    { tool: "npc", file: "runtime/pixi/easynpc-core.js", marker: /WEATHER_INFO/ },
    { tool: "fx", file: "runtime/pixi/easyfx-pixi.js", marker: /WEATHER_FX/ },
  ],
  lifeSkills: [{ tool: "items", file: "runtime/pixi/easyitems-core.js", marker: /class LifeSkills\b/ }],
  skillTrees: [{ tool: "battle", file: "runtime/pixi/easybattle-core.js", marker: /function treeUnlock\b/ }],
  relationships: [{ tool: "npc", file: "runtime/pixi/easynpc-core.js", marker: /function heartEventDue\b/ }],
  achievements: [{ tool: "quest", file: "runtime/pixi/easyquest-manager.js", marker: /achievement_unlocked/ }],
  followers: [{ tool: "tilemap", file: "runtime/pixi/easytilemap-overworld.js", marker: /function followerTiles\b/ }],
  minimap: [{ tool: "tilemap", file: "runtime/pixi/easytilemap-overworld.js", marker: /function minimapGrid\b/ }],
  platformer: [{ tool: "action", file: "runtime/pixi/easyaction-core.js", marker: /function stepBody\b/ }],
  actionCombat: [
    { tool: "action", file: "runtime/pixi/easyaction-core.js", marker: /(?:class Skirmish\b|Skirmish = class\b)/ },
    { tool: "battle", file: "runtime/pixi/easybattle-core.js", marker: /function treeUnlock\b/ },
  ],
};

export interface SystemReport {
  id: SystemId;
  name: string;
  ok: boolean;
  tools: ToolId[];
  missing: string[];
}

/** `easy doctor`: does each installed tool runtime provide the systems? */
export function probeSystems(home: (t: ToolId) => string | null): SystemReport[] {
  return SYSTEM_IDS.map((id) => {
    const probes = SYSTEM_PROBES[id];
    const missing: string[] = [];
    for (const p of probes) {
      const h = home(p.tool);
      const f = h ? path.join(h, p.file) : null;
      if (!f || !existsSync(f) || !p.marker.test(readFileSync(f, "utf8"))) missing.push(`${p.tool}: ${p.file} lacks ${p.marker.source.replace(/\\b/g, "")}`);
    }
    if (!probes.length) missing.push("not implemented in the Easy tools yet");
    return { id, name: SYSTEM_NAMES[id].en, ok: missing.length === 0, tools: [...new Set(probes.map((p) => p.tool))], missing };
  });
}

export function enabledSystems(s: Systems | undefined): SystemId[] {
  if (!s) return [];
  return SYSTEM_IDS.filter((k) => {
    const v = (s as Record<string, unknown>)[k];
    return Array.isArray(v) ? v.length > 0 : v !== undefined && v !== false;
  });
}

/** What the Godot / Pixi games read: kit/systems.json. */
export function systemsData(s: Systems | undefined, fxExport: string[], action: { doc: string; file: string; battleDb: string } = { doc: "three_towns", file: "action/easyaction.json", battleDb: "action/battle_db.json" }): Record<string, unknown> {
  if (!s) return { format: "easy-systems/1", enabled: [] };
  const weatherFx = ["rain", "storm_rain", "fog_drift", "wind_gust"].filter((x) => fxExport.includes(x));
  return {
    format: "easy-systems/1",
    enabled: enabledSystems(s),
    ...(s.calendar ? { calendar: s.calendar } : {}),
    ...(s.weather ? { weather: { ...s.weather, fx: weatherFx } } : {}),
    ...(s.lifeSkills ? { lifeSkills: s.lifeSkills } : {}),
    ...(s.skillTrees ? { skillTrees: s.skillTrees } : {}),
    ...(s.relationships ? { relationships: s.relationships } : {}),
    ...(s.achievements ? { achievements: s.achievements } : {}),
    ...(s.followers?.length ? { followers: s.followers } : {}),
    ...(s.minimap ? { minimap: s.minimap } : {}),
    ...(s.platformer ? { platformer: { doc: action.doc, file: action.file, levels: typeof s.platformer === "object" ? s.platformer.levels : [] } } : {}),
    ...(s.actionCombat ? { actionCombat: { doc: action.doc, file: action.file, battleDb: action.battleDb, encounters: typeof s.actionCombat === "object" ? s.actionCombat.encounters : [], ...(typeof s.actionCombat === "object" && s.actionCombat.party ? { party: s.actionCombat.party } : {}) } } : {}),
  };
}

/** Easy NPC calendar document written into the npc workspace (merged with Easy NPC's defaults). */
export function calendarDoc(s: Systems | undefined): Record<string, unknown> | null {
  if (!s?.calendar) return null;
  const cal: Record<string, unknown> = {};
  if (s.calendar.weatherSeed !== undefined) cal.weatherSeed = s.calendar.weatherSeed;
  if (s.calendar.daysPerSeason !== undefined) cal.daysPerSeason = s.calendar.daysPerSeason;
  return { format: "easynpc/1", id: "kit_calendar", npcs: [], calendar: cal };
}

export function checkSystems(m: GameManifest, c: Catalog): Issue[] {
  const s = m.systems;
  const out: Issue[] = [];
  if (!s) return out;
  const err = (code: string, p: string, th: string, en: string) => out.push({ severity: "error", code, path: p, th, en });
  const warn = (code: string, p: string, th: string, en: string) => out.push({ severity: "warning", code, path: p, th, en });
  const list = (x: Iterable<string>) => [...x].sort().join(", ") || "-";
  if (s.weather && !s.calendar) warn("systems.weather", "systems.weather", "สภาพอากาศใช้ปฏิทินของ Easy NPC (เปิด systems.calendar ด้วย)", "weather rolls come from the Easy NPC calendar (turn on systems.calendar too)");
  if (s.weather?.overlay)
    for (const fx of ["rain", "storm_rain", "fog_drift", "wind_gust"])
      if (!m.fx.export.includes(fx)) warn("systems.weather.fx", "fx.export", `ใส่ "${fx}" ใน fx.export เพื่อแสดงสภาพอากาศ`, `add "${fx}" to fx.export to show the weather overlay`);
  if (s.lifeSkills && c.ready.has("items")) {
    for (const [i, k] of s.lifeSkills.skills.entries()) if (!c.systems.lifeSkills.has(k)) err("systems.lifeSkills", `systems.lifeSkills.skills[${i}]`, `ไม่พบทักษะ "${k}" ใน Easy Items (มี: ${list(c.systems.lifeSkills)})`, `life skill "${k}" not found in Easy Items (have: ${list(c.systems.lifeSkills)})`);
    for (const [i, k] of s.lifeSkills.crops.entries()) if (!c.systems.crops.has(k)) err("systems.lifeSkills", `systems.lifeSkills.crops[${i}]`, `ไม่พบพืช "${k}"`, `crop "${k}" not found in Easy Items (have: ${list(c.systems.crops)})`);
    for (const [i, k] of s.lifeSkills.fishingSpots.entries()) if (!c.systems.fishing.has(k)) err("systems.lifeSkills", `systems.lifeSkills.fishingSpots[${i}]`, `ไม่พบจุดตกปลา "${k}"`, `fishing spot "${k}" not found in Easy Items (have: ${list(c.systems.fishing)})`);
  }
  if (s.skillTrees && c.ready.has("battle")) {
    const party = new Set(m.battle?.party.map((p) => p.id) ?? []);
    for (const [i, h] of s.skillTrees.heroes.entries()) {
      if (!c.systems.heroTrees.has(h)) err("systems.skillTrees", `systems.skillTrees.heroes[${i}]`, `ฮีโร่ "${h}" ไม่มีต้นไม้ทักษะใน Easy Battle`, `hero "${h}" has no skill tree in Easy Battle (have: ${list(c.systems.heroTrees)})`);
      else if (!party.has(h)) warn("systems.skillTrees", `systems.skillTrees.heroes[${i}]`, `ฮีโร่ "${h}" ไม่อยู่ใน battle.party`, `hero "${h}" is not in battle.party`);
    }
  }
  if (s.relationships && c.ready.has("npc"))
    for (const [i, n] of s.relationships.npcs.entries()) {
      if (!c.npcs.has(n)) err("systems.relationships", `systems.relationships.npcs[${i}]`, `ไม่พบ NPC "${n}" ใน Easy NPC`, `NPC "${n}" not found in Easy NPC`);
      else if (s.relationships.heartEvents && !c.systems.heartNpcs.has(n)) warn("systems.relationships", `systems.relationships.npcs[${i}]`, `NPC "${n}" ยังไม่มี heartEvents`, `NPC "${n}" has no heartEvents yet`);
    }
  if (s.achievements && c.ready.has("quest"))
    for (const [i, q] of s.achievements.quests.entries()) if (!c.systems.achievements.has(q)) err("systems.achievements", `systems.achievements.quests[${i}]`, `ไฟล์เควสต์ "${q}" ไม่มี @achievement`, `quest file "${q}" has no @achievement lines (have: ${list(c.systems.achievements.keys())})`);
  const cast = new Set([...m.sprites.cast, ...m.sprites.side].map((x) => x.id));
  for (const [i, f] of (s.followers ?? []).entries()) {
    if (!cast.has(f)) err("systems.followers", `systems.followers[${i}]`, `ผู้ติดตาม "${f}" ไม่อยู่ใน sprites.cast`, `follower "${f}" is not in sprites.cast`);
    if (f === m.sprites.player) err("systems.followers", `systems.followers[${i}]`, "ผู้เล่นเป็นผู้ติดตามตัวเองไม่ได้", "the player cannot follow itself");
  }
  if ((s.platformer || s.actionCombat) && c.ready.has("action")) {
    const docId = m.action?.doc ?? "three_towns";
    const doc = c.systems.actionDocs.get(docId);
    if (!doc) err("systems.action", "action.doc", `ไม่พบเอกสาร Easy Action "${docId}"`, `Easy Action document "${docId}" not found (have: ${list(c.systems.actionDocs.keys())})`);
    else {
      if (typeof s.platformer === "object")
        for (const [i, l] of s.platformer.levels.entries()) if (!doc.levels.has(l)) err("systems.platformer", `systems.platformer.levels[${i}]`, `ไม่พบด่าน "${l}" ใน ${docId}`, `level "${l}" not in ${docId} (have: ${list(doc.levels)})`);
      if (typeof s.actionCombat === "object") {
        for (const [i, e] of s.actionCombat.encounters.entries()) if (!doc.encounters.has(e)) err("systems.actionCombat", `systems.actionCombat.encounters[${i}]`, `ไม่พบการต่อสู้ "${e}" ใน ${docId}`, `encounter "${e}" not in ${docId} (have: ${list(doc.encounters)})`);
        if (c.ready.has("battle")) for (const [i, h] of (s.actionCombat.party ?? []).entries()) if (!c.battle.heroes.has(h.id)) err("systems.actionCombat", `systems.actionCombat.party[${i}].id`, `ไม่พบฮีโร่ "${h.id}" ใน Easy Battle`, `hero "${h.id}" not found in Easy Battle`);
      }
    }
  }
  if (s.actionCombat && !m.battle) warn("systems.actionCombat", "battle", "การต่อสู้แบบเรียลไทม์ใช้ค่าพลังจาก Easy Battle (เพิ่มส่วน battle เพื่อใช้ฮีโร่ของเกม)", "real-time combat uses Easy Battle stats (add a battle section to fight with this game's heroes; the bundled sample is used otherwise)");
  return out;
}
