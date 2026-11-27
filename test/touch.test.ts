/** DSK-7: game.easy.json `touch` — phone controls config, defaults, checks, round trip. */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { manifestJsonSchema, manifestToTemplate, parseManifest, templateToManifest } from "../src/lib/manifest.js";
import { loadTemplate } from "../src/lib/pipeline.js";
import { checkTouch, DEFAULT_TOUCH_PROFILES, touchData } from "../src/lib/touch.js";

const root = path.resolve(import.meta.dirname, "..");
const example = async () => JSON.parse(await readFile(path.join(root, "examples/tung_sadao/game.easy.json"), "utf8"));

describe("touch config", () => {
  it("defaults: auto mode, a control set for every game mode", () => {
    const d = touchData();
    expect(d).toMatchObject({ mode: "auto", opacity: 0.6, size: 1, style: "stick", menuKey: "Escape" });
    expect(Object.keys(d.profiles).sort()).toEqual(["action", "battle", "dialogue", "map", "menu", "street"]);
    expect(d.profiles.map!.stick).toBe("8way");
    expect(d.profiles.street!.stick).toBe("horizontal");
    expect(d.profiles.map!.buttons.map((b) => b.key)).toEqual(["e", "z", "Escape"]);
    expect(d.profiles.action!.buttons.map((b) => b.key)).toEqual([" ", "j", "k"]);
  });
  it("game profiles merge over the defaults", () => {
    const d = touchData({ mode: "on", profiles: { street: { stick: "horizontal", buttons: [{ id: "ok", key: "e" }, { id: "climb", label: "X", key: "x" }] } } });
    expect(d.mode).toBe("on");
    expect(d.profiles.street!.buttons).toHaveLength(2);
    expect(d.profiles.map).toEqual(DEFAULT_TOUCH_PROFILES.map);
  });
  it("manifest: valid touch section parses, bad values are schema errors, template round trip keeps it", async () => {
    const raw = await example();
    raw.touch = { mode: "auto", opacity: 0.5, style: "dpad", profiles: { map: { stick: "8way", buttons: [{ id: "ok", label: "E", key: "e" }] } } };
    const r = parseManifest(raw);
    expect(r.issues).toEqual([]);
    const tpl = manifestToTemplate(r.manifest!, await loadTemplate("village_delivery"));
    expect(tpl.touch?.style).toBe("dpad");
    const back = parseManifest(templateToManifest(tpl, { name: "X", engine: "both", seed: 1 }));
    expect(back.manifest?.touch?.opacity).toBe(0.5);
    for (const bad of [{ mode: "sometimes" }, { opacity: 2 }, { profiles: { map: { stick: "9way" } } }, { profiles: { map: { buttons: Array.from({ length: 7 }, (_, i) => ({ id: `b${i}`, key: "e" })) } } }, { extra: 1 }]) {
      const res = parseManifest({ ...raw, touch: bad });
      expect(res.manifest, JSON.stringify(bad)).toBeNull();
      expect(res.issues[0]!.path.startsWith("touch"), JSON.stringify(res.issues[0])).toBe(true);
    }
    expect(JSON.stringify(manifestJsonSchema())).toContain("dpad");
  });
  it("checkTouch: duplicate button ids and empty profiles", () => {
    const r = parseManifest({ ...{}, x: 1 });
    expect(r.manifest).toBeNull();
    const issues = checkTouch({ mode: "auto", opacity: 0.6, size: 1, style: "stick", menuKey: "Escape", profiles: { a: { stick: "8way", buttons: [{ id: "ok", key: "e" }, { id: "ok", key: "z" }] }, b: { stick: "none", buttons: [] } } });
    expect(issues.map((i) => i.path)).toEqual(["touch.profiles.a.buttons[1]", "touch.profiles.b"]);
    expect(checkTouch(undefined)).toEqual([]);
  });
});
