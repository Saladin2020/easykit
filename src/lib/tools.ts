import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The 12 Easy tools Easy Kit drives, in pipeline order. */
export const TOOL_IDS = ["sprite", "scene", "tilemap", "dialogue", "quest", "ui", "sfx", "fx", "music", "anim", "items", "save"] as const;
export type ToolId = (typeof TOOL_IDS)[number];

export interface ToolSpec {
  id: ToolId;
  /** npm package / repo name, e.g. easysprite */
  pkg: string;
  /** Display name, e.g. Easy Sprite */
  name: string;
  /** Env prefix, e.g. EASYSPRITE (→ EASYSPRITE_HOME, EASYSPRITE_WORKSPACE, EASYSPRITE_ALLOWED_DIRS) */
  env: string;
  role: string;
  ports: { serve?: number; mcp: number; vite: number };
  /** Has a file-level CLI (init/export). Easy Sprite is driven through its MCP tools. */
  cli: boolean;
  /** Extra local folder names tried when EASY*_HOME is unset (relative to the suite folder). */
  aliases?: string[];
}

export const TOOLS: Record<ToolId, ToolSpec> = {
  sprite: { id: "sprite", pkg: "easysprite", name: "Easy Sprite", env: "EASYSPRITE", role: "48px paperdoll characters → top-down + side-view sheets", ports: { serve: 8787, mcp: 8790, vite: 5173 }, cli: false, aliases: ["easysprite-work"] },
  scene: { id: "scene", pkg: "easyscene", name: "Easy Scene", env: "EASYSCENE", role: "side-view scenes → title backdrop", ports: { mcp: 8796, vite: 5174 }, cli: true },
  tilemap: { id: "tilemap", pkg: "easytilemap", name: "Easy Tilemap", env: "EASYTILEMAP", role: "top-down village map, collision, spawns, NPCs", ports: { serve: 8808, mcp: 8809, vite: 5176 }, cli: true },
  dialogue: { id: "dialogue", pkg: "easydialogue", name: "Easy Dialogue", env: "EASYDIALOGUE", role: "branching NPC dialogue + dialogue box", ports: { serve: 8798, mcp: 8799, vite: 5175 }, cli: true },
  quest: { id: "quest", pkg: "easyquest", name: "Easy Quest", env: "EASYQUEST", role: "quest graph, flags, items, quest log", ports: { serve: 8818, mcp: 8819, vite: 5177 }, cli: true },
  ui: { id: "ui", pkg: "easyui", name: "Easy UI", env: "EASYUI", role: "pixel UI kit: theme, HUD, title, pause", ports: { serve: 8838, mcp: 8839, vite: 5179 }, cli: true },
  sfx: { id: "sfx", pkg: "easysfx", name: "Easy SFX", env: "EASYSFX", role: "8-bit sound effects + dialogue blips", ports: { serve: 8828, mcp: 8829, vite: 5178 }, cli: true },
  fx: { id: "fx", pkg: "easyfx", name: "Easy FX", env: "EASYFX", role: "pixel particle effects", ports: { serve: 8848, mcp: 8849, vite: 5180 }, cli: true },
  music: { id: "music", pkg: "easymusic", name: "Easy Music", env: "EASYMUSIC", role: "chiptune background music", ports: { serve: 8858, mcp: 8859, vite: 5181 }, cli: true },
  anim: { id: "anim", pkg: "easyanim", name: "Easy Anim", env: "EASYANIM", role: "cutscenes", ports: { serve: 8868, mcp: 8869, vite: 5182 }, cli: true },
  items: { id: "items", pkg: "easyitems", name: "Easy Items", env: "EASYITEMS", role: "item database, inventory, shops", ports: { serve: 8878, mcp: 8879, vite: 5185 }, cli: true },
  save: { id: "save", pkg: "easysave", name: "Easy Save", env: "EASYSAVE", role: "save slots + th/en/ms string tables", ports: { serve: 8898, mcp: 8899, vite: 5186 }, cli: true },
};

