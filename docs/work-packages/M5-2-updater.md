# M5-2: Updater (latest.json, minisign), Updates settings page, v1 bridge job

**Wave 5.** **Agent:** Sonnet. Conventions apply.
- **Worktree:** `…-wp\M5-2`, branch `wp/M5-2`.
- **Ports:** 5197 / 48017.
- Owns `tauri.conf.json` `plugins.updater` in wave 5.

Read first:
- `docs/architecture.md` §3.3 (installer/updater quit path), §7 (updater, channels, portable never auto-updates, bridge), open question 3
- `docs/api.md` §3.15 `update.status`, §6 (`update_check/status/install`)
- `docs/test-guide.md` §7 U-2, U-3

## Owned paths
- `src-tauri/src/update/**`, the `M5-2` blocks in `main.rs`, `src-tauri/capabilities/m5-2.json`
- `tauri.conf.json` (`plugins.updater`: endpoint `https://github.com/nev-minhnh/MinMusic_For_Windows/releases/latest/download/latest.json`, `pubkey`)
- `ui/src/pages/Settings/Updates/**` (category order 120)
- `ui/src/i18n/extra/{en,vi}/m5-2.json`
- `.github/workflows/bridge.yml`
- `scripts/{make-latest-json.mjs,gen-updater-key.md}`
- `tests/e2e/app/m5-2.spec.ts`, `tests/fixtures/updater/**`

## Work
- **Rust `update/`:**
  - commands `update_check`, `update_status` (→ the `update.status` shape), `update_install`
  - hourly background check gated by the settings `checkForUpdates` and `updateChannel` (read over corelink `settings.get` after INT-W4; `shell.json` fallback before)
  - **Install path:** download → `quit_for_update()` = the normal graceful quit (stdin shutdown, wait ≤ 3 s, terminate) → run the installer. Never call `app.restart()`.
  - Portable builds (`portable.flag`) never auto-update; Updates shows a "Mở trang phát hành" button.
  - While hidden in the tray, `update.available` shows a tray balloon (via M1-4's tray module API).
  - The endpoint is overridable in e2e builds by `MINMUSIC_UPDATER_ENDPOINT` (compiled out of release).
- **Keys:** document generating the minisign key (`cargo tauri signer generate`) and storing `TAURI_SIGNING_PRIVATE_KEY` (+ password) as repo secrets. **Do not generate or commit any key**; Minh does it. The pubkey goes into `tauri.conf.json` at INT-W5. Use a placeholder plus a failing check until then.
- **`scripts/make-latest-json.mjs`:** builds `latest.json` from the release assets (version, notes, `pub_date`, the `windows-x86_64` url + signature).
- **`bridge.yml`:** manual `workflow_dispatch(tag)` that copies the v2 setup as `MinMusic-2.0.0-windows-x64-setup.exe` to `nev-minhnh/MinMusic` release `windows-v2.0.0` (needs a PAT secret `BRIDGE_TOKEN`; document it).
- **Updates page:** channel, auto-check, "Kiểm tra cập nhật", state/progress, notes (Markdown rendered as plain paragraphs, no HTML), install button.

## Verify (cheap)
1. `cargo check` + `cargo test`: `latest.json` parsing, the version comparison incl. pre-release, the portable gate, and the quit-for-update sequence with a mock supervisor.
2. `node scripts/make-latest-json.mjs --selftest`.
3. **Spec for integration:** `tests/e2e/app/m5-2.spec.ts` U-3-local. Serve `tests/fixtures/updater/latest.json` + a signed test setup from a local HTTP server, signed with a **throwaway test key** generated at test time in `.testdata`. Use the `MINMUSIC_UPDATER_ENDPOINT` override. Check update → graceful quit → the new version starts → queue restored. STATUS line.
