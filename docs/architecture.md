# MinMusic for Windows v2: architecture

Status: proposal for M0 (2026-11-22). Owner: Minh. Normative for all work packages.

## Open questions for Minh (each has a default; work proceeds on the default)

1. **bgutil PO-token sidecar (46 MB).** With the Tauri WebView2 always present, the page-bound WebView minter covers every token (it already does when `preferSidecar=false`).
   - **Default:** do not bundle bgutil. Keep the existing on-demand download (pinned SHA-256) as a fallback only.
2. **Install folder.** v1 (jpackage) and v2 (NSIS) cannot share an MSI upgrade.
   - **Default:** v2 installs per-user to `%LOCALAPPDATA%\Programs\MinMusic`. Its installer silently uninstalls v1 (MSI UpgradeCode `4ce33e04-b190-4983-b1b1-037bdff99a71`) and keeps all user data.
3. **Release channel for 1.0.x users.**
   - **Default:** one bridge release `windows-v2.0.0` in `nev-minhnh/MinMusic` carries the v2 setup under the v1 asset name. v1's updater installs it. Every later update comes from `MinMusic_For_Windows` through the Tauri updater.
4. **Locales.**
   - **Default:** ship all 57 locales generated from composeResources. The new UI-only strings (`w2_*`) are written in EN and VI only, and other locales fall back to EN.
5. **Third-party playlist import** (Spotify/Tidal/Deezer/Apple/Amazon). It is a large surface.
   - **Default:** it is kept, and scheduled last (M4). It reuses the generic web-login primitive.

## 1. Shape

```
+-------------------------- MinMusic.exe (Tauri 2, Rust) --------------------------+
|  main window (WebView2: ui/ SolidJS)       mini-player window (same bundle, #/mini)|
|  hidden "potoken" webview  (youtube.com/robots.txt, InPrivate)                     |
|  login windows (on demand, InPrivate, temp profile)                                |
|  tray | SMTC | taskbar thumb buttons | single-instance | deep links | updater      |
|  sidecar supervisor (Job Object, health, restart, shutdown)                        |
+---------|------------------------------------------------^------------------------+
          | spawn (stdin = token + control, stdout = ready)| ws client role=shell
          v                                                |
+---------------- minmusic-core.exe (jlink JVM, headless) -+------------------------+
|  CoreServer: ws://127.0.0.1:<random>/rpc  +  GET /art/...                          |
|  desktopCore: PlayerState, MusicPlayer (FFmpeg -> JavaSound), ParametricEqualizer, |
|  DownloadManager, SongCacheManager, Settings (DPAPI), Room v69, SourceRegistry,    |
|  Lyrics, LastFM/Scrobble, Discord RPC, DeviceConnect (ws :47821 + mDNS),           |
|  ListenTogether, Backup, Updater-check (v1 bridge only), PO TokenProvider          |
+-------------------------------------------------------------------------------------+
   ^ the UI webviews connect directly: ws client role=ui (main) / role=mini
```

Rules:
- The audio path, the EQ, the DB and the network all stay in the JVM.
- Rust owns only OS integration and webviews.
- The UI holds no business logic. It renders state from the core and sends commands.

## 2. Repo layout and how the Kotlin core gets in (decision 1)

```
MinMusic_4_Windows/
  core/MinMusic/        git submodule -> github.com/nev-minhnh/MinMusic, pinned commit on branch `windows`
  sidecar/              build-sidecar.sh, sidecar.lock (pinned submodule sha + artifact sha256), dist/ (gitignored)
  src-tauri/            Rust shell (Cargo workspace member `minmusic-shell`)
  ui/                   Vite + SolidJS + TS app (main window and mini window)
  protocol/             TS protocol types (source of truth for TS), JSON Schema generated from them, fixtures/
  mock-core/            Node WebSocket mock core (fixtures + generators) for UI dev and Playwright
  tools/                gen-strings.mjs, perf/ (CDP + PresentMon harness), release helpers
  docs/
```

