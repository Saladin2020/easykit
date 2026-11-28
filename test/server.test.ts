import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/server/app.js";
import { tempDir } from "./helpers.js";

let dir: string;
let cleanup: () => Promise<void>;
let app: ReturnType<typeof createApp>;
const H = { host: "127.0.0.1:8908" };
beforeAll(async () => {
  ({ dir, cleanup } = await tempDir());
  const root = path.join(dir, "Demo");
  await mkdir(path.join(root, "web"), { recursive: true });
  await writeFile(path.join(root, "web", "index.html"), "<h1>demo</h1>");
  await writeFile(path.join(dir, "secret.txt"), "nope");
  await writeFile(
    path.join(root, "easykit.project.json"),
    JSON.stringify({ format: "easykit-project/1", name: "Demo", id: "demo", template: "village_delivery", engine: "pixi", seed: 3, createdAt: "2026-11-15T07:00:00.000Z", kit: { version: "0.1.0" }, tools: {}, choices: {}, steps: [], ok: true }),
  );
  app = createApp({ projects: dir, dev: true });
});
afterAll(() => cleanup());

describe("dashboard API", () => {
  it("lists tools, templates and projects", async () => {
    const tools = (await (await app.request("/api/tools", { headers: H })).json()) as any;
    expect(tools.tools).toHaveLength(19);
    const tpl = (await (await app.request("/api/templates", { headers: H })).json()) as any;
    expect(tpl[0].id).toBe("village_delivery");
    const p = (await (await app.request("/api/projects", { headers: H })).json()) as any;
    expect(p.projects).toHaveLength(1);
    expect(p.projects[0]).toMatchObject({ name: "Demo", web: true, godot: false, seed: 3 });
  });

  it("serves a project's web build and blocks traversal", async () => {
    const ok = await app.request("/play/Demo/index.html", { headers: H });
    expect(ok.status).toBe(200);
    expect(await ok.text()).toContain("demo");
    expect((await app.request("/play/Demo/..%2F..%2Fsecret.txt", { headers: H })).status).toBe(404);
    expect((await app.request("/play/Demo/missing.js", { headers: H })).status).toBe(404);
  });

  it("validates new-project input", async () => {
    const bad = await app.request("/api/projects", { method: "POST", headers: { ...H, "content-type": "application/json" }, body: JSON.stringify({ name: "../x" }) });
    expect(bad.status).toBe(400);
    const eng = await app.request("/api/projects", { method: "POST", headers: { ...H, "content-type": "application/json" }, body: JSON.stringify({ name: "Ok", engine: "unity" }) });
    expect(eng.status).toBe(400);
  });

  it("rejects foreign hosts and origins", async () => {
    expect((await app.request("/api/tools", { headers: { host: "evil.example" } })).status).toBeGreaterThanOrEqual(400);
    const cross = await app.request("/api/projects", { method: "POST", headers: { ...H, origin: "http://evil.example", "content-type": "application/json" }, body: "{}" });
    expect(cross.status).toBeGreaterThanOrEqual(400);
  });
});
