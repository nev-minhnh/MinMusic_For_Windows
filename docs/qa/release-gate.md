# Release gate v2.0.0 (W6, 2026-11-23)

Main at the release commit `2857b9a`, core `feat/desktop-core` `ea8d5670`. Owner policy for W6: speed first; perf and the
upgrade tests that need a separate Windows user stay pending for the owner and do not block the release.

## Fix in W6: seek during loading, silent stall after a far seek
- **Seek while the stream loads** (root cause of the `[yt1, yt2]` auto-advance failure and of T-P2): `PlayerState` records the
  track a `playTrack` loads (from the play request). A seek before the stream is prepared becomes the pending resume
  position: persisted at once and applied after the load. `PlayerApi.seek` verifies against that track, waits for the load
  and re-checks up to 4 times.
- **`SeekCheck.landed`** treated any target within 6 s of the end as landed, so the lost seek to `dur - 3 s` was never
  repeated; the window is now 1.5 s.
- **Silent stall after a far seek (INT-W5 "MV seek, nothing for 35 s"):** a far range got HTTP 403, the stream recovery
  called `invalidateAttestation()` → `ShellPoTokenRuntime.reset()` → `ApiException("shell not connected")`, uncaught: the
  recovery coroutine died with `playing = true`. `reset()` no longer throws.
- **`player.play` waits for `--seed-library`** (test roots only): a play racing the seed transaction was dropped silently.
- **Load time:** 3–6 s from `player.play` to audio in the core and in the app on this PC (not 11–13 s). No cheap change found.

Verification in the real app (e2e build, test root, shell connected): play the MV `Llw9Q6akRo4`, seek to 200 s after it
plays → the position runs on from 200 s; seek to 270 s while it still loads → plays from 270 s and advances to `psZ1g9fMfeo`
after ~6.7 s.

## Tests
| Suite | Result |
|---|---|
| Gradle `:desktopCore:test` | 452/452 |
| Gradle `:shared:desktopTest` | 717 (6 skipped), 0 failures |
| vitest (all workspaces) | 288/288 |
| lint-strings | ok |
| contract mock `--suite all` | 167/167 |
| contract real `--suite all` (incl. live) | 121/138: the 17 known from INT-W5 (synthetic seed ids / fixture album ids are not playable on YouTube; live `playlist.save`; live auto-advance without a shell, see below) |
| process T-P1…T-P12 + M1-4a/b | 13 pass (T-P2 now passes: restored total=2, pos=42.0 s, paused), T-P12 skip (installer, M5-1 sandbox) |
| app e2e (real core, seeded root) | 22 pass, 2 skip (E-36b synthetic Snap input; U-3-local) |
| web e2e (Vite + mock) | 209/209 |
| cargo test (GNU) | 89/89 |
| real-data guard | unchanged (every e2e run + a W6 before/after snapshot) |
| perf P1–P8, S1–S3, R1/R2, C1 | **pending for the owner**: the desktop was locked during W6 |

Known: the contract live auto-advance test passes or fails depending on YouTube: without a shell there is no page-bound PO
token, googlevideo answers far ranges with 403 and the recovery (SABR) sometimes fails too. In the app (shell connected) the
same scenario passes.

## Pending for Minh (manual)
- Perf table unlocked (P1–P8 at 1920 and 4k, S1/S2/S3, R1/R2, C1): `scripts/perf-trace.ps1`.
- Upgrade tests on a separate Windows QA user: U-1 (v1.0.2 MSI → v2 setup), U-2 (v1 updater → bridge `windows-v2.0.0`),
  U-3 (v2.0.0 → v2.0.1 via the updater while playing), U-4 (uninstall keeps data).
- test-guide §6: physical wheel/touchpad/Shift+wheel feel, Snap halves; light theme, VI/EN; gapless/crossfade A/B vs
  v1.0.2; EQ audible, Bluetooth switch profile; SMTC art + media keys hidden; Google login + signed-in-only track;
  Zing VIP 320 vs non-VIP; NCT login; Device Connect with Android 1.0.2 (QR, SAS, both ways, transfer); Listen Together;
  Last.fm scrobble; downloads keep format + tags (foobar2000/MP3Tag); folder change; backup → restore; crash prompt after
  `taskkill` of the core during a write; SmartScreen flow; portable zip from a USB path.
