# Easy Kit (studio install)

Install: `/workspace/indie-studio/tools/easykit` @ `<SHA>`. CLI: `node /workspace/indie-studio/tools/easykit-cli.mjs`.
Finds the Easy tools next to it in `tools/` (override per tool with `EASY<TOOL>_HOME`): the 12 core ones are
required, Easy Portrait / NPC / Font / Battle / Ship are optional (the game gains portraits, schedules, the มะขาม font
and battles; `ship` packages it).

| Task | Command |
|---|---|
| Which tools / versions are installed | `easykit-cli.mjs doctor` |
| New game (Godot + Pixi) | `easykit-cli.mjs new <Name> --template village_delivery --seed N` → `projects/<Name>` |
| Re-assemble after editing a tool workspace | `easykit-cli.mjs build projects/<Name>` |
| Godot headless test + web check + screenshots | `easykit-cli.mjs check projects/<Name> --shots projects/<Name>/shots [--frames]` |
| Release plan / local build (never uploads) | `easykit-cli.mjs ship projects/<Name> [--build] [--targets web,linux,windows]` → `projects/<Name>/.easy/ship/releases/` |
| Dashboard | `easykit-cli.mjs serve --projects /workspace/indie-studio/projects` → http://127.0.0.1:8908 |
| MCP (all 17 tools + kit tools) | `easykit-cli.mjs mcp` (stdio) or `mcp --http` → http://127.0.0.1:8909/mcp |

Project layout: `.easy/<tool>/` tool workspaces, `assets/` generated sheets, `godot/` (open `project.godot`),
`web/` (static), `easykit.project.json` (seed, tool commits, step log). Godot: set `EASYKIT_GODOT` if `godot` is not
on PATH (the studio binary is `/workspace/tools-godot/Godot_v4.3-stable_linux.x86_64`).
