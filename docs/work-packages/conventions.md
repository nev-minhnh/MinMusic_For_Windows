# Work-package conventions (M1–M5): normative for every brief

Every brief says "conventions apply". This file defines the conflict-free ownership scheme for shared files, the worktree and port layout, and the self-test rules.

## 1. Worktrees, branches, ports
- **Windows repo WP:** `git -C D:\Coding_Project\MinMusic_4_Windows worktree add D:\Coding_Project\MinMusic_4_Windows-wp\<WP> -b wp/<WP> origin/main`.
  - Run `npm install` in the worktree.
  - `main` here means `main` at the start of the WP's wave, after the previous integration checkpoint.
- **Kotlin WP (MinMusic repo):** `git -C D:\Coding_Project\MinMusic-wt-core worktree add D:\Coding_Project\MinMusic-wt-<wp> -b feat/desktop-core-<wp> origin/feat/desktop-core`.
  - `<wp>` is the lower-case WP id, e.g. `m2-1`.
  - **Test checkout:** `D:\Coding_Project\MinMusic_4_Windows-wp\<WP>-test`, `--detach origin/main`. It is used only to run the contract suites and e2e. Never commit there.
- **Ports:** each WP has its own pair from `waves.md`: `MM_WEB_PORT` (Vite) and `MOCK_PORT` (mock core). Playwright web runs use them; never reuse another WP's server.
- **Commits:** Conventional Commits.
  - WP agents end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. The coordinator and Opus agents use the Opus line.
  - Push the branch. No PR. The coordinator merges at the wave checkpoint.
- **Status:** append one line per milestone event (first push, done, blocked) to `D:\Coding_Project\MinMusic_4_Windows-wp\STATUS.md`: `<WP> HH:MM <sha> <what>`.

## 2. File ownership
- **Ownership is per wave.** A WP may edit only its listed paths. After a checkpoint merges a WP, later waves may edit its files when their brief lists them.
- **Shared files** use one of the three mechanisms below. Nothing else is shared.

| Shared thing | Mechanism | Detail |
|---|---|---|
| UI routes | **one file per page** (glob registry) | `ui/src/pages/<Name>/index.tsx` exports `routes: RouteName[]` + default component. `router/View.tsx` globs `../pages/*/index.tsx` (M1-3a). `RouteName` in `router/routes.ts` already lists every route of frontend-spec §3. A new route name needs a checkpoint edit |
| Settings categories | **one folder per category** (glob) | `ui/src/pages/Settings/<Category>/index.tsx` exports `category = {key, order, icon, titleKey}` + default component. The Settings shell (M4-1b) globs `./*/index.tsx`. Until M4-1b lands, a category WP tests its component through a dev-only route `#/dev/settings/<key>` served by `pages/Settings/_dev.tsx` (M1-3a creates that file) |
| Shortcuts / commands | **one file per area** | `ui/src/input/commands/<area>.ts` exports `commands: {key, run}[]`. `input/keys.ts` (M1-3a) globs them. The key table itself is fixed by frontend-spec §7 |
| i18n strings | **one file per WP** | `ui/src/i18n/extra/<locale>/<wp>.json` (en and vi). `gen-strings.mjs` merges all of them and fails on a duplicate key. Keys are `w2_<area>_*` |
| Icons | **one file per WP** | `ui/src/icons/<wp>.svg`, `<symbol id="i-…">` only. The Icon host injects the merged sprite (glob `?raw`, M1-3a). Duplicate ids fail the build |
| CSS | **next to the page or component** | `pages/<Name>/<name>.css`, prefixed classes. `styles/*.css` and `components/**` belong to M1-3a in wave 1; later WPs create components inside their own page folder, or in `ui/src/components/<area>/**` when their brief lists it |
| Protocol types | **append-only marked sections + api.md first** | `protocol/src/{methods,events,models}.ts` already contain every api.md method. A WP that needs a change edits api.md **and** adds its delta inside `// <WP>` … `// </WP>` markers at the end of the file. Changing an existing type is done only by the coordinator at a checkpoint. `protocol/schema/*` is regenerated at the checkpoint (`npm run schema`); WPs may regenerate locally but never commit `schema/` |
| Mock core | **one file per area** | `mock-core/src/handlers/<area>.ts` exports `handlers` and optionally `topics`; `server.ts` loads `handlers/*.ts` (M1-5). Fixtures go in `mock-core/fixtures/<area>/`. Duplicate method names fail at start |
| Contract suites | **one file per area** | `tests/contract/suites/<area>.mjs`; `run.mjs --suite <area>|all` (M1-5) |
| e2e specs | **one file per WP** | `tests/e2e/web/<wp>.spec.ts`, `tests/e2e/app/<wp>.spec.ts`; `scripts/e2e.ps1 -Spec <file>` (M1-5) |
| Kotlin API registration | **one module object per area**, discovered at start | `desktopCore/.../core/api/<area>/<Area>Module.kt`: `object XModule : ApiModule { override val handlers; override val topics }`. `core/api/ApiRegistry.kt` (M1-2a) finds every class named `com.metrolist.core.api.*.*Module` by scanning the core jar (or the classes dir in tests). A duplicate method or topic makes start fail; a unit test checks it. `SidecarMain.kt` is no longer edited for registration |
| Kotlin DTOs | **per area** | `api/<area>/Dto.kt`. Shared cards (`AlbumCard`, `ArtistCard`, `PlaylistCard`) are in `api/Cards.kt` (M1-2a). The M0 `api/Dto.kt` is frozen except at checkpoints |
| Rust commands/modules | **append-only marked sections** | `src-tauri/src/main.rs` has marked blocks `// <WP>` … `// </WP>` in three places: `mod` lines, `generate_handler![…]` entries (both cfg variants), and setup calls. A WP adds only inside its own block; it creates its block at the end of each list. All logic goes in the WP's own `src-tauri/src/<module>/**` |
| Tauri permissions | **one capability file per WP** | `src-tauri/capabilities/<wp>.json` (windows `main`, `mini`) |
| `Cargo.toml` | **pre-declared by M1-4** | M1-4 adds every crate and `windows` feature that any M1–M5 Rust WP needs (list in the M1-4 brief). Later WPs do not edit `Cargo.toml`; if something is missing, they note it in STATUS and the coordinator adds it at the checkpoint |
| `tauri.conf.json` | **single owner per wave** | W1: M1-4 (window and deep-link config). W2: M5-1 (bundle). W5: M5-2 (updater plugin config). No one else |
| `package.json` (root and `ui/`), lockfiles | **pre-declared** | M1-3a adds every UI dependency M1–M5 need: `@tauri-apps/api@2`, `@tauri-apps/plugin-dialog@2`, `qrcode-generator`. Others add none. If one is missing, the coordinator adds it at the checkpoint |
| Docs | the coordinator only | `docs/api.md` (WPs may edit it in their marked section `<!-- WP -->`), `docs/perf/*` (WPs append rows to `results.md` only) |

