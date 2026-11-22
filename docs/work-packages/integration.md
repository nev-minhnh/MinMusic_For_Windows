# Integration procedure (one agent per wave)

**Agent:** Opus (medium), because it does the fix loop. Conventions apply. Each `INT-W<n>.md` names the merge order, the extra checks and the acceptance for its wave; this file is the common procedure.

## Budget
- **Gradle:** 1 main build + at most 2 fix builds per wave, all through `MM_HEAP=6g bash D:/Coding_Project/MinMusic-notes/tools/mm-build.sh <wt> <tasks> --no-configuration-cache`.
- **Tauri:** 1 main `cargo tauri build --target x86_64-pc-windows-gnu --features e2e --no-bundle` + rebuilds as needed. Rust compiles are incremental, but run only one at a time.
- If the fix loop exceeds the budget: stop, push the integration branch as-is, write the failing list in STATUS, and ask the coordinator.

## Steps
1. **Kotlin** (only if the wave has Kotlin WPs).
   - `git -C D:\Coding_Project\MinMusic-wt-core worktree add D:\Coding_Project\MinMusic-wt-int-w<n> -b int/w<n> origin/feat/desktop-core`
   - Merge the Kotlin branches in the INT order with `--no-ff`. Resolve conflicts using the brief ownership tables.
   - **Main build:** `:desktopCore:test :desktopCore:sidecarImage :desktopApp:compileKotlinJvm`, plus `:androidApp:compileDebugKotlin :shared:desktopTest` when the wave touched `shared/`. Fix compile errors using the WPs' checklists, all in one go before rebuilding.
   - On green: `git push origin int/w<n>:feat/desktop-core` (fast-forward only).
2. **Windows repo.**
   - `git worktree add D:\Coding_Project\MinMusic_4_Windows-wp\INT-W<n> -b int/w<n> origin/main`
   - Merge the `wp/*` branches in the INT order (`--no-ff`).
   - Bump the submodule: `git -C core/MinMusic fetch && git -C core/MinMusic checkout <feat/desktop-core sha>`, then commit.
   - `npm install`, then `npm run schema` (commit `protocol/schema`).
   - Set `sidecar\dist` as a junction to `D:\Coding_Project\MinMusic-wt-int-w<n>\build\sidecar\dist`, or to the last wave's image if no Kotlin changed.
3. **Full test run** (record every number):
   - `npm test` (all workspaces), `node ui/tools/lint-strings.mjs`, `npm -w ui run build` (JS/CSS gzip sizes)
   - `node tests/contract/run.mjs --target mock --suite all` and `--target real --suite all`, including the live tests
   - `cargo test` (GNU), then the Tauri e2e build
   - `scripts/e2e.ps1 -Suite process`, `-Suite web`, `-Suite app` (all specs)
   - `scripts/perf-trace.ps1 -Scenario P1,P2,P3,P4,P5,P7,P8 -Size 1920 -Runs 3` and `-Size 4k -Runs 3` (perf lock; no other heavy work on the machine meanwhile)
   - `scripts/size.ps1` (sidecar dist and the exe)
   - the real-data guard: `realdata-check.txt` unchanged
4. **Fix** what fails. Small fixes go directly on `int/w<n>`, with a commit per fix (`fix(int-w<n>): …`). If a fix is larger than ~50 lines in one WP's area, write it up in STATUS for the next wave instead and mark the test as a known failure.
5. **Land:**
   - `git push origin int/w<n>:main` (fast-forward), and the Kotlin branch as in step 1
   - append the wave report to `docs/perf/results.md` (perf rows) and `D:\Coding_Project\MinMusic_4_Windows-wp\STATUS.md` (one line: `INT-W<n> <sha> pass/fail counts, perf worst, sizes, known failures`)
   - remove the merged WP worktrees: `git worktree remove` for each WP and test checkout. The disk is tight (≈ 47 GB free).
6. **Report:** merge conflicts and how they were resolved, the fix list, all test counts, perf table, sizes, and known failures carried forward.

Rules: test data roots only; kill only your own PIDs; never touch the owner's MinMusic data or a running owner instance.
