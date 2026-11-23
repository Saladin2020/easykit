import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CORE_TOOL_IDS, TOOL_IDS, TOOLS, cliPath, mcpServerPath, resolveTool } from "../src/lib/tools.js";

export async function tempDir(prefix = "easykit-"): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

/** A folder of fake easy* repos (package.json only, optionally with dist/cli.js). */
export async function fakeSuite(dir: string, opts: { built?: boolean; skip?: string[] } = {}): Promise<void> {
  for (const id of TOOL_IDS) {
    const t = TOOLS[id];
    if (opts.skip?.includes(id)) continue;
    const home = path.join(dir, id === "sprite" ? "easysprite-work" : t.pkg);
    await mkdir(home, { recursive: true });
    await writeFile(path.join(home, "package.json"), JSON.stringify({ name: t.pkg, version: "9.9.9" }));
    if (opts.built) {
      await mkdir(path.join(home, "dist", "mcp"), { recursive: true });
      await mkdir(path.join(home, "node_modules"), { recursive: true });
      await writeFile(path.join(home, "dist", "cli.js"), "");
      await writeFile(path.join(home, "dist", "mcp", "server.js"), "");
    }
  }
}

/** True when every core sibling repo is present and built (local dev); CI has none, so integration tests skip. */
/** Optional tools (portrait, npc, font, battle, ship) that are installed and built here. */
export const OPTIONAL_SIBLINGS = TOOL_IDS.filter((id) => !(CORE_TOOL_IDS as readonly string[]).includes(id)).filter((id) => {
  const r = resolveTool(id);
  return !!r.home && existsSync(cliPath(r.home));
});

export const SIBLINGS = (() => {
  if (process.env.EASYKIT_SKIP_INTEGRATION === "1") return false;
  return CORE_TOOL_IDS.every((id) => {
    const r = resolveTool(id);
    return !!r.home && existsSync(cliPath(r.home)) && existsSync(mcpServerPath(r.home));
  });
})();
