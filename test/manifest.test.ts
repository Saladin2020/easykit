import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildOrder, STEP_DEPS } from "../src/lib/build.js";
import { parseEzdChars, parseEzq, type Catalog } from "../src/lib/catalog.js";
import { manifestJsonSchema, manifestToTemplate, parseManifest, templateToManifest, type GameManifest } from "../src/lib/manifest.js";
import { loadTemplate } from "../src/lib/pipeline.js";
import { BUILD_IDS, type ToolId } from "../src/lib/tools.js";
import { crossCheck } from "../src/lib/validate.js";
import { calendarDoc, enabledSystems, probeSystems, systemsData } from "../src/lib/systems.js";

const root = path.resolve(import.meta.dirname, "..");
const example = async () => JSON.parse(await readFile(path.join(root, "examples/tung_sadao/game.easy.json"), "utf8"));
const parse = (raw: unknown) => {
  const r = parseManifest(raw);
  if (!r.manifest) throw new Error(JSON.stringify(r.issues));
  return r.manifest;
};

/** A catalog shaped like a freshly initialised village_delivery project (+ the example's halal stall). */
function catalog(over: Partial<Catalog> = {}): Catalog {
  return {
    ready: new Set<ToolId>(["sprite", "portrait", "scene", "tilemap", "dialogue", "npc", "quest", "items", "battle", "ui", "fx", "sfx", "music", "anim", "save", "font", "action"]),
    spriteProjects: new Set(["teacher", "little_boy", "market_seller", "roti_seller", "hijab_teacher", "kopiah_boy", "pak_cik_jubah", "grandpa", "village_farmer", "side_little_boy", "side_market_seller", "side_kopiah_boy", "side_hijab_teacher", "side_grandma"]),
    portraits: new Set(["town_monk", "town_kid", "town_vendor", "town_hijab_teacher"]),
    scenes: new Set(["harmony_town"]),
    maps: new Map([["multicultural_village", { characters: new Set(["ton", "pa_daeng", "bang_roti", "kak_fatimah", "adam", "pak_cik_ismail", "ta_poem", "luang_phi", "aisyah", "pak_hamid"]), spawns: new Set() }]]),
    dialogues: new Map([["village_delivery", { chars: new Map<string, string | null>([["kid", "town_kid"], ["vendor", "town_vendor"], ["monk", "town_monk"], ["farmer", "town_farmer"], ["elder", "town_elder"], ["fatimah", "town_hijab_teacher"], ["teacher", "town_teacher"]]) }]]),
    npcs: new Map([["fatimah", { sprite: "town_hijab_teacher" }], ["adam", { sprite: "town_kopiah_boy" }], ["pakcik", { sprite: "town_pak_cik" }], ["aisyah", { sprite: "town_tadika_girl" }], ["hamid", { sprite: "town_fisher" }]]),
    npcSheets: new Set(["town_hijab_teacher", "town_kopiah_boy", "town_pak_cik", "town_tadika_girl", "town_fisher"]),
    quests: new Map([["village_delivery", [{ id: "village_delivery", dialogue: "village_delivery", declaredItems: ["sticky_rice", "morning_glory", "balm"], usedItems: [{ item: "khanom", line: 9 }], givers: ["vendor"], steps: ["accept", "hall", "temple", "farm", "elder", "report"] }]]]),
    items: new Map([
      ["khanom", { id: "khanom", tags: [] }],
      ["roti_mataba", { id: "roti_mataba", tags: ["halal"], halal: true }],
      ["khao_mok_gai", { id: "khao_mok_gai", tags: ["halal"], halal: true }],
      ["moo_ping", { id: "moo_ping", tags: ["pork"] }],
    ]),
    shops: new Map([
      ["halal_stall", { id: "halal_stall", halal: true, stock: ["roti_mataba", "khao_mok_gai"] }],
      ["raya_bazaar", { id: "raya_bazaar", halal: true, stock: ["roti_mataba"] }],
      ["market", { id: "market", halal: false, stock: ["khanom", "moo_ping"] }],
    ]),
    battle: { enemies: new Set(["paddy_crab", "giant_mosquito", "monkey_thief", "fighting_rooster"]), heroes: new Set(["ton", "adam"]), encounters: new Set(["plains_fields", "tung_sadao_fields"]) },
    uiScreens: new Set(["village"]),
    fx: new Set(["coin_burst", "level_up", "sparkle_shine", "confetti", "footstep_dust", "heal_plus", "fireflies", "lantern_glow", "rain", "storm_rain", "fog_drift", "wind_gust"]),
    sfxBanks: new Map([["village", new Set(["coin"])]]),
    sfxPresets: new Set(["coin"]),
    music: new Set(["village_day", "shop_theme"]),
    cutscenes: new Set(["village_morning_delivery"]),
    saveSchemas: new Set(["village_delivery"]),
    fonts: new Set(["makham-8", "makham-12", "makham-16"]),
    systems: { lifeSkills: new Set(["farming", "fishing", "cooking"]), crops: new Set(["morning_glory"]), fishing: new Set(["canal"]), heroTrees: new Set(["ton", "adam"]), achievements: new Map([["village_delivery", ["first_job"]]]), heartNpcs: new Set(["fatimah"]), actionDocs: new Map([["three_towns", { levels: new Set(["ban_na_di_rooftops"]), encounters: new Set(["monkey_raid", "field_pests"]) }]]), shops: new Set(["heng_shop", "halal_stall"]), lines: new Map([["sh_kb", "train"], ["fl_sh_kb", "flight"]]), floodConfig: true },
    ...over,
  };
}
const errors = (m: GameManifest, c = catalog()) => crossCheck(m, c).filter((i) => i.severity === "error");

