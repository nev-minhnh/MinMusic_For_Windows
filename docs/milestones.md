# Milestones

Every work package (WP) ends with its agent running the real app on this PC and verifying its own work, as described in test-guide §0.
- Agents commit on their own branch `wp/<id>`. The coordinator merges to `main`.
- WPs within a milestone touch disjoint paths (listed below). Shared files have exactly one owner.

## Performance acceptance criteria (decision 6)
These are measured by `scripts/perf-trace.ps1` (test-guide §5) on this PC:
- integrated AMD Radeon GPU
- panel 3840×2400 at 60 Hz with the Windows scale as set by Minh, plus 1920×1200 at 100 % via a 1920×1200 window
- release build (`--features e2e`), mains power, the sidecar warm
- 5 repetitions; the **worst** run counts

Dropped frames use Chromium `PipelineReporter` frames with state `STATE_DROPPED` or `STATE_PRESENTED_PARTIAL` (main-thread miss) over all frames in the window. "Long gap" means presentation intervals in the PresentMon CSV for `msedgewebview2.exe` `MsBetweenDisplayChange` > 25 ms during motion.

| # | Scenario | 1920×1200 | 3840×2400 |
|---|---|---|---|
| P1 | Wheel scroll, 5,000-row songs list with art, 40 notches over 8 s | dropped ≤ 0.5 %, long gaps 0 | dropped ≤ 1 %, long gaps ≤ 1 |
| P2 | Wheel scroll Home (shelves, quick picks, charts) top→bottom→top | ≤ 0.5 % | ≤ 1 % |
| P3 | Page push/pop (Home→Album→Artist→back×2), 20 transitions | ≤ 1 dropped frame per transition, 0 long gaps | ≤ 1 per transition, ≤ 2 long gaps total |
| P4 | Player bar ↔ full player, 20 open/close | ≤ 1 dropped per transition | ≤ 2 dropped per transition |
| P5 | Hover sweep over 30 rows / cards | 0 dropped | ≤ 0.5 % |
| P6 | Window resize drag across 1199/840 breakpoints, 5 s | ≤ 5 % dropped, no frame > 50 ms | ≤ 8 %, no frame > 66 ms |
| P7 | Main-thread long tasks > 50 ms during P1–P5 | 0 | 0 |
| P8 | Click → first changed frame (input latency) for nav/play | ≤ 50 ms p95 | ≤ 66 ms p95 |
| S1 | Warm start: launch → main window painted with cached Home | ≤ 700 ms | same |
| S2 | Warm start: launch → core `READY` | ≤ 900 ms (cold after reboot ≤ 2.0 s) | same |
| S3 | Click play → audio starts (YouTube, warm) | ≤ v1.0.2 time + 0 ms (no regression), absolute ≤ 1.5 s | same |
| R1 | Total private bytes (shell + all msedgewebview2 children + core) after 10 min browse + play | ≤ 700 MB | ≤ 800 MB |
| R2 | Hidden in tray, playing, 5 min | ≤ 450 MB | same |
| C1 | CPU, full player visible with lyrics, playing (all processes) | ≤ 4 % of total CPU avg over 60 s | ≤ 5 % |
| I1 | NSIS setup size / installed size | ≤ 100 MB / ≤ 280 MB | – |

For comparison, the v1 baseline is 20–45 % duplicate frames during transitions.

**M0 gate:** P1–P8 and S1/S2 must meet the targets at both sizes. If P1–P5 pass but P6 fails, that is acceptable; record it and continue. Minh decides.

## M0: Spike (1–2 days, 5 WPs in parallel)
**Goal:** prove smoothness and the process model before any feature work.

| WP | Brief | Owns paths | Depends on |
|---|---|---|---|
| M0-A | Tauri shell + sidecar supervisor + test hooks | `src-tauri/**`, `scripts/dev.ps1`, `.gitmodules`, root `package.json` (workspaces only) | M0-D types (read only) |
| M0-B | `desktopCore` headless sidecar (spike) | `core/MinMusic` on branch `feat/desktop-core` (MinMusic repo), `sidecar/**` | – |
| M0-C | UI spike: shell layout, Home, virtual list, full-player transition, navigation | `ui/**` except `ui/src/core/**` | M0-D client |
| M0-D | Protocol types, TS client, mock core | `protocol/**`, `mock-core/**`, `ui/src/core/**` | – |
| M0-E | Perf and e2e harness | `scripts/e2e.ps1`, `scripts/perf-trace.ps1`, `tools/perf/**`, `tests/e2e/**` | – (uses mock until A+B land) |

Order:
- Day 1 morning: D publishes the types and client first (about 2 h).
- A, B, C and E start immediately, using api.md directly.
- Day 2: the coordinator integrates A+B+C, then E measures and writes `docs/perf/M0-report.md`.

**M0 acceptance:**
- the app starts the sidecar, shows Home (fixture and live), scrolls 5,000 rows, plays a track, opens and closes the full player, and navigates Home ↔ Album ↔ Library
- the process tests T-P1…T-P6 (test-guide §3) pass
- the perf table is filled in

