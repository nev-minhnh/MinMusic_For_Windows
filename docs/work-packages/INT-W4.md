# INT-W4: Wave 4 integration = M3 acceptance

Follow `integration.md`. **Start when** M3-2, M3-4a, M4-1a, M3-4b, M4-2b and M4-3b are done.

## Merge order
- **Kotlin:**
  1. `feat/desktop-core-m4-1a` (shared `Settings` registry, `w2FirstRunDone`)
  2. `feat/desktop-core-m3-2`
  3. `feat/desktop-core-m3-4a`

  **Main build:** `:desktopCore:test :desktopCore:sidecarImage :desktopApp:compileKotlinJvm :shared:desktopTest :androidApp:compileDebugKotlin` (M4-1a touched commonMain).
- **Windows:**
  1. `wp/M4-1a` (shell `settings_link`; replaces the `shell.json` stand-ins)
  2. `wp/M3-4b`
  3. `wp/M4-2b`
  4. `wp/M4-3b`

  Wiring you add as one-liners:
  - the `menus/ext/*.ts` glob in M1-3a's menus (for the download submenu)
  - the `startup/*.ts` glob in `App`
  - the `DownloadsBox` mount in Library

## Extra checks
1. **Contract on real:** `m3-accounts`, `m3-dc-lt`, `m4-settings` (the schema key diff vs the mock fixture must be empty, or explained), plus all earlier suites.
2. **Security:**
   - R-SEC-3: NCT and Last.fm test logins with dummy credentials. `rg -a "<test password>" .testdata/` → nothing; `secrets.properties` is not plaintext.
   - R-SEC-2 contract checks.
   - The webLogin data dir is deleted.
3. **Shell settings:** toggle `minimizeToTrayOnClose` via `settings.set` → × quits (T-P9). `desktopTaskbarButtons` off → buttons removed. `desktopMiniPlayerOnMinimize` → mini opens on minimise.
4. **PO token through the shell:** play a YouTube track that needs a PO token with `ShellPoTokenRuntime` (log shows `shell.po.evaluate` used, no bgutil download).
5. **Manual items for Minh (list them in STATUS):** Google login + a signed-in-only track, Zing VIP 320 with and without VIP, NCT login, Device Connect pairing with Android 1.0.2 (QR, SAS, control both ways, transfer), Listen Together host and guest, a Last.fm scrobble.

## Acceptance = M3 gate
- YouTube login + a signed-in-only track.
- Zing VIP shows 320 only with VIP.
- The NCT password grep test.
- Pairing with Android 1.0.2 (manual).
