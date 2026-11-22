# Wave plan M1–M5 (cross-milestone, parallel)

Normative for launching agents. Rules: `conventions.md` (ownership, ports, build policy) and `integration.md` (per-wave integration).

- **Concurrency:** ≤ 6 WP agents at once. WP agents do no heavy builds, so RAM is dominated by agents and Vite/mock servers.
- **Order:** launch a wave's WPs as slots free up. A wave's integration (`INT-W<n>`) starts when all its WPs are done; the next wave branches from the integrated `main` / `feat/desktop-core`.
- **Overlap:** WPs of wave n+1 that touch no Kotlin and whose brief says **"may start before INT-W<n>"** may launch early from `main`. They then merge the integrated `main` once before finishing.

## Waves
| Wave | WPs (agent) | Kotlin | Theme | Integration → milestone gate |
|---|---|---|---|---|
| **W1** | M1-1 core extraction (S, K) · M1-2a core browse/search/pages/queue + API registry (S, K) · M1-3a UI foundation (S) · M1-4 shell OS integration (S) · M1-5 mock/contract infra (S) · M3-1 shell webLogin + PO token (S) | 2 | foundations | **INT-W1**: size diet, auto-advance, shell features |
| **W2** | M1-2b core library/userAlbum/history/art (S, K) · M1-3b UI Home/Search/Charts/Browse (S) · M1-3c UI Library/UserAlbum/History/Stats (S) · M1-3d UI Album/Artist/Playlist/Podcast (S) · M2-2 UI player: full player, queue pane, lyrics (S) · M5-1 NSIS/portable/sizes (S) | 1 | browse + player UI | **INT-W2** = **M1 acceptance** |
| **W3** | M2-1 core player/queue/lyrics complete (S, K) · M2-3a core EQ (S, K) · M2-3b UI Equalizer (S) · M2-4 shell+UI mini player, taskbar (S) · M3-3 UI sources/integrations settings + dialogs (S) · M4-1b UI Settings shell + all general pages (S) | 2 | player + settings UI | **INT-W3** = **M2 acceptance** |
| **W4** | M3-2 core accounts/sources/integrations/PO runtime (S, K) · M3-4a core Device Connect + Listen Together API (S, K) · M4-1a core settings API (S, K) · M3-4b UI DC/LT (S) · M4-2b UI downloads/storage (S) · M4-3b UI backup/onboarding/crash/logs (S) | 3 | accounts + settings core | **INT-W4** = **M3 acceptance** |
| **W5** | M4-2a core downloads/storage/import.files (S, K) · M4-3a core backup/crash/onboarding/logs (S, K) · M4-4a core playlist import (S, K) · M4-4b UI playlist import (S) · M5-2 updater + Updates page + bridge job (S) · M5-3 release workflow + CI (S) | 3 | data + release plumbing | **INT-W5** = **M4 acceptance** |
| **W6** | M5-4 full regression, upgrade tests, release candidate (Opus) | 0 | release gate | **M5 release gate** → coordinator tags `v2.0.0` |

S = Sonnet, K = Kotlin.

**May start before the previous integration** (no Kotlin, mock-first; they merge `main` once at the end):
- **W2:** M1-3b/c/d (after M1-3a stage 2 + M1-5 stage 2 are pushed); M2-2 and M5-1 any time after M1-3a stage 1.
- **W3:** M2-3b, M3-3, M4-1b, M2-4 (after INT-W1, since M2-4 needs the M1-4 corelink).
- **W4:** M3-4b, M4-2b, M4-3b.
- **W5:** M4-4b.

Kotlin WPs always start after the previous integration, from the merged `feat/desktop-core`. The single exception is wave 1, where M1-1 and M1-2a run in parallel on disjoint files.

