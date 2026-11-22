# M5-3: Release workflow (MSVC), no-ads check, contract tests in CI

**Wave 5.** **Agent:** Sonnet. Conventions apply.
- **Worktree:** `…-wp\M5-3`, branch `wp/M5-3`.

Read first:
- `docs/architecture.md` §7 (workflow steps 1–10, MSVC on `windows-latest`, secrets `LASTFM_*`, `LYPRIO_*`, signing key), §9 (no ads/telemetry)
- `docs/test-guide.md` §2, §8 (R-SEC-5)

## Owned paths
- `.github/workflows/{release.yml,ci.yml}`
- `scripts/check_no_ads.sh` (copy from `D:\Coding_Project\MinMusic\scripts\check_no_ads.sh`, extend to `ui/src` + `src-tauri/src`)
- `scripts/ci/**`
- `docs/release/release-process.md`

## Work
- **`release.yml`** on tag `v*.*.*`, `windows-latest`:
  1. checkout with submodules (recursive)
  2. `scripts/check_no_ads.sh` + the R-SEC-5 grep
  3. verify the tag equals `tauri.conf.json` `version`
  4. Temurin JDK 25 + Gradle cache, then `./gradlew :desktopCore:sidecarImage -PsidecarOut=../../sidecar/dist` in `core/MinMusic` (env from the secrets)
  5. Node 26, `npm ci`, `npm run build`
  6. `npm test` + `node tests/contract/run.mjs --target real --suite all --offline` (no live network in CI)
  7. Rust stable MSVC, `cargo tauri build --target x86_64-pc-windows-msvc --bundles nsis` with `TAURI_SIGNING_PRIVATE_KEY`(+ `_PASSWORD`)
  8. `scripts/portable.ps1`
  9. sha256 files + `node scripts/make-latest-json.mjs`
  10. `scripts/size.ps1` (fail on an I1 breach)
  11. `gh release create` with the setup, zip, sig and `latest.json`
- **`ci.yml`** (manual `workflow_dispatch` only; Actions are for releases): the same up to step 6, without a release. It is used by W6 for a dry run on a branch.
- **Pin every action by commit SHA.** Concurrency group per tag. Least-privilege `permissions: contents: write` only on the release job.
- **`release-process.md`:** how to cut a release (bump version in `tauri.conf.json`, submodule sha, tag), the secret list, a rollback note.

## Verify (cheap)
1. `actionlint` (download the binary to `.testdata`, never globally) on both workflows.
2. `bash scripts/check_no_ads.sh` passes locally.
3. Dry-run all script steps that do not need MSVC or secrets locally: tag/version check and the `make-latest-json` self-test. The real run happens in W6 via `ci.yml` and an RC tag. STATUS line.
