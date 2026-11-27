/** Cross-reference checks for game.easy.json: every id a section names must exist in the tool that owns it. */
import type { Catalog } from "./catalog.js";
import { checkSystems } from "./systems.js";
import type { GameManifest, Issue } from "./manifest.js";
import type { ToolId } from "./tools.js";
import { TOOLS } from "./tools.js";

const THAI = /[\u0E00-\u0E7F]/;
/** Content rules of the Easy Suite: no scripture, calligraphy or call to prayer as game content. */
const FORBIDDEN: Array<[RegExp, string]> = [
  [/qur['’]?an|koran|อัลกุรอาน|กุรอาน/i, "Quran / อัลกุรอาน"],
  [/calligraph|คัดลายมืออาหรับ|อักษรวิจิตรอาหรับ/i, "Arabic calligraphy decoration / อักษรวิจิตรอาหรับ"],
  [/\badhan\b|\badzan\b|\bazan\b|อะซาน|อาซาน/i, "adhan / อะซาน"],
  [/prophet|ศาสดา|นบี/i, "prophets / ศาสดา"],
];
/** Item tags / categories that can never be sold at a halal stall. */
const NON_HALAL = /^(pork|pig|lard|alcohol|liquor|beer|wine|non_halal|nonhalal)$/i;

export interface ValidateResult {
  ok: boolean;
  errors: Issue[];
  warnings: Issue[];
  /** Workspaces that were not ready, so references into them were not checked. */
  unchecked: ToolId[];
}

export function crossCheck(m: GameManifest, c: Catalog): Issue[] {
  const out: Issue[] = [...checkSystems(m, c)];
  const err = (code: string, p: string, th: string, en: string) => out.push({ severity: "error", code, path: p, th, en });
  const warn = (code: string, p: string, th: string, en: string) => out.push({ severity: "warning", code, path: p, th, en });
  const have = (s: Iterable<string>) => {
    const a = [...s].sort();
    return a.length ? ` (มี / have: ${a.slice(0, 12).join(", ")}${a.length > 12 ? ", …" : ""})` : "";
  };
  const ready = (t: ToolId) => c.ready.has(t);
  const missing = (code: string, p: string, tool: ToolId, kindTh: string, kindEn: string, id: string, pool: Iterable<string>) =>
    err(code, p, `ไม่พบ${kindTh} "${id}" ใน ${TOOLS[tool].name}${have(pool)}`, `${kindEn} "${id}" not found in ${TOOLS[tool].name}${have(pool)}`);
  const dupes = (ids: string[], p: string, what: string) => {
    const seen = new Set<string>();
    ids.forEach((x, i) => {
      if (seen.has(x)) err("dup", `${p}[${i}]`, `id ซ้ำ "${x}" ใน ${what}`, `duplicate id "${x}" in ${what}`);
      seen.add(x);
    });
  };

  // --- game + content rules
  if (!THAI.test(m.game.title.th)) err("title.thai", "game.title.th", "ชื่อเกมภาษาไทยต้องเขียนด้วยอักษรไทย", "game.title.th must be written in Thai script");
  if (m.game.setting && !THAI.test(m.game.setting.th)) err("setting.thai", "game.setting.th", "ชื่อหมู่บ้าน / สถานที่ภาษาไทยต้องเขียนด้วยอักษรไทย", "Thai settlement names must be written in Thai script");
  const walk = (v: unknown, p: string): void => {
    if (typeof v === "string") {
      for (const [re, what] of FORBIDDEN) if (re.test(v)) err("content.sacred", p, `ห้ามใช้ ${what} เป็นเนื้อหาเกม`, `${what} is not allowed as game content`);
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}[${i}]`));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, p ? `${p}.${k}` : k);
  };
  walk(m, "");

  // --- sprites
  const castIds = m.sprites.cast.map((x) => x.id);
  const sideIds = m.sprites.side.map((x) => x.id);
  dupes(castIds, "sprites.cast", "sprites.cast");
  dupes(sideIds, "sprites.side", "sprites.side");
  if (!castIds.includes(m.sprites.player)) err("sprites.player", "sprites.player", `ผู้เล่น "${m.sprites.player}" ต้องอยู่ใน sprites.cast`, `player "${m.sprites.player}" must be one of sprites.cast`);
  if (ready("sprite"))
    [...m.sprites.cast.map((x, i) => [x, `sprites.cast[${i}].base`] as const), ...m.sprites.side.map((x, i) => [x, `sprites.side[${i}].base`] as const)].forEach(([x, p]) => {
      if (!c.spriteProjects.has(x.base)) missing("sprite.base", p, "sprite", "ตัวละครต้นแบบ", "Easy Sprite base project", x.base, c.spriteProjects);
    });

  // --- portraits (made from the cast) → dialogue portraits
  const portraitIds = new Set([...c.portraits, ...(m.portraits?.sets.map((s) => s.id) ?? [])]);
  m.portraits?.sets.forEach((s, i) => {
    if (!castIds.includes(s.from)) err("portrait.from", `portraits.sets[${i}].from`, `ภาพเหมือน "${s.id}" ทำจาก "${s.from}" ซึ่งไม่อยู่ใน sprites.cast`, `portrait "${s.id}" is made from "${s.from}", which is not in sprites.cast`);
    if (!THAI.test(s.th)) err("portrait.thai", `portraits.sets[${i}].th`, "ชื่อภาษาไทยต้องเขียนด้วยอักษรไทย", "Thai names must be written in Thai script");
  });
  if (ready("dialogue") || ready("portrait")) m.portraits?.keep.forEach((k, i) => !portraitIds.has(k) && missing("portrait.keep", `portraits.keep[${i}]`, "portrait", "ภาพเหมือน", "Portrait", k, portraitIds));

  // --- scene
  if (ready("scene") && !c.scenes.has(m.scenes.title.id)) missing("scene.id", "scenes.title.id", "scene", "ฉาก", "Scene", m.scenes.title.id, c.scenes);
  if (!sideIds.includes(m.scenes.title.actor)) err("scene.actor", "scenes.title.actor", `นักแสดงฉากไตเติล "${m.scenes.title.actor}" ต้องอยู่ใน sprites.side`, `title actor "${m.scenes.title.actor}" must be one of sprites.side`);

  // --- tilemap
  const map = c.maps.get(m.tilemaps.main);
  if (ready("tilemap") && !map) missing("tilemap.main", "tilemaps.main", "tilemap", "แผนที่", "Map", m.tilemaps.main, c.maps.keys());
  if (map)
    m.sprites.cast.forEach((x, i) => {
      if (!x.at && !map.characters.has(x.map ?? x.id)) warn("tilemap.place", `sprites.cast[${i}]`, `"${x.map ?? x.id}" ไม่มีบนแผนที่และไม่มี "at" จะไม่ถูกวาง`, `"${x.map ?? x.id}" is not on the map and has no "at": it will not be placed`);
    });

  // --- dialogue + speakers
  const dlg = c.dialogues.get(m.dialogue.main);
  if (ready("dialogue") && !dlg) missing("dialogue.main", "dialogue.main", "dialogue", "บทสนทนา", "Dialogue", m.dialogue.main, c.dialogues.keys());
  if (dlg)
    for (const [ch, portrait] of dlg.chars)
      if (portrait && !portraitIds.has(portrait)) err("dialogue.portrait", "dialogue.main", `ผู้พูด "${ch}" ใช้ภาพเหมือน "${portrait}" ที่ไม่มี`, `speaker "${ch}" uses portrait "${portrait}", which does not exist${have(portraitIds)}`);

  // --- NPC roles + schedules
  for (const [who, r] of Object.entries(m.npcs.roles)) {
    const p = `npcs.roles.${who}`;
    const placed = m.sprites.cast.some((x) => (x.map ?? x.id) === who && x.at);
    if (map && !placed && !map.characters.has(who)) warn("npc.onmap", p, `"${who}" ไม่ได้อยู่บนแผนที่ ${m.tilemaps.main}`, `"${who}" is not a character on map ${m.tilemaps.main}`);
    if (r.role === "quest" && !r.speaker) err("npc.speaker", p, `NPC ภารกิจ "${who}" ต้องมี speaker`, `quest NPC "${who}" needs a speaker`);
    if (r.speaker && dlg && !dlg.chars.has(r.speaker)) missing("npc.speaker", `${p}.speaker`, "dialogue", `ผู้พูดในบท ${m.dialogue.main}`, `Speaker in ${m.dialogue.main}`, r.speaker, dlg.chars.keys());
    if (r.role === "shop" && !r.shop) err("npc.shop", p, `NPC ร้านค้า "${who}" ต้องระบุ shop`, `shop NPC "${who}" needs a shop`);
    if (r.shop && ready("items") && !c.shops.has(r.shop)) missing("npc.shop", `${p}.shop`, "items", "ร้าน", "Shop", r.shop, c.shops.keys());
  }
  for (const [who, npcId] of Object.entries(m.npcs.schedules ?? {})) {
    const p = `npcs.schedules.${who}`;
    const n = c.npcs.get(npcId);
    if (ready("npc") && !n) missing("npc.id", p, "npc", "ชาวบ้าน", "NPC", npcId, c.npcs.keys());
    if (n?.sprite && !c.npcSheets.has(n.sprite)) warn("npc.sheet", p, `ไม่พบสไปรต์ "${n.sprite}" ของ NPC "${npcId}" ใน Easy NPC (จะวาดเป็นจุดแทน)`, `NPC "${npcId}" sprite sheet "${n.sprite}" is not in Easy NPC characters/ (drawn as a marker)`);
    // the NPC's face in conversations: its @char portrait in any dialogue
    for (const [file, d] of c.dialogues) {
      const pid = d.chars.get(npcId);
      if (pid && (ready("dialogue") || ready("portrait")) && !portraitIds.has(pid)) err("npc.portrait", p, `NPC "${npcId}" ใช้ภาพเหมือน "${pid}" (บท ${file}) ที่ไม่มี`, `NPC "${npcId}" uses portrait "${pid}" (dialogue ${file}), which does not exist${have(portraitIds)}`);
    }
    if (map && !map.characters.has(who) && !castIds.includes(who)) warn("npc.onmap", p, `"${who}" ไม่ได้อยู่บนแผนที่`, `"${who}" is not a character on the map`);
  }

  // --- quests ↔ dialogue ↔ items
  const qs = c.quests.get(m.quests.main);
  if (ready("quest") && !qs) missing("quest.main", "quests.main", "quest", "ไฟล์ภารกิจ", "Quest file", m.quests.main, c.quests.keys());
  if (qs) {
    const main = m.quests.quest ?? m.quests.main;
    if (!qs.some((q) => q.id === main)) missing("quest.quest", "quests.quest", "quest", "ภารกิจ", "Quest", main, qs.map((q) => q.id));
    for (const q of qs) {
      if (q.dialogue && q.dialogue !== m.dialogue.main) warn("quest.dialogue", "quests.main", `ภารกิจ "${q.id}" ผูกกับบทสนทนา "${q.dialogue}" ไม่ใช่ "${m.dialogue.main}"`, `quest "${q.id}" is linked to dialogue "${q.dialogue}", not "${m.dialogue.main}"`);
      for (const g of q.givers) if (dlg && !dlg.chars.has(g)) err("quest.giver", "quests.main", `ผู้ให้ภารกิจ "${g}" (${q.id}) ไม่มีในบทสนทนา ${m.dialogue.main}`, `quest giver "${g}" (${q.id}) is not a speaker in dialogue ${m.dialogue.main}`);
      if (ready("items"))
        for (const u of q.usedItems)
          if (!c.items.has(u.item)) err("quest.item", `quests.main:${u.line}`, `ภารกิจ "${q.id}" ใช้ไอเทม "${u.item}" ที่ไม่มีใน Easy Items`, `quest "${q.id}" uses item "${u.item}", which is not in Easy Items${q.declaredItems.includes(u.item) ? " (declared with @item in the quest only)" : ""}`);
    }
  }

  // --- delivery stops (opt-in) and removed map characters
  const removed = new Set(m.tilemaps.remove ?? []);
  m.tilemaps.remove?.forEach((who) => {
    if (m.npcs.roles[who] && !m.sprites.cast.some((x) => (x.map ?? x.id) === who && x.at)) err("tilemap.remove", `npcs.roles.${who}`, `"${who}" ถูกนำออกจากแผนที่แต่ยังมีบทบาทใน npcs.roles`, `"${who}" is removed from the map but still has an npcs.roles entry`);
  });
  const mainQuest = qs?.find((q) => q.id === (m.quests.quest ?? m.quests.main));
  m.quests.deliveries?.forEach((d, i) => {
    const p = `quests.deliveries[${i}]`;
    if (dlg && !dlg.chars.has(d.speaker)) missing("delivery.speaker", `${p}.speaker`, "dialogue", `ผู้พูดในบท ${m.dialogue.main}`, `Speaker in ${m.dialogue.main}`, d.speaker, dlg.chars.keys());
    const placed = (who: string) => !removed.has(who) || m.sprites.cast.some((x) => (x.map ?? x.id) === who && x.at);
    if (!Object.entries(m.npcs.roles).some(([who, r]) => r.role === "quest" && r.speaker === d.speaker && placed(who)))
      err("delivery.npc", `${p}.speaker`, `ไม่มี NPC ภารกิจที่พูดเป็น "${d.speaker}" ใน npcs.roles`, `no quest NPC in npcs.roles speaks as "${d.speaker}"`);
    if (mainQuest && !mainQuest.steps.includes(d.step)) missing("delivery.step", `${p}.step`, "quest", `ขั้นของภารกิจ ${mainQuest.id}`, `Step of quest ${mainQuest.id}`, d.step, mainQuest.steps);
    if (!m.dialogue.segments.includes(d.step)) err("delivery.segment", `${p}.step`, `"${d.step}" ต้องอยู่ใน dialogue.segments ด้วย`, `"${d.step}" must also be one of dialogue.segments`);
    if (ready("items") && !c.items.has(d.item) && !mainQuest?.declaredItems.includes(d.item)) missing("delivery.item", `${p}.item`, "items", "ไอเทม", "Item", d.item, c.items.keys());
  });

  // --- items: shops, halal stalls
  if (ready("items")) {
    if (!c.shops.has(m.items.shop)) missing("items.shop", "items.shop", "items", "ร้าน", "Shop", m.items.shop, c.shops.keys());
    m.items.halalShops.forEach((sid, i) => {
      const s = c.shops.get(sid);
      const p = `items.halalShops[${i}]`;
      if (!s) return missing("items.halal", p, "items", "ร้าน", "Shop", sid, c.shops.keys());
      if (!s.halal) err("items.halal", p, `ร้าน "${sid}" ต้องตั้ง halal: true ใน Easy Items`, `shop "${sid}" must set halal: true in Easy Items`);
      for (const it of s.stock) {
        const item = c.items.get(it);
        if (!item) missing("items.stock", p, "items", `สินค้าของร้าน ${sid}`, `Stock of ${sid}`, it, c.items.keys());
        else if (item.halal === false || [...item.tags, item.category ?? ""].some((t) => NON_HALAL.test(t))) err("items.halal", p, `ร้านฮาลาล "${sid}" ขาย "${it}" ซึ่งไม่ฮาลาล`, `halal shop "${sid}" stocks "${it}", which is not halal`);
      }
    });
  }

  // --- battle
  const b = m.battle;
  if (b) {
    if (ready("battle")) {
      if (!c.battle.encounters.has(b.table)) missing("battle.table", "battle.table", "battle", "ตารางศัตรู", "Encounter table", b.table, c.battle.encounters);
      b.enemies.forEach((e, i) => !c.battle.enemies.has(e) && missing("battle.enemy", `battle.enemies[${i}]`, "battle", "ศัตรู", "Battle enemy", e, c.battle.enemies));
      b.party.forEach((h, i) => !c.battle.heroes.has(h.id) && missing("battle.hero", `battle.party[${i}].id`, "battle", "ฮีโร่", "Battle hero", h.id, c.battle.heroes));
    }
    for (const [hero, sheet] of Object.entries(b.heroSheets)) if (!sideIds.includes(sheet)) err("battle.sheet", `battle.heroSheets.${hero}`, `ชีตด้านข้าง "${sheet}" ต้องอยู่ใน sprites.side`, `side sheet "${sheet}" must be one of sprites.side`);
    if (b.layout === "backview" && b.status === "rows") warn("battle.status", "battle.status", "มุมหลังไม่มีแถบ HP แบบแถว จะใช้การ์ดสถานะแทน", "the backview layout has no HP rows; status cards are used instead");
    if (b.timing === "atb" && b.status === "none") warn("battle.atb", "battle.status", "ATB แสดงเกจเวลาบนการ์ดสถานะ ถ้า status เป็น none จะไม่เห็นเกจ", "ATB shows its time bars on the status cards; with status none they are hidden");
  }

  // --- ui, fx, sfx, music, anim, save, font
  if (ready("ui") && !c.uiScreens.has(m.ui.screen)) missing("ui.screen", "ui.screen", "ui", "หน้าจอ UI", "UI screen document", m.ui.screen, c.uiScreens);
  if (ready("fx")) {
    m.fx.seeded.forEach((f, i) => !c.fx.has(f.from) && missing("fx.from", `fx.seeded[${i}].from`, "fx", "เอฟเฟกต์", "Effect", f.from, c.fx));
    const made = new Set([...c.fx, ...m.fx.seeded.map((f) => f.id)]);
    m.fx.export.forEach((f, i) => !made.has(f) && missing("fx.export", `fx.export[${i}]`, "fx", "เอฟเฟกต์", "Effect", f, made));
  }
  if (ready("sfx")) {
    if (!c.sfxBanks.has(m.sfx.bank)) missing("sfx.bank", "sfx.bank", "sfx", "คลังเสียง", "Sound bank", m.sfx.bank, c.sfxBanks.keys());
    if (c.sfxPresets.size) m.sfx.seeded.forEach((s, i) => !c.sfxPresets.has(s.preset) && missing("sfx.preset", `sfx.seeded[${i}].preset`, "sfx", "พรีเซ็ตเสียง", "Sound preset", s.preset, c.sfxPresets));
  }
  if (ready("music")) {
    m.music.seeded.forEach((s, i) => !c.music.has(s.from) && missing("music.from", `music.seeded[${i}].from`, "music", "เพลง", "Song", s.from, c.music));
    const made = new Set([...c.music, ...m.music.seeded.map((s) => s.id)]);
    m.music.export.forEach((s, i) => !made.has(s) && missing("music.export", `music.export[${i}]`, "music", "เพลง", "Song", s, made));
  }
  for (const k of ["world", "shop"] as const) if (!m.music.export.includes(m.music[k])) err("music.use", `music.${k}`, `เพลง "${m.music[k]}" ต้องอยู่ใน music.export`, `song "${m.music[k]}" must be listed in music.export`);
  if (ready("anim") && !c.cutscenes.has(m.anim.cutscene)) missing("anim.cutscene", "anim.cutscene", "anim", "คัตซีน", "Cutscene", m.anim.cutscene, c.cutscenes);
  if (ready("save") && !c.saveSchemas.has(m.save.schema)) missing("save.schema", "save.schema", "save", "สคีมาเซฟ", "Save schema", m.save.schema, c.saveSchemas);
  if (ready("font") && !c.fonts.has(m.game.font)) missing("font", "game.font", "font", "ฟอนต์", "Font", m.game.font, c.fonts);
  for (const k of ["fontSmall", "fontDialogue"] as const) {
    const v = m.game[k];
    if (v && ready("font") && !c.fonts.has(v)) missing("font", `game.${k}`, "font", "ฟอนต์", "Font", v, c.fonts);
  }
  if (m.ship?.targets.includes("android") && m.ship.androidPackage && !/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(m.ship.androidPackage)) err("ship.android", "ship.androidPackage", "ชื่อแพ็กเกจ Android ไม่ถูกต้อง (เช่น app.easysuite.village)", "invalid Android package id (e.g. app.easysuite.village)");
  return out;
}

export function formatIssue(i: Issue): string {
  return `${i.severity === "error" ? "✗" : "!"} [${i.path}] ${i.th}\n    ${i.en}`;
}
