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
| I1 | NSIS setup size / installed size | reported only, no target (owner decision 2026-11-23: speed over size) | – |

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

## M1–M5 execution model (owner decision 2026-11-22)
- Work runs in **cross-milestone waves**, not milestone by milestone. See `work-packages/waves.md`.
- Conflict-free ownership, ports and the build policy are in `work-packages/conventions.md`. WP agents do no heavy builds; one integration agent per wave builds once, tests everything and fixes (`work-packages/integration.md`, `INT-W<n>.md`).
- The gates below are checked at the integration that completes them: M1 at INT-W2, M2 at INT-W3, M3 at INT-W4, M4 at INT-W5, M5 at W6.

## M1: Core extraction + browse
| WP | Wave | Content | Brief |
|---|---|---|---|
| M1-1 | W1 | Move CORE files to `desktopCore` (same packages), flip the dependency, seams for Skia/Compose/Coil, sidecar runtime excludes, jlink locales | `M1-1-core-extraction.md` |
| M1-2a | W1 | Core: `ApiRegistry` + `Cards.kt`; home chips/more, charts, browse, moods, search.*, album/artist/playlist/podcast/related, `app.openUrl/copyLink`; **all `player.play` contexts + `queue.window/add/addContext/setAutoplay` + `queue` topic + the auto-advance fix** | `M1-2a-core-browse.md` |
| M1-2b | W2 | Core: `library.*` (all lists and sorts), likes/saves, `track.info/block`, `userAlbum.*`, history, stats, `/art` route, `--seed-library` | `M1-2b-core-library.md` |
| M1-3a | W1 | UI foundation: route/settings/command globs, i18n and icons per WP, Menu, Table, selection, drag, Dialog, Toast, Sidebar/Rail, shortcuts, theme and locale | `M1-3a-ui-foundation.md` |
| M1-3b | W2 | UI Home (final), Search, Charts, Browse | `M1-3b-ui-discover.md` |
| M1-3c | W2 | UI Library (all filters), Liked/Downloads lists, UserAlbum, History, Stats, song info dialog | `M1-3c-ui-library.md` |
| M1-3d | W2 | UI Album, Artist (+ About), Playlist, Podcast | `M1-3d-ui-pages.md` |
| M1-4 | W1 | Shell: tray, close-to-tray, SMTC, deep links, window state/`shell.json`, Snap Layouts, corelink + core→shell requests, Rust shared-file setup | `M1-4-shell.md` |
| M1-5 | W1 | Mock per area, M1 fixtures + seed, contract suites (live incl. auto-advance), port isolation, perf lock | `M1-5-mock-contract.md` |

- **Scope moves:** `track.sources`/`track.setSource` (per-track source choice; no v1 backing) → M3-2. `import.files` (no v1 importer) → M4-2a.
- **Queue:** the basic queue and auto-advance are folded into M1-2a. The remaining queue methods and the queue pane UI stay in M2.

**Acceptance (INT-W2):** all M1 contract tests pass against the real sidecar; e2e browse flows E-1…E-12 pass; P1–P5 still pass. (Sizes are reported only; no size criterion.)

## M2: Player complete
| WP | Wave | Content |
|---|---|---|
| M2-1 | W3 | Core: `queue.remove/move/select/clear/radio`, `player.*` complete (mute, sleep timer, output devices, speed), `lyrics.*` (get/search/choose/offset/translate/romanize/edit/providers), `lyrics` topic |
| M2-2 | W2 | UI: full player final, queue pane, lyrics pane + fullscreen + karaoke, sleep timer, output picker, volume popover, floating player-bar variant, progress variants (mock-first) |
| M2-3a | W3 | Core EQ: `eq.*`, `eq` topic, spectrum, `eq.response` |
| M2-3b | W3 | UI Equalizer page (all features, canvas graph) |
| M2-4 | W3 | Shell + UI: mini-player window, taskbar thumb buttons + progress, Ctrl M |

**Acceptance (INT-W3):** E-20…E-35; P4 at final full-player fidelity; C1.

## M3: Accounts, sources, integrations
| WP | Wave | Content |
|---|---|---|
| M3-1 | W1 | Shell `shell.webLogin` + `shell.po.*` |
| M3-2 | W4 | Core: `WebLoginConfigs`, `ShellPoTokenRuntime`, `account.*`, `sources.*`, `source.zing/nct.*`, Last.fm, ListenBrainz, Discord, **`track.sources/setSource`** |
| M3-3 | W3 | UI: Settings → Nguồn nhạc, Tích hợp, NCT and Last.fm dialogs, account menu |
| M3-4a | W4 | Core: Device Connect + Listen Together API (`dc.*`, `lt.*`, topics) |
| M3-4b | W4 | UI: Device Connect panel, Listen Together page |

**Acceptance (INT-W4):** YouTube login + a signed-in-only track; Zing VIP 320 only with VIP; the NCT password grep test; pairing with Android 1.0.2 (manual QA).

## M4: Settings, downloads, data
| WP | Wave | Content |
|---|---|---|
| M4-1a | W4 | Core: `settings.schema/get/set/reset`, `settings` topic; the shell reads its keys over corelink |
| M4-1b | W3 | UI: Settings shell + every general page (layout table), settings search |
| M4-2a | W5 | Core: `download.*`, `storage.*`, `downloads` topic, **`import.files`** |
| M4-2b | W4 | UI: Library downloads box, Downloads page, queue, folder choice, save-to, Storage page |
| M4-3a | W5 | Core: `backup.*`, `import.foreignBackup`, `crash.*`, `onboarding.*`, `app.logs.tail` |
| M4-3b | W4 | UI: Onboarding, Backup page, crash prompt, log viewer |
| M4-4a | W5 | Core: `import.providers/login/playlists/run` via webLogin |
| M4-4b | W5 | UI: Settings → Nhập playlist |

## M5: Packaging, migration, release
| WP | Wave | Content |
|---|---|---|
| M5-1 | W2 | NSIS (currentUser, hooks: stop processes, uninstall v1 MSI, deep-link scheme registration), portable zip, size script |
| M5-2 | W5 | Updater (latest.json, minisign), Updates settings page, v1 bridge release job |
| M5-3 | W5 | Release workflow (MSVC), no-ads check, contract tests in CI |
| M5-4 | W6 | Full regression: perf table, QA checklist, v1 → v2 upgrade tests, release candidate |

**Release gate (W6):** all P/S/R/C/I targets, the full manual QA checklist, and the upgrade tests U-1…U-4.
