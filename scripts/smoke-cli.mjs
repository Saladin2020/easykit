/** CLI smoke test: drive the real CLI. Runs `easykit new` only when every sibling tool is installed and built. */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(os.tmpdir(), "easykit-cli-"));
const run = (...args) => {
  try {
    return { code: 0, out: execFileSync("npx", ["tsx", "src/cli.ts", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) };
  } catch (e) {
    return { code: e.status ?? 1, out: String(e.stdout ?? "") + String(e.stderr ?? "") };
  }
};
let failed = false;
const ok = (cond, label) => {
  console.log(`${cond ? "ok  " : "FAIL"} ${label}`);
  if (!cond) failed = true;
};

const tools = JSON.parse(run("tools", "--json").out);
ok(tools.tools.length === 18 && tools.kit.serve === 8908, "tools --json lists 18 tools + kit ports");
const doc = run("doctor", "--json");
const report = JSON.parse(doc.out);
ok(report.tools.length === 18 && typeof report.summary === "string", `doctor --json: ${report.summary}`);
ok((doc.code === 0) === report.ok, "doctor exit code matches readiness");
ok(/Easy Kit doctor/.test(run("doctor").out), "doctor text report");
ok(/no Easy Kit projects/.test(run("status", dir).out), "status on an empty folder");
ok(run("new", "../bad", "--dir", dir).code !== 0, "new rejects a bad name");
ok(run("new", "X", "--engine", "unity", "--dir", dir).code !== 0, "new rejects an unknown engine");
ok(run("ship", dir).code !== 0, "ship rejects a folder that is not a project");

if (report.ok) {
  const r = run("new", "SmokeDemo", "--dir", dir, "--seed", "5", "--engine", "pixi");
  ok(r.code === 0 && existsSync(path.join(dir, "SmokeDemo", "web", "index.html")), "new SmokeDemo --engine pixi (all installed tools)");
  ok(/SmokeDemo/.test(run("status", dir).out), "status lists the new project");
  const b = run("build", path.join(dir, "SmokeDemo"), "--engine", "pixi");
  ok(b.code === 0, "build re-assembles the web build");
  if (report.tools.find((t) => t.id === "ship")?.installed) {
    const sp = run("ship", path.join(dir, "SmokeDemo"), "--json");
    const sj = sp.code === 0 ? JSON.parse(sp.out) : null;
    ok(sj?.ok && sj.mode === "plan" && sj.uploaded === false, "ship plans a release (no build, no upload)");
  }
} else {
  console.log("skip new/build: sibling Easy tools are not installed (see doctor)");
}

rmSync(dir, { recursive: true, force: true });
if (failed) process.exit(1);
console.log("cli smoke ok");