describe("game.easy.json schema", () => {
  it("parses the Thai village example and fills defaults", async () => {
    const m = parse(await example());
    expect(m.game.font).toBe("makham-16");
    expect(m.game.engine).toBe("both");
    expect(m.battle?.timing).toBe("atb");
    expect(m.game.setting?.th).toMatch(/บ้านทุ่งสะเดา/);
  });

  it("defaults the font to makham-16", async () => {
    const raw = await example();
    delete raw.game.font;
    expect(parse(raw).game.font).toBe("makham-16");
  });

  it("picks the small-label and dialogue fonts (DSK-6) and checks they exist", async () => {
    const raw = await example();
    raw.game.font = "makham-16";
    raw.game.fontSmall = "sarabun-px-12";
    raw.game.fontDialogue = "sarabun-px-14";
    const m = parse(raw);
    expect(m.game.fontSmall).toBe("sarabun-px-12");
    const c = catalog();
    expect(errors(m, c).map((i) => i.path)).toEqual(expect.arrayContaining(["game.fontSmall", "game.fontDialogue"]));
    expect(errors(m, catalog({ fonts: new Set(["makham-8", "makham-16", "sarabun-px-12", "sarabun-px-14"]) })).filter((i) => i.path.startsWith("game.font"))).toEqual([]);
  });

  it("rejects unknown keys and bad enums with a path", async () => {
    const raw = await example();
    raw.game.engine = "unity";
    raw.extra = 1;
    const r = parseManifest(raw);
    expect(r.manifest).toBeNull();
    expect(r.issues.map((i) => i.path)).toContain("game.engine");
    expect(r.issues.every((i) => i.th && i.en)).toBe(true);
  });

  it("schema/game.easy.schema.json is in sync (npm run schema)", async () => {
    const file = JSON.parse(await readFile(path.join(root, "schema/game.easy.schema.json"), "utf8"));
    expect(file).toEqual(JSON.parse(JSON.stringify(manifestJsonSchema())));
  });

  it("template → manifest → template round-trips the parts the build reads", async () => {
    const t = await loadTemplate("village_delivery");
    const m = parse(templateToManifest(t, { name: "Rt", engine: "both", seed: 3 }));
    const back = manifestToTemplate(m, t);
    for (const k of ["sprite", "scene", "tilemap", "dialogue", "quest", "npcs", "npc", "portrait", "ui", "sfx", "fx", "music", "anim", "items", "save"] as const) expect(back[k], k).toEqual(t[k]);
    expect(back.battle?.table).toBe(t.battle?.table);
  });
});

