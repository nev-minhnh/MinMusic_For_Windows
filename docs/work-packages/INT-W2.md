# INT-W2: Wave 2 integration = M1 acceptance

Follow `integration.md`. **Start when** M1-2b, M1-3b, M1-3c, M1-3d, M2-2 and M5-1 are done.

## Merge order
- **Kotlin:** `feat/desktop-core-m1-2b`. Expected conflict: `api/m0/M0Module.kt`; take M1-2b's version.
- **Windows:**
  1. `wp/M2-2` (touches the mock queue/lyrics handlers and the player shell)
  2. `wp/M1-3c`
  3. `wp/M1-3d`
  4. `wp/M1-3b`
  5. `wp/M5-1`

  Expected conflicts:
  - `components/pages/CollectionHeader` (M1-3d) vs a private copy in M1-3c: keep M1-3d's and switch M1-3c to it.
  - The `m1-3*` i18n files never conflict; `gen-strings` fails on duplicate keys, so rename the later one.

## Extra checks
1. Contract `--target real --suite all` with the seed: `m1-library` is now green, `m1-browse`/`m1-queue` stay green, `m2-player` runs (methods M2-1 will add are known failures owned by M2-1).
2. **App e2e:** E-1…E-12 all green (specs `m1-foundation`, `m1-3b`, `m1-3c`, `m1-3d`), E-20…E-27 against real where the core supports it.
3. **Perf**, both sizes, 3 runs, with the full M1 pages: P1–P5 and P7, P8 must meet the milestones.md table. P3 with the real Artist page.
4. **Bundle:** `cargo tauri build --target x86_64-pc-windows-gnu --bundles nsis`, then `scripts/size.ps1` (I1 measured early), then `tests/e2e/process/m5-1.ps1` (T-P12) into a test dir.
5. **Manual-QA screenshots** for Minh (test-guide §6 M1): Home, Search, Library and pages at 1920×1200 and 1280×800, light theme, VI/EN. Put them in `.testdata\INT-W2\qa\`, with an index listed in STATUS.

## Acceptance = M1 gate (milestones.md)
All M1 contract tests pass on the real sidecar; E-1…E-12 pass; P1–P5 pass. Sizes are reported only (no size criterion since 2026-11-23).
