import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { KIT_TOOL_NAMES, SEP, createKitMcp, proxyListFromEnv } from "../src/mcp/server.js";
import { SIBLINGS, tempDir } from "./helpers.js";

async function connect(proxy: Parameters<typeof createKitMcp>[0]["proxy"], workspace: string) {
  const kit = createKitMcp({ workspace, proxy });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await kit.server.connect(a);
  const client = new Client({ name: "test", version: "0.0.1" });
  await client.connect(b);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: Array<{ type: string; text: string }> };
    return { error: !!r.isError, text: r.content[0]?.text ?? "", json: () => JSON.parse(r.content[0]!.text) };
  };
  return { kit, client, call };
}

describe("proxyListFromEnv", () => {
  it("parses the EASYKIT_MCP_TOOLS list", () => {
    expect(proxyListFromEnv({})).toBeUndefined();
    expect(proxyListFromEnv({ EASYKIT_MCP_TOOLS: "none" })).toEqual([]);
    expect(proxyListFromEnv({ EASYKIT_MCP_TOOLS: "save, items,bogus" })).toEqual(["save", "items"]);
  });
});

describe("kit MCP tools (no proxy)", () => {
  let ctx: Awaited<ReturnType<typeof connect>>;
  let cleanup: () => Promise<void>;
  beforeAll(async () => {
    const t = await tempDir();
    cleanup = t.cleanup;
    ctx = await connect([], t.dir);
  });
  afterAll(async () => {
    await ctx.client.close();
    await ctx.kit.close();
    await cleanup();
  });

  it("lists only the kit tools", async () => {
    const { tools } = await ctx.client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...KIT_TOOL_NAMES].sort());
    for (const t of tools) expect(t.inputSchema.type).toBe("object");
  });

  it("list_tools describes all 17 tools with a namespace prefix", async () => {
    const r = (await ctx.call("list_tools")).json();
    expect(r.tools).toHaveLength(17);
    expect(r.tools.map((t: { prefix: string }) => t.prefix)).toContain(`save${SEP}`);
    expect(r.kit.ports.mcp).toBe(8909);
  });

  it("doctor and status answer without siblings", async () => {
    const d = (await ctx.call("doctor")).json();
    expect(d.tools).toHaveLength(17);
    const s = (await ctx.call("status")).json();
    expect(s.proxy).toEqual([]);
    expect(s.projects).toBeNull();
  });

  it("rejects unknown and disabled namespaces", async () => {
    expect((await ctx.call("save__list_slots")).error).toBe(true);
    expect((await ctx.call("nope")).error).toBe(true);
  });

  it("keeps client paths inside the workspace", async () => {
    const r = await ctx.call("new_project", { name: "Escape", dir: "/etc" });
    expect(r.error).toBe(true);
    expect(r.text).toMatch(/outside the kit workspace/);
    expect((await ctx.call("build_project", { project: "../../x" })).error).toBe(true);
  });

  it("new_project validates the name", async () => {
    const r = await ctx.call("new_project", { name: "../evil" });
    expect(r.error).toBe(true);
  });
});

describe.skipIf(!SIBLINGS)("proxied sibling tools (local suite)", () => {
  let ctx: Awaited<ReturnType<typeof connect>>;
  let cleanup: () => Promise<void>;
  beforeAll(async () => {
    const t = await tempDir();
    cleanup = t.cleanup;
    ctx = await connect(["save", "fx"], t.dir);
  });
  afterAll(async () => {
    await ctx.client.close();
    await ctx.kit.close();
    await cleanup();
  });

  it("exposes namespaced tools and forwards calls", async () => {
    const { tools } = await ctx.client.listTools();
    const names = tools.map((t) => t.name);
    expect(names.some((n) => n.startsWith(`save${SEP}`))).toBe(true);
    expect(names.some((n) => n.startsWith(`fx${SEP}`))).toBe(true);
    const fxList = names.find((n) => /^fx__list/.test(n))!;
    const r = await ctx.call(fxList);
    expect(r.error).toBe(false);
    expect(r.text.length).toBeGreaterThan(2);
  }, 60_000);
});
