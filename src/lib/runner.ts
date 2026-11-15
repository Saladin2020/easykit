import { spawn } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { TOOLS, cliPath, mcpServerPath, type ToolId } from "./tools.js";

export interface ToolEnv {
  home: string;
  /** Tool workspace (each tool gets its own under <project>/.easy/<tool>). */
  workspace: string;
  /** Folders the tool may read/write outside its workspace. */
  allowed: string[];
}

export function toolEnv(id: ToolId, t: ToolEnv, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const e = TOOLS[id].env;
  return { ...base, [`${e}_HOME`]: t.home, [`${e}_WORKSPACE`]: t.workspace, [`${e}_ALLOWED_DIRS`]: t.allowed.join(process.platform === "win32" ? ";" : ":"), NO_COLOR: "1" };
}

export class ToolError extends Error {
  constructor(
    readonly tool: ToolId,
    message: string,
    readonly detail = "",
  ) {
    super(`${TOOLS[tool].name}: ${message}`);
  }
}

export interface CliResult {
  stdout: string;
  stderr: string;
}

/** `node <home>/dist/cli.js <args…> --workspace <ws>` with the tool env. */
export function runCli(id: ToolId, t: ToolEnv, args: string[], opts: { workspaceFlag?: boolean; timeoutMs?: number } = {}): Promise<CliResult> {
  const argv = [cliPath(t.home), ...args, ...(opts.workspaceFlag === false ? [] : ["--workspace", t.workspace])];
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, argv, { cwd: t.workspace, env: toolEnv(id, t), stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs ?? 180_000);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new ToolError(id, e.message));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new ToolError(id, `\`${args.join(" ")}\` exited ${code}`, (stderr || stdout).trim().slice(-2000)));
    });
  });
}

/** A stdio MCP client for one Easy tool's server (`dist/mcp/server.js --workspace <ws>`). */
export class ToolMcp {
  private client: Client | null = null;
  constructor(
    readonly id: ToolId,
    readonly env: ToolEnv,
  ) {}

  async connect(): Promise<Client> {
    if (this.client) return this.client;
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [mcpServerPath(this.env.home), "--workspace", this.env.workspace],
      env: toolEnv(this.id, this.env) as Record<string, string>,
      cwd: this.env.workspace,
      stderr: "pipe",
    });
    const client = new Client({ name: `easykit→${TOOLS[this.id].pkg}`, version: "0.1.0" });
    await client.connect(transport);
    this.client = client;
    return client;
  }

  async listTools() {
    return (await (await this.connect()).listTools()).tools;
  }

  /** Call a tool; parses the JSON text payload the Easy servers return. Throws on isError. */
  async call<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const res = await (await this.connect()).callTool({ name, arguments: args });
    const content = (res.content ?? []) as Array<{ type: string; text?: string }>;
    const text = content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
    if (res.isError) throw new ToolError(this.id, `${name} failed`, text);
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as T;
    }
  }

  async raw(name: string, args: Record<string, unknown> = {}) {
    return (await this.connect()).callTool({ name, arguments: args });
  }

  async close(): Promise<void> {
    const c = this.client;
    this.client = null;
    await c?.close().catch(() => undefined);
  }
}