## 3. Self-verification (test-guide §0, mandatory)
- Use test data roots only: `.testdata\<run-id>` inside your worktree, or the contract runner's `.testdata\contract`. Never use `%LOCALAPPDATA%\MinMusic` or `%APPDATA%\MinMusic`.
- Kill only PIDs you started (pidfile or child handles). Never kill by image name; the owner's real MinMusic may be running.
- Run one app instance at a time per agent, and close it in `finally`.
- **Build policy (owner decision): WP agents do no heavy builds.**
  - **Allowed per WP:**
    - TS: `tsc --noEmit` (`npm -w ui run build` is fine, since it is just Vite), vitest, `node tests/contract/run.mjs --target mock`, and Vite + mock-core with Playwright `web` on your ports.
    - Rust: `cargo check` and `cargo test` for the crate, with `--target x86_64-pc-windows-gnu` after `source scripts/gnu-env.sh`.
  - **Not allowed:** any Gradle/`mm-build.sh` run, `cargo tauri build`/`dev`, `scripts/perf-trace.ps1`, and app-project e2e. Those run once per wave in the integration step (`INT-W<n>.md`).
  - **Kotlin WPs:** code against the exact signatures in the brief. Keep handlers small and make the mapping pure, unit-test the pure parts (the integration build runs them), and finish with a self-review checklist in the report.
- **The integration agent per wave:**
  1. merges in the fixed order
  2. runs ONE `mm-build.sh … :desktopCore:sidecarImage :desktopCore:test …` and ONE `cargo tauri build --features e2e`
  3. runs the full contract suite on the real core, app e2e, the process tests and perf
  4. fixes, with at most 2 extra Gradle runs per wave, then pushes
- **Smoothness rules** (frontend-spec §6) apply to every UI change: transform/opacity only, VirtualList over 60 rows, no wheel or scroll handlers that write styles, sized images, no hover transitions while scrolling, no task over 50 ms.
- **Report:** commands run, pass/fail counts, screenshot paths, perf numbers, what was not verified and why.
