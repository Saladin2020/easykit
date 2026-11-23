# Easy Kit × five new tools: integration plan (prepared, NOT applied)

Branch `plan/easy-suite-18` (local only, not pushed). Nothing here changes the pipeline yet; it is the plan for
taking Easy Kit from 12 to 17 driven tools: Easy Battle, Easy Font, Easy NPC, Easy Portrait and Easy Ship.
The five repos live in `/workspace/easy-new/<tool>`; each has its own `install-plan/` (studio wrapper, notes, plan).

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
