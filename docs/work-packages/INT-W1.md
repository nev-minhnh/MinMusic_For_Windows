# INT-W1: Wave 1 integration

Follow `integration.md`. **Start when** M1-1, M1-2a, M1-3a, M1-4, M1-5 and M3-1 have all posted "done" in STATUS.md.

## Merge order
**Kotlin** (`MinMusic-wt-int-w1`, branch `int/w1` from `feat/desktop-core`):
1. `feat/desktop-core-m1-1`
2. `feat/desktop-core-m1-2a`

The only expected conflict is in `SidecarMain.kt` imports. M1-2a replaced the registration with `ApiRegistry.load()`; keep that. M1-1's `AppEvents` and M1-2a's use of it must match the signature in M1-1's brief.

**Main build:** `:desktopCore:test :desktopCore:sidecarImage :desktopApp:compileKotlinJvm :desktopApp:jvmTest :shared:desktopTest :androidApp:compileDebugKotlin`. M1-1 touched `shared/desktopMain`.

**Windows** (`INT-W1`):
1. `wp/M1-5`
2. `wp/M1-3a`
3. `wp/M1-4`
4. `wp/M3-1`

Expected conflicts:
- `main.rs` marked blocks: M1-4 created the markers, M3-1 filled its block after merging M1-4 stage 1. That should be clean.
- `ui/src/core/**` (M1-5) vs. the M1-3a type shim: take M1-5's client and fix the shim imports.

## Extra checks this wave
1. **Class-load audit** of the new image: 0 classes from skia/skiko/compose.ui/foundation/material/animation/coil3, measured as in M1-1 step 0.
2. **Sizes:** `sidecar/dist` ≤ 200 MB, the 7-Zip `-mx9` proxy ≤ 90 MB, warm READY ≤ 900 ms (5 runs).
3. **Contract:** `--target real --suite m0,m1-browse,m1-queue` green, live included. That includes the **auto-advance** test (3 runs in a row). `m1-library` on real is expected to fail until wave 2 (M1-2b); record it as known.
4. **v1 safety:** `desktopApp` `SwingMainDispatcherTest` green.
5. **App e2e:**
   - `m1-foundation` (E-5, E-7, E-8, E-11, E-12; E-8 uses mock data in the web project, real in app)
   - `m1-4` (tray, `shell.json`, deep link `mm-nav`, SMTC title)
   - `m3-1` (webLogin fixture, PO evaluate)
   - process T-P1…T-P11
6. **Snap Layouts:** hover the maximise button on the real app → the Snap flyout appears (manual look plus screenshot). Record which approach M1-4 shipped.
7. **Perf:** P1, P3, P4, P5 at both sizes must not regress against `docs/perf/results.md` M0 rows.

## Acceptance (W1)
- Every item above passes, or is listed as a known failure with an owner WP in a later wave.
- `main` and `feat/desktop-core` are pushed. The submodule points at the merged core.
