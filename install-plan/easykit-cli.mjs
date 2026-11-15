#!/usr/bin/env node
/**
 * Studio CLI wrapper around Easy Kit (new / build / check / doctor / status / mcp).
 *
 * Usage:
 *   node /workspace/indie-studio/tools/easykit-cli.mjs <command> [options]
 *
 * Install:  EASYKIT_HOME, else this folder's easykit/
 * Tools:    the studio installs next to it (tools/easy<id>), unless EASY<TOOL>_HOME or EASYKIT_SUITE_DIR is set.
 * New games go to /workspace/indie-studio/projects/<Name> by default (`new` without --dir), which is also allowed
 * for the MCP server.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const HOME = path.resolve(process.env.EASYKIT_HOME?.trim() || path.join(here, "easykit"));
const STUDIO_PROJECTS = path.resolve(here, "..", "projects");
const cli = path.join(HOME, "dist", "cli.js");

if (!existsSync(cli)) {
  console.error(`Easy Kit CLI not found at ${cli}. Set EASYKIT_HOME and run npm ci && npm run build there.`);
  process.exit(1);
}

const env = { ...process.env, EASYKIT_SUITE_DIR: process.env.EASYKIT_SUITE_DIR?.trim() || here };
const allowed = new Set((env.EASYKIT_ALLOWED_DIRS ?? "").split(path.delimiter).map((s) => s.trim()).filter(Boolean));
allowed.add(STUDIO_PROJECTS);
env.EASYKIT_ALLOWED_DIRS = [...allowed].join(path.delimiter);

const args = process.argv.slice(2);
if (args[0] === "new" && !args.includes("--dir")) args.push("--dir", STUDIO_PROJECTS);
if (args[0] === "mcp" && !args.includes("--workspace") && !args.includes("--project")) args.push("--workspace", STUDIO_PROJECTS);

const child = spawn(process.execPath, [cli, ...args], { cwd: process.cwd(), stdio: "inherit", env });
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