## M1: Core extraction + browse
| WP | Content | Paths | Deps |
|---|---|---|---|
| M1-1 | Move CORE/MIXED-light files into `desktopCore` and flip the dependency; remove `:desktopApp` from the sidecar classpath; jlink without Compose UI/Skiko | MinMusic `desktopCore/`, `desktopApp/` build files | M0 |
| M1-2 | Core API: home, charts, browse, search, album, artist, playlist, podcast, related, library.window/counts, likes/saves, userAlbum.*, history, stats | `desktopCore/.../api/{browse,search,library,pages}` | M1-1 (rebases after it) |
| M1-3 | UI pages: Home (final), Search, Library (all filters), Album, UserAlbum, Artist, Playlist, Charts, Browse, History, Stats; context menu; selection and drag to album | `ui/src/pages/{Home,Search,Library,Album,UserAlbum,Artist,Playlist,Charts,Browse,History,Stats}`, `ui/src/components/Menu*` | mock fixtures from M1-5 |
| M1-4 | Shell: tray, close-to-tray, SMTC, single instance + deep links, window state, Snap Layouts hit-test | `src-tauri/src/{tray,smtc,window,deeplink}.rs` | M0-A |
| M1-5 | Mock-core fixtures and contract tests for every M1 method | `mock-core/fixtures/**`, `protocol/**`, `tests/contract/**` | api.md |

**Acceptance:** all M1 contract tests pass against the real sidecar; e2e browse flows E-1…E-12 pass; P1–P5 still pass.

## M2: Player complete
| WP | Content | Paths |
|---|---|---|
| M2-1 | Core: queue.*, player.* complete, sleep timer, output devices, lyrics.* (translate, romanize, offset, edit, search), related | `desktopCore/.../api/{player,queue,lyrics}` |
| M2-2 | UI: full player final, queue pane, lyrics pane + fullscreen + karaoke, sleep timer, output picker, volume popover, floating player-bar variant, progress variants | `ui/src/shell/{FullPlayer,PlayerBar,SupportPane}`, `ui/src/pages/Lyrics*` |
| M2-3 | Equalizer, core + UI (all features: 32 bands, filter types, preamp/auto, effects, profiles, undo/redo, APO import/export, AutoEq, per-device, spectrum) | `desktopCore/.../api/eq`, `ui/src/pages/Equalizer/**` |
| M2-4 | Shell: mini-player window, taskbar thumb buttons, taskbar progress, Ctrl M | `src-tauri/src/{mini,taskbar}.rs`, `ui/src/mini/**` |

**Acceptance:** E-20…E-35; P4 at final full-player fidelity; C1.

## M3: Accounts, sources, integrations
| WP | Content | Paths |
|---|---|---|
| M3-1 | Shell `shell.webLogin` + `shell.po.*` (hidden webview, cookies, ExecuteScript) | `src-tauri/src/{weblogin,potoken}.rs` |
| M3-2 | Core: `WebLoginConfigs`, `ShellPoTokenRuntime`, account.*, sources.*, NCT, Zing, Last.fm, ListenBrainz, Discord | `desktopCore/.../{shell,api/account,api/integrations}` |
| M3-3 | UI: Settings → Nguồn nhạc, NCT and Last.fm dialogs, account menu, Tích hợp pages | `ui/src/pages/Settings/{Sources,Integrations}`, dialogs |
| M3-4 | Device Connect + Listen Together, core API + UI panel/pages | `desktopCore/.../api/{dc,lt}`, `ui/src/pages/{DeviceConnect,ListenTogether}` |

**Acceptance:**
- YouTube login and playback of a signed-in-only track
- Zing VIP shows 320 only with a VIP account
- the NCT password is absent from every file under the data dir and logs (grep test)
- pair and control with Android 1.0.2 (manual QA M3)

## M4: Settings, downloads, data
| WP | Content | Paths |
|---|---|---|
| M4-1 | Settings: schema endpoint + every page/layout table, settings search | `desktopCore/.../api/settings`, `ui/src/pages/Settings/**` (except M3 pages) |
| M4-2 | Downloads: core API + Library downloads box, queue, folder choice, save-to, storage page | `desktopCore/.../api/download`, `ui/src/pages/{Downloads,Settings/Storage}` |
| M4-3 | Backup/restore, foreign import, crash prompt, onboarding, log viewer | `desktopCore/.../api/{backup,crash}`, `ui/src/pages/{Onboarding,Settings/Backup}` |
| M4-4 | Playlist import (Spotify/Tidal/Deezer/Apple/Amazon) via webLogin | `desktopCore/.../api/import`, `ui/src/pages/Settings/Import` |

## M5: Packaging, migration, release
| WP | Content | Paths |
|---|---|---|
| M5-1 | NSIS (currentUser, hooks: stop processes, uninstall v1 MSI), portable zip, sizes | `src-tauri/nsis/**`, `tauri.conf.json` bundle |
| M5-2 | Updater (latest.json, minisign), Updates settings page, v1 bridge release job | `src-tauri/src/update.rs`, `.github/workflows/**` |
| M5-3 | Release workflow (MSVC) + no-ads check + contract tests in CI | `.github/workflows/release.yml` |
| M5-4 | Full regression: perf table, QA checklist, v1 → v2 upgrade on a VM-free test user profile | `docs/perf/`, `docs/qa/` |

**Release gate:** all P/S/R/C/I targets, the full manual QA checklist, and the upgrade tests U-1…U-4.