## Worktrees, branches, ports
| WP | Windows worktree / branch | Kotlin worktree / branch | Web / mock port |
|---|---|---|---|
| M1-1 | `…-wp\M1-1-test` (detached) | `MinMusic-wt-m1-1` / `feat/desktop-core-m1-1` | – |
| M1-2a | `…-wp\M1-2a-test` (detached) | `MinMusic-wt-m1-2a` / `feat/desktop-core-m1-2a` | – |
| M1-3a | `…-wp\M1-3a` / `wp/M1-3a` | – | 5181 / 48001 |
| M1-4 | `…-wp\M1-4` / `wp/M1-4` | – | 5184 / 48004 |
| M1-5 | `…-wp\M1-5` / `wp/M1-5` | – | 5185 / 48005 |
| M3-1 | `…-wp\M3-1` / `wp/M3-1` | – | 5186 / 48006 |
| M1-2b | `…-wp\M1-2b-test` | `MinMusic-wt-m1-2b` / `feat/desktop-core-m1-2b` | – |
| M1-3b | `…-wp\M1-3b` / `wp/M1-3b` | – | 5182 / 48002 |
| M1-3c | `…-wp\M1-3c` / `wp/M1-3c` | – | 5183 / 48003 |
| M1-3d | `…-wp\M1-3d` / `wp/M1-3d` | – | 5187 / 48007 |
| M2-2 | `…-wp\M2-2` / `wp/M2-2` | – | 5188 / 48008 |
| M5-1 | `…-wp\M5-1` / `wp/M5-1` | – | – |
| M2-1 | `…-wp\M2-1-test` | `MinMusic-wt-m2-1` / `feat/desktop-core-m2-1` | – |
| M2-3a | `…-wp\M2-3a-test` | `MinMusic-wt-m2-3a` / `feat/desktop-core-m2-3a` | – |
| M2-3b | `…-wp\M2-3b` / `wp/M2-3b` | – | 5189 / 48009 |
| M2-4 | `…-wp\M2-4` / `wp/M2-4` | – | 5190 / 48010 |
| M3-3 | `…-wp\M3-3` / `wp/M3-3` | – | 5192 / 48012 |
| M4-1b | `…-wp\M4-1b` / `wp/M4-1b` | – | 5191 / 48011 |
| M3-2 | `…-wp\M3-2-test` | `MinMusic-wt-m3-2` / `feat/desktop-core-m3-2` | – |
| M3-4a | `…-wp\M3-4a-test` | `MinMusic-wt-m3-4a` / `feat/desktop-core-m3-4a` | – |
| M4-1a | `…-wp\M4-1a` / `wp/M4-1a` (shell part) | `MinMusic-wt-m4-1a` / `feat/desktop-core-m4-1a` | – |
| M3-4b | `…-wp\M3-4b` / `wp/M3-4b` | – | 5193 / 48013 |
| M4-2b | `…-wp\M4-2b` / `wp/M4-2b` | – | 5194 / 48014 |
| M4-3b | `…-wp\M4-3b` / `wp/M4-3b` | – | 5195 / 48015 |
| M4-2a | `…-wp\M4-2a-test` | `MinMusic-wt-m4-2a` / `feat/desktop-core-m4-2a` | – |
| M4-3a | `…-wp\M4-3a-test` | `MinMusic-wt-m4-3a` / `feat/desktop-core-m4-3a` | – |
| M4-4a | `…-wp\M4-4a-test` | `MinMusic-wt-m4-4a` / `feat/desktop-core-m4-4a` | – |
| M4-4b | `…-wp\M4-4b` / `wp/M4-4b` | – | 5196 / 48016 |
| M5-2 | `…-wp\M5-2` / `wp/M5-2` | – | 5197 / 48017 |
| M5-3 | `…-wp\M5-3` / `wp/M5-3` | – | – |
| M5-4 | `…-wp\M5-4` / `wp/M5-4` | – | 5198 / 48018 |
| INT-W<n> | `…-wp\INT-W<n>` / `int/w<n>` | `MinMusic-wt-int-w<n>` / `int/w<n>` | 5199 / 48019 |

`…-wp` = `D:\Coding_Project\MinMusic_4_Windows-wp`. Kotlin worktrees live in `D:\Coding_Project\`.

## Gradle build schedule (global lock; only integration agents build)
| Integration | Main build | Fix budget | Tasks |
|---|---|---|---|
| INT-W1 | 1 | ≤ 2 | `:desktopCore:test :desktopCore:sidecarImage :desktopApp:compileKotlinJvm :desktopApp:jvmTest :shared:desktopTest :androidApp:compileDebugKotlin` (shared touched) |
| INT-W2 | 1 | ≤ 2 | `:desktopCore:test :desktopCore:sidecarImage :desktopApp:compileKotlinJvm` |
| INT-W3 | 1 | ≤ 2 | same as W2, + `:shared:desktopTest` if M2-1/M2-3a touched shared |
| INT-W4 | 1 | ≤ 2 | same as W2, + Android compile if shared touched |
| INT-W5 | 1 | ≤ 2 | same as W2 |
| W6 | 1 | ≤ 1 | release-equivalent image + the CI dry-run tag (GitHub Actions, MSVC) |

- **Total:** 6 main builds + ≤ 11 fix builds. Expect 9–12 local builds at 10–30 min each, about 3–5 h of lock time over the whole project.
- Builds never overlap, because there is one integration at a time.

## Integration checkpoints
- Each INT also re-runs **all** earlier suites (contract all, e2e all, process, perf), so regressions from later waves surface at once.
- Known failures carry forward with a named owner WP. A gate (M1…M5 acceptance from `milestones.md`) passes only when its own items are green.

## Dependencies (why this order)
- **M1-1 before any Kotlin of W2+:** everything after W1 builds on the flipped module layout (same packages, so the briefs do not change).
- **M1-2a's `ApiRegistry`** (W1) gives every later Kotlin WP its own `api/<area>/<Area>Module.kt` and no shared registration file.
- **M1-4 stage 1 → M3-1, M2-4, M5-2:** Rust marked blocks, the pre-declared `Cargo.toml`, `corelink` + `srv::register`.
- **M1-3a → every UI WP:** route, settings and command globs, i18n and icon files, components, Menu, Table, Dialog, Toast.
- **M1-5 → every UI WP:** per-area mock loader, ports, the contract runner with suite names. UI WPs of later waves write their own area's mock handlers and contract suites. The Kotlin WP of the same area must make that suite pass on the real core at its integration.
- **M3-1 (W1) → M3-2 (W4):** the core's `ShellPoTokenRuntime` and `WebLoginConfigs` call the shell methods.
- **M4-1a settings API (W4) → shell tray/close/mini settings** wired at INT-W4, replacing the `shell.json` stand-ins from M1-4/M2-4.
- **M5-1 (W2) → M5-2/M5-3 (W5) → M5-4 (W6).**
