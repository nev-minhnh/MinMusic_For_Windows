# M0-B: desktopCore headless sidecar (spike)

**Agent:** Sonnet (escalate to Opus if headless start fails twice).

**Repo:**
- MinMusic, at the submodule `D:\Coding_Project\MinMusic_4_Windows\core\MinMusic`. If M0-A has not added it yet, use a worktree `D:\Coding_Project\MinMusic-wt-core` from branch `windows`.
- Branch `feat/desktop-core`. Push the branch. No PR and no merge.

Read first:
- `docs/architecture.md` §2, §3
- `docs/api.md` §1, §3.2, §3.4 (`library.window` only), §3.6 (subset), §4 `player`
- `D:\Coding_Project\MinMusic-notes\agent-brief-windows.md`. Its rules apply: Android must keep compiling, and the coordinator does the shared build.
  - Exception for this WP: you may run `mm-build.sh` yourself, at most 3 times, batched.

## Goal
`minmusic-core.exe` starts headless from `sidecar/dist` and does the following:
- prints `READY` in ≤ 900 ms when warm
- serves the WS API subset
- plays audio through the existing `PlayerState` / `MusicPlayer`
- shuts down gracefully with no orphan

## Files
| File | Content |
|---|---|
| `settings.gradle.kts` | `include(":desktopCore")` |
| `desktopCore/build.gradle.kts` | Kotlin JVM 25 toolchain; `implementation(project(":desktopApp"))` (spike only, see architecture §2), `project(":shared")`, ktor-server-cio, ktor-server-websockets, kotlinx-serialization-json. Exclude `kotlinx-coroutines-swing` from `runtimeClasspath`. `application { mainClass = "com.metrolist.core.SidecarMainKt" }`. Task `sidecarImage` (below) |
| `desktopCore/src/main/kotlin/com/metrolist/core/SidecarMain.kt` | parses args (`--parent-pid`, `--dev`, `--fixture-home`, `--cds-warmup`, `--exe-path`); reads the token line from stdin; installs the snapshot pump; runs the v1 `initializeBackend()` steps without UI (Main.kt §4 sequence 11, minus window/tray/taskbar/WebView); starts `CoreServer` on port 0; writes `core.pid`; prints READY; starts the stdin-EOF and parent-exit watchers |
| `.../core/CoreMainDispatcherFactory.kt` + `META-INF/services/kotlinx.coroutines.internal.MainDispatcherFactory` | single-thread `core-main` |
| `.../core/SnapshotPump.kt` | `Snapshot.registerGlobalWriteObserver` → coalesced `sendApplyNotifications()` on `core-main` |
| `.../core/CoreShutdown.kt` | ordered: `PlaybackStatePersistence` save → `DownloadManager` pause → settings writer flush → DB close → DeviceConnect/ListenTogether stop → delete `core.pid` → `exitProcess(0)`; hard cap 2.5 s then `Runtime.getRuntime().halt(0)` |
| `.../core/server/CoreServer.kt` | Ktor CIO on `127.0.0.1:0`, `/rpc` WebSocket: Origin check, hello/token (4401), dispatch table `Map<String, suspend (JsonObject, Conn) -> JsonElement>`, subscriptions with seq, error envelope (api.md §1.5) |
| `.../core/api/HomeApi.kt` | `home.get` (via `HomeViewModel` or the `HomeState` logic; `--fixture-home` short-circuits) |
| `.../core/api/LibraryApi.kt` | `library.window` for `list:"songs"` with `sort.by` added/title and offset/limit from `DatabaseDao`; `library.counts` |
| `.../core/api/PlayerApi.kt` | `player.play` (contexts `tracks`, `library`), `toggle`, `next`, `prev`, `seek`, `setVolume`; topic `player`: snapshot + `player.state` + `player.position` (rules api.md §1.9), bridged from `PlayerState` with `snapshotFlow` / StateFlows |
| `.../core/api/Dto.kt` | `Track`, `Art`, `Shelf`, `PlayerState` exactly as in api.md §2 / §4 |

### `sidecarImage` task
1. `installDist`-style lib folder → `<repo>/../../sidecar/dist/lib` (path configurable with `-PsidecarOut=`).
2. jlink with the module list and options from architecture §3.2 → `dist/runtime`, then copy `java.exe` → `minmusic-core.exe`.
3. Write `core.args` (JVM args from §3.2).
4. Run `--cds-warmup` with `-XX:ArchiveClassesAtExit=dist/core.jsa`.
5. Write `sidecar/sidecar.lock` (`{submoduleSha, builtAt, sha256 of lib/*}`).

Build command:
```bash
bash D:/Coding_Project/MinMusic-notes/tools/mm-build.sh D:/Coding_Project/MinMusic_4_Windows/core/MinMusic :desktopCore:sidecarImage
```

## Known risks to resolve (report each)
- **UI classes touched at init:** `PlayerState` touches `SystemMediaManager`, `DesktopMediaControls`, and Compose `getString`.
  - Do not construct anything from `ui/` or `window/`.
  - If an init path forces it, add a minimal seam in desktopApp (an interface + no-op), guarded so the v1 app behaves the same.
- **`DesktopTokenProvider` without a WebView:**
  - For M0, construct it with `preferSidecar=true` and no page-bound runtime. bgutil is then downloaded to the cache dir on first use, which is acceptable for the spike only.
  - M3 replaces this with `ShellPoTokenRuntime`.
- **Dispatchers.Main use before the factory loads:** verify with a log line at startup.

## Done criteria
1. `sidecar/dist/runtime/bin/minmusic-core.exe @core.args -cp "lib/*" com.metrolist.core.SidecarMainKt --parent-pid <pid>` with the token on stdin prints READY. Warm READY time from 5 runs is reported, target ≤ 900 ms.
2. `node tests/contract/run.mjs --target real --suite m0` (from M0-D/M0-E) passes for `sys.hello`, `home.get` (fixture), `library.window`, `player.*`, and the `player` topic.
3. Playing a YouTube track (live network) produces audio. Verified by `player.position` advancing and by the owner's ear at integration.
4. Shutdown: stdin `{"cmd":"shutdown"}` → exit 0 in ≤ 2.5 s. Closing stdin → exit in ≤ 2.5 s. Killing the parent pid → exit in ≤ 3 s.
5. A v1 1.0.2 build of the same branch still compiles: `:desktopApp:compileKotlinJvm` is in the same mm-build batch.
6. Self-verification as in test-guide §0, using a test data root only.