**Decision: git submodule plus a new Gradle module `desktopCore` inside the MinMusic repo.**
- `desktopCore` lives at `core/MinMusic/desktopCore/`, on branch `windows`.
- Android fixes in `shared/` reach Windows along the path they already take: merge `main` → `windows`, bump the submodule pointer, run `sidecar/build-sidecar.sh`.
- No code is copied. The Compose 1.0.x app keeps building from the same tree until v2 replaces it.

Why not the alternatives:
- **Published jar:** it needs a CI or Maven publish step for every core fix, and Actions are for releases only.
- **Copied module:** it forks `shared/` and silently drops Android fixes.

Migration of code into `desktopCore`:
- **M0 (spike):** `desktopCore` depends on `:desktopApp` and `:shared` and moves nothing. The Compose UI classes are on the classpath but never instantiated. This is the cheapest way to prove headless playback.
- **M1:** move the CORE and MIXED-light files listed below from `desktopApp` to `desktopCore`, and flip the dependency so `desktopApp` depends on `desktopCore`. That removes Compose UI and Skiko from the sidecar runtime.
  - CORE files: `storage/*`, `state/playback/*` except the Compose-only `DesktopAnimatedArtwork`/`PlayerArtworkPreview`, `state/content/*`, `state/auth/AuthState`, `history/*`, `backup/*`, `source/*`, `deviceconnect/DesktopDeviceConnect`, `listentogether/*`, `update/*`, `utils/{AppLogger,DesktopSingleInstance,DesktopUrlHandler,...}`, `crash/DesktopCrashRecovery` logic.
  - Compose state that is not composable (`mutableStateOf` in `PlayerState`, `Settings`, `EqualizerProfiles`) stays as-is. Only `compose.runtime` is needed, which is about 2 MB and has no Skiko.

**UI iteration never needs Gradle:**
- `sidecar/dist/` holds a prebuilt runtime image built once per submodule bump with `bash D:/Coding_Project/MinMusic-notes/tools/mm-build.sh D:/Coding_Project/MinMusic_4_Windows/core/MinMusic :desktopCore:sidecarImage`.
- Day-to-day UI work runs `npm run dev` (Vite and mock core) or `cargo tauri dev`, which uses `sidecar/dist`.

## 3. Sidecar (decision 2)

### 3.1 Module and entry point
- Gradle module `:desktopCore` (Kotlin JVM, JDK 25 toolchain).
- Main class: `com.metrolist.core.SidecarMainKt`.
- Package root: `com.metrolist.core`. New code lives here, including `server/` (Ktor CIO websockets, already in the build), `api/` (handlers + DTOs), `bridge/` (snapshot → event flows), and `shell/` (requests to the Rust shell).

Headless prerequisites, all implemented in `desktopCore`:
1. **Main dispatcher.**
   - `CoreMainDispatcherFactory` implements `kotlinx.coroutines.internal.MainDispatcherFactory`, is registered in `META-INF/services`, and has `loadPriority = Int.MAX_VALUE`.
   - It is a single thread named `core-main`.
   - `kotlinx-coroutines-swing` is excluded from the runtime classpath.
2. **Snapshot pump.**
   - A `GlobalSnapshotManager` copy: `Snapshot.registerGlobalWriteObserver` schedules `Snapshot.sendApplyNotifications()` on `core-main`, coalesced to one call per write burst.
   - Without it, `snapshotFlow` never emits.
3. **AWT.** Pass `-Djava.awt.headless=true`. JavaSound (`java.desktop`) works headless.
4. **Compose UI class loading.** Nothing under `ui/`, `window/` or `ComposeTrayManager` is touched. In M0 any accidental touch is a bug to fix by moving the call.
5. **Replaced UI-bound bindings:**
   - `DesktopPageBoundTokenRuntime` → `ShellPoTokenRuntime`, which implements `DesktopPoTokenJavaScriptRuntime` over the shell channel (§5.2).
   - `ComposeTrayManager`, `SystemMediaManager`, `WindowsTaskbarController` and `MiniplayerWindow` are not started. Rust does their job from `player.*` events.
   - Snackbars (`AppState.snackbarHostState`) → `app.toast` events.
   - `UiState` update fields → `update.*` API.
   - Clipboard and share → done in the UI. The core returns the text or link.

