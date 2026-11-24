/** `easy init`: write game.easy.json for a new game, or from an existing Easy Kit project (easykit.project.json). */
import path from "node:path";
import { exists, readJson, writeJson } from "./fsutil.js";
import { MANIFEST_FILE, parseManifest, templateToManifest, type GameManifestInput } from "./manifest.js";
import { loadTemplate, type ProjectManifest, type Template } from "./pipeline.js";

export async function manifestFromProject(project: string): Promise<GameManifestInput> {
  const p = path.join(path.resolve(project), "easykit.project.json");
  if (!(await exists(p))) throw new Error(`${project} is not an Easy Kit project (no easykit.project.json)`);
  const pm = await readJson<ProjectManifest>(p);
  const tpl = await loadTemplate(pm.template);
  const font = (pm.choices?.font as Template["font"] | undefined)?.dialogue;
  // projects made before มะขาม 16 recorded no font: they used makham-12
  return templateToManifest(tpl, { name: pm.name, engine: pm.engine, seed: pm.seed, font: font ?? "makham-12", ship: { targets: ["web"], release: "0.1.0" } });
}

export async function initManifest(opts: { dir: string; from?: string; name?: string; template?: string; force?: boolean }): Promise<{ file: string; manifest: GameManifestInput }> {
  const dir = path.resolve(opts.dir);
  const file = path.join(dir, MANIFEST_FILE);
  if ((await exists(file)) && !opts.force) throw new Error(`${file} already exists (use --force to overwrite)`);
  const manifest = opts.from
    ? await manifestFromProject(opts.from)
    : templateToManifest(await loadTemplate(opts.template ?? "village_delivery"), { name: opts.name ?? (path.basename(dir).replace(/[^A-Za-z0-9_-]/g, "") || "MyGame"), engine: "both", seed: 1, ship: { targets: ["web"], release: "0.1.0" } });
  if (opts.name) manifest.game.name = opts.name;
  const { issues } = parseManifest(manifest);
  if (issues.length) throw new Error(`generated manifest is invalid: ${issues.map((i) => `${i.path}: ${i.en}`).join("; ")}`);
  await writeJson(file, manifest);
  return { file, manifest };
}
