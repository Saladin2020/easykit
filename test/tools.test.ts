import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BUILD_IDS, CORE_TOOL_IDS, KIT_PORTS, TOOL_IDS, TOOLS, isToolId, resolveTool } from "../src/lib/tools.js";
import { fakeSuite, tempDir } from "./helpers.js";

let dir: string;
let cleanup: () => Promise<void>;
beforeAll(async () => {
  ({ dir, cleanup } = await tempDir());
  await fakeSuite(dir);
});
afterAll(() => cleanup());

describe("tool registry", () => {
  it("lists the 17 tools in pipeline order, the 12 core ones first-class", () => {
    expect(TOOL_IDS).toEqual(["sprite", "portrait", "scene", "tilemap", "dialogue", "npc", "quest", "font", "ui", "sfx", "fx", "music", "anim", "items", "battle", "save", "ship"]);
    expect(CORE_TOOL_IDS).toEqual(["sprite", "scene", "tilemap", "dialogue", "quest", "ui", "sfx", "fx", "music", "anim", "items", "save"]);
    expect(BUILD_IDS).not.toContain("ship");
    for (const id of TOOL_IDS) expect(!!TOOLS[id].optional, id).toBe(!(CORE_TOOL_IDS as readonly string[]).includes(id));
    for (const id of TOOL_IDS) {
      expect(TOOLS[id].id).toBe(id);
      expect(TOOLS[id].env).toBe(TOOLS[id].pkg.toUpperCase());
    }
    expect(isToolId("save")).toBe(true);
    expect(isToolId("kit")).toBe(false);
  });

  it("gives every tool and the kit a unique port", () => {
    const ports = [...TOOL_IDS.flatMap((id) => Object.values(TOOLS[id].ports)), ...Object.values(KIT_PORTS)];
    expect(new Set(ports).size).toBe(ports.length);
    expect(KIT_PORTS).toEqual({ serve: 8908, mcp: 8909, vite: 5187 });
  });
});

describe("resolveTool", () => {
  it("finds siblings in the suite folder, including the easysprite-work alias", () => {
    const r = resolveTool("sprite", { suiteDir: dir }, {});
    expect(r.source).toBe("suite");
    expect(r.home).toBe(path.join(dir, "easysprite-work"));
    expect(resolveTool("save", { suiteDir: dir }, {}).home).toBe(path.join(dir, "easysave"));
  });

  it("prefers EASY*_HOME, then the kit config", () => {
    const env = { EASYSAVE_HOME: path.join(dir, "easysave") };
    expect(resolveTool("save", { suiteDir: "/nowhere" }, env).source).toBe("env");
    expect(resolveTool("items", { suiteDir: "/nowhere", tools: { items: path.join(dir, "easyitems") } }, {}).source).toBe("config");
  });

  it("ignores folders whose package.json names another tool", () => {
    const r = resolveTool("save", { suiteDir: "/nowhere", tools: { save: path.join(dir, "easyitems") } }, { EASYSAVE_HOME: path.join(dir, "easyfx") });
    expect(r.source).toBe("missing");
    expect(r.home).toBeNull();
    expect(r.tried.length).toBeGreaterThanOrEqual(3);
  });
});