### 3.2 Runtime, size, start-up budget
- **jlink image** (`:desktopCore:sidecarImage`) → `sidecar/dist/runtime/`.
  - Modules: `java.base, java.desktop, java.instrument, java.management, java.naming, java.net.http, java.prefs, java.sql, java.xml, jdk.crypto.ec, jdk.localedata, jdk.security.auth, jdk.unsupported, jdk.zipfs`.
  - Options: `--strip-debug --no-header-files --no-man-pages --compress zip-9`.
  - The launcher is `runtime\bin\java.exe` copied to `runtime\bin\minmusic-core.exe`. The firewall prompt then names a stable program, and `WindowsFirewall.kt` points at it.
- **App jars** → `sidecar/dist/lib/*.jar`. **AppCDS:** `sidecar/dist/core.jsa`.
  - Generated at build time with `-XX:ArchiveClassesAtExit` from a scripted warm-up run (`--cds-warmup`, which starts, opens the DB, loads Home from fixtures and exits).
  - Never generated at runtime on a user PC. The v1 lesson: a missing archive meant a 45 s first frame.
- **JVM args:** v1 `desktopWindowsJvmArgs` minus the Skiko flags, with these changes:
  - `-Xmx768m` (no UI heap any more)
  - `-XX:SharedArchiveFile=core.jsa -Xshare:auto`
  - `-Djava.awt.headless=true`
  - `-XX:ErrorFile=%LOCALAPPDATA%\MinMusic\state\metrolist\logs\hs_err_core_%p.log`
  - Args are kept in `sidecar/dist/core.args` (an `@argfile`), so Rust only passes `@core.args`.
- **Budgets** (measured in M0, enforced from M1):

| Step | Warm (2nd launch) | Cold (after reboot) |
|---|---|---|
| Spawn → `READY` line on stdout | ≤ 900 ms | ≤ 2.0 s |
| `READY` → `home.get` answered from DB/cache | ≤ 300 ms | ≤ 800 ms |
| `READY` → network Home | ≤ 2.5 s | ≤ 4.0 s |

The UI never waits for `READY` to paint. It renders the last cached Home snapshot from IndexedDB.

### 3.3 Lifecycle owned by Tauri (hard requirement: no orphan JVM, ever)
The user never launches the sidecar. `MinMusic.exe` spawns it at start-up, before the main window is shown.

