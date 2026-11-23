import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { copyTree, exists, walk, writeJson } from "./fsutil.js";
import { featureData, features, fontMetrics, kitData, loadGameStrings, loadShaper, pixelFontLayout, writeLocalizedDialogues, type DialogueBuild } from "./godot.js";
import { LOCALES } from "./localize.js";
import type { Ctx } from "./pipeline.js";
import { templateDir } from "./pipeline.js";
import type { ToolId } from "./tools.js";

export function pixiSources(c: Ctx): Array<{ tool: ToolId; dir: string; to: string; optional?: boolean }> {
  const e = (tool: ToolId, rel: string, to: string = tool) => ({ tool, dir: path.join(c.ws(tool), "exports", rel), to });
  return [
    e("tilemap", `${c.tpl.tilemap.map}-pixi`),
    e("dialogue", `${c.tpl.dialogue.id}-pixi`),
    e("quest", `${c.tpl.quest.id}-pixi`),
    e("ui", `${c.tpl.ui.doc}-pixi`),
    e("sfx", `${c.tpl.sfx.bank}-pixi`),
    e("fx", "easyfx-pixi"),
    e("music", "easymusic-web"),
    e("anim", "easyanim-pixi"),
    e("items", "easyitems-pixi"),
    e("save", "easysave-web"),
    { ...e("portrait", "easyportrait-pixi"), optional: true },
    { ...e("npc", "easynpc-pixi"), optional: true },
    { ...e("font", "easyfont-pixi"), optional: true },
    { ...e("battle", "easybattle-pixi"), optional: true },
  ];
}

/** PixiJS v8 browser bundle shipped with Easy Kit (MIT). */
export function pixiBundle(): string | null {
  try {
    const req = createRequire(import.meta.url);
    let dir = path.dirname(req.resolve("pixi.js"));
    for (let i = 0; i < 4 && path.basename(dir) !== "pixi.js"; i++) dir = path.dirname(dir);
    return path.join(dir, "dist", "pixi.min.js");
  } catch {
    return null;
  }
}

export interface PixiBuild {
  dir: string;
  files: number;
  pixi: "bundled" | "cdn";
  dialogue: DialogueBuild;
}

export async function assemblePixi(c: Ctx): Promise<PixiBuild> {
  const dest = path.join(c.root, "web");
  await mkdir(dest, { recursive: true });
  // Each tool keeps its own folder so relative URLs inside the exports keep working.
  for (const s of pixiSources(c)) {
    if (!(await exists(s.dir))) {
      if (s.optional) continue;
      throw new Error(`missing web export ${s.dir}`);
    }
    await copyTree(s.dir, path.join(dest, s.to), (rel) => rel === "index.html" || rel === "README.txt");
  }
  await copyTree(path.join(templateDir(c.tpl.id), "pixi"), dest);
  const bundle = pixiBundle();
  let pixi: PixiBuild["pixi"] = "cdn";
  if (bundle && (await exists(bundle))) {
    await copyFile(bundle, path.join(dest, "pixi.min.js"));
    pixi = "bundled";
  }
  await mkdir(path.join(dest, "kit"), { recursive: true });
  await copyFile(path.join(c.assets, "scene", "title.png"), path.join(dest, "kit", "title.png"));
  const strings = await loadGameStrings(c);
  const feat = await features(c, "pixi");
  const fontId = c.tpl.font?.dialogue;
  const metrics = feat.font && fontId ? await fontMetrics(c, fontId) : null;
  const font = feat.font && fontId && metrics ? { shape: await loadShaper(c), assets: (doc: any) => pixelFontLayout(doc, fontId, metrics) } : undefined;
  const dialogue = await writeLocalizedDialogues(c, path.join(dest, "dialogue", `${c.tpl.dialogue.id}.dialogue.json`), path.join(dest, "dialogue"), strings, font);
  await writeJson(path.join(dest, "kit", "kit.json"), {
    ...kitData(c, "pixi"),
    ...featureData(c, feat),
    world: `tilemap/${c.tpl.tilemap.map}.tilemap.json`,
    questFile: `quest/${c.tpl.quest.id}.quests.json`,
    dialogueFiles: Object.fromEntries(LOCALES.map((l) => [l, `dialogue/${c.tpl.dialogue.id}.${l}.dialogue.json`])),
    cutsceneFile: `anim/cutscenes/${c.tpl.anim.cutscene}.json`,
  });
  return { dir: "web", files: (await walk(dest)).length, pixi, dialogue };
}
