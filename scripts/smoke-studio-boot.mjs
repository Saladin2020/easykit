#!/usr/bin/env node
// Cross-platform (Windows/macOS/Linux) boot smoke for `easy studio`: start it on a temp folder,
// create a game, validate a broken draft, save, then stop. No bash, no browser.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(path.join(os.tmpdir(), "easystudio-boot-"));
const port = Number(process.env.STUDIO_PORT ?? 8931);
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, [path.join(root, "dist", "cli.js"), "studio", dir, "--port", String(port)], { stdio: ["ignore", "inherit", "inherit"] });
const fail = (m) => {
  console.error(`FAIL ${m}`);
  process.exitCode = 1;
};
const j = async (method, url, body) => {
  const r = await fetch(base + url, { method, headers: { "content-type": "application/json" }, body: body && JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
try {
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    await new Promise((r) => setTimeout(r, 250));
    up = await fetch(`${base}/api/studio/info`).then((r) => r.ok, () => false);
  }
  if (!up) throw new Error("studio did not start");
  const info = (await j("GET", "/api/studio/info")).body;
  console.log(`ok   studio up · platform ${info.platform} · godot ${info.godot ?? "-"} · aseprite ${info.aseprite ?? "-"}`);
  const c = await j("POST", "/api/studio/projects", { name: "BootDemo" });
  c.status === 200 ? console.log("ok   created BootDemo/game.easy.json") : fail(`create ${JSON.stringify(c.body)}`);
  const m = (await j("GET", "/api/studio/p/BootDemo/manifest")).body.json;
  const v = await j("POST", "/api/studio/p/BootDemo/validate", { manifest: { ...m, game: { ...m.game, engine: "unity" } } });
  v.body.issues?.some((i) => i.path === "game.engine" && /[\u0E00-\u0E7F]/.test(i.th)) ? console.log("ok   draft validation (th/en)") : fail(`validate ${JSON.stringify(v.body)}`);
  const s = await j("PUT", "/api/studio/p/BootDemo/manifest", { manifest: m });
  s.body.ok ? console.log("ok   saved") : fail("save");
  const html = await fetch(`${base}/`).then((r) => r.text());
  /id="root"/.test(html) ? console.log("ok   UI served") : fail("UI not built (npm run build)");
  // fetch() cannot set Host, so use node:http (DNS-rebinding guard)
  const remote = await new Promise((res) => http.get({ host: "127.0.0.1", port, path: "/api/studio/info", headers: { host: "evil.example" } }, (r) => (r.resume(), res(r.statusCode))).on("error", () => res(0)));
  remote === 403 || remote === 401 || remote === 400 ? console.log(`ok   foreign Host header refused (${remote})`) : fail(`foreign host got ${remote}`);
} catch (e) {
  fail(e.message);
} finally {
  child.kill();
  setTimeout(() => rmSync(dir, { recursive: true, force: true }), 300);
}
