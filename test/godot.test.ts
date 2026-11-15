import { describe, expect, it } from "vitest";
import { isDemoFile, parseAutoloads, parseSection, projectGodot } from "../src/lib/godot.js";

describe("godot helpers", () => {
  it("skips each export's demo files but keeps runtime files", () => {
    for (const f of ["project.godot", "main.tscn", "main.gd", "icon.svg", "test_quest.gd", "README.txt", ".godot/x", "a.png.import"]) expect(isDemoFile(f)).toBe(true);
    for (const f of ["easyquest/quest_manager.gd", "scenes/main.tscn", "sfx/coin.wav", "test.gd"]) expect(isDemoFile(f)).toBe(false);
  });

  it("parses autoloads and sections", () => {
    const src = `config_version=5\n[application]\nconfig/name="x"\n[autoload]\n\nQuestManager="*res://easyquest/quest_manager.gd"\nSfxBank="*res://sfx/sfx_bank.gd"\n[display]\nwindow/size/viewport_width=480\n`;
    expect(parseAutoloads(src)).toEqual([
      ["QuestManager", "*res://easyquest/quest_manager.gd"],
      ["SfxBank", "*res://sfx/sfx_bank.gd"],
    ]);
    expect(parseSection(src, "display")).toEqual([["window/size/viewport_width", "480"]]);
  });

  it("writes a Godot 4.3 compatibility project with autoloads and translations", () => {
    const text = projectGodot({ name: 'Village "Demo"', autoloads: [["I18n", "*res://easysave/i18n.gd"]], width: 480, height: 270, translations: ["res://easysave/i18n/strings.th.translation"] });
    expect(text).toContain('config/name="Village Demo"');
    expect(text).toContain('run/main_scene="res://kit/main.tscn"');
    expect(text).toContain('I18n="*res://easysave/i18n.gd"');
    expect(text).toContain("window/size/viewport_width=480");
    expect(text).toContain('"res://easysave/i18n/strings.th.translation"');
    expect(text).toContain('renderer/rendering_method="gl_compatibility"');
    expect(parseAutoloads(text)).toHaveLength(1);
  });
});