export const KIT_PORTS = { serve: 8908, mcp: 8909, vite: 5187 } as const;

/** Repo root of Easy Kit itself (works from src/ under tsx and from dist/). */
export function kitRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    if (existsSync(path.join(dir, "package.json")) && existsSync(path.join(dir, "templates"))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

export interface KitConfig {
  /** Folder holding the easy* repos side by side (default: the folder that holds Easy Kit). */
  suiteDir?: string;
  /** Per-tool home override. */
  tools?: Partial<Record<ToolId, string>>;
  /** Godot 4.3+ binary. */
  godot?: string;
  /** Chrome / Chromium binary (headless checks). */
  chrome?: string;
}

export interface ConfigSource {
  path: string | null;
  config: KitConfig;
}

/** easykit.config.json lookup: $EASYKIT_CONFIG → ./easykit.config.json → <kit>/easykit.config.json. */
export function loadKitConfig(cwd = process.cwd(), env: NodeJS.ProcessEnv = process.env): ConfigSource {
  const candidates = [env.EASYKIT_CONFIG, path.join(cwd, "easykit.config.json"), path.join(kitRoot(), "easykit.config.json")].filter(Boolean) as string[];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    const config = JSON.parse(readFileSync(p, "utf8")) as KitConfig;
    const base = path.dirname(p);
    const abs = (v?: string) => (v ? path.resolve(base, v) : v);
    return {
      path: p,
      config: {
        ...config,
        suiteDir: abs(config.suiteDir),
        tools: Object.fromEntries(Object.entries(config.tools ?? {}).map(([k, v]) => [k, abs(v)])),
      },
    };
  }
  return { path: null, config: {} };
}

export interface ResolvedTool {
  spec: ToolSpec;
  home: string | null;
  source: "env" | "config" | "suite" | "missing";
  tried: string[];
}

function looksLikeTool(dir: string, pkg: string): boolean {
  const p = path.join(dir, "package.json");
  if (!existsSync(p)) return false;
  try {
    return (JSON.parse(readFileSync(p, "utf8")) as { name?: string }).name === pkg;
  } catch {
    return false;
  }
}

/** EASY<NAME>_HOME → kit config tools.<id> → <suiteDir>/easy<id> (+ aliases). */
export function resolveTool(id: ToolId, cfg: KitConfig = loadKitConfig().config, env: NodeJS.ProcessEnv = process.env): ResolvedTool {
  const spec = TOOLS[id];
  const tried: string[] = [];
  const fromEnv = env[`${spec.env}_HOME`];
  if (fromEnv) {
    tried.push(fromEnv);
    if (looksLikeTool(fromEnv, spec.pkg)) return { spec, home: path.resolve(fromEnv), source: "env", tried };
  }
  const fromCfg = cfg.tools?.[id];
  if (fromCfg) {
    tried.push(fromCfg);
    if (looksLikeTool(fromCfg, spec.pkg)) return { spec, home: fromCfg, source: "config", tried };
  }
  const suite = cfg.suiteDir ?? env.EASYKIT_SUITE_DIR ?? path.dirname(kitRoot());
  for (const name of [spec.pkg, ...(spec.aliases ?? [])]) {
    const dir = path.join(suite, name);
    tried.push(dir);
    if (looksLikeTool(dir, spec.pkg)) return { spec, home: dir, source: "suite", tried };
  }
  return { spec, home: null, source: "missing", tried };
}

export function resolveAll(cfg?: KitConfig, env?: NodeJS.ProcessEnv): Record<ToolId, ResolvedTool> {
  return Object.fromEntries(TOOL_IDS.map((id) => [id, resolveTool(id, cfg, env)])) as Record<ToolId, ResolvedTool>;
}

export function cliPath(home: string): string {
  return path.join(home, "dist", "cli.js");
}

export function mcpServerPath(home: string): string {
  return path.join(home, "dist", "mcp", "server.js");
}

export function isToolId(v: string): v is ToolId {
  return (TOOL_IDS as readonly string[]).includes(v);
}