describe("cross-references", () => {
  it("the example is clean", async () => {
    expect(errors(parse(await example()))).toEqual([]);
  });

  it("names the missing id, where it is used, in Thai and English", async () => {
    const raw = await example();
    raw.battle.enemies.push("dragon");
    raw.npcs.roles.lung_mee.speaker = "ghost";
    raw.items.shop = "casino";
    const errs = errors(parse(raw));
    const enemy = errs.find((e) => e.code === "battle.enemy")!;
    expect(enemy.path).toBe("battle.enemies[4]");
    expect(enemy.th).toMatch(/ไม่พบศัตรู "dragon"/);
    expect(enemy.en).toMatch(/Battle enemy "dragon" not found in Easy Battle/);
    expect(errs.find((e) => e.code === "npc.speaker")?.en).toMatch(/Speaker in village_delivery "ghost"/);
    expect(errs.find((e) => e.code === "items.shop")?.path).toBe("items.shop");
  });

  it("quest reward / give items must exist in Easy Items", async () => {
    const c = catalog();
    c.quests.get("village_delivery")![0]!.usedItems.push({ item: "golden_mango", line: 20 });
    const e = errors(parse(await example()), c).find((x) => x.code === "quest.item")!;
    expect(e.path).toBe("quests.main:20");
    expect(e.th).toMatch(/golden_mango/);
  });

  it("dialogue speakers and NPCs need existing portraits", async () => {
    const c = catalog();
    c.dialogues.get("village_delivery")!.chars.set("fatimah", "town_nobody");
    const errs = errors(parse(await example()), c);
    expect(errs.map((e) => e.code)).toEqual(expect.arrayContaining(["dialogue.portrait", "npc.portrait"]));
  });

  it("halal stalls must be flagged halal and stock nothing non-halal", async () => {
    const raw = await example();
    raw.items.halalShops.push("market");
    const errs = errors(parse(raw)).filter((e) => e.code === "items.halal");
    expect(errs.map((e) => e.en)).toEqual([`shop "market" must set halal: true in Easy Items`, `halal shop "market" stocks "moo_ping", which is not halal`]);
  });

  it("rejects non-Thai settlement names and sacred content", async () => {
    const raw = await example();
    raw.game.setting.th = "Ban Thung Sadao";
    raw.game.title.en = "Quran recital night";
    const codes = errors(parse(raw)).map((e) => e.code);
    expect(codes).toEqual(expect.arrayContaining(["setting.thai", "content.sacred"]));
  });

  it("does not check references into workspaces that are not there yet", async () => {
    const c = catalog({ ready: new Set(), battle: { enemies: new Set(), heroes: new Set(), encounters: new Set() } });
    expect(errors(parse(await example()), c).filter((e) => e.code.startsWith("battle."))).toEqual([]);
  });
});

describe("delivery stops (quests.deliveries) and removed map characters", () => {
  it("the example replaces the base's first stop with a teacher at the community hall", async () => {
    const m = parse(await example());
    expect(m.quests.deliveries?.[0]).toEqual({ speaker: "teacher", step: "hall", item: "sticky_rice" });
    expect(m.tilemaps.remove).toEqual(["luang_phi"]);
    expect(JSON.stringify(m)).not.toMatch(/"monk"|"luang_phi":|หลวงพี่|วัด/);
  });

  it("checks each stop's speaker, quest NPC, step and segment", async () => {
    const raw = await example();
    raw.quests.deliveries[0] = { speaker: "ghost", step: "library", item: "sticky_rice" };
    const codes = errors(parse(raw)).map((e) => e.code);
    expect(codes).toEqual(expect.arrayContaining(["delivery.speaker", "delivery.npc", "delivery.step", "delivery.segment"]));
  });

  it("a removed map character cannot keep an NPC role", async () => {
    const raw = await example();
    raw.npcs.roles.luang_phi = { role: "bark" };
    expect(errors(parse(raw)).find((e) => e.code === "tilemap.remove")?.en).toMatch(/luang_phi/);
  });

  it("games without deliveries keep the base's stops (no new keys in their template)", async () => {
    const t = await loadTemplate("village_delivery");
    const back = manifestToTemplate(parse(templateToManifest(t, { name: "Old", engine: "both", seed: 1 })), t);
    expect(back.deliveries).toBeUndefined();
    expect(back.tilemap).toEqual({ map: t.tilemap.map });
    expect(back.save).toEqual({ schema: t.save.schema });
  });
});

