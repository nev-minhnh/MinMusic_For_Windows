# M0-E: e2e and performance harness

**Agent:** Sonnet. **Branch:** `wp/M0-E`.

Read first:
- `docs/test-guide.md` §0, §3, §4, §5 (normative for this WP)
- `docs/milestones.md` perf table
- `docs/architecture.md` §10

## Goal
Ready-to-run scripts that start the real app in test mode, attach over CDP, take CDP screenshots, run Playwright suites, check processes, and produce the M0 performance numbers. The analyzer must be calibrated so its numbers can be trusted.

## Owned paths
- `scripts/e2e.ps1`
- `scripts/perf-trace.ps1`
- `scripts/size.ps1`
- `tools/perf/**`: `run.mjs`, `analyze.mjs`, `startup.ps1`, `resources.ps1`, `sendinput/` (a tiny Rust bin crate, built with the GNU toolchain), `presentmon.ps1`, `bin/` (gitignored downloads)
- `tools/sendmsg.ps1`
- `tests/e2e/**`
- `playwright.config.ts`
- `docs/perf/**`

## Script contracts
- **`scripts/e2e.ps1 -Suite <name> [-Exe <path>] [-Keep]`**
  1. Run id `yyyyMMdd-HHmmss`. `$root = .testdata\<id>`. Set the env vars `MINMUSIC_DATA_ROOT`, `MINMUSIC_DEVTOOLS_PORT` (a free port), `MINMUSIC_TEST_PIDFILE`.
  2. Start the exe. The default is the newest of `src-tauri/target/x86_64-pc-windows-gnu/{release,debug}/MinMusic.exe`.
  3. Poll `http://127.0.0.1:<port>/json/version` for 20 s, then wait for `core_status=ready` through the CDP evaluate `window.__TAURI__.core.invoke('core_status')`.
  4. Run `npx playwright test --project=app tests/e2e/<suite>`, or the PowerShell process suite for `-Suite process`.
  5. In `finally`, stop only the pidfile PIDs: graceful `app_quit` via CDP, then `Stop-Process -Id` after 5 s. Exit code = number of failures.
- **`tests/e2e/fixtures/app.ts`:** a Playwright fixture that does `chromium.connectOverCDP(endpoint)`, picks the page whose URL is the main window (not `#/mini`), and exposes `invoke(cmd,args)` and `shot(name)` (CDP `Page.captureScreenshot` → `.testdata/<id>/shots/<name>.png`).
- **Process suite** (`tests/e2e/process/*.ps1`): T-P1…T-P11 from test-guide §3, each a function returning pass/fail plus a message. T-P10 uses `tools/sendmsg.ps1` (`SendMessageTimeout` P/Invoke via `Add-Type`).
- **`scripts/perf-trace.ps1 -Scenario P1,P2,...|all|CAL -Size 4k|1920 -Runs 5 [-Exe]`**: test-guide §5 exactly. Writes `docs/perf/<date>-<scenario>-<size>.json` and appends rows to `docs/perf/results.md`.
- **`tools/perf/analyze.mjs <trace.json> [presentmon.csv] --window <startTs,endTs>`**: prints and returns `{frames, dropped, droppedPct, partial, longTasks, maxLongTaskMs, eventLatencyP95, pmLongGaps}`.

## Web project tests (Vite + mock)
`tests/e2e/web/m0.spec.ts`: E-1…E-4 at the viewports in test-guide §4, using the `data-testid` names listed in M0-C.

## Done criteria
1. **Calibration** `CAL`:
   - With injection, the result is ≥ 1 long task/s and dropped > 0.
   - Without injection (the idle Home page, no input, 5 s), there are 0 long tasks and no dropped frames other than `NO_UPDATE_DESIRED`.
   - Both results are in the report.
2. `scripts/e2e.ps1 -Suite process` runs all T-P tests; the ones whose features exist pass. Run it against the M0-A shell + mock sidecar first, then the real core.
3. `scripts/perf-trace.ps1 -Scenario all -Size 1920 -Runs 1` and `-Size 4k -Runs 1` complete end-to-end on the integrated app. The full 5-run M0 report `docs/perf/M0-report.md` is produced at integration.
4. `scripts/e2e.ps1` never touches `%LOCALAPPDATA%\MinMusic`. Prove it with a before/after `Get-ChildItem -Recurse | Measure` LastWriteTime check in the report.
5. Screenshots are taken via CDP only. No GDI or PrintWindow anywhere.
