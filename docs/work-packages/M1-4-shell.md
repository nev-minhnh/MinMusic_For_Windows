# M1-4: Shell OS integration (tray, close-to-tray, SMTC, deep links, window state, Snap Layouts) + Rust shared-file setup

**Wave 1. Agent:** Sonnet. Conventions apply (`conventions.md`).
- **Worktree:** `D:\Coding_Project\MinMusic_4_Windows-wp\M1-4`, branch `wp/M1-4`.
- **Ports:** web 5184, mock 48004.

Read first:
- `docs/architecture.md` §3.3 (× and single instance), §5 (table), §10
- `docs/api.md` §3.1 `app.openUrl`, §4 `player`, §5, §6
- `docs/frontend-spec.md` §4 (Snap Layouts, `caption_rects`), §5 (close behaviour)
- `src-tauri/src/{main.rs,sidecar/supervisor.rs}`

## Stage 1, push within 1 h (M3-1 and later Rust WPs depend on it)
1. **`src-tauri/src/main.rs` marked blocks.** Create empty blocks `// <WP>` … `// </WP>` for `M1-4`, `M2-4`, `M3-1` and `M5-2` in each of:
   - the `mod` list
   - both `generate_handler![…]` lists (debug/e2e and release variants)
   - the plugin chain in `main()`
   - the `setup` closure
   Move nothing else. From then on every Rust WP edits only inside its own blocks. All logic lives in modules.
