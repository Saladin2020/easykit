# Easy Kit MCP server

One server for the whole suite: the kit's own tools plus every installed Easy tool, proxied under
`<tool>__<name>`.

```bash
easykit mcp --workspace ~/games                 # stdio
easykit mcp --http --workspace ~/games          # http://127.0.0.1:8909/mcp (Streamable HTTP)
easykit mcp --project ~/games/VillageDemo       # proxy straight into a project's .easy/<tool> workspaces
```

```json
{ "mcpServers": { "easykit": { "command": "node", "args": ["/path/to/easykit/dist/cli.js", "mcp", "--workspace", "/path/to/games"] } } }
```

## Kit tools

| Tool | Arguments | Result |
|---|---|---|
| `new_project` | `name`, `dir?`, `template?` (`village_delivery`), `engine?` (`godot`/`pixi`/`both`), `seed?`, `force?` | Runs all 12 tools and assembles the game (~30 s). Root, per-step ok / ms / notes, Godot files + autoloads + collisions, web files |
| `build_project` | `project`, `engine?` | Re-assembles `godot/` and `web/` from `.easy/<tool>` exports (after you re-export with a proxied tool) |
| `check_project` | `project`, `godot?`, `web?` | Godot import + headless gameplay test, headless-Chrome web check; engines that are missing are reported as skipped |
| `doctor` | — | Every tool: home, how it was found, version, git commit / branch / dirty, built, deps, ports, problems; Node, Godot, Chrome, xvfb |
| `status` | `path?` | Tools summary, which proxies are running (and their errors), the project at `path` |
| `list_tools` | — | The 12 tools with role, ports, home, `prefix` and whether they are proxied; the kit's ports |

Paths are resolved against `--workspace` and must stay inside it, the `--project`, or a folder in
`EASYKIT_ALLOWED_DIRS` (`:`-separated).

## Proxied tools

Each installed tool's own MCP server (`<home>/dist/mcp/server.js`) is started lazily over stdio the first time a
client lists or calls its tools. Its workspace is `<workspace>/<tool>` (initialised with the tool's `init` if new)
or, with `--project`, `<project>/.easy/<tool>`. `EASY<TOOL>_ALLOWED_DIRS` is set to that root so the tool can read
and write the game. Descriptions are prefixed with the tool name; arguments and results pass through unchanged.

With the full suite (Easy Kit 0.1.0, all tools v0.1.0) the server lists 94 tools:

| Prefix | Tools |
|---|---|
| `sprite__` (8) | workspace_info, list_parts, list_projects, get_project, compose_character, export_character, batch_compose, build_showcase |
| `scene__` (7) | workspace_info, list_parts, list_scenes, get_scene, compose_scene, render_preview, export_scene |
| `tilemap__` (7) | workspace_info, list_maps, get_map, write_map, edit_map, render_map, export_map |
| `dialogue__` (7) | workspace_info, list_dialogues, get_dialogue, write_dialogue, make_portraits, render_preview, export_dialogue |
| `quest__` (7) | workspace_info, list_quests, get_quest, write_quest, simulate_quest, render_quest_log, export_quests |
| `ui__` (7) | workspace_info, list_screens, get_screen, write_screen, render_screen, list_icons, export_ui |
| `sfx__` (7) | workspace_info, list_sounds, get_sound, write_sound, write_track, render_audio, export_bank |
| `fx__` (6) | workspace_info, list_effects, get_effect, write_effect, render_effect, export_fx |
| `music__` (6) | workspace_info, list_songs, get_song, write_song, render_song, export_music |
| `anim__` (6) | workspace_info, list_cutscenes, get_cutscene, write_cutscene, render_cutscene, export_cutscenes |
| `items__` (9) | workspace_info, list_items, get_item, write_items, check_items, render_icons, roll_loot, simulate, export_items |
| `save__` (11) | workspace_info, get_schema, write_schema, list_slots, validate_save, migrate_save, list_strings, set_strings, extract_strings, check_all, export_save |

`EASYKIT_MCP_TOOLS=save,items` proxies only those tools; `EASYKIT_MCP_TOOLS=none` serves the kit tools alone.
A tool that is missing or fails to start is left out of the list and its error shows in `status`.

## HTTP

`--http` binds `127.0.0.1:8909` by default. Requests with a foreign `Host` or `Origin` are rejected (DNS-rebinding
guard). On a non-loopback `--host` a token is required (`Authorization: Bearer <token>` or `x-easykit-token`); it is
printed once at start, or set `EASYKIT_TOKEN`. Each MCP session gets its own set of proxied tool servers.
