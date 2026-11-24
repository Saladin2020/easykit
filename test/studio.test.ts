import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/server/app.js";
import { DIR_RE, inside } from "../src/server/studio.js";
import { which } from "../src/lib/doctor.js";
import { tempDir } from "./helpers.js";

let dir: string;
let cleanup: () => Promise<void>;
let app: ReturnType<typeof createApp>;
const launched: { bin: string; args: string[] }[] = [];
const H = { host: "127.0.0.1:8908", "content-type": "application/json" };
const get = (u: string) => app.request(u, { headers: H });
const send = (m: string, u: string, body?: unknown) => app.request(u, { method: m, headers: H, body: body === undefined ? undefined : JSON.stringify(body) });

beforeAll(async () => {
  ({ dir, cleanup } = await tempDir("easystudio-"));
  const fakeBin = path.join(dir, "fake-bin.exe");
  await writeFile(fakeBin, "");
  // a legacy Easy Kit project (no game.easy.json yet)
  await mkdir(path.join(dir, "OldVillage"), { recursive: true });
  await writeFile(
    path.join(dir, "OldVillage", "easykit.project.json"),
    JSON.stringify({ format: "easykit-project/1", name: "OldVillage", id: "old_village", template: "village_delivery", engine: "pixi", seed: 3, createdAt: "2026-11-15T07:00:00.000Z", kit: { version: "0.1.0" }, tools: {}, choices: {}, steps: [], ok: true }),
  );
  app = createApp({ projects: dir, dev: true, launch: (bin, args) => launched.push({ bin, args }), env: { GODOT_BIN: fakeBin, ASEPRITE_BIN: fakeBin, PATH: "" } });
});
afterAll(() => cleanup());

