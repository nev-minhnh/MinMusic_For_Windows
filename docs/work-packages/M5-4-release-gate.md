# M5-4 / W6: Full regression, upgrade tests, release candidate (release gate)

**Wave 6. Agent:** Opus (it acts as the final integration owner; follow `integration.md` for the build/test steps).
- **Worktree:** `…-wp\M5-4`, branch `wp/M5-4` from `main` after INT-W5.
- **Ports:** 5198 / 48018.

Read first:
- `docs/milestones.md` (the perf table, release gate)
- `docs/test-guide.md` (all; §6 M5 checklist, §7 U-1…U-4, §8 R-SEC)
- `docs/architecture.md` §7

## Steps
1. **Image build:** 1 Gradle `sidecarImage` from `feat/desktop-core` (≤ 1 fix build) and the GNU e2e build. Then run **everything**: unit, contract mock + real + live, web + app e2e, process T-P1…T-P12, R-SEC-1…5.
2. **Perf, the full table:** P1–P8 at both sizes with 5 runs (worst counts), S1/S2 with 10 launches each, S3 vs v1.0.2 (measure v1.0.2 S3 on the same track with the v1 app under a **separate Windows test user**), R1/R2 (`tools/perf/resources.ps1`), C1 (60 s lyrics), I1 (`scripts/size.ps1`). Write `docs/perf/M5-report.md`.
3. **CI dry run:** run `ci.yml` via `gh workflow run ci.yml --ref wp/M5-4` and fix failures. Then tag `v2.0.0-rc.1` (pre-release) to exercise `release.yml` end-to-end on MSVC.
4. **Upgrade tests**, on a **separate Windows user account** created for QA (never Minh's account; ask the coordinator to create it if it does not exist; do not create accounts yourself): U-1 (v1.0.2 MSI → v2 setup), U-2 (v1 updater → bridge build, using a test bridge release in a fork or the rc), U-3 (rc.1 → rc.2 via the updater while playing), U-4 (uninstall keeps data).
5. **Manual QA checklist:** prepare `docs/qa/M5-checklist.md` from test-guide §6 M0–M5 with screenshots where automatable. Device Connect with Android 1.0.2, Zing VIP, NCT and Google logins are marked "Minh" and listed in the report for him.
6. **Gate report** (`docs/qa/release-gate.md`): every P/S/R/C/I target with its measured value and pass/fail, U-1…U-4, R-SEC, open known failures. **The coordinator, not this agent, tags `v2.0.0`** after Minh's manual items.

## Owned paths
`docs/perf/M5-report.md`, `docs/qa/**`, fixes anywhere (as the integration owner), with a commit per fix.

## Done
The gate report is pushed and the rc release exists. STATUS line: "M5-4 gate: <n> pass / <m> fail, manual items for Minh: …".