**Spawn** (`src-tauri/src/sidecar/mod.rs`):
1. Create a Job Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION`. The shell holds the only handle and never duplicates it into the child.
2. Spawn with `CreateProcessW(..., CREATE_SUSPENDED | CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT)`. Call `AssignProcessToJobObject`, then `ResumeThread`.
   - Assigning before resume means no child can escape the job. `std::process::Command` cannot do this reliably, so use `windows` crate calls.
3. Command line: `minmusic-core.exe @<dist>\core.args -cp <dist>\lib\* com.metrolist.core.SidecarMainKt --parent-pid <pid> --data-root <default> --log-dir <dir>`.
4. **stdin** (pipe, kept open for the shell's whole life):
   - The first line is `{"token":"<64 hex>","artToken":"<32 hex>","protocol":1}`.
   - Later lines are control messages (`{"cmd":"shutdown"}`).
   - The token is never placed on argv, so other processes cannot read it through WMI.
5. **stdout:** the first line is `READY {"port":<u16>,"pid":<u32>,"version":"<core semver>","protocol":1}`. Anything else on stdout or stderr goes to `core-stdout.log`.
6. **Timeouts:** no `READY` within 15 s → kill, retry once, then show the fatal "core failed to start" screen with a log link.

**Health:**
- The shell's own WS connection (role `shell`) sends `sys.ping` every 5 s.
- 3 missed pongs, or a process-exit notification (`WaitForSingleObject` thread on the process handle), means a crash.

**Restart on crash:**
- Back-off 0.5 s, 2 s, 5 s. After 3 crashes in 120 s, stop and show the fatal screen with "Thử lại" and "Mở thư mục log".
- On restart, the UI shows a 32 px top banner "Đang khởi động lại lõi…". The core client reconnects (api.md §1.6) and re-subscribes, and the core restores the persisted queue paused.

**Sidecar self-termination** (second safety net, in `SidecarMain`):
- A thread blocks on `System.in` and calls `CoreShutdown.run(reason="stdin-eof")` on EOF.
- `ProcessHandle.of(parentPid).get().onExit()` triggers the same shutdown, and a 2 s polling fallback runs alongside it.
- The hard cap for the graceful shutdown is 2.5 s, then `Runtime.halt(0)`.

**Normal quit** (tray "Thoát", Alt+F4 or × when close-to-tray is off, updater restart, "Quit" in the jump list or mini player):
1. The shell hides all windows immediately, which gives a perceived instant quit.
2. It sends `{"cmd":"shutdown"}` on stdin. The core then:
   - saves the queue and position (`PlaybackStatePersistence`)
   - pauses downloads with resumable state
   - flushes the settings writer
   - checkpoints and closes Room
   - stops Device Connect and Listen Together cleanly
   - exits 0
3. The shell waits up to 3 s on the process handle.
4. If the process is still alive, `TerminateProcess`. Then it closes the job handle and exits.

**Windows logoff, shutdown or restart:**
- The main window is subclassed (`SetWindowSubclass`).
- On `WM_QUERYENDSESSION`: call `ShutdownBlockReasonCreate(hwnd, "Đang lưu hàng đợi…")` and return TRUE.
- On `WM_ENDSESSION(wParam=TRUE)`: run the same graceful path synchronously (≤ 3 s, within the OS budget of about 5 s), then call `ShutdownBlockReasonDestroy`.

**Crash or kill of `MinMusic.exe`** (Task Manager, `taskkill /F`): the kernel closes the job handle, so `KILL_ON_JOB_CLOSE` kills the JVM. stdin EOF and the parent poll are a backup if the job assignment ever failed. That failure is logged at ERROR and surfaced in Settings → Giới thiệu → Chẩn đoán.

**× button:** this is owner decision 3.
- By default it minimises to the tray. Both processes stay alive and music continues.
- The WebView is put into a low-memory state (`ICoreWebView2_3::TrySuspend` is not used because the mini player and SMTC need it alive; `MemoryUsageTargetLevel=Low` is used instead).
- Settings toggle `minimizeToTrayOnClose=false` makes × quit through the normal-quit path.

**Single instance** (`tauri-plugin-single-instance`):
- A second launch forwards its argv (deep links) to the first instance, focuses or restores its main window, and exits before it spawns anything.
- It never starts a second JVM.

**Stale sidecar:**
- The core writes `%LOCALAPPDATA%\MinMusic\state\metrolist\core.pid` as `{pid, startTimeMs, exe}`.
- At start-up, before spawning, the shell reads it. If that PID is alive, its image path equals our `minmusic-core.exe`, and its creation time matches, the shell kills it, then deletes the file.
- The core also keeps v1's `metrolist.lock` (`DesktopSingleInstance` file lock). If the lock is held after the stale-kill step, it is held by a v1.0.x app. The core exits with code 20, and the shell shows "MinMusic 1.x đang chạy — hãy thoát nó trước".

**Installer and updater:**
- The NSIS `NSIS_HOOK_PREINSTALL` hook runs `taskkill /IM MinMusic.exe /T` (graceful first), waits 3 s, then `taskkill /F /IM MinMusic.exe /T` and `taskkill /F /IM minmusic-core.exe`.
- The `/T` kills the tree. Killing `minmusic-core.exe` by name is restricted to our install dir via `wmic`-free PowerShell `Get-Process | ? Path -like "$INSTDIR*"`.
- The Tauri updater path calls the normal quit first (`app.restart()` is replaced by our `quit_for_update()`).

### 3.4 Logs and user data (unchanged paths, no migration of data)
The sidecar uses `XdgUtils`, so every path stays identical to v1 1.0.x:

| What | Path |
|---|---|
| DB (Room v69) | `%LOCALAPPDATA%\MinMusic\data\metrolist\metrolist.db` |
| Settings | `%APPDATA%\MinMusic\config\metrolist\settings.properties` |
| Secrets (DPAPI, entropy `MetrolistDesktopSecretsV1`) | `%LOCALAPPDATA%\MinMusic\state\metrolist\secrets.properties` |
| Downloads (default) and metadata | `...\data\metrolist\downloads`, `...\state\metrolist\downloads.json` |
| Song cache, image cache, AutoEQ | `%LOCALAPPDATA%\MinMusic\cache\metrolist\{cache,image_cache,autoeq}` |
| Logs | `%LOCALAPPDATA%\MinMusic\state\metrolist\logs\` with `app.log` (core, existing rotation), `shell.log` (Rust, `tauri-plugin-log`, 5 × 2 MB), `ui.log` (UI `console.error` and unhandled rejections forwarded via the shell), `core-stdout.log` |
| WebView2 UI profile (new) | `%LOCALAPPDATA%\MinMusic\webview2-ui` |
| Login webviews | `%TEMP%\MinMusic-login-<guid>`, InPrivate, deleted after use (same as v1 helper) |

- **Migration from 1.0.x:** none for data. DPAPI is per-user, so the same Windows user decrypts.
- The one-off "v2 first run" flag is `w2FirstRunDone` in settings. It drives a one-time toast "Đã chuyển sang giao diện mới" and nothing else.
- The UI layout state (sidebar width, pane, window placement) is new. It is stored by the shell in `%APPDATA%\MinMusic\config\metrolist\shell.json`.

## 4. Transport (decision 3; details in api.md)
**Choice:** WebSocket on `127.0.0.1:<ephemeral>`, served by the core. The webviews connect directly, and Rust connects as one more client.

**Why not Tauri IPC proxied by Rust:**
- It adds a hop and a second serialisation on the hottest path (lists, events).
- It needs the Rust code to know every message.

**Direct WS** keeps Rust schema-agnostic except for `player.*` (SMTC, tray, taskbar) and `shell.*`.

**Security:**
- Binds only to `127.0.0.1`.
- A per-launch 256-bit token is required in the first frame (`sys.hello`). The connection is closed within 2 s otherwise.
- The `Origin` must be `http://tauri.localhost`, empty (shell client), or `http://localhost:5173` when the core is started with `--dev`.
- Art endpoints require `?k=<artToken>`. That token is read-only and scoped to `/art`.
- The token reaches the UI through the Tauri command `core_config`, which resolves after READY and again after each restart. The UI client then sets `window.__MM_CORE__ = {port, token, artToken}`. The command is granted by capability only to the `main` and `mini` windows, never to login or PO-token webviews, which have no IPC at all. The main window is not gated on READY.