describe("Easy Studio API", () => {
  it("creates a new manifest project and lists it next to legacy ones", async () => {
    const r = await send("POST", "/api/studio/projects", { name: "NewVillage" });
    expect(r.status).toBe(200);
    expect(((await r.json()) as any).dir).toBe("NewVillage");
    expect((await send("POST", "/api/studio/projects", { name: "NewVillage" })).status).toBe(409);
    expect((await send("POST", "/api/studio/projects", { name: "../evil" })).status).toBe(400);
    const list = (await (await get("/api/studio/projects")).json()) as any;
    const byDir = Object.fromEntries(list.projects.map((p: any) => [p.dir, p]));
    expect(byDir.NewVillage).toMatchObject({ manifest: true, legacy: false, engine: "both", lastBuild: null });
    expect(byDir.NewVillage.title.th).toBeTruthy();
    expect(byDir.OldVillage).toMatchObject({ manifest: false, legacy: true });
  });

  it("init --from an existing Easy Kit project, in place", async () => {
    const r = await send("POST", "/api/studio/projects", { from: "OldVillage" });
    expect(r.status).toBe(200);
    const m = JSON.parse(await readFile(path.join(dir, "OldVillage", "game.easy.json"), "utf8"));
    expect(m.game).toMatchObject({ name: "OldVillage", engine: "pixi", seed: 3 });
    expect((await send("POST", "/api/studio/projects", { from: "Missing" })).status).toBe(400);
  });

  it("serves the JSON schema and reads / saves the manifest", async () => {
    const schema = (await (await get("/api/studio/schema")).json()) as any;
    expect(schema.properties.game.properties.engine.enum).toEqual(["godot", "pixi", "both"]);
    const m = (await (await get("/api/studio/p/NewVillage/manifest")).json()) as any;
    expect(m.json.game.name).toBe("NewVillage");
    m.json.game.title.en = "Edited in Studio";
    const saved = (await (await send("PUT", "/api/studio/p/NewVillage/manifest", { manifest: m.json })).json()) as any;
    expect(saved).toMatchObject({ ok: true, issues: [] });
    expect(JSON.parse(await readFile(path.join(dir, "NewVillage", "game.easy.json"), "utf8")).game.title.en).toBe("Edited in Studio");
    expect((await send("PUT", "/api/studio/p/NewVillage/manifest", { manifest: [1] })).status).toBe(400);
  });

  it("validates an unsaved draft with Thai + English messages and field paths", async () => {
    const m = ((await (await get("/api/studio/p/NewVillage/manifest")).json()) as any).json;
    const bad = { ...m, game: { ...m.game, engine: "unity" } };
    const r = (await (await send("POST", "/api/studio/p/NewVillage/validate", { manifest: bad })).json()) as any;
    expect(r.ok).toBe(false);
    const i = r.issues.find((x: any) => x.path === "game.engine");
    expect(i).toMatchObject({ severity: "error" });
    expect(i.th).toMatch(/[\u0E00-\u0E7F]/);
    expect(i.en).toMatch(/Invalid/);
    // the file on disk is untouched by validation
    expect(JSON.parse(await readFile(path.join(dir, "NewVillage", "game.easy.json"), "utf8")).game.engine).toBe("both");
  });

  it("streams a build as server-sent events (invalid manifest → report without steps)", async () => {
    const m = JSON.parse(await readFile(path.join(dir, "OldVillage", "game.easy.json"), "utf8"));
    m.game.engine = "unity";
    await writeFile(path.join(dir, "OldVillage", "game.easy.json"), JSON.stringify(m));
    const r = await send("POST", "/api/studio/p/OldVillage/build", {});
    expect(r.headers.get("content-type")).toMatch(/text\/event-stream/);
    const text = await r.text();
    expect(text).toMatch(/event: hello/);
    const done = text.split("\n\n").find((c) => c.startsWith("event: done"))!;
    const data = JSON.parse(done.split("\n").find((l) => l.startsWith("data:"))!.slice(5));
    expect(data.report.ok).toBe(false);
    expect(data.report.issues[0].path).toBe("game.engine");
    expect(data.markdown).toMatch(/Build report/);
    const rep = (await (await get("/api/studio/p/OldVillage/report")).json()) as any;
    expect(rep.report.ok).toBe(false);
  });

  it("opens Godot / Aseprite through the launcher, only for files inside the project", async () => {
    expect(((await (await send("POST", "/api/studio/p/NewVillage/open", { app: "godot" })).json()) as any).error).toMatch(/Build first/i);
    await mkdir(path.join(dir, "NewVillage", "godot"), { recursive: true });
    await writeFile(path.join(dir, "NewVillage", "godot", "project.godot"), "");
    await mkdir(path.join(dir, "NewVillage", "assets"), { recursive: true });
    await writeFile(path.join(dir, "NewVillage", "assets", "hero.png"), "");
    const g = (await (await send("POST", "/api/studio/p/NewVillage/open", { app: "godot" })).json()) as any;
    expect(g.ok).toBe(true);
    expect(launched.at(-1)!.args).toEqual(["--editor", "--path", path.join(dir, "NewVillage", "godot")]);
    const assets = (await (await get("/api/studio/p/NewVillage/assets")).json()) as any;
    expect(assets.assets).toContain("assets/hero.png");
    const a = (await (await send("POST", "/api/studio/p/NewVillage/open", { app: "aseprite", file: "assets/hero.png" })).json()) as any;
    expect(a.ok).toBe(true);
    expect(launched.at(-1)!.args).toEqual([path.join(dir, "NewVillage", "assets", "hero.png")]);
    expect((await send("POST", "/api/studio/p/NewVillage/open", { app: "aseprite", file: "../OldVillage/easykit.project.json" })).status).toBe(400);
    expect((await send("POST", "/api/studio/p/NewVillage/open", { app: "notepad" })).status).toBe(400);
    expect(launched).toHaveLength(2);
  });

  it("lists check screenshots and blocks traversal", async () => {
    const shots = path.join(dir, "NewVillage", ".easy", "shots", "web");
    await mkdir(shots, { recursive: true });
    await writeFile(path.join(shots, "title.png"), "png");
    const s = (await (await get("/api/studio/p/NewVillage/shots")).json()) as any;
    expect(s.shots[0].file).toBe("web/title.png");
    expect((await get(s.shots[0].url)).status).toBe(200);
    expect((await get("/api/studio/p/NewVillage/shot/..%2F..%2Fgame.easy.json")).status).toBe(404);
    expect((await get("/api/studio/p/..%2F/manifest")).status).toBe(404);
    const list = (await (await get("/api/studio/projects")).json()) as any;
    expect(list.projects.find((p: any) => p.dir === "NewVillage").thumb).toBe("web/title.png");
  });

  it("ship refuses before a build and never reports an upload", async () => {
    const r = (await (await send("POST", "/api/studio/p/NewVillage/ship", {})).json()) as any;
    expect(r.error).toMatch(/build the game first/);
  });
});

describe("Studio helpers", () => {
  it("DIR_RE and inside() keep paths in the projects folder", () => {
    expect(DIR_RE.test("TungSadao")).toBe(true);
    expect(DIR_RE.test("_easystudio_demo")).toBe(true);
    expect(DIR_RE.test("..")).toBe(false);
    expect(DIR_RE.test(".easy")).toBe(false);
    expect(DIR_RE.test("a/b")).toBe(false);
    expect(inside("/p/x", "assets/a.png")).toBe(path.resolve("/p/x/assets/a.png"));
    expect(inside("/p/x", "../y/a.png")).toBeNull();
  });

  it("which() searches PATH without a shell", async () => {
    const d = (await tempDir("which-")).dir;
    const exe = path.join(d, process.platform === "win32" ? "mytool.exe" : "mytool");
    await writeFile(exe, "");
    expect(which("mytool", { PATH: d, PATHEXT: ".EXE" })).toBe(exe);
    expect(which("nope-tool", { PATH: d })).toBeNull();
  });
});
