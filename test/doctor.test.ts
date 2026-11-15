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
  it("reports all 12 tools with versions when the suite is built", () => {
    const r = doctor({ cfg: { suiteDir: built }, env: {}, engines: false });
    expect(r.tools).toHaveLength(12);
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
    expect(r.summary).toBe("0/12 Easy tools ready");
    expect(r.tools.filter((t) => t.installed)).toHaveLength(10);
  });
});
