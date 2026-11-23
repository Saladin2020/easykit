# Easy Kit studio install plan (prepared, NOT applied)

Nothing below has been run against `/workspace/indie-studio`. Apply only after the user approves.

0. Prerequisite: the studio has the 12 core tools (plus optionally Portrait, NPC, Font, Battle, Ship) under `/workspace/indie-studio/tools/easy<id>`. Today it has 8
   (sprite, scene, tilemap, dialogue, quest, ui, sfx, fx). Easy Music, Anim, Items and Save have their own prepared
   plans in their repos' `install-plan/`; apply those first, or point `EASY<TOOL>_HOME` at `/workspace/easy<tool>`.
1. `git clone /workspace/easykit /workspace/indie-studio/tools/easykit && cd $_ && git checkout --detach <SHA>`
2. `npm ci && npm run build && npm test` (expect 43 passed with the whole suite; integration tests skip without the sibling tools).
3. Copy `install-plan/easykit-cli.mjs` → `/workspace/indie-studio/tools/easykit-cli.mjs` (same shape as the other
   `easy*-cli.mjs` wrappers: sets `EASYKIT_SUITE_DIR` to `tools/`, defaults `new --dir` and `mcp --workspace` to
   `/workspace/indie-studio/projects`, adds that folder to `EASYKIT_ALLOWED_DIRS`).
4. Copy `install-plan/EASYKIT.md` → `/workspace/indie-studio/tools/EASYKIT.md` and replace `<SHA>`.
5. Smoke: `node /workspace/indie-studio/tools/easykit-cli.mjs doctor` (expect 17/17), then
   `… new SmokeKit --seed 3` and `… check /workspace/indie-studio/projects/SmokeKit`; delete `SmokeKit` afterwards.
6. Shared skill: install `SKILL.draft.md` as `easykit-game-scaffold` (the parent agent does this).
7. Once a GitHub repo exists (user's call): `git remote add github https://github.com/Saladin2020/easykit.git`.

Ports: dashboard 8908, MCP HTTP 8909, Vite 5187, web check 8989 (Easy Save 8898 / 8899 / 5186, Easy Items
8878 / 8879 / 5185).

## The five newer tools (applied)

Easy Battle, Easy Font, Easy NPC, Easy Portrait and Easy Ship are published (github.com/Saladin2020/easy<tool>) and
wired in: install each next to Easy Kit under `/workspace/indie-studio/tools/easy<tool>` with its own `install-plan/`
(wrapper `easy<tool>-cli.mjs` + `EASY<TOOL>.md`). Doctor then reports 17/17; with any of them missing it still
passes and `new` skips that tool's part of the game. Details: [`docs/INTEGRATION-18.md`](../docs/INTEGRATION-18.md).
