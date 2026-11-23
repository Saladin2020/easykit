import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newProject, type ProjectManifest } from "../src/lib/pipeline.js";
import { shipProject } from "../src/lib/ship.js";
import { BUILD_IDS, CORE_TOOL_IDS } from "../src/lib/tools.js";
import { OPTIONAL_SIBLINGS, SIBLINGS, tempDir } from "./helpers.js";

const has = (t: string) => (OPTIONAL_SIBLINGS as string[]).includes(t);

describe.skipIf(!SIBLINGS)("easykit new (12 core sibling tools + the optional ones installed here)", () => {
  let dir: string;
  let cleanup: () => Promise<void>;
  let m: ProjectManifest;
  beforeAll(async () => {
    ({ dir, cleanup } = await tempDir());
    m = await newProject({ name: "ItDemo", dir, template: "village_delivery", engine: "both", seed: 11 });
  }, 300_000);
  afterAll(() => cleanup());

  it("runs one step per tool and assembles both engines", () => {
    for (const id of CORE_TOOL_IDS) expect(m.steps.find((s) => s.tool === id)?.ok, id).toBe(true);
    for (const id of BUILD_IDS.filter((t) => !(CORE_TOOL_IDS as readonly string[]).includes(t))) {
      const step = m.steps.find((s) => s.tool === id);
      if (has(id)) expect(step?.ok, id).toBe(true);
      else expect(step?.notes.join(" ") ?? "skipped", id).toMatch(/skipped|not installed/);
    }
    expect(m.ok).toBe(true);
    const root = path.join(dir, "ItDemo");
    for (const f of ["godot/project.godot", "godot/kit/kit.json", "godot/kit/game.gd", "web/index.html", "web/kit/kit.json", "easykit.project.json"]) expect(existsSync(path.join(root, f)), f).toBe(true);
  });

  it("generates the seeded player sheet into the project, with all three locales", async () => {
    const root = path.join(dir, "ItDemo");
    const kit = JSON.parse(await readFile(path.join(root, "godot", "kit", "kit.json"), "utf8"));
    expect(Object.keys(kit.dialogueFiles).sort()).toEqual(["en", "ms", "th"]);
    expect(existsSync(path.join(root, "godot", "characters", "kit_ton.png"))).toBe(true);
    const pg = await readFile(path.join(root, "godot", "project.godot"), "utf8");
    for (const a of ["QuestManager", "SfxBank", "MusicPlayer", "Items", "SaveManager", "I18n"]) expect(pg).toContain(`${a}=`);
  });

  it.skipIf(!has("portrait") || !has("npc") || !has("font") || !has("battle"))("wires Easy Portrait, NPC, Font and Battle into both builds", async () => {
    const root = path.join(dir, "ItDemo");
    const pg = await readFile(path.join(root, "godot", "project.godot"), "utf8");
    for (const a of ["Portraits", "NPCs", "EasyFont", "Battle"]) expect(pg).toContain(`${a}=`);
    for (const engine of ["godot", "web"]) {
      const kit = JSON.parse(await readFile(path.join(root, engine, "kit", "kit.json"), "utf8"));
      expect(kit.features).toEqual({ portrait: true, npc: true, font: true, battle: true });
      expect(kit.portraits.ids).toContain("town_vendor");
      expect(Object.keys(kit.npcSchedule.map).length).toBeGreaterThanOrEqual(3);
      expect(kit.battle.party.map((p: { id: string }) => p.id)).toEqual(["ton", "adam"]);
    }
    const th = JSON.parse(await readFile(path.join(root, "godot", "dialogue", "village_delivery.th.dialogue.json"), "utf8"));
    expect(th.assets.fontFiles.body).toBe("res://easyfont/makham-12.fnt");
    expect(th.ui.layout.text.fontSize).toBe(12);
    for (const f of ["godot/easybattle/heroes/ton.png", "web/battle/heroes/ton.png", "web/font/fonts/makham-12.fnt", "web/portrait/portraits.json", "web/npc/easynpc.world.json"]) expect(existsSync(path.join(root, f)), f).toBe(true);
  });

  it.skipIf(!has("ship"))("plans a release with Easy Ship and never uploads", async () => {
    const r = await shipProject(path.join(dir, "ItDemo"));
    expect(r.ok).toBe(true);
    expect(r.mode).toBe("plan");
    expect(r.uploaded).toBe(false);
    expect(r.configs.map((c) => c.engine)).toEqual(["godot", "pixi"]);
    for (const x of r.runs) expect(x.command).not.toContain("--upload");
    expect(existsSync(path.join(dir, "ItDemo", ".easy", "ship", "releases"))).toBe(false);
  }, 120_000);
});