describe("text formats", () => {
  it("reads quest ids, items and givers from .ezq", () => {
    const q = parseEzq(`@id x\n@dialogue village\n@item khanom "Khanom"\n=== q1 "One"\ngiver vendor\n  give khanom\n  take letter 2\n=== q2 "Two"\n`);
    expect(q.map((x) => x.id)).toEqual(["q1", "q2"]);
    expect(q[0]!.usedItems).toEqual([{ item: "khanom", line: 6 }, { item: "letter", line: 7 }]);
    expect(q[0]!.givers).toEqual(["vendor"]);
    expect(q[0]!.dialogue).toBe("village");
  });
  it("reads @char portraits from .ezd", () => {
    expect([...parseEzdChars(`@char kid "ต้น" portrait=town_kid\n@char narrator "—"\n`)]).toEqual([["kid", "town_kid"], ["narrator", null]]);
  });
});

describe("build order", () => {
  it("puts every step after the steps it reads", () => {
    const order = buildOrder(BUILD_IDS);
    expect(order).toHaveLength(BUILD_IDS.length);
    for (const t of order) for (const d of STEP_DEPS[t]) expect(order.indexOf(d), `${d} before ${t}`).toBeLessThan(order.indexOf(t));
    expect(order.indexOf("portrait")).toBeLessThan(order.indexOf("dialogue"));
  });
  it("detects a cycle", () => {
    expect(() => buildOrder(["sprite", "portrait"], { ...STEP_DEPS, sprite: ["portrait"] })).toThrow(/cycle/);
  });
});

