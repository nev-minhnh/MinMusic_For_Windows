# Installer, portable zip, sizes (M5-1)

## Files
| File | Role |
|---|---|
| `src-tauri/tauri.conf.json` (`bundle`) | NSIS only, `installMode: currentUser`, Vietnamese + English, `installerHooks: nsis/hooks.nsh`, `webviewInstallMode: downloadBootstrapper`, resources `../sidecar/dist/{runtime,lib,core.args,core.jsa}` -> `$INSTDIR\core\`, publisher `nev-minhnh`, copyright/description metadata. `version` is numeric `2.0.0`; the pre-release marker lives in `plugins.minmusic.displayVersion` only |
| `src-tauri/nsis/hooks.nsh` | The four Tauri NSIS hooks (below) |
| `src-tauri/nsis/installer-helper.ps1` | Stop processes of an install dir, uninstall the v1 MSI, GUID packing. Embedded in the setup; a copy is kept in `$INSTDIR` for the uninstaller and removed on uninstall |
| `src-tauri/nsis/installer-sandbox.ps1` | Test helper: backs up and restores the per-user registry keys and shortcuts a test install touches |
| `src-tauri/nsis/installer-helper.tests.ps1` | Pester-free unit checks (GUID pairs, product-code lookup, process filter) |
| `src-tauri/nsis/stub-sidecar.ps1` | Empty `sidecar\dist` placeholder so `cargo check` works before the sidecar image exists |
| `scripts/portable.ps1`, `scripts/size.ps1`, `tests/e2e/process/m5-1.ps1` | Portable zip, I1 size check, T-P12 and uninstall/scheme checks |

## What the installer does
- **Install dir:** `%LOCALAPPDATA%\Programs\MinMusic` (no admin). The Tauri 2 template default for `currentUser` is `%LOCALAPPDATA%\MinMusic`, which is also the user-data folder, so `NSIS_HOOK_PREINSTALL` remaps that default (only when no earlier install is registered and the path is still the template default). `/D=<dir>` and the previous install location win. The GUI directory page still pre-fills the template default; the hook remaps it afterwards.
- **PREINSTALL:** stop MinMusic.exe and minmusic-core.exe that live under `$INSTDIR` (graceful `taskkill /PID <pid> /T`, wait 3 s, then `Stop-Process -Force`). Never by bare image name, so another MinMusic elsewhere is left alone. Then uninstall the v1 MSI: look up UpgradeCode `4ce33e04-b190-4983-b1b1-037bdff99a71` in `HKCU\Software\Microsoft\Installer\UpgradeCodes\<packed GUID>`, unpack each value name to a ProductCode, `msiexec /x {code} /qn /norestart`. An MSI uninstall removes only its own files; user data is kept.
- **POSTINSTALL:** copy the helper, register HKCU `minmusic`, `metrolist`, `metrolist-auth` -> `"$INSTDIR\MinMusic.exe" "%1"`.
- **PREUNINSTALL:** stop the processes the same way, remove the three schemes (only if they still point at this exe), delete the helper and `core\`.
- **POSTUNINSTALL:** the template's "Delete app data" checkbox (unticked by default, Vietnamese label "Xoa du lieu ung dung") also removes `%LOCALAPPDATA%\MinMusic` and `%APPDATA%\MinMusic` when ticked and not in update mode. Otherwise data is kept (U-4).
- The template's own `CheckIfAppIsRunning` still runs after the hook as a second guard.

## Portable zip
`powershell -File scripts\portable.ps1` -> `dist\MinMusic-<displayVersion>-portable-x64.zip` with `MinMusic.exe`, `core\{runtime,lib,core.args,core.jsa}`, `portable.flag`. Contract: with `portable.flag` next to the exe the shell sets `MINMUSIC_PORTABLE=1` and the core uses `<exe dir>\data` as XDG base; never auto-updated.

## Checks
- Unit: `powershell -File src-tauri\nsis\installer-helper.tests.ps1`.
- Bundle (INT-W2 only): `cargo tauri build --target x86_64-pc-windows-gnu --bundles nsis`, then `scripts\size.ps1`, then `tests\e2e\process\m5-1.ps1`.
- Test safety: the setup is run only with `/D=<repo>\.testdata\...` and `MINMUSIC_DATA_ROOT`. Setup also writes per-user keys/shortcuts shared with a real install, so the scripts back them up and restore them. `MINMUSIC_INSTALLER_SKIP_V1=1` (set by the scripts) makes the helper skip the v1 uninstall; `m5-1.ps1 -AllowV1Uninstall` turns that off (default off). U-1 runs in M5-4 on a separate Windows user.

## Sizes (I1: setup <= 100 MB, installed <= 280 MB)
Measured on the current M0 sidecar image: runtime 76 MB + lib 169 MB + core.jsa 49 MB = about 294 MB, plus MinMusic.exe about 9 MB (GNU release) = about 303 MB installed, which is over the 280 MB limit. Deflate of the same files is 222 MB (portable zip 225 MB); LZMA setup is expected at about 180-210 MB, over the 100 MB limit. The jars and the CDS archive barely compress. `size.ps1` exits 1 on a breach. Levers for the core side: trim jars (skiko 43 MB, ffmpeg 29 MB, shared-desktop 25 MB), a smaller jlink image, and building `core.jsa` on first run instead of shipping it (49 MB).
