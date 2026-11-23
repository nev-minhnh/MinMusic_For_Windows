# Release process (MinMusic for Windows v2)

Releases are built by GitHub Actions on `windows-latest` with MSVC (`x86_64-pc-windows-msvc`). Actions are used for releases only: `release.yml` runs on a `v*.*.*` tag or a manual dispatch, and `ci.yml` is a manual dry run. Nothing runs on push or pull request. The GNU build used for local work is never shipped.

Releases are **not Authenticode-signed** (owner decision; SmartScreen shows "Unknown publisher"). In-app updates are verified with a **minisign** key (Tauri updater).

## 1. Secrets and keys (repo `nev-minhnh/MinMusic_For_Windows`, Settings -> Secrets and variables -> Actions)

| Secret | Used by | Notes |
|---|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | `cargo tauri build` | minisign private key (file content or path) from `cargo tauri signer generate`. Required; the release fails early when empty |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | `cargo tauri build` | password of that key; set it (empty string only if the key has none) |
| `LASTFM_API_KEY`, `LASTFM_SECRET` | sidecar Gradle build | optional (W6): without them Last.fm scrobbling stays off; same values as the MinMusic builds when set |
| `LYPRIO_BASE_URL`, `LYPRIO_HMAC_KEY` | sidecar Gradle build | optional (W6), but both or neither; same values as the MinMusic builds when set |

`GITHUB_TOKEN` is provided by Actions; only the `publish` job gets `contents: write`. `BRIDGE_TOKEN` (PAT) belongs to the manual `bridge.yml` job (M5-2), not to this workflow.

The public key goes into `src-tauri/tauri.conf.json` `plugins.updater.pubkey` (done at INT-W5). `scripts/ci/check-tag.mjs` fails the release while that value is missing or a placeholder, and when `bundle.createUpdaterArtifacts` is not `true`. The key was generated at W6 (2026-11-23); the private key and its password are kept outside the repo in `D:\Coding_Project\MinMusic-secrets\` (owner-only ACL) and set as the two repository secrets. See `scripts/gen-updater-key.md` (M5-2). Never commit a private key. Losing the key means existing installs can no longer verify updates, so keep a backup.

## 2. Cut a release

1. On `main`, with everything merged and the tree clean, decide the version `X.Y.Z` (or `X.Y.Z-rc.N` for a release candidate).
2. Set the same version in `src-tauri/tauri.conf.json` (`version`) and the root `package.json` (`version`). Keep `src-tauri/Cargo.toml` in step.
3. Make sure the submodule `core/MinMusic` points at the intended commit on `feat/desktop-core` (`git -C core/MinMusic log -1`), and that `git add core/MinMusic` is part of the release commit. The workflow builds exactly the recorded SHA.
4. Optional dry run: Actions -> "CI (manual dry run)" -> pick the branch. It runs the no-ads check, the sidecar build, unit tests and the real-core contract tests, with no installer and no publish.
5. Commit (`chore(release): vX.Y.Z`), push `main`, then tag and push the tag:
   ```
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```
   The tag must equal `v` + the `tauri.conf.json` version, otherwise the workflow stops at the tag check.
6. Watch the run. On success the release `vX.Y.Z` contains:
   - `MinMusic-X.Y.Z-windows-x64-setup.exe` and `.sig`
   - `MinMusic-X.Y.Z-portable-x64.zip`
   - `*.sha256` for the setup and the zip
   - `latest.json` (updater manifest)
   A tag with a `-` (for example `-rc.1`) is published as a **prerelease** and not as "latest", so the updater endpoint (`releases/latest/download/latest.json`) keeps serving the previous stable release.
7. Manual re-run for an existing tag (for example after a flaky runner): Actions -> Release -> Run workflow -> enter the tag. An existing release is updated in place (`--clobber`).

## 3. What the workflow checks

1. `scripts/check_no_ads.sh`: no ad/analytics SDK in the submodule Gradle files or the manifests, and no `analytics|telemetry|sentry.io|google-analytics|gtag` in `ui/src` or `src-tauri/src` (R-SEC-5).
2. Tag equals `tauri.conf.json` and `package.json` version; updater pubkey is real; updater artifacts are enabled.
3. All required secrets are non-empty.
4. `npm test` and `node tests/contract/run.mjs --target real --suite all --offline` (no live network in CI).
5. `scripts/size.ps1` fails the release on an I1 breach (setup over 100 MB or installed over 280 MB).

## 4. Rollback

- A bad release that is **not yet "latest"** (prerelease): delete it and the tag (`gh release delete vX.Y.Z --cleanup-tag`).
- A bad **stable** release: the updater follows `releases/latest`. Quickest fix is to mark the previous good release as latest (`gh release edit vPREV --latest`) or, if installs already updated, publish a fixed higher version (`vX.Y.Z+1`); updaters never downgrade. Then mark or delete the bad release.
- Do not move or reuse a published tag. Use a new patch version.
- If `latest.json` is wrong but the binaries are fine: fix the asset with `gh release upload vX.Y.Z latest.json --clobber`.

## 5. Notes for maintainers

- All third-party actions are pinned by commit SHA (the tag is in a comment). Bump them deliberately.
- Node 26, JDK 25 (Temurin), Rust stable, `tauri-cli` `^2` (installed with `cargo install --locked`, cached with `Swatinem/rust-cache`).
- `scripts/make-latest-json.mjs` (M5-2) is called as `--version --tag --setup --sig --notes-file --repo --out`; keep the interface in step with `release.yml`.
- `--offline` and `MINMUSIC_OFFLINE=1` tell the real-core contract run not to use the live network; the suites already use `tests/fixtures`.