## 5. What Rust owns vs the JVM (decision 4)

| Concern | Owner | How |
|---|---|---|
| Audio decode, output, EQ, crossfade, normalization | JVM | unchanged `MusicPlayer` / `AudioRenderer` / `ParametricEqualizer`, identical to Android/desktop behaviour |
| Tray (play/pause, next, prev, show, Thoát) | Rust | Tauri `TrayIconBuilder`; state from `player.state` events |
| Close to tray, window state | Rust | `on_window_event(CloseRequested)` + setting from core; `tauri-plugin-window-state` |
| SMTC and media keys | Rust | `windows` crate `SystemMediaTransportControls` via `ISystemMediaTransportControlsInterop::GetForWindow(main hwnd)`; buttons → `player.*` commands; metadata + artwork (`RandomAccessStreamReference::CreateFromUri` with the https art URL); timeline updated on state change and every 5 s |
| Taskbar thumbnail toolbar | Rust | `ITaskbarList3::ThumbBarAddButtons`, icons from `src-tauri/icons/thumb/*.ico`, WM_COMMAND via window subclass; toggle `desktopTaskbarButtons` |
| Taskbar progress | Rust | `ITaskbarList3::SetProgressValue/State`, downloads only (green running, paused yellow) |
| Mini-player window 320×88 (↔ 320×320) | Rust window + UI | second `WebviewWindow` label `mini`, `always_on_top`, no decorations, loads `index.html#/mini`, own ws client |
| Single instance, deep links `minmusic://`, `metrolist://`, `metrolist-auth://` | Rust | `tauri-plugin-single-instance` + `tauri-plugin-deep-link` (registers HKCU schemes); URL → `app.openUrl` command to core (core keeps `DesktopUrlHandler` logic) |
| Jump list | Rust (M5, optional) | `ICustomDestinationList` tasks: Play/Pause, Next, Mini player |
| Notifications | UI toasts only | no OS toasts (v1 has none). Exception: `update.available` while hidden in tray → tray balloon |
| Auto-update | Rust | `tauri-plugin-updater` (§7) |
| File/folder pickers | UI via `tauri-plugin-dialog` | path is passed to the core |
| Google, Zing, Spotify, Discord, import-provider logins | Rust executes, JVM decides | generic `shell.webLogin` (§5.1); replaces the 130 MB .NET helper and composewebview |
| PO token page-bound runtime | Rust executes, JVM decides | hidden webview + `shell.po.evaluate` (§5.2) |
| NCT and Last.fm password logins | UI form → JVM | the password is passed once in `source.nct.login` / `lastfm.login`, never logged and never stored; the UI clears the field after the call |
| Device Connect, Listen Together, Discord RPC, Last.fm, downloads, backup | JVM | unchanged shared code |

