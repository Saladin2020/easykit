---
name: easykit-game-scaffold
description: >-
  Use when a new 2D pixel game (or a playable prototype) should be scaffolded from the Easy Suite in one step:
  walkable top-down Thai / Malay-Muslim village, NPC dialogue, quest, shop, cutscene, music, FX, save slots and
  th / en / ms text, as a Godot 4.3+ project and a PixiJS web build; or when you need to know which Easy tools are
  installed (doctor) or want one MCP server for all 12 tools. Not for editing one asset — use that tool directly.
---
# Easy Kit: scaffold a game with all 12 Easy tools

Read `/workspace/indie-studio/tools/EASYKIT.md` for paths and commands. CLI:
`node /workspace/indie-studio/tools/easykit-cli.mjs`. Ports: dashboard 8908, MCP 8909, Vite 5187.

## Steps

1. **Doctor first.** `doctor` must say 12/12. A missing or unbuilt tool: fix that tool's install (or set
   `EASY<TOOL>_HOME`), never copy files around.
2. **New.** `new <Name> --template village_delivery --seed N` (CamelCase name, ~30 s). Pick a new seed for a
   different player colour, coin sound, coin burst and village theme. Read the step list: every step must be `ok`.
3. **Check.** `check projects/<Name> --shots projects/<Name>/shots` must end with `EASYKIT TEST OK` (Godot) and
   `EASYKIT WEB OK` (web). Look at the screenshots before reporting; add `--frames` and `scripts/make-gif.py` for a GIF.
4. **Change content** with the tool that owns it, in `projects/<Name>/.easy/<tool>` (e.g. through the kit MCP's
   `dialogue__write_dialogue`, then `dialogue__export_dialogue`), then `build projects/<Name>` and `check` again.
   Do not hand-edit `godot/` or `web/` files that came from a tool; they are overwritten on build.
5. **Report** the project path, `easykit.project.json` (seed, tool commits), check results and screenshot paths.

## Rules

- Generated sheets and assets stay in the game project; never commit them into a tool repo.
- Content: multicultural Thai village; no sacred figures, no Quran or Arabic calligraphy, no synthesized adhan;
  halal food at Muslim stalls.
- MCP paths must stay inside the workspace or `EASYKIT_ALLOWED_DIRS`.