describe("systems section", () => {
  const withSystems = async (systems: unknown) => parse({ ...(await example()), systems });
  it("is optional and round-trips through the template", async () => {
    const m = await withSystems({ calendar: { weatherSeed: 7 }, weather: {}, followers: ["kopiah_boy"], minimap: {} });
    expect(m.systems?.weather).toEqual({ overlay: true, affectsGameplay: true });
    expect(enabledSystems(m.systems)).toEqual(["calendar", "weather", "followers", "minimap"]);
    const tpl = manifestToTemplate(m, await loadTemplate("village_delivery"));
    expect(tpl.systems?.calendar?.weatherSeed).toBe(7);
    expect(templateToManifest(tpl, { name: "x", engine: "pixi", seed: 1 }).systems).toEqual(m.systems);
    expect(calendarDoc(m.systems)).toEqual({ format: "easynpc/1", id: "kit_calendar", npcs: [], calendar: { weatherSeed: 7 } });
    expect(calendarDoc(undefined)).toBeNull();
  });
  it("rejects unknown keys", async () => {
    expect(parseManifest({ ...(await example()), systems: { seasons: true } }).manifest).toBeNull();
  });
  it("cross-checks life skills, trees, hearts, achievements and followers", async () => {
    const m = await withSystems({
      lifeSkills: { skills: ["farming", "mining"], crops: ["durian"], fishingSpots: ["canal"] },
      skillTrees: { heroes: ["ton", "ghost"] },
      relationships: { npcs: ["fatimah", "adam", "nobody"] },
      achievements: { quests: ["village_delivery", "other"] },
      followers: ["nobody_sprite"],
      platformer: { levels: ["ban_na_di_rooftops", "moon_base"] },
      actionCombat: { encounters: ["monkey_raid", "dragon"], party: [{ id: "ton", level: 3 }, { id: "ghost", level: 1 }] },
    });
    const issues = crossCheck(m, catalog());
    const errs = issues.filter((i) => i.severity === "error").map((i) => i.path);
    expect(errs).toEqual(expect.arrayContaining(["systems.lifeSkills.skills[1]", "systems.lifeSkills.crops[0]", "systems.skillTrees.heroes[1]", "systems.relationships.npcs[2]", "systems.achievements.quests[1]", "systems.followers[0]", "systems.platformer.levels[1]", "systems.actionCombat.encounters[1]", "systems.actionCombat.party[1].id"]));
    expect(errs).not.toContain("systems.platformer.levels[0]");
    expect(errs).not.toContain("systems.lifeSkills.skills[0]");
    const warns = issues.filter((i) => i.severity === "warning").map((i) => i.path);
    expect(warns).toEqual(expect.arrayContaining(["systems.relationships.npcs[1]"]));
  });
  it("writes the runtime systems data with the exported weather effects", async () => {
    const m = await withSystems({ calendar: {}, weather: {} });
    expect(systemsData(m.systems, ["rain", "storm_rain", "coin_burst"])).toMatchObject({ format: "easy-systems/1", enabled: ["calendar", "weather"], weather: { fx: ["rain", "storm_rain"] } });
    expect(systemsData(undefined, [])).toEqual({ format: "easy-systems/1", enabled: [] });
    const a = await withSystems({ platformer: { levels: ["ban_na_di_rooftops"] }, actionCombat: true });
    expect(systemsData(a.systems, [], { doc: "three_towns", file: "res://easyaction/easyaction.json", battleDb: "res://easyaction/battle_db.json" })).toMatchObject({ enabled: ["platformer", "actionCombat"], platformer: { levels: ["ban_na_di_rooftops"], file: "res://easyaction/easyaction.json" }, actionCombat: { encounters: [], battleDb: "res://easyaction/battle_db.json" } });
  });
  it("town life: checks shops and transit lines against Easy NPC, writes the runtime data", async () => {
    const m = await withSystems({
      calendar: {}, weather: {}, lighting: true, shopHours: { shops: ["heng_shop", "ghost_shop"] }, interiors: { scenes: ["shop_interior"] },
      flood: {}, trains: { lines: ["sh_kb", "fl_sh_kb", "nope"] }, flights: { airports: ["talat_sin_heng"], lines: ["fl_sh_kb"] },
    });
    const issues = crossCheck(m, catalog());
    const errs = issues.filter((i) => i.severity === "error").map((i) => i.path);
    expect(errs).toEqual(expect.arrayContaining(["systems.shopHours.shops[1]", "systems.trains.lines[1]", "systems.trains.lines[2]"]));
    expect(errs).not.toContain("systems.shopHours.shops[0]");
    expect(errs).not.toContain("systems.trains.lines[0]");
    expect(errs).not.toContain("systems.flights.lines[0]");
    expect(issues.filter((i) => i.severity === "warning").map((i) => i.path)).toContain("systems.flights.airports");
    const d = systemsData(m.systems, []);
    expect(d.enabled).toEqual(expect.arrayContaining(["lighting", "shopHours", "interiors", "flood", "trains", "flights"]));
    expect(d).toMatchObject({ lighting: { overlay: true, lamps: true }, flood: { overlay: true, affectsGameplay: true }, trains: { ticketCounter: true } });
    const r = probeSystems(() => null);
    expect(r.find((s) => s.id === "flood")?.tools).toEqual(["npc", "fx", "tilemap"]);
    expect(r.find((s) => s.id === "interiors")?.tools).toEqual(["scene"]);
  });
  it("doctor probes report missing runtimes per system", () => {
    const r = probeSystems(() => null);
    expect(r.find((s) => s.id === "calendar")).toMatchObject({ ok: false, tools: ["npc"] });
    expect(r.find((s) => s.id === "platformer")).toMatchObject({ ok: false, tools: ["action"] });
    expect(r.find((s) => s.id === "actionCombat")?.tools).toEqual(["action", "battle"]);
    expect(r.every((s) => !s.missing.includes("not implemented in the Easy tools yet"))).toBe(true);
  });
});
