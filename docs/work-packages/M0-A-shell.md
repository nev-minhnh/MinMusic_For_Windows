# M0-A: Tauri shell, sidecar supervisor, test hooks

**Agent:** Sonnet. **Branch:** `wp/M0-A` in `D:\Coding_Project\MinMusic_4_Windows`.

Read first:
- `docs/architecture.md` §3.3, §4, §7, §10
- `docs/api.md` §1.3 and §6

## Goal
`MinMusic.exe` (Tauri 2) does the following:
- spawns the sidecar in a Job Object
- passes the token over stdin and reads `READY`
- injects `window.__MM_CORE__`
- shows the UI (`ui/` dev server in dev, `ui/dist` in build)
- supervises the core (health, restart) and quits cleanly with no orphan
- has the test hooks
- builds on the **GNU** toolchain

## Owned paths
- `src-tauri/**`
- `.gitmodules` + the submodule `core/MinMusic` (add it: `git submodule add https://github.com/nev-minhnh/MinMusic.git core/MinMusic`, checkout branch `windows` HEAD)
- `scripts/dev.ps1`
- root `package.json` (npm workspaces `ui`, `protocol`, `mock-core`; scripts only)
- `.gitignore`

## Environment
```bash
source D:/Coding_Project/MinMusic-notes/tools/rust-env.sh   # cargo; rustup default must be stable-x86_64-pc-windows-gnu
export PATH="/c/TDM-GCC-64/bin:$PATH"                         # gcc + windres for the GNU target
cargo install tauri-cli --version "^2" --locked               # into the portable CARGO_HOME
```

**Day-1 check, report it first:**
- Run `cargo tauri build --target x86_64-pc-windows-gnu --bundles nsis` on the bare template.
- If it fails, try `--no-bundle` and record the exact error.
- If linking itself fails, stop and report. The fallback is VS Build Tools, which is Minh's decision.

## Files to create
| File | Content |
|---|---|
| `src-tauri/Cargo.toml` | crate `minmusic-shell`; deps: `tauri@2` (features `tray-icon`), `tauri-plugin-single-instance`, `tauri-plugin-log`, `tauri-plugin-dialog`, `windows` (features `Win32_System_JobObjects`, `Win32_System_Threading`, `Win32_Foundation`, `Win32_Security`, `Win32_UI_WindowsAndMessaging`, `Win32_UI_Shell`), `tokio`, `tokio-tungstenite`, `serde_json`, `rand`. Feature `e2e = []` |
| `src-tauri/tauri.conf.json` | identifier `nev-minhnh.MinMusic`, productName `MinMusic`, version `2.0.0-alpha.0` → NSIS needs numeric, so use `2.0.0` and keep the alpha marker in `app.info`. Main window `main` 1280×800, min 640×480, `decorations:false`, `visible:false` (shown after the first UI paint signal `ui_ready`). Dev URL `http://localhost:5173`, frontendDist `../ui/dist`. CSP per architecture §9 |
| `src-tauri/src/main.rs` | builder, plugins, commands from api.md §6 that M0 needs: `window_minimize`, `window_toggle_maximize`, `window_close`, `window_start_drag`, `app_quit`, `core_status`, `ui_ready`, `log_ui`; e2e only: `test_set_window_size` |
| `src-tauri/src/sidecar/job.rs` | `JobObject::new_kill_on_close()`, `assign(handle)`; `Drop` closes the handle |
| `src-tauri/src/sidecar/spawn.rs` | `CreateProcessW` suspended + no window, stdin/stdout pipes, `AssignProcessToJobObject`, `ResumeThread`; writes the token line; reads the `READY {...}` line with a 15 s timeout; routes the remaining stdout/stderr to `core-stdout.log` |
| `src-tauri/src/sidecar/supervisor.rs` | state machine `Starting → Ready → Restarting → Failed`; exit watcher thread; shell ws client (`sys.hello role=shell`, `sys.ping` every 5 s, 3 misses = dead); back-off 0.5/2/5 s; 3 crashes in 120 s → Failed; emits the Tauri event `core-status` |
| `src-tauri/src/sidecar/shutdown.rs` | `graceful_quit()`: hide windows → `{"cmd":"shutdown"}` on stdin → wait ≤ 3 s → `TerminateProcess` → drop job → `app.exit(0)` |
| `src-tauri/src/sidecar/stale.rs` | read `core.pid`; if the pid is alive, the image path equals our `minmusic-core.exe` and the creation time equals `startTimeMs` ±1 s, kill it; delete the file |
| `src-tauri/src/session_end.rs` | `SetWindowSubclass` on the main hwnd; `WM_QUERYENDSESSION` → `ShutdownBlockReasonCreate` + TRUE; `WM_ENDSESSION(TRUE)` → `graceful_quit` synchronously (≤ 3 s) |
| `src-tauri/src/paths.rs` | resolves the sidecar dist (dev: `<repo>/sidecar/dist`; installed: `<exe dir>/core`), data root, and log dir; applies `MINMUSIC_DATA_ROOT` (sets the child env `LOCALAPPDATA`/`APPDATA`) |
| `src-tauri/src/testhooks.rs` | `#[cfg(any(debug_assertions, feature="e2e"))]`: `MINMUSIC_DEVTOOLS_PORT` → `additional_browser_args`; `MINMUSIC_TEST_PIDFILE`; `MINMUSIC_TEST_NO_JOB`; `MINMUSIC_CORE_EXTRA_ARGS` |
| `src-tauri/src/core_config.rs` | Tauri command `core_config` → `Promise<{port,token,artToken}>`. It resolves once READY arrives, and again after each restart through the event `core-status`. The command is allowed only for the `main` and `mini` windows via a capability file (`src-tauri/capabilities/main.json`). The window is created immediately at launch and is **not** gated on READY: the UI paints cached Home first (S1 ≤ 700 ms), then the UI client awaits `core_config` and sets `window.__MM_CORE__` |
| `scripts/dev.ps1` | starts `mock-core` (unless `-Real`) and `cargo tauri dev` with test env vars set to `.testdata\dev` |

- The single-instance plugin callback focuses `main` and forwards argv (deep links come later, in M1).
- Single-instance key: the identifier, or the hashed variant under `MINMUSIC_DATA_ROOT` (architecture §10).

## Interfaces you consume
- Sidecar CLI and stdin/stdout contract: architecture §3.3. Until M0-B lands, use a **fake core**: `mock-core` started as `node mock-core/bin/sidecar.mjs`, which speaks the same stdin/READY contract (M0-D provides it). Configure it with `MINMUSIC_SIDECAR_CMD`, honoured only in debug/e2e.

## Done criteria
1. `cargo tauri dev` shows the UI from Vite, with `window.__MM_CORE__` populated (check from CDP).
2. `cargo tauri build --target x86_64-pc-windows-gnu --features e2e --no-bundle` succeeds. The NSIS bundle on GNU is a best-effort attempt; report the outcome.
3. `cargo test` passes: unit tests from test-guide §1, Rust row.
4. `scripts/e2e.ps1 -Suite process` passes T-P1, T-P3, T-P4, T-P5, T-P6, T-P7, T-P8 against the fake core, and T-P2 and T-P10 once M0-B is available. The e2e script is owned by M0-E; coordinate through its interface (`-Exe`, `-Suite`).
5. Self-verification as in test-guide §0, with screenshots of the splash and the first UI frame.

## Out of scope
Tray, SMTC, mini window, webLogin, updater, NSIS hooks (later milestones).
