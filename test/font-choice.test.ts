import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dialogueFitIssues, pixelFontLayout } from "../src/lib/godot.js";
import { LEGACY_FONT, projectFont } from "../src/lib/pipeline.js";

const tpl = JSON.parse(readFileSync(new URL("../templates/village_delivery/template.json", import.meta.url), "utf8")) as { font: { hud: string; small: string; dialogue: string } };

/** Easy Dialogue's default box (480×270 viewport) as exported for the village template. */
const layout = () => ({
  ui: {
    layout: {
      viewport: { width: 480, height: 270 },
      box: { x: 8, y: 186, w: 464, h: 78 },
      text: { padX: 10, padY: 9, fontSize: 12, lineHeight: 18, maxLines: 3 },
      plate: { h: 20, padX: 9, fontSize: 12, offsetY: -12 },
      choices: { rowH: 18, padX: 22, padY: 8, gap: 6, fontSize: 12, minW: 150 },
    },
  },
});

describe("pixel font for new and existing games", () => {
  it("new games use มะขาม 16 for HUD and dialogue, มะขาม 8 for small labels", () => {
    expect(tpl.font).toEqual({ hud: "makham-16", small: "makham-8", dialogue: "makham-16" });
  });

  it("existing projects keep their font; --font opts in", () => {
    expect(projectFont(tpl.font, undefined)).toEqual(LEGACY_FONT); // made before the switch: no recorded choice
    expect(projectFont(tpl.font, { hud: "makham-16", small: "makham-8", dialogue: "makham-16" })).toEqual(tpl.font);
    expect(projectFont(tpl.font, undefined, "makham-16")).toEqual({ hud: "makham-16", small: "makham-8", dialogue: "makham-16" });
    expect(projectFont(undefined, undefined, "makham-16")).toBeUndefined();
    expect(() => projectFont(tpl.font, undefined, "../x")).toThrow(/bad font id/);
  });

  it("the dialogue box grows to fit มะขาม 16 (22 px lines) and stays inside the viewport", () => {
    const doc = layout();
    pixelFontLayout(doc, "makham-16", { size: 16, line: 22 });
    const L = doc.ui.layout;
    expect(L.text.lineHeight).toBe(22);
    expect(L.plate.h).toBe(24);
    expect(L.choices.rowH).toBe(22);
    expect(L.box.h).toBe(2 * 9 + 3 * 22);
    expect(L.box.y + L.box.h).toBe(186 + 78); // bottom edge kept
    expect(dialogueFitIssues(L)).toEqual([]);
    expect((doc.ui as { kitFont?: string }).kitFont).toBe("makham-16");
  });

  it("มะขาม 12 layouts are unchanged", () => {
    const doc = layout();
    pixelFontLayout(doc, "makham-12", { size: 12, line: 18 });
    expect(doc.ui.layout.box).toEqual({ x: 8, y: 186, w: 464, h: 78 });
    expect(dialogueFitIssues(doc.ui.layout)).toEqual([]);
  });

  it("reports a box that cannot hold its lines", () => {
    const L = layout().ui.layout;
    L.text.lineHeight = 22;
    expect(dialogueFitIssues(L).join(" ")).toMatch(/needs 84 px but the box is 78 px/);
    expect(() => pixelFontLayout({ ui: { layout: { ...L, box: { x: 8, y: 0, w: 464, h: 20 }, viewport: { width: 480, height: 40 } } } }, "huge", { size: 40, line: 60 })).toThrow(/does not fit/);
  });
});
