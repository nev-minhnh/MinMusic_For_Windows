# INT-W5: Wave 5 integration = M4 acceptance

Follow `integration.md`. **Start when** M4-2a, M4-3a, M4-4a, M4-4b, M5-2 and M5-3 are done.

## Merge order
- **Kotlin:**
  1. `feat/desktop-core-m4-3a` (touches `CoreRuntime` for pending restore and portable mode)
  2. `feat/desktop-core-m4-2a` (`DownloadManager` additive)
  3. `feat/desktop-core-m4-4a` (`WebLoginConfigs` `// <M4-4a>` block)

  **Main build:** `:desktopCore:test :desktopCore:sidecarImage :desktopApp:compileKotlinJvm`.
- **Windows:**
  1. `wp/M5-3`
  2. `wp/M5-2` (`tauri.conf.json` `plugins.updater`; the pubkey stays a placeholder until Minh generates the key; record it)
  3. `wp/M4-4b`

## Extra checks
1. **Contract on real:** `m4-downloads`, `m4-backup`, `m4-import` (shapes), and all earlier suites.
2. **Downloads (test folder):**
   - download one YouTube track and one album (3+ tracks) into `.testdata\…\dl`; the format is kept (ffprobe codec = source) with full tags
   - pause/resume, cancel, retry, remove
   - the taskbar progress shows during the download (M2-4 probe)
   - `import.files` with 2 fixture audio files (generate them with ffmpeg in `.testdata`) → playable, art served via `/art/local`
3. **Backup:** create → inspect → restore on a test root → `app_restart` → data present. Crash prompt after `Stop-Process` of the core during a write (test root).
4. **Portable:** build the portable zip (`scripts/portable.ps1`) and run it from a `.testdata` path. Data goes to `<exe dir>\data`, and nothing is written to `%LOCALAPPDATA%\MinMusic` (realdata-check).
5. **Updater (local):** `m5-2.spec.ts` U-3-local with a throwaway key.
6. `actionlint` on the workflows, `check_no_ads.sh`.

## Acceptance = M4 gate
E-50…E-55 green; downloads keep the original format with full tags (manual foobar/MP3Tag check listed for Minh); backup → restore works on a test root; the crash prompt appears after a forced core kill during a write.