2. **`src-tauri/Cargo.toml`, pre-declared for M1–M5** (nobody else edits it):
   - `tauri-plugin-deep-link = "2"`, `tauri-plugin-updater = "2"`, `tauri-plugin-process = "2"`, `webview2-com = "0.38"` (match the version Tauri's `wry` uses: check `Cargo.lock`), `base64 = "0.22"`, `url = "2"`
   - `windows` features added: `Media`, `Media_Playback`, `Storage_Streams`, `Foundation`, `Foundation_Collections`, `Win32_System_WinRT`, `Win32_System_Com`, `Win32_UI_Shell_Common`, `Win32_Graphics_Gdi`, `Win32_UI_Controls`, `Win32_System_Registry`, `Win32_UI_Input_KeyboardAndMouse`
   - `cargo check` passes
3. **`src-tauri/capabilities/m1-4.json`**, an empty permission list to start.

STATUS line: "M1-4 stage 1 <sha>: Rust marked blocks + Cargo deps ready".

## Owned paths
- `src-tauri/Cargo.toml`, `Cargo.lock`, `src-tauri/tauri.conf.json` (wave 1)
- the `M1-4` blocks in `main.rs`, plus the one-time marker setup
- `src-tauri/src/{tray,smtc,window_state,deeplink,snap,corelink}/**`
- `src-tauri/src/sidecar/supervisor.rs`: only to expose the shell WS connection through `corelink`
- `src-tauri/capabilities/m1-4.json`
- `tests/e2e/app/m1-4.spec.ts`, `tests/e2e/process/m1-4.ps1`

## Work
| Module | Content |
|---|---|
| `corelink/` | Turns the supervisor's shell WS client (role `shell`) into a small API: `CoreLink::call(m, p) -> Result<Value>` and `CoreLink::subscribe(topic, cb)`. It re-subscribes after a core restart, from the same place the supervisor reconnects. Keep the supervisor's state machine untouched. **Also expose core→shell requests (api.md §1.2 `SrvReq`):** `corelink::srv::register(method: &str, handler: Arc<dyn Fn(Value) -> BoxFuture<'static, Result<Value, ApiError>> + Send + Sync>)`. An incoming `{sid,m,p}` frame → handler → `{sid,r}` / `{sid,e}`. An unknown `m` → `e.code="unsupported"`. Register `shell.focusMain` and `shell.openExternal` (https only) here. M3-1 registers `shell.webLogin` and `shell.po.*`. **Include `corelink::srv` in the stage-1 push** (signature plus a stub) |
| `tray/` | Tray menu: Phát/Tạm dừng (label follows `player.state.playing`), Bài trước, Bài tiếp, separator, Hiện MinMusic, Thoát. Tooltip "MinMusic — <title> · <artist>", truncated to 127 chars. Left click shows or focuses main (`desktopTrayToggleOnClick` toggles hide/show; read it from `shell.json` until M4 wires settings). Labels are VI/EN by the OS UI language (a small Rust table, `w2_tray_*` keys mirrored in `ui/src/i18n/extra/{en,vi}/m1-4.json`) |
| close-to-tray | Existing `close_to_tray` flag. First hide per install → tray balloon "MinMusic vẫn đang phát trong khay hệ thống" (flag `trayBalloonShown` in `shell.json`). Minimising with `desktopMiniPlayerOnMinimize` is M2-4's |
| `smtc/` | `ISystemMediaTransportControlsInterop::GetForWindow(main hwnd)`. Enable play, pause, next, previous. On button → `CoreLink::call("player.toggle"/…)`. From `player.state`: `DisplayUpdater` (Music type, title, artist, album; thumbnail `RandomAccessStreamReference::CreateFromUri` with the https art, or `http://127.0.0.1:<port>/art/...&k=<artToken>` for `core:`), `PlaybackStatus`, and the timeline (`UpdateTimelineProperties`) on state change and every 5 s while playing. Media keys work with the window hidden |
| `deeplink/` | `tauri-plugin-deep-link` with schemes `minmusic`, `metrolist`, `metrolist-auth`. **Register the schemes only in release builds** (`#[cfg(not(any(debug_assertions, feature="e2e")))]`), so tests never write HKCU. The installer (M5-1) registers them too. A URL arrives on start argv or from the single-instance callback → `CoreLink::call("app.openUrl", {url})` → `{nav}` → `emit_to("main", "mm-nav", nav)` + show/focus main. `metrolist-auth://discord/...` is forwarded to M3-1's `weblogin::on_auth_callback(url)`, which M3-1 implements; until it lands, log the URL |
| `window_state/` | `shell.json` under the config dir (honours `MINMUSIC_DATA_ROOT`). It holds window placement (normal rect, maximised, monitor). Restore it at create time and clamp to a visible monitor work area. Commands `shell_settings_get` → `{sidebarWidth?, sidebarDocked?, paneWidth?, trayBalloonShown?, desktopTrayToggleOnClick?}` and `shell_settings_set {patch}` (merge, debounced write 500 ms, atomic rename) |
| `snap/` | Command `caption_rects {max:[x,y,w,h]}` (physical px; the UI already calls it). **Timebox 3 h**, in this order: (a) `ICoreWebView2Settings9::put_IsNonClientRegionSupportEnabled(true)` plus a CSS `app-region` on the max button, if the runtime maps it to `HTMAXBUTTON`; (b) subclass the top-level window and answer `WM_NCHITTEST` → `HTMAXBUTTON` inside the rect (only reaches us if the WebView2 child passes hit-testing through; test it); (c) report which works. If none works by the timebox, ship maximize-on-click only and write the finding in STATUS (Minh decides) |

## Verify (cheap checks only)
1. `cargo check` and `cargo test` (target GNU) are green.
2. **Unit tests:**
   - tray label/tooltip formatting (truncation, VI/EN)
   - `shell.json` merge and atomic write
   - window rect clamping to the monitor work area (pure function)
   - deep-link URL → `app.openUrl` request plus event payload (mock `CoreLink` trait)
   - SMTC metadata mapping from a `PlayerState` JSON (pure function)
   - the `core:` art URL builder
3. **Specs written for the integration run** (app project): `tests/e2e/app/m1-4.spec.ts`:
   - `shell_settings_set/get` round-trip
   - `mm-nav` after a second-instance launch with `minmusic://album/<id>` (through T-P4 style launching)
   - `caption_rects` accepted
   Process checks go in `tests/e2e/process/m1-4.ps1` (T-P8 with tray balloon flag; SMTC state queried via `Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager` in PowerShell: title equals the playing track).
4. STATUS.md line.
