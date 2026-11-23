# Easy Kit × five new tools: integration (applied)

Status: **applied** on branch `plan/easy-suite-18` (merged to master). Easy Kit drives 17 tools: the 12 core ones plus
Easy Portrait, NPC, Font and Battle (optional build steps) and Easy Ship (`easykit ship`, never uploads). Below is
the original plan; "As built" at the end lists where the implementation differs.
The five repos are github.com/Saladin2020/easy<tool>; each has its own `install-plan/` (studio wrapper, notes, plan).

## The five tools

| Tool | Repo / env prefix | Serve · MCP · Vite | CLI commands Easy Kit needs | Output Easy Kit consumes | Skill draft |
|---|---|---|---|---|---|
| Easy Battle | `easybattle` / `EASYBATTLE` | 8938 · 8939 · 5193 | `init`, `check`, `bind-overworld <map>`, `export --preset godot\|pixi` | `battle/` data + runtime, encounter zones bound to the Easy Tilemap map | `easybattle-combat` |
| Easy Font | `easyfont` / `EASYFONT` | 8948 · 8949 · 5194 | `init`, `check`, `export --preset godot\|pixi` | Thai/Latin/Malay pixel font (BMFont `.fnt` + `.png`, TTF) used by Easy UI theme and dialogue box | `easyfont-thai-pixel-fonts` |
| Easy NPC | `easynpc` / `EASYNPC` | 8958 · 8959 · 5195 | `init`, `check`, `export --preset godot\|pixi` | `npcs/` schedules, A* paths on the Easy Tilemap map, day/night clock, dialogue/quest hooks | `easynpc-village-schedules` |
| Easy Portrait | `easyportrait` / `EASYPORTRAIT` | 8968 · 8969 · 5196 | `init`, `from-sprite`, `check`, `export --preset dialogue\|godot\|pixi` | 64×64 portraits × 9 emotions + blink/talk strips in the Easy Dialogue layout (`<id>/<emotion>.png`, `frames/`, `portrait.json`) | `easyportrait-dialogue-portraits` |
| Easy Ship | `easyship` / `EASYSHIP` | 8978 · 8979 · 5197 | `doctor`, `init`, `new`, `plan`, `ship --build` (never `--upload`) | `releases/<id>/<version>/` zips (web / windows / linux / android) + `SHIP.md` | `easyship-release-builds` |

## Code changes (when approved)

1. `src/lib/tools.ts`
   - `TOOL_IDS` += `"portrait", "npc", "battle", "font", "ship"` (pipeline order below), `ToolSpec` entries with the
     ports above, `cli: true`. Easy Ship is a post-build step, not a content generator: give it `stage: "release"`.
   - Doctor wording "12/12" becomes `TOOL_IDS.length`; README, MCP docs and `SKILL.draft.md` say "17 tools".
2. `src/lib/pipeline.ts` (new steps; `STEP_TITLES` gets one entry each)
   - **font** (before `ui`): `easyfont export --preset godot|pixi` → `assets/fonts/`; Easy UI's theme and the dialogue
     box point at the exported font instead of Kanit-only fallbacks, so Thai stacked vowels render in pixels.
   - **portrait** (after `sprite`, before `dialogue`): `easyportrait from-sprite` for each template cast member, then
     `export --preset dialogue` into the Easy Dialogue portraits folder, so `@char` lines show animated portraits.
     Names come from the template cast (Thai names stay in Thai script).
   - **npc** (after `tilemap` + `dialogue`): schedules for the template cast on the generated map; Godot autoload +
     Pixi module; dialogue `@talk` and quest `talk <npc>` triggers resolve to scheduled NPCs.
   - **battle** (after `items`, optional per template via `template.battle: true`): bestiary + party from the cast,
     `bind-overworld` to the map's encounter zones; rewards use Easy Items ids.
   - **ship** (last, opt-in `easykit ship <project> [--build]`): `easyship new` from the project, `plan` by default,
     `ship --build` only when asked. Easy Kit never passes `--upload`; uploading stays a manual `easyship` CLI call.
3. `src/lib/check.ts`: Godot import + headless run already covers new autoloads; add web-check assertions for the
   portrait strip, the NPC clock and the font atlas (same Playwright/Chrome harness, `app.render()` before readback).
