# Updater keys and secrets (M5-2) — for Minh, do this once

Nothing in the repo contains a real key. The updater is wired and unit-tested; it stays inert until the steps below are done.
Update integrity is a Tauri **minisign** signature (not Authenticode): the app verifies every downloaded setup against the public key baked into `tauri.conf.json`.

## 1. Generate the updater key (once, on your machine, not in CI)

```powershell
cargo tauri signer generate -w "$env:USERPROFILE\.tauri\minmusic-updater.key"
```

- Type a password when asked (or leave it empty; then the password secret below is empty too).
- It writes two files: `minmusic-updater.key` (**private**) and `minmusic-updater.key.pub` (public).
- **Back up the private key and the password somewhere safe (password manager).** Losing it means existing installs can never be updated again, because they only trust this public key. Never commit it, never paste it into an issue or chat.

## 2. Repository secrets (Settings > Secrets and variables > Actions, repo `nev-minhnh/MinMusic_For_Windows`)

| Secret | Value | Used by |
|---|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | the **content** of `minmusic-updater.key` (the file text, one base64 line) | `release.yml` (M5-3): `cargo tauri build` signs the setup and writes `<setup>.sig` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | the password from step 1 (empty if none) | same |
| `BRIDGE_TOKEN` | fine-grained PAT, see section 4 | `bridge.yml` only |

## 3. Public key into the app (INT-W5)

Put the content of `minmusic-updater.key.pub` (one base64 line, the file's text as is) into `src-tauri/tauri.conf.json` -> `plugins.updater.pubkey`, replacing `REPLACE_AT_INT_W5`. The public key is not secret.

Until then:
- `node scripts/make-latest-json.mjs --check-config` **fails** on purpose (placeholder pubkey). Run it at INT-W5 and before the first tag; the release workflow can call it as a gate.
- In the app, every update check ends in the error state "updater public key is not configured". Nothing is downloaded.

`tauri.conf.json` already sets, and `--check-config` enforces:
- `plugins.updater.endpoints = ["https://github.com/nev-minhnh/MinMusic_For_Windows/releases/latest/download/latest.json"]` (the only host the app talks to for updates),
- `requireSignedVersion: true` (the signature's trusted comment carries the version, so a crafted `latest.json` cannot pair a new version number with an old signed setup; `make-latest-json.mjs` checks the same thing),
- `bundle.createUpdaterArtifacts: true` (so `cargo tauri build` emits `<setup>.sig`; it needs `TAURI_SIGNING_PRIVATE_KEY` in the environment).

**Local and integration builds without the private key** (INT-W5 `cargo tauri build --features e2e`) must pass
`--config tests/fixtures/updater/e2e.tauri.conf.json`: it turns `createUpdaterArtifacts` off and allows the loopback `http://` test endpoint. Never use that file for a release.

## 4. `BRIDGE_TOKEN` (v1 bridge release)

v1.0.x apps read `nev-minhnh/MinMusic` releases tagged `windows-vX.Y.Z`. `bridge.yml` (manual `workflow_dispatch`, input `tag` = the v2 release tag, e.g. `v2.0.0`) copies the v2 setup of that finished release to the MinMusic repo as release `windows-v2.0.0` with the single asset `MinMusic-2.0.0-windows-x64-setup.exe`, not draft, not pre-release, not "latest".

Create the token at GitHub > Settings > Developer settings > Fine-grained personal access tokens:
- Resource owner `nev-minhnh`, **Only select repositories: `MinMusic`**.
- Repository permissions: **Contents: Read and write**. Nothing else.
- Short expiry (90 days) is fine; the job runs once per major release. Store it as the secret `BRIDGE_TOKEN` in `MinMusic_For_Windows`.

Run it only after the v2 release (`release.yml`) is published and checked. `dry_run: true` validates the download and checksum and publishes nothing. The job refuses to touch an existing `windows-vX.Y.Z` release; delete it by hand first if one must be replaced. It verifies afterwards that the published release has exactly the one asset v1's updater expects.

## 5. Day-to-day

- Release: `release.yml` builds, signs, runs `make-latest-json.mjs` and uploads `latest.json` next to the setup. `releases/latest/download/latest.json` therefore always points at the newest non-pre-release release; pre-releases are `--latest=false` and are not seen by the updater endpoint (the "pre-release" channel setting only matters for a release that is marked latest and carries a pre-release version).
- The `.sig` asset is uploaded next to the setup but the app reads the signature from `latest.json`.
- Key rotation is a breaking change: ship one release signed with the old key whose `pubkey` is the new one, then switch the secret.
