# M2-3b: UI Equalizer page (all features)

**Wave 3** (may start before INT-W2; mock-first). **Agent:** Sonnet. Conventions apply.
- **Worktree:** `…-wp\M2-3b`, branch `wp/M2-3b`.
- **Ports:** 5189 / 48009.

Read first:
- `docs/frontend-spec.md` §5 Equalizer, §6, §7 (Ctrl E, band keys)
- `docs/api.md` §3.8, §4 `eq`
- MK frame 8 (Equalizer 1920×1200)
- LS §7

## Owned paths
- `ui/src/pages/Equalizer/**` (route `equalizer`)
- `ui/src/state/eq.ts`
- `ui/src/input/commands/eq.ts`
- `mock-core/src/handlers/eq.ts`, `mock-core/fixtures/eq/**` (profiles, AutoEq index sample, an APO file fixture)
- `tests/contract/suites/m2-eq.mjs`
- `ui/src/i18n/extra/{en,vi}/m2-3b.json`, `ui/src/icons/m2-3b.svg`
- `tests/e2e/web/m2-3b.spec.ts`, `tests/e2e/app/m2-3b.spec.ts`, `tests/fixtures/eq/*.txt`

## Work
- **Mock `eq.ts`:**
  - stateful `EqState` (32-band max), undo/redo stacks, profiles
  - `eq.response {points:256}` computes real RBJ biquad magnitude responses (PK/LSC/HSC/LPQ/HPQ/BP/NO) on a log grid 20 Hz–20 kHz at 48 kHz
  - `eq.spectrum` at 30 Hz only while the subscription has `{spectrum:true}` (32 `Uint8` base64)
  - APO/AutoEQ ParametricEQ text import/export (parser shared with the UI tests)
- **Graph:**
  - one `<canvas>` sized by DPR, redrawn only on change (no rAF loop when idle)
  - curve from `eq.response`; while dragging, the UI draws its own local biquad approximation (same maths module `pages/Equalizer/biquad.ts`, unit-tested against the mock's output ±0.1 dB)
  - node hit radius 24: drag moves freq (x, log) and gain (y); `eq.updateBand` at most once per rAF, last wins; wheel changes Q, Shift+wheel is fine gain; double-click sets 0 dB
  - spectrum drawn behind the curve only while the page is visible
- **Inspector steppers:** type, freq, gain, Q. **11 vertical faders**, or horizontal rows below 720. Effects card (bass, treble, width, crossfeed, limiter + `limiterReductionDb` meter, output). Per-device card (`eq.device.bind`, devices from `player.output.list`). Profile chips + "+ Lưu hồ sơ", rename/delete. Nhập/Xuất APO via `pick_file`/`save_file` → `eq.importFile/exportFile`. AutoEq wizard dialog (`eq.autoeq.search/apply`). Undo/Redo/Reset.
- **Keyboard:** Tab/↑↓ selects a band. With a node selected, ←→ moves 1/12 octave and ↑↓ moves 0.5 dB (Shift: 0.1). Ctrl E opens the page.

## Verify (cheap)
1. Vitest: biquad maths vs reference values, APO parser round-trip, drag → coalesced `updateBand` (≤ 1 per frame).
2. Contract `m2-eq.mjs` green on the mock. M2-3a must pass it on real.
3. Web Playwright E-28…E-33.
4. **Perf proxy:** a node drag over 3 s gives 0 long tasks and no frame > 16.7 ms; idle page with spectrum off → no rAF activity.
5. Screenshots vs MK 8. STATUS line.