### 5.1 Generic web login (replaces metro-wv2-helper)
- The core sends `shell.webLogin` (api.md §6) with `{url, allowedHosts, userAgent?, title, banner, window{w,h,maximizable}, done:{anyCookie:[names] on [urls] | navPrefix | script+predicate}, collect:{cookieUrls, script?}, timeoutMs}`.
- Rust opens a `WebviewWindowBuilder` with:
  - `.incognito(true)`
  - `.data_directory(%TEMP%\MinMusic-login-<guid>)`
  - its own title bar (the Zing design: read-only address bar, "Mở bằng trình duyệt", "Huỷ")
  - `on_navigation` that blocks non-allowed hosts in the top frame and intercepts `navPrefix` (Discord `metrolist-auth://discord/callback`)
- It polls every 500 ms and on `NavigationCompleted`:
  - cookies via `ICoreWebView2_2::CookieManager().GetCookies(url)` through `with_webview` (httpOnly included)
  - the script via `ICoreWebView2::ExecuteScript`
- On success it returns `{cookies:{name:value}, cookieHeader, scriptResult, finalUrl}`, closes the window and deletes the folder.
- Cancel and close return `{cancelled:true}`.

Per-provider configs live in Kotlin (`desktopCore/shell/WebLoginConfigs.kt`), ported from `Program.cs` and `ProviderLoginDialog.kt`:
- YouTube done when `SAPISID|__Secure-3PAPISID|__Secure-1PAPISID` is present and `ytcfg` returns `VISITOR_DATA`, `DATASYNC_ID`, `SESSION_INDEX`.
- Zing `zmp3_sid|zpsid`.
- Spotify `sp_dc`.
- Deezer `arl`.
- Tidal and Apple use script extractors.
- Amazon uses a marketplace URL.

The core then runs the existing validation (`AuthManager.validateAndSaveCredentials`, `zingClient.account()`).

### 5.2 PO token
- Rust creates a hidden (`visible(false)`, 1×1, `skip_taskbar`) webview window `potoken`, InPrivate, UA Chrome 136, URL `https://www.youtube.com/robots.txt`.
- It is created lazily on the first `shell.po.evaluate` and unloaded (`about:blank`) after the idle signal `shell.po.reset`.
- `ShellPoTokenRuntime.evaluate(script)` → `shell.po.evaluate{script}` → `ExecuteScript`. The JSON result string is returned unchanged, and the core keeps `normalizeJavaScriptResult`. The timeout is 10 s, as in v1.
- `available` is true when the shell is connected and the WebView2 runtime exists.
- `DesktopTokenProvider` is used unchanged with `preferSidecar=false`.