4. MCP (`src/mcp/server.ts`): `kit_new` / `kit_rebuild` accept `steps` including the new ids; add `kit_ship_plan`
   (plan only, no build/upload over MCP).
5. Templates: `village_delivery` gains `portraits: true`, `npcs: true`, `font: "makham-12"`; a second template
   `village_battle` (optional) enables Easy Battle.
6. Tests: unit tests for the new `ToolSpec`s and step ordering; integration tests run only when all 17 tools resolve
   (same skip rule as today). Expect the current 37 (+3) to grow by roughly 10.

## Pipeline order after the change

sprite → **portrait** → scene → tilemap → dialogue → **npc** → quest → **font** → ui → sfx → fx → music → anim →
items → **battle** → save → (optional) **ship**

## Studio install (indie-studio), per tool

For each of the five: follow its `install-plan/PLAN.md` (clone into `/workspace/indie-studio/tools/easy<tool>`,
`npm ci && npm run build && npm test`, copy `easy<tool>-cli.mjs` + `EASY<TOOL>.md`, install `SKILL.draft.md`).
Then update Easy Kit's own `install-plan/PLAN.md` step 0 from 12 to 17 tools and re-run `easykit doctor` (17/17).

## Known gaps to carry into the work

- Easy Ship Android: export presets are written, but no JDK / Android SDK on the box, so APK builds are unverified.
- Easy Ship Windows: `.exe` is checked as a valid PE with the embedded pck; not run (no Wine on the box).
- butler is not installed; `plan` prints the `butler push` commands, nothing is uploaded.
- None of the five repos exist on GitHub yet; creating and pushing them is the user's call. Social previews are
  in each repo's `docs/brand/social-<key>.png` for manual upload.

## Ports (whole suite)

Existing: Sprite 8787/8790/5173 · Scene –/8796/5174 · Dialogue 8798/8799/5175 · Tilemap 8808/8809/5176 ·
Quest 8818/8819/5177 · SFX 8828/8829/5178 · UI 8838/8839/5179 · FX 8848/8849/5180 · Music 8858/8859/5181 ·
Anim 8868/8869/5182 · Items 8878/8879/5185 · Save 8898/8899/5186 · Kit 8908/8909/5187.
New: Battle 8938/8939/5193 · Font 8948/8949/5194 · NPC 8958/8959/5195 · Portrait 8968/8969/5196 · Ship 8978/8979/5197.

## As built

- The five tools are **optional** (`ToolSpec.optional`): `new` requires only the 12 core tools, skips a missing
  optional tool with a "skipped: … not installed" note, and `doctor` stays ok without them.
- Pipeline order: sprite → portrait → scene → tilemap → dialogue → npc → quest → font → ui → sfx → fx → music → anim →
  items → battle → save; Easy Ship is not a build step but `easykit ship <project> [--build]` and the MCP
  `ship_plan` (plan only).
- Portraits: `from-sprite` on the generated sheets for ต้น / ป้าแดง / ลุงมี / ตาเพิ่ม (+ the sample monk) replace Easy
  Dialogue's sample portraits; in game an EasyPortrait (Godot) / `lib.portrait` (Pixi) blinks and talks over the box.
- NPC: five bark villagers follow their schedules (feet at `x*16+8, y*16+15`); quest NPCs stay put. Clock in the HUD,
  night tint, `talk` raises friendship, state saved in Easy Save `items.npc`.
- Font: dialogue text is word-broken (U+200B) and shaped at build time; the box uses the `.fnt` at its native size
  (12 px, line 18). HUD labels ≤ 12 px use มะขาม 8 / 12; titles stay in Kanit.
- Battle: zone = the paddy tiles (37–42 × 1–6), not the whole north-east corner (Uncle Mee's spot stays outside);
  the first encounter is `plains_fields` seed 7; party ton + adam L3; `items.battle` in the save. No
  `bind-overworld` call: the kit checks the zone itself.
- Ship: configs `<name>` (Godot, targets from `--targets`, default web) and `<name>-web` (Pixi web); `EASYSHIP_GODOT`
  is set from the kit's Godot. `easyship new --version` is swallowed by easyship's program-level `--version`, so the
  kit writes the version into the config itself (`--release`).
- Checks: Godot `test_game.gd` 73 checks, web `check-web.py` 34 checks, screenshots add `07_battle` / `08_night`.

