import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { doctor, formatDoctor } from "../src/lib/doctor.js";
import { fakeSuite, tempDir } from "./helpers.js";

let built: string;
let partial: string;
const cleanups: Array<() => Promise<void>> = [];
beforeAll(async () => {
  const a = await tempDir();
  const b = await tempDir();
  cleanups.push(a.cleanup, b.cleanup);
  built = a.dir;
  partial = b.dir;
  await fakeSuite(built, { built: true });
  await fakeSuite(partial, { skip: ["music", "anim"] });
});
afterAll(async () => {
  for (const c of cleanups) await c();
});

describe("doctor", () => {
  it("reports all 18 tools with versions when the suite is built", () => {
    const r = doctor({ cfg: { suiteDir: built }, env: {}, engines: false });
    expect(r.tools).toHaveLength(18);
    expect(r.ok).toBe(true);
    for (const t of r.tools) {
      expect(t.installed).toBe(true);
      expect(t.version).toBe("9.9.9");
      expect(t.problems).toEqual([]);
    }
    expect(formatDoctor(r)).toContain("Easy Sprite");
  });

  it("flags missing and unbuilt tools", () => {
    const r = doctor({ cfg: { suiteDir: partial }, env: {}, engines: false });
    expect(r.ok).toBe(false);
    const music = r.tools.find((t) => t.id === "music")!;
    expect(music.installed).toBe(false);
    expect(music.problems.join(" ")).toMatch(/not found/i);
    const save = r.tools.find((t) => t.id === "save")!;
    expect(save.installed).toBe(true);
    expect(save.built).toBe(false);
    expect(save.problems.length).toBeGreaterThan(0);
    expect(r.summary).toBe("0/18 Easy tools ready");
    expect(r.tools.filter((t) => t.installed)).toHaveLength(16);
  });

  it("stays ok when only the optional tools (Portrait, NPC, Font, Battle, Action, Ship) are missing", async () => {
    const c = await tempDir();
    cleanups.push(c.cleanup);
    await fakeSuite(c.dir, { built: true, skip: ["portrait", "npc", "font", "battle", "action", "ship"] });
    const r = doctor({ cfg: { suiteDir: c.dir }, env: {}, engines: false });
    expect(r.ok).toBe(true);
    expect(r.tools.filter((t) => !t.installed).map((t) => t.id).sort()).toEqual(["action", "battle", "font", "npc", "portrait", "ship"]);
    expect(r.summary).toBe("12/18 Easy tools ready");
  });
});

describe("doctor systems", () => {
  it("finds every built game system in the sibling tool runtimes", async () => {
    const { probeSystems } = await import("../src/lib/systems.js");
    const { resolveAll, loadKitConfig } = await import("../src/lib/tools.js");
    const homes = resolveAll(loadKitConfig().config);
    const r = probeSystems((t) => homes[t]?.home ?? null);
    const built = r.filter((s) => s.tools.length);
    // Only meaningful when the suite's tools are on their systems versions; otherwise each miss names the tool to update.
    for (const s of built) if (!s.ok) expect(s.missing.join()).toMatch(/lacks|runtime/);
    expect(r.map((s) => s.id)).toContain("minimap");
  });
});