## 6. Frontend stack (decision 5; details in frontend-spec.md)
- **Framework: SolidJS 1.9** with Vite and TypeScript (strict). Fine-grained signals with no VDOM diff mean 4 Hz player events touch only the text nodes that change. Svelte 5 is comparable; Solid wins on smaller runtime and explicit control of what re-renders.
- **Styling:** plain CSS with design tokens as custom properties (`ui/src/styles/tokens.css`), using CSS modules per component. No CSS-in-JS and no Tailwind.
- **Lists:** `@tanstack/solid-virtual` for all lists over 60 rows. Rows have a fixed height (56 / 48) with no dynamic measuring.
- **Routing:** an own 200-line stack router with keep-alive of the previous 4 pages (`content-visibility:hidden`) so that Back is instant and keeps its scroll.
- **State:** core-backed stores (`createStore`) fed by subscriptions, plus local UI signals. No Redux-like layer.
- **Images:** `<img decoding="async" loading="lazy">` sized by `artUrl(src, cssPx × devicePixelRatio)`. Chromium decodes off the main thread and caches in the profile HTTP cache.
- **Wheel:** native WebView2 smooth scrolling. Never `preventDefault` on wheel, no JS scroll libraries, and all listeners passive.

## 7. Packaging and release (decision 7)
- **Toolchain:** local dev and local test builds use **x86_64-pc-windows-gnu** (portable rustc 1.100 + TDM-GCC 10.3 `gcc`/`windres` on PATH).
  - Tauri 2 compiles and runs on GNU. `webview2-com` and `windows-rs` ship GNU import libs, and `embed-resource` uses `windres`.
  - WP M0-A must prove `cargo tauri build --target x86_64-pc-windows-gnu --bundles nsis` on day 1.
  - Fallback if it fails: VS 2022 Build Tools (MSVC v143 + Win11 SDK). This needs admin and about 7 GB; Minh decides then.
- **Releases** build on GitHub `windows-latest` with **MSVC** (`x86_64-pc-windows-msvc`), the officially supported target. The GNU build is never shipped.
- **Bundles:**
  - NSIS `installMode: "currentUser"` (no admin), languages Vietnamese + English, install dir `$LOCALAPPDATA\Programs\MinMusic`.
  - `installerHooks` (`src-tauri/nsis/hooks.nsh`): stop processes (§3.3) and uninstall v1 MSI silently (`msiexec /x {ProductCode} /qn`, looked up from UpgradeCode, per-user so no admin).
  - WebView2: `webviewInstallMode: downloadBootstrapper` (Windows 11 has it).
  - **Portable zip:** the same files plus `portable.flag`. The shell then sets `MINMUSIC_PORTABLE=1` and the core uses `<exe dir>\data` as the XDG base. It is never auto-updated, and Updates opens the release page.
- **Resources:** `sidecar/dist/{runtime,lib,core.args,core.jsa}` go in as `bundle.resources` → `$INSTDIR\core\`. There is no .NET helper and no bgutil (open question 1).
  - Size targets: setup ≤ 100 MB, installed ≤ 280 MB.
- **Updater:** `tauri-plugin-updater`, endpoint `https://github.com/nev-minhnh/MinMusic_For_Windows/releases/latest/download/latest.json`.
  - Updates are signed with a Tauri minisign key (`TAURI_SIGNING_PRIVATE_KEY` repo secret). This is update-integrity signing, not Authenticode.
  - Checks are hourly, matching v1. The `updateChannel` and `checkForUpdates` settings are kept.
- **Code signing:** none (owner accepted SmartScreen). Version metadata (Company `nev-minhnh`, Product `MinMusic`) is set to reduce Defender ML false positives.
- **Workflow** `.github/workflows/release.yml`, on tag `v*.*.*`, `windows-latest`:
  1. checkout with submodules
  2. `scripts/check_no_ads.sh` (copied from MinMusic)
  3. verify the tag equals `src-tauri/tauri.conf.json` `version`
  4. JDK 25 + Gradle cache, then `./gradlew :desktopCore:sidecarImage` inside `core/MinMusic` (secrets: `LASTFM_*`, `LYPRIO_*`)
  5. Node 22 (`npm ci`), `npm run build`
  6. `npm test` (unit + contract against `sidecar/dist`)
  7. `cargo tauri build --target x86_64-pc-windows-msvc --bundles nsis`
  8. build the portable zip
  9. sha256 files and `latest.json`
  10. `gh release create`
