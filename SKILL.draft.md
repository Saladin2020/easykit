---
name: easykit-game-scaffold
description: >-
  Use when a new 2D pixel game (or a playable prototype) should be scaffolded from the Easy Suite in one step:
  walkable top-down Thai / Malay-Muslim village, NPC dialogue with animated portraits, villagers on daily schedules
  with a clock and night, quest, shop, paddy-field battles, cutscene, music, FX, the มะขาม Thai pixel font, save slots
  and th / en / ms text, as a Godot 4.3+ project and a PixiJS web build, then a release plan or local build with
  Easy Ship; or when you need to know which Easy tools are installed (doctor) or want one MCP server for all 17
  tools. Not for editing one asset — use that tool directly.
---
# Easy Kit: scaffold a game with the Easy tools

Read `/workspace/indie-studio/tools/EASYKIT.md` for paths and commands. CLI:
`node /workspace/indie-studio/tools/easykit-cli.mjs`. Ports: dashboard 8908, MCP 8909, Vite 5187.

The 12 core tools (Sprite, Scene, Tilemap, Dialogue, Quest, UI, SFX, FX, Music, Anim, Items, Save) are required.
Easy Portrait, NPC, Font and Battle are optional: when installed, `new` adds animated dialogue portraits, villager
schedules + clock, the มะขาม pixel font and paddy-field battles; when not, their steps say "skipped" and the game is the
12-tool version. Easy Ship (optional) packages the result.

## Steps

1. **Doctor first.** `doctor` must say ok (17/17 for the full game). A missing or unbuilt core tool: fix that tool's
   install (or set `EASY<TOOL>_HOME`), never copy files around.
2. **New.** `new <Name> --template village_delivery --seed N` (CamelCase name, ~50 s). Pick a new seed for a
   different player colour, coin sound, coin burst and village theme. Read the step list: every step must be `ok`
   (optional tools may say skipped).
3. **Check.** `check projects/<Name> --shots projects/<Name>/shots` must end with `EASYKIT TEST OK` (Godot) and
   `EASYKIT WEB OK` (web). Look at the screenshots before reporting (gameplay, dialogue with portrait, battle,
   night); add `--frames` and `scripts/make-gif.py` for a GIF.
4. **Change content** with the tool that owns it, in `projects/<Name>/.easy/<tool>` (e.g. through the kit MCP's
   `dialogue__write_dialogue`, then `dialogue__export_dialogue`; `npc__…` for schedules, `battle__…` for encounters,
   `portrait__…` for faces), then `build projects/<Name>` and `check` again. Do not hand-edit `godot/` or `web/`
   files that came from a tool; they are overwritten on build.
5. **Ship (optional).** `ship projects/<Name>` writes Easy Ship configs (`<name>` Godot, `<name>-web` Pixi) and
   prints the plan; `ship projects/<Name> --build [--targets web,linux,windows]` builds and zips into
   `projects/<Name>/.easy/ship/releases/`. Easy Kit never uploads. Uploading to itch.io is the user's own
   `easyship ship <id> --upload` and needs their explicit go-ahead.
6. **Report** the project path, `easykit.project.json` (seed, tool commits), check results, screenshot paths and
   any ship zips.

## Rules

- Generated sheets and assets stay in the game project; never commit them into a tool repo.
- Content: multicultural Thai village; no sacred figures, no Quran or Arabic calligraphy, no synthesized adhan;
  halal food at Muslim stalls. Thai names in Thai script (ต้น, ป้าแดง, ลุงมี, ตาเพิ่ม).
- MCP paths must stay inside the workspace or `EASYKIT_ALLOWED_DIRS`. The kit MCP's `ship_plan` only plans.
