# Easy Kit studio install plan (prepared, NOT applied)

Nothing below has been run against `/workspace/indie-studio`. Apply only after the user approves.

0. Prerequisite: the studio has all 12 tools under `/workspace/indie-studio/tools/easy<id>`. Today it has 8
   (sprite, scene, tilemap, dialogue, quest, ui, sfx, fx). Easy Music, Anim, Items and Save have their own prepared
   plans in their repos' `install-plan/`; apply those first, or point `EASY<TOOL>_HOME` at `/workspace/easy<tool>`.
1. `git clone /workspace/easykit /workspace/indie-studio/tools/easykit && cd $_ && git checkout --detach <SHA>`
2. `npm ci && npm run build && npm test` (expect 37 passed; the 3 integration tests also run when the 12 tools resolve, for 40).
3. Copy `install-plan/easykit-cli.mjs` → `/workspace/indie-studio/tools/easykit-cli.mjs` (same shape as the other
   `easy*-cli.mjs` wrappers: sets `EASYKIT_SUITE_DIR` to `tools/`, defaults `new --dir` and `mcp --workspace` to
   `/workspace/indie-studio/projects`, adds that folder to `EASYKIT_ALLOWED_DIRS`).
4. Copy `install-plan/EASYKIT.md` → `/workspace/indie-studio/tools/EASYKIT.md` and replace `<SHA>`.
5. Smoke: `node /workspace/indie-studio/tools/easykit-cli.mjs doctor` (expect 12/12), then
   `… new SmokeKit --seed 3` and `… check /workspace/indie-studio/projects/SmokeKit`; delete `SmokeKit` afterwards.
6. Shared skill: install `SKILL.draft.md` as `easykit-game-scaffold` (the parent agent does this).
7. Once a GitHub repo exists (user's call): `git remote add github https://github.com/Saladin2020/easykit.git`.

Ports: dashboard 8908, MCP HTTP 8909, Vite 5187, web check 8989 (Easy Save 8898 / 8899 / 5186, Easy Items
8878 / 8879 / 5185).