- **v1 bridge (open question 3):** a manual job `bridge.yml` copies the setup as `MinMusic-2.0.0-windows-x64-setup.exe` to the MinMusic repo tag `windows-v2.0.0`.

## 8. Device Connect (decision 8)
- The sidecar runs the unchanged `DeviceConnectManager(localDeviceType = DESKTOP)`, so v2 is wire-compatible with Android 1.0.2+ by construction:
  - protocol 2, `ws://host:47821/connect`, mDNS `_metrolist-connect._tcp.`, ECDH + SAS pairing
  - QR link `metrolist://device-connect?a=..&n=..`
- The UI only renders state and approvals through `deviceConnect.*` (api.md §5.14).
  - The QR is rendered from the link string by the UI (`qrcode-generator`, level M), or as an SVG returned by the existing `DeviceConnectQrCode` encoder (default, so it is byte-identical).
- **Firewall:** the program is now `$INSTDIR\core\runtime\bin\minmusic-core.exe`. `WindowsFirewall.kt` takes that path from `--exe-path`, and the notice UI is unchanged.
- **Regression test:** pair and control with an Android 1.0.2 phone (test-guide M3).

## 9. Hard rules (inherited, non-negotiable)
- No ads and no telemetry, ever.
  - No analytics SDK in the UI.
  - The CSP `connect-src` allows only `ws://127.0.0.1:*`, `http://127.0.0.1:*` and `ipc:`.
  - `img-src` allows `https:`, `http://127.0.0.1:*` and `data:`.
  - Sentry stays off.
- Never bypass VIP, DRM or SoundCloud Go+. Pick only tiers the account is entitled to, and never use geo tricks.
- The NCT and Last.fm passwords are used only at login. They are never stored or logged, and the UI clears the field.
- All secrets stay in the DPAPI store and are never returned over the API. Settings reads of secret keys return `{set: true|false}` only.
- Cookies and tokens are excluded from backups exactly as v1 does (`backupExcludedKeys`).

## 10. Test mode (agents test the real app on this PC)
These hooks exist in debug builds and in builds with the cargo feature `e2e`. They are compiled out of release builds (`#[cfg(any(debug_assertions, feature = "e2e"))]`).

- **`MINMUSIC_DATA_ROOT=<dir>`** redirects all user data.
  - The shell sets `LOCALAPPDATA=<dir>\Local` and `APPDATA=<dir>\Roaming` for the sidecar child environment, which `XdgUtils` honours. It also puts its own `shell.json`, logs and `webview2-ui` under `<dir>`.
  - The single-instance key becomes `nev-minhnh.MinMusic.test-<fnv64(dir)>`, so a test instance never focuses or kills the owner's real app.
  - The stale-sidecar check reads `<dir>\Local\MinMusic\state\metrolist\core.pid` only.
  - The owner's real `%LOCALAPPDATA%\MinMusic` is never read or written.
  - Scripts always use `D:\Coding_Project\MinMusic_4_Windows\.testdata\<run-id>` (gitignored).
- **`MINMUSIC_DEVTOOLS_PORT=<port>`** makes the shell set `additional_browser_args("--remote-debugging-port=<port>")` on the main and mini webviews.
  - Playwright attaches with `chromium.connectOverCDP("http://127.0.0.1:<port>")`.
  - Release builds never set it. Production code never sets `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`.
- **`MINMUSIC_TEST_PIDFILE=<file>`** makes the shell write `{shellPid, corePid}` to that file. Scripts kill only those PIDs (process-tree), never by image name.
- **Fixtures.** `--fixture-home <json>` (core flag, test only) makes `home.get` return the fixture instead of calling the network, so perf runs are deterministic. The flag passes through the shell as `MINMUSIC_CORE_EXTRA_ARGS`.

## 11. Performance acceptance (decision 6)
- The exact numbers (P1–P8, S1–S3, R1–R2, C1, I1) live in `milestones.md` under "Performance acceptance criteria".
- The measurement procedure is in `test-guide.md` §5: Chromium `PipelineReporter` dropped frames via CDP tracing plus PresentMon display-change gaps, measured on this PC at 3840×2400 and 1920×1200.
- The M0 numbers decide go or no-go.
