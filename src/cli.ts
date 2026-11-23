#!/usr/bin/env node
import { Command } from "commander";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { checkGodot, checkWeb, screenshotGodot, type CheckRun } from "./lib/check.js";
import { doctor, formatDoctor } from "./lib/doctor.js";
import { shipProject } from "./lib/ship.js";
import { exists } from "./lib/fsutil.js";
import { ENGINES, TEMPLATES, newProject, projectStatus, rebuildProject, type Engine } from "./lib/pipeline.js";
import { KIT_PORTS, TOOLS, TOOL_IDS } from "./lib/tools.js";

const program = new Command();
program.name("easykit").description("Easy Kit — one CLI / MCP server / dashboard over the 17 Easy tools").version("0.1.0");

const print = (json: boolean, data: unknown, text: () => string) => console.log(json ? JSON.stringify(data, null, 2) : text());

program
  .command("new")
  .description("Scaffold a playable game from a template, driving the 12 core Easy tools plus Easy Portrait, NPC, Font and Battle when installed")
  .argument("<name>", "Project name (folder), e.g. VillageDemo")
  .option("--template <id>", `Template (${TEMPLATES.join(", ")})`, "village_delivery")
  .option("--engine <engine>", "godot | pixi | both", "both")
  .option("--seed <n>", "Seed for generated variations (player colours, coin sound, coin FX, music)", "1")
  .option("--dir <path>", "Parent folder (default: current folder)")
  .option("--force", "Replace an existing project folder")
  .option("--json", "Print the project manifest as JSON")
  .action(async (name: string, o) => {
    if (!(ENGINES as readonly string[]).includes(o.engine)) throw new Error("--engine must be godot, pixi or both");
    const t0 = Date.now();
    const m = await newProject({ name, template: o.template, engine: o.engine as Engine, seed: Number(o.seed), dir: o.dir, force: !!o.force, log: o.json ? undefined : (l) => console.error(l) });
    const root = path.resolve(o.dir ?? process.cwd(), name);
    print(!!o.json, m, () =>
      [
        `created ${root} in ${((Date.now() - t0) / 1000).toFixed(1)} s`,
        ...m.steps.map((s) => `  ${s.ok ? "ok" : "!!"} ${(s.tool === "kit" ? "Easy Kit" : TOOLS[s.tool].name).padEnd(13)} ${s.title}${s.notes.length ? ` — ${s.notes.join("; ")}` : ""}`),
        m.godot ? `godot: ${path.join(root, "godot")} (${m.godot.files} files, autoloads ${m.godot.autoloads.map(([k]) => k).join(", ")}${m.godot.collisions.length ? `, ${m.godot.collisions.length} file collisions kept first` : ""})` : "",
        m.web ? `web:   ${path.join(root, "web")} (${m.web.files} files, PixiJS ${m.web.pixi})` : "",
        `next:  easykit check ${name}`,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  });

program
  .command("build")
  .description("Re-assemble godot/ and web/ from the tool exports in <project>/.easy")
  .argument("<project>")
  .option("--engine <engine>", "godot | pixi | both")
  .option("--json")
  .action(async (project: string, o) => {
    const m = await rebuildProject(path.resolve(project), { engine: o.engine });
    print(!!o.json, m, () => m.steps.filter((s) => s.tool === "kit").map((s) => `${s.title}: ${s.notes.join("; ")}`).join("\n"));
  });

program
  .command("check")
  .description("Godot import + headless test, web headless-Chrome check (skips what is not installed)")
  .argument("<project>")
  .option("--no-godot", "Skip Godot")
  .option("--no-web", "Skip the web check")
  .option("--shots <dir>", "Also save screenshots here (godot/ and web/ sub-folders)")
  .option("--frames", "Save GIF frames too")
  .option("--json")
  .action(async (project: string, o) => {
    const root = path.resolve(project);
    const runs: CheckRun[] = [];
    if (o.godot) {
      runs.push(...(await checkGodot(root)));
      if (o.shots) runs.push(await screenshotGodot(root, path.resolve(o.shots, "godot"), { frames: o.frames }));
    }
    if (o.web) runs.push(await checkWeb(root, { out: o.shots ? path.resolve(o.shots, "web") : undefined, frames: o.frames }));
    const ok = runs.every((r) => r.ok);
    print(!!o.json, { ok, runs }, () => runs.map((r) => `${r.ok ? "ok" : "!!"} ${r.name}${r.skipped ? ` (skipped: ${r.skipped})` : ` ${(r.ms / 1000).toFixed(1)} s`}${!r.ok || /test|check/.test(r.name) ? `\n${r.tail.replace(/^/gm, "   ")}` : ""}`).join("\n"));
    if (!ok) process.exitCode = 1;
  });

program
  .command("ship")
  .description("Easy Ship: release configs + plan for the project's Godot and web builds (--build to build and zip locally; never uploads)")
  .argument("<project>")
  .option("--build", "Build, check and zip into <project>/.easy/ship/releases/")
  .option("--targets <list>", "Godot targets: web, windows, linux, android (the Pixi build is always web)", "web")
  .option("--release <v>", "Release version for new ship configs (default 0.1.0)")
  .option("--itch <user/game>", "itch.io page for later manual uploads (Easy Kit never uploads)")
  .option("--json")
  .action(async (project: string, o) => {
    const r = await shipProject(path.resolve(project), { build: !!o.build, targets: o.targets, version: o.release, itch: o.itch });
    print(!!o.json, r, () =>
      [
        `Easy Ship ${r.mode} · workspace ${r.workspace}`,
        ...r.configs.map((c) => `  ${c.id.padEnd(16)} ${c.engine.padEnd(6)} ${c.targets.padEnd(20)} ${c.source}`),
        ...r.runs.map((x) => `${x.ok ? "ok" : "!!"} ${x.command}\n${x.output.split("\n").slice(-12).join("\n").replace(/^/gm, "   ")}`),
        "uploads: none (upload with `easyship ship <id> --upload --workspace <ws>` yourself when ready)",
      ].join("\n"),
    );
    if (!r.ok) process.exitCode = 1;
  });

program
  .command("doctor")
  .description("Which Easy tools are installed, their versions, and the engines for checks")
  .option("--json")
  .action((o) => {
    const r = doctor();
    print(!!o.json, r, () => formatDoctor(r));
    if (!r.ok) process.exitCode = 1;
  });

program
  .command("status")
  .description("Summary of a project (or of every Easy Kit project in a folder)")
  .argument("[path]", "Project or folder", ".")
  .option("--json")
  .action(async (p: string, o) => {
    const root = path.resolve(p);
    const roots = (await exists(path.join(root, "easykit.project.json"))) ? [root] : (await readdir(root, { withFileTypes: true }).catch(() => [])).filter((d) => d.isDirectory()).map((d) => path.join(root, d.name));
    const list = (await Promise.all(roots.map(projectStatus))).filter((s) => s.manifest);
    print(!!o.json, list, () =>
      list.length
        ? list.map((s) => `${s.manifest!.name.padEnd(18)} ${s.manifest!.template} seed ${s.manifest!.seed} · ${s.manifest!.ok ? "ok" : "failed"} · godot ${s.godot ? "yes" : "no"} · web ${s.web ? "yes" : "no"} · ${s.root}`).join("\n")
        : `no Easy Kit projects under ${root}`,
    );
  });

program
  .command("tools")
  .description("The 17 Easy tools, their roles and ports")
  .option("--json")
  .action((o) => {
    print(!!o.json, { tools: TOOL_IDS.map((id) => TOOLS[id]), kit: KIT_PORTS }, () =>
      [...TOOL_IDS.map((id) => `${TOOLS[id].name.padEnd(14)} ${TOOLS[id].role.padEnd(52)} serve ${TOOLS[id].ports.serve ?? "—"} · mcp ${TOOLS[id].ports.mcp} · vite ${TOOLS[id].ports.vite}`), `${"Easy Kit".padEnd(14)} ${"this kit".padEnd(52)} serve ${KIT_PORTS.serve} · mcp ${KIT_PORTS.mcp} · vite ${KIT_PORTS.vite}`].join("\n"),
    );
  });

program
  .command("serve")
  .description(`Dashboard + API (default http://127.0.0.1:${KIT_PORTS.serve})`)
  .option("--port <n>", "Port", String(KIT_PORTS.serve))
  .option("--host <host>", "Bind host", "127.0.0.1")
  .option("--projects <dir>", "Folder for new projects (default: current folder)")
  .option("--dev", "API only (use the Vite dev server on 5187)")
  .action(async (o) => {
    const { startServer } = await import("./server/app.js");
    await startServer({ port: Number(o.port), host: o.host, projects: path.resolve(o.projects ?? process.cwd()), dev: !!o.dev });
  });

program
  .command("mcp")
  .description(`Unified MCP server (stdio; --http for port ${KIT_PORTS.mcp})`)
  .option("--http")
  .option("--port <n>", "Port", String(KIT_PORTS.mcp))
  .option("--host <host>", "Bind host", "127.0.0.1")
  .option("--workspace <dir>", "Kit workspace (tool workspaces live in <dir>/<tool>)")
  .option("--project <dir>", "Proxy into an Easy Kit project's .easy/<tool> workspaces")
  .action(async (o) => {
    const { startMcp } = await import("./mcp/server.js");
    await startMcp({ http: !!o.http, port: Number(o.port), host: o.host, workspace: path.resolve(o.workspace ?? process.env.EASYKIT_WORKSPACE ?? process.cwd()), project: o.project ? path.resolve(o.project) : undefined });
  });

program.parseAsync().catch((e) => {
  console.error(`easykit: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
