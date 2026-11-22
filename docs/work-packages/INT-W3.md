# INT-W3: Wave 3 integration = M2 acceptance

Follow `integration.md`. **Start when** M2-1, M2-3a, M2-3b, M2-4, M3-3 and M4-1b are done.

## Merge order
- **Kotlin:**
  1. `feat/desktop-core-m2-1` (touches `shared/desktopMain` `ffmpeg/AudioRenderer.kt`/`AudioOutput.kt`)
  2. `feat/desktop-core-m2-3a`

  **Main build:** `:desktopCore:test :desktopCore:sidecarImage :desktopApp:compileKotlinJvm :shared:desktopTest`.
- **Windows:**
  1. `wp/M4-1b` (replaces M1-3a's minimal Settings shell)
  2. `wp/M3-3`
  3. `wp/M2-3b`
  4. `wp/M2-4`

  Expected conflicts:
  - The `TitleBar` mounting of M3-3's `<AccountButton/>`: you add the one line.
  - `main.tsx` `#/mini` routing, if M2-4 needed it.

## Extra checks
1. Contract on real: `m2-player` (incl. `queue.setLocked`, `lyrics.*`), `m2-eq` green, plus everything from earlier waves.
2. **App e2e:** E-20…E-35 (M2-2, M2-3b, M2-4 specs), E-40…E-46 on the mock-backed parts. M3-3 runs against the real core, where `account.*` is `unsupported` until W4 (a known failure owned by M3-2).
3. **Perf:** P4 at final full-player fidelity (both sizes), C1 (full player + lyrics, 60 s), P1–P5 regression.
4. **Audio (record for Minh's manual M2 QA):** an `player.output.set` switch moves playback to the chosen device on the next track (verified by `player.state.output` plus a log line); EQ changes are audible (manual); `eq.spectrum` streams at ≤ 30 Hz only while subscribed.
5. **v1 safety:** `shared:desktopTest` green. `git diff` of `shared/` limited to the M2-1 files.

## Acceptance = M2 gate
E-20…E-35; P4 at final full-player fidelity; C1.
