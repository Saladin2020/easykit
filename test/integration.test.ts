import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newProject, type ProjectManifest } from "../src/lib/pipeline.js";
import { TOOL_IDS } from "../src/lib/tools.js";
import { SIBLINGS, tempDir } from "./helpers.js";

describe.skipIf(!SIBLINGS)("easykit new (all 12 sibling tools)", () => {
  let dir: string;
  let cleanup: () => Promise<void>;
  let m: ProjectManifest;
  beforeAll(async () => {
    ({ dir, cleanup } = await tempDir());
    m = await newProject({ name: "ItDemo", dir, template: "village_delivery", engine: "both", seed: 11 });
  }, 240_000);
  afterAll(() => cleanup());

  it("runs one step per tool and assembles both engines", () => {
    for (const id of TOOL_IDS) expect(m.steps.find((s) => s.tool === id)?.ok, id).toBe(true);
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
});
