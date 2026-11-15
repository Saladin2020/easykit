import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { walk } from "../src/lib/fsutil.js";
import { LOCALES } from "../src/lib/localize.js";
import { TEMPLATES, loadTemplate, templateDir } from "../src/lib/pipeline.js";

describe.each(TEMPLATES)("template %s", (id) => {
  it("has a cast, segments and every engine entry point", async () => {
    const t = await loadTemplate(id);
    expect(t.id).toBe(id);
    for (const l of LOCALES) expect(t.name[l]).toBeTruthy();
    expect(t.sprite.cast.length).toBeGreaterThanOrEqual(5);
    expect(t.sprite.cast.map((c) => c.id)).toContain(t.sprite.player);
    expect(t.dialogue.segments[0]).toBe("market");
    const files = await walk(templateDir(id));
    for (const f of ["godot/kit/game.gd", "godot/kit/main.tscn", "godot/kit/test_game.gd", "pixi/index.html", "pixi/game.js", "strings/kit.easyi18n.json"]) expect(files).toContain(f);
  });

  it("ships kit strings in Thai, English and Malay", async () => {
    const doc = JSON.parse(await readFile(path.join(templateDir(id), "strings", "kit.easyi18n.json"), "utf8")) as { strings: Record<string, Record<string, string>> };
    const keys = Object.keys(doc.strings);
    expect(keys.length).toBeGreaterThan(20);
    for (const k of keys) for (const l of LOCALES) expect(doc.strings[k]![l], `${k}.${l}`).toBeTruthy();
  });

  it("keeps sacred content out (no adhan, no scripture, no calligraphy, no sacred figures)", async () => {
    const forbidden = /adhan|azan|athan|quran|qur'an|koran|calligraph|prophet|อาซาน|อะซาน|อัลกุรอาน|ศาสดา|[\u0600-\u06FF]/i;
    for (const f of await walk(templateDir(id))) {
      const text = await readFile(path.join(templateDir(id), f), "utf8");
      expect(forbidden.test(text), f).toBe(false);
    }
  });

  it("never commits generated sprite sheets into the kit", async () => {
    const files = await walk(templateDir(id));
    expect(files.filter((f) => /\.(png|webp|gif)$/.test(f))).toEqual([]);
  });
});
