# M5-1: NSIS installer, portable zip, sizes

**Wave 2** (may start any time; no Kotlin). **Agent:** Sonnet. Conventions apply.
- **Worktree:** `…-wp\M5-1`, branch `wp/M5-1`.
- Owns `src-tauri/tauri.conf.json` in wave 2 (the `bundle` section only).

Read first:
- `docs/architecture.md` §3.3 (installer and updater), §7 (bundles, portable, resources, sizes), open question 2
- `docs/test-guide.md` §3 T-P12, §7 U-1/U-4
- `scripts/size.ps1`

## Owned paths
- `src-tauri/nsis/**`
- `src-tauri/tauri.conf.json` (`bundle` only: `targets: ["nsis"]`, `nsis.installMode: "currentUser"`, languages Vietnamese + English, `installerHooks: "nsis/hooks.nsh"`, `webviewInstallMode: downloadBootstrapper`, `resources`: `../sidecar/dist/{runtime,lib,core.args,core.jsa}` → `core/`, publisher `nev-minhnh`, version metadata)
- `scripts/{portable.ps1,size.ps1}`
- `tests/e2e/process/m5-1.ps1`
- `docs/release/installer.md`

## Work
| Item | Content |
|---|---|
| `nsis/hooks.nsh` | **`NSIS_HOOK_PREINSTALL`:** graceful `taskkill /IM MinMusic.exe /T`, wait 3 s, then force-kill both `MinMusic.exe` and `minmusic-core.exe`. The force-kill is **restricted to `$INSTDIR`**, through PowerShell `Get-Process | ? Path -like "$INSTDIR*" | Stop-Process -Force` (never by bare image name outside the install dir). Then uninstall v1: look up the ProductCode for UpgradeCode `4ce33e04-b190-4983-b1b1-037bdff99a71` in the per-user MSI registry (`HKCU\Software\Microsoft\Installer\UpgradeCodes\<packed GUID>`; write the GUID-packing helper in NSIS or PowerShell), then `msiexec /x {code} /qn` (no admin). **POSTINSTALL:** register the HKCU URL schemes `minmusic`, `metrolist` and `metrolist-auth` → `"$INSTDIR\MinMusic.exe" "%1"`. **PREUNINSTALL:** stop processes the same way; remove the schemes; keep user data unless the "Xoá dữ liệu" checkbox is ticked (custom page) |
| Version | `src-tauri/tauri.conf.json` numeric `2.0.0`; the pre-release marker lives in `app.info` only |
| `scripts/portable.ps1` | From the release build output: `MinMusic.exe` + `core\` + `portable.flag` → `MinMusic-<ver>-portable-x64.zip`. Document that the shell sets `MINMUSIC_PORTABLE=1` and the core uses `<exe dir>\data` (the core side is checked at INT-W2; if it is missing, write the needed change into STATUS for M4-3a) |
| `scripts/size.ps1` | Reports the setup size, the installed size (sum of the install dir after a silent install into `.testdata\install-<id>` with `/D=`), the sidecar dist, and the zip. Report only: it prints the sizes and exits 0 (size targets dropped 2026-11-23) |
| `tests/e2e/process/m5-1.ps1` | **T-P12:** silent install into a test dir, start it with a test data root, run the installer again `/S` while running → both processes stopped before replacement, install succeeds, app starts. Also: uninstall keeps the data dir; the schemes are registered and then removed. Run this **only** with `/D=<.testdata dir>` and `MINMUSIC_DATA_ROOT`. Do **not** run the v1 uninstall path on this PC: guard it behind `-AllowV1Uninstall`, default off. U-1 runs in M5-4 on a separate Windows user |

## Verify (cheap)
1. NSIS script lint: `makensis /NOCD /HDRINFO` is not available without a bundle build, so review the hooks against the Tauri 2 NSIS template hook names (`NSIS_HOOK_PREINSTALL`, `NSIS_HOOK_POSTINSTALL`, `NSIS_HOOK_PREUNINSTALL`, `NSIS_HOOK_POSTUNINSTALL`) and quote the template source lines in the report.
2. `cargo check` (`tauri.conf.json` must parse: `cargo check` runs `tauri-build`).
3. Pester-free PowerShell unit check of the GUID-packing function against 3 known pairs.
4. **INT-W2 runs the real bundle:** `cargo tauri build --target x86_64-pc-windows-gnu --bundles nsis`, then `scripts/size.ps1` and `m5-1.ps1`. STATUS line.
