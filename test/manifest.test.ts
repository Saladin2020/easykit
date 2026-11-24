import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildOrder, STEP_DEPS } from "../src/lib/build.js";
import { parseEzdChars, parseEzq, type Catalog } from "../src/lib/catalog.js";
import { manifestJsonSchema, manifestToTemplate, parseManifest, templateToManifest, type GameManifest } from "../src/lib/manifest.js";
import { loadTemplate } from "../src/lib/pipeline.js";
import { BUILD_IDS, type ToolId } from "../src/lib/tools.js";
import { crossCheck } from "../src/lib/validate.js";

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
    ready: new Set<ToolId>(["sprite", "portrait", "scene", "tilemap", "dialogue", "npc", "quest", "items", "battle", "ui", "fx", "sfx", "music", "anim", "save", "font"]),
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
    fx: new Set(["coin_burst", "level_up", "sparkle_shine", "confetti", "footstep_dust", "heal_plus", "fireflies", "lantern_glow"]),
    sfxBanks: new Map([["village", new Set(["coin"])]]),
    sfxPresets: new Set(["coin"]),
    music: new Set(["village_day", "shop_theme"]),
    cutscenes: new Set(["village_morning_delivery"]),
    saveSchemas: new Set(["village_delivery"]),
    fonts: new Set(["makham-8", "makham-12", "makham-16"]),
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
