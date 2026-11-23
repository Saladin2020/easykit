/** MCP smoke test: start the unified server over stdio and over HTTP like a client would and call tools. */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const ws = mkdtempSync(path.join(os.tmpdir(), "easykit-mcp-"));
const fail = (m) => {
  console.error("FAIL", m);
  process.exitCode = 1;
};
const body = (r) => JSON.parse(r.content?.[0]?.text ?? "{}");

async function exercise(client, label) {
  const tools = (await client.listTools()).tools.map((t) => t.name);
  const kit = tools.filter((n) => !n.includes("__"));
  const byNs = {};
  for (const n of tools.filter((n) => n.includes("__"))) byNs[n.split("__")[0]] = (byNs[n.split("__")[0]] ?? 0) + 1;
  console.log(`[${label}] kit tools: ${kit.join(", ")}; proxied: ${Object.entries(byNs).map(([k, v]) => `${k}(${v})`).join(" ") || "none"}`);
  for (const k of ["new_project", "doctor", "status"]) if (!kit.includes(k)) fail(`${label}: missing ${k}`);
  const d = body(await client.callTool({ name: "doctor", arguments: {} }));
  console.log(`[${label}] doctor: ${d.summary}`);
  if (d.tools?.length !== 17) fail(`${label}: doctor`);
  const s = body(await client.callTool({ name: "status", arguments: {} }));
  if (!Array.isArray(s.proxy)) fail(`${label}: status`);
  return { byNs, doctor: d };
}

// stdio, proxying Easy Save + Easy FX when they are installed
{
  const client = new Client({ name: "smoke", version: "0.0.1" });
  await client.connect(new StdioClientTransport({ command: "npx", args: ["tsx", "src/mcp/server.ts", "--workspace", ws], env: { ...process.env, EASYKIT_MCP_TOOLS: "save,fx" }, stderr: "ignore" }));
  const { byNs, doctor } = await exercise(client, "stdio");
  const saveReady = doctor.tools.find((t) => t.id === "save")?.built;
  if (saveReady) {
    if (!byNs.save) fail("stdio: save tools not proxied");
    const info = await client.callTool({ name: "save__workspace_info", arguments: {} });
    console.log(`[stdio] save__workspace_info: ${info.isError ? "error" : "ok"} keys=${body(info).strings?.keys}`);
    if (info.isError) fail("stdio: save__workspace_info");
  } else console.log("[stdio] skip proxy calls: Easy Save not installed");
  await client.close();
}

// HTTP, kit tools only
{
  const port = 18909 + Math.floor(Math.random() * 500);
  const proc = spawn("npx", ["tsx", "src/mcp/server.ts", "--http", "--port", String(port), "--workspace", ws], { stdio: ["ignore", "ignore", "pipe"], env: { ...process.env, EASYKIT_MCP_TOOLS: "none" } });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("HTTP server did not start")), 30_000);
    proc.stderr.on("data", (d) => String(d).includes("/mcp") && (clearTimeout(t), resolve()));
  });
  const client = new Client({ name: "smoke", version: "0.0.1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
  const { byNs } = await exercise(client, "http");
  if (Object.keys(byNs).length) fail("http: EASYKIT_MCP_TOOLS=none should disable proxies");
  await client.close();
  proc.kill();
}

rmSync(ws, { recursive: true, force: true });
if (!process.exitCode) console.log("mcp smoke ok");
process.exit(process.exitCode ?? 0);
