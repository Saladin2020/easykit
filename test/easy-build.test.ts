import { cp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildProject, validateProject, type BuildReport } from "../src/lib/build.js";
import { initManifest } from "../src/lib/init.js";
import { parseManifest } from "../src/lib/manifest.js";
import { SIBLINGS, OPTIONAL_SIBLINGS, tempDir } from "./helpers.js";

const ALL = SIBLINGS && ["portrait", "npc", "font", "battle"].every((t) => (OPTIONAL_SIBLINGS as string[]).includes(t));
const example = path.resolve(import.meta.dirname, "../examples/tung_sadao");
const built = (r: BuildReport) => r.steps.filter((s) => s.status === "built").map((s) => (s.tool === "kit" ? s.title.split(" ")[1]! : s.tool));

describe.skipIf(!ALL)("easy build: examples/tung_sadao (all 17 tools)", () => {
  let dir: string;
  let cleanup: () => Promise<void>;
  let first: BuildReport;
  beforeAll(async () => {
    ({ dir, cleanup } = await tempDir("easy-build-"));
    await cp(example, path.join(dir, "TungSadao"), { recursive: true });
    first = await buildProject(path.join(dir, "TungSadao"));
  }, 400_000);
  afterAll(() => cleanup());

  it("builds every tool step in dependency order, then both engines", async () => {
    expect(first.ok, JSON.stringify(first.issues.concat(first.steps.filter((s) => s.error) as never[]))).toBe(true);
    expect(first.steps.filter((s) => s.status === "built")).toHaveLength(18);
    const kit = JSON.parse(await readFile(path.join(dir, "TungSadao/web/kit/kit.json"), "utf8"));
    const s = JSON.stringify(kit);
    expect(s).toContain("ตลาดเช้าบ้านทุ่งสะเดา");
    expect(s).toContain("halal_stall");
    expect(s).toContain("tung_sadao_fields");
    const battle = JSON.parse(await readFile(path.join(dir, "TungSadao/godot/easybattle/easybattle.json"), "utf8"));
    expect(battle.ui.timing).toBe("atb");
    // the first stop is a lay teacher at the community hall; the base's monk is gone from the game data
    expect(kit.deliveries[0]).toEqual({ speaker: "teacher", step: "hall", item: "sticky_rice" });
    expect(kit.npcs.kru_somjai).toEqual({ role: "quest", speaker: "teacher" });
    expect(kit.npcs.luang_phi).toBeUndefined();
    for (const f of ["web/save/strings.json", "web/quest/village_delivery.quests.json", "web/npc/easynpc.world.json", "web/kit/kit.json"])
      expect(await readFile(path.join(dir, "TungSadao", f), "utf8"), f).not.toMatch(/หลวงพี่|luang_phi/);
    const strings = JSON.parse(await readFile(path.join(dir, "TungSadao/web/save/strings.json"), "utf8"));
    expect(JSON.stringify(strings)).toContain("Hantaran pagi di Ban Thung Sadao");
    expect(await readFile(path.join(dir, "TungSadao/BUILD-REPORT.md"), "utf8")).toMatch(/✅ built/);
    // game systems: calendar seed reaches Easy NPC, both engines get kit/systems.json
    expect(kit.systemsFile).toBe("kit/systems.json");
    for (const e of ["web", "godot"]) {
      const sys = JSON.parse(await readFile(path.join(dir, "TungSadao", e, "kit/systems.json"), "utf8"));
      expect(sys).toMatchObject({ enabled: ["calendar", "weather", "followers", "minimap"], followers: ["adam"], weather: { fx: ["rain", "storm_rain", "fog_drift", "wind_gust"] } });
    }
    const world = JSON.parse(await readFile(path.join(dir, "TungSadao/web/npc/easynpc.world.json"), "utf8"));
    expect(world.calendar.weatherSeed).toBe(11);
  });

  it("is idempotent: a second build skips everything", async () => {
    const r = await buildProject(path.join(dir, "TungSadao"));
    expect(built(r)).toEqual([]);
    expect(r.steps.every((s) => s.status === "skipped")).toBe(true);
  }, 120_000);

  it("rebuilds only what an edited source feeds", async () => {
    const f = path.join(dir, "TungSadao/content/items/tung_sadao_halal.easyitems.json");
    await writeFile(f, (await readFile(f, "utf8")).replace('"price": 35', '"price": 30'));
    const r = await buildProject(path.join(dir, "TungSadao"));
    expect(built(r)).toEqual(["items", "save", "Godot", "PixiJS"]);
  }, 120_000);

  it("reports broken cross-references in Thai and English and builds nothing", async () => {
    const f = path.join(dir, "TungSadao/game.easy.json");
    const good = await readFile(f, "utf8");
    const m = JSON.parse(good);
    m.battle.enemies.push("dragon");
    m.npcs.roles.pa_daeng.speaker = "ghost";
    await writeFile(f, JSON.stringify(m));
    const v = await validateProject(path.join(dir, "TungSadao"));
    expect(v.ok).toBe(false);
    expect(v.issues.find((i) => i.code === "battle.enemy")?.th).toMatch(/ไม่พบศัตรู "dragon"/);
    const r = await buildProject(path.join(dir, "TungSadao"));
    expect(r.ok).toBe(false);
    expect(r.steps).toEqual([]);
    await writeFile(f, good);
  }, 120_000);

  it("easy init --from writes a valid manifest for an existing project", async () => {
    const { manifest } = await initManifest({ dir: path.join(dir, "fromProject"), from: path.join(dir, "TungSadao") });
    expect(parseManifest(manifest).issues).toEqual([]);
    expect(manifest.game.name).toBe("TungSadao");
    expect(manifest.game.font).toBe("makham-16");
  });
});
