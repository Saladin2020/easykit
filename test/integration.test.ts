import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dialogueFitIssues } from "../src/lib/godot.js";
import { newProject, rebuildProject, type ProjectManifest } from "../src/lib/pipeline.js";
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
    expect(th.assets.fontFiles.body).toBe("res://easyfont/makham-16.fnt");
    expect(th.ui.kitFont).toBe("makham-16");
    expect(th.ui.layout.text.fontSize).toBe(16);
    expect(th.ui.layout.text.lineHeight).toBe(22);
    expect(dialogueFitIssues(th.ui.layout)).toEqual([]);
    const m = JSON.parse(await readFile(path.join(root, "easykit.project.json"), "utf8")) as ProjectManifest;
    expect(m.choices.font).toEqual({ hud: "makham-16", small: "makham-8", dialogue: "makham-16" });
    for (const f of ["godot/easybattle/heroes/ton.png", "web/battle/heroes/ton.png", "web/font/fonts/makham-16.fnt", "web/portrait/portraits.json", "web/npc/easynpc.world.json"]) expect(existsSync(path.join(root, f)), f).toBe(true);
  });

  it.skipIf(!has("font"))("keeps the font of an older project on rebuild; --font opts in to มะขาม 16", async () => {
    const root = path.join(dir, "ItDemo");
    const mp = path.join(root, "easykit.project.json");
    const thPath = path.join(root, "godot", "dialogue", "village_delivery.th.dialogue.json");
    const m = JSON.parse(await readFile(mp, "utf8")) as ProjectManifest;
    delete (m.choices as { font?: unknown }).font; // a project made before the switch
    await writeFile(mp, JSON.stringify(m, null, 2));
    await rebuildProject(root, { engine: "both" });
    let th = JSON.parse(await readFile(thPath, "utf8"));
    expect(th.assets.fontFiles.body).toBe("res://easyfont/makham-12.fnt");
    expect(th.ui.layout.text.lineHeight).toBe(18);
    const kit = JSON.parse(await readFile(path.join(root, "web", "kit", "kit.json"), "utf8"));
    expect(kit.font).toEqual({ hud: "makham-12", small: "makham-8", dialogue: "makham-12" });

    const r = await rebuildProject(root, { engine: "both", font: "makham-16" });
    expect(r.choices.font).toEqual({ hud: "makham-16", small: "makham-8", dialogue: "makham-16" });
    th = JSON.parse(await readFile(thPath, "utf8"));
    expect(th.assets.fontFiles.body).toBe("res://easyfont/makham-16.fnt");
    expect(dialogueFitIssues(th.ui.layout)).toEqual([]);
    expect(existsSync(path.join(root, "web", "font", "fonts", "makham-16.fnt"))).toBe(true);
  }, 240_000);

  it.skipIf(!has("ship"))("plans a release with Easy Ship and never uploads", async () => {
    const r = await shipProject(path.join(dir, "ItDemo"));
    expect(r.ok).toBe(true);
    expect(r.mode).toBe("plan");
    expect(r.uploaded).toBe(false);
    expect(r.configs.map((c) => c.engine)).toEqual(["godot", "pixi"]);
    for (const x of r.runs) expect(x.command).not.toContain("--upload");
    expect(existsSync(path.join(dir, "ItDemo", ".easy", "ship", "releases"))).toBe(false);
  }, 120_000);

  it.skipIf(!has("ship"))("adds an Android package when android is a target (existing config updated, still a plan)", async () => {
    const r = await shipProject(path.join(dir, "ItDemo"), { targets: "web,android" });
    expect(r.ok, r.runs.map((x) => x.output).join("\n")).toBe(true);
    const j = JSON.parse(await readFile(path.join(dir, "ItDemo", ".easy", "ship", "ships", "itdemo.easyship.json"), "utf8")) as { targets: string[]; android?: { package: string } };
    expect(j.android?.package).toBe("app.easysuite.itdemo");
    expect(j.targets).toContain("android");
    for (const x of r.runs) expect(x.command).not.toContain("--upload");
  }, 120_000);
});
