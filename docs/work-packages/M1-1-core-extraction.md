# M1-1: Core extraction, dependency flip, sidecar diet

**Wave 1. Agent:** Sonnet. Conventions apply (`conventions.md`). Use Opus if the move turns out to need more than the listed seams.

**Repo:** MinMusic.
- **Worktree:** `git -C D:\Coding_Project\MinMusic-wt-core worktree add D:\Coding_Project\MinMusic-wt-m1-1 -b feat/desktop-core-m1-1 origin/feat/desktop-core`
- Push the branch. No PR and no merge; the coordinator merges into `feat/desktop-core`.
- **Test checkout (read-only, for the contract runner):** `git -C D:\Coding_Project\MinMusic_4_Windows worktree add --detach D:\Coding_Project\MinMusic_4_Windows-wp\M1-1-test origin/main`, then `npm install` there.

Read first:
- `docs/architecture.md` §2, §3.1, §3.2
- `D:\Coding_Project\MinMusic-notes\agent-brief-windows.md`. Android must keep compiling. Do not change Android behaviour.

**No Gradle builds** (owner policy). The wave-1 integration agent builds, runs the tests and fixes. Your work must be mechanical and self-checked:
- move files with `git mv` only
- keep a written checklist of every `internal` member you opened up, every seam with both sides named, and every Gradle edit with the exact block

Wherever the text below mentions "Gradle batches" or `mm-build`, read it as "the integration agent does this".

## Goal
1. **Diet.** The sidecar image has no Skiko, Compose UI, Foundation, Material, Coil-Compose, WebView or Navigation jars. `sidecar/dist` shrinks from 293 MB to **≤ 200 MB**, and a 7-Zip LZMA2 `-mx9` archive of it (the proxy for the NSIS size) is **≤ 90 MB**.
2. **Flip.** CORE files move from `desktopApp` to `desktopCore`, `desktopApp` depends on `desktopCore`, and `desktopCore` no longer depends on `:desktopApp`.
3. Nothing changes in behaviour: the v1 app compiles and its `Dispatchers.Main` is still Swing, and every M0 contract test still passes on the new image.

## Owned paths (MinMusic repo)
- `settings.gradle.kts`, `desktopCore/build.gradle.kts`, `desktopApp/build.gradle.kts`
- `desktopApp/src/**` (moves out, seam implementations in)
- `desktopCore/src/main/kotlin/com/metrolist/desktop/**` (moved files, new)
- `desktopCore/src/test/kotlin/com/metrolist/desktop/**`
- `desktopCore/src/main/kotlin/com/metrolist/core/{CoreRuntime,CoreMainDispatcherFactory,SnapshotPump,CoreShutdown,Warmup}.kt`, `core/api/SysApi.kt`, `core/bridge/**` (new)
- `shared/src/desktopMain/kotlin/**/playback/VideoPlayer.kt`, the lazy frame holders only

**Not yours (M1-2a/M1-2b edit them in parallel):**
- `core/api/**` except `SysApi.kt`
- `core/server/**`, `SidecarMain.kt`, `CoreOptions.kt`

Rename or change no public symbol that `core/api/**` uses.

## Rule that keeps M1-2 conflict-free
**Move files with `git mv` and keep their package names** (`com.metrolist.desktop.*`). Kotlin allows a package that does not match the directory. All imports in `desktopApp/ui/**` and in `core/api/**` then stay valid. Do not reformat moved files.

## Steps
### 0. Class-load audit (no Gradle)
Run the current image from `D:\Coding_Project\MinMusic-wt-core\build\sidecar\dist`:
- add `-Xlog:class+load:file=<scratch>\classes.txt`
- use a test data root
- run `node <M1-1-test>\tests\contract\run.mjs --target real --suite m0` with `MINMUSIC_SIDECAR_DIST` pointing at it, plus one live `player.play` of a YouTube id for 15 s

List every loaded class from the `org.jetbrains.skia`, `org.jetbrains.skiko`, `androidx.compose.ui`, `androidx.compose.foundation`, `androidx.compose.material*`, `androidx.compose.animation` and `coil3` packages, with the first loader stack. Keep this list in the report. It is the hypothesis the seams below must kill.

### 1. Seams (known from static analysis; verify against step 0)
| Where | Change |
|---|---|
| `shared/src/desktopMain/.../playback/VideoPlayer.kt` (~1112–1192) | `frameHolders` / `FrameBitmapHolder` allocate their `org.jetbrains.skia.Bitmap`s lazily, on the first video frame, not in the constructor. This is a desktopMain-only change: Android is untouched and the v1 behaviour is the same |
| `storage/DownloadArtwork.kt` `encode()` | Skia → `javax.imageio` + `BufferedImage`/`Graphics2D` (bilinear, same output size and JPEG quality). Add a unit test comparing dimensions |
| `state/app/AppState.kt` (`SnackbarHostState`), `PlayerState.kt:1270` | Core `object CoreNotifier { val messages: SharedFlow<UiMessage> }`. `AppState` (stays in desktopApp) collects it into the snackbar. The sidecar bridges it to `app.toast` events in `SysApi.appTopic` |
| `state/app/UiState.kt` colours, `utils/{MatugenPalette,DesktopAccentColor}.kt` | These stay in desktopApp. Plain flags move to a core `UiFlags` object that UiState delegates to |
| `state/content/HomeState.kt` `rememberListState()` | Becomes an extension in desktopApp `ui/`. Core keeps the index and offset as ints |
| `HomeState.kt:141`, `utils/DesktopImageLoader.kt` | Core `object ArtworkCache { var evict: (String) -> Unit = {} }`. desktopApp registers the coil eviction |
| `PlayerState.kt:24,740` (`window.playbackWindowVisibility`), `:1289` and `DesktopUrlHandler.kt:120` (`ComposeTrayManager`) | Core `object WindowHost { val visible: MutableStateFlow<Boolean>; var showWindow: () -> Unit = {}; var playbackVisibility: () -> Flow<Boolean> = { flowOf(false) } }`, set from desktopApp `Main` |
| `PlayerState.artworkPreview` (coil `Image`) | Moves to a desktopApp-side holder. `PlayerArtworkPreview.kt` and `DesktopAnimatedArtwork`'s Compose part stay in desktopApp |
| `crash/DesktopCrashScreenshotHint.kt` | Stays in desktopApp. Core `var crashHintInstaller` is set by `Main` |
| `di/AppModule.kt` | Only `headlessStateModule` moves. `composeStateModule`, `youtube/DesktopPageBoundTokenRuntime.kt`, `web/**` and the WebView utils stay in desktopApp |
| `CoreMainDispatcherFactory` | `loadPriority = if (System.getProperty("minmusic.sidecar") == "true") Int.MAX_VALUE else Int.MIN_VALUE`. Add `-Dminmusic.sidecar=true` to `sidecarJvmArgs`, which reaches `core.args` and the warm-up args. Unit test both values. A desktopApp `jvmTest` asserts that `Dispatchers.Main` is the Swing dispatcher with desktopCore on the classpath |

### 2. Move and flip
- **Move** the closure from the M1-1 research, about 100 files and 21k lines. That covers `DesktopStartupTasks`, `auth/*`, `backup/*`, `crash/DesktopCrashRecovery`, `deviceconnect/DesktopDeviceConnect`, `di` (headless part), `history/*`, `listentogether/*`, `playback/*`, `source/*`, `state/DesktopLocaleManager`, `state/auth/*`, `state/content/*`, `state/playback/*` (minus the Compose-only files), the flag part of `state/app/*`, `storage/*`, `update/*`, `utils/{AppLogger,DesktopSingleInstance,DesktopUrlHandler,DesktopRelaunch,WindowsAppIdentity,NativeMemoryTrimmer}`. Everything else stays: `ui/`, `window/`, `input/`, `spotifyimport/`, `web/`, `youtube/`, `constants/`, `Main.kt`.
- **`internal` members** used across the new module boundary (list in the research notes): drop `internal`, the smallest change. Do not add new public API beyond that.
- **Gradle:**
  - `desktopApp` jvmMain takes `api(project(":desktopCore"))`.
  - `desktopCore` drops `project(":desktopApp")` and `evaluationDependsOn(":desktopApp")`.
  - The `platformSqliteJdbc` task moves to desktopCore, and desktopApp consumes its output.
  - `kotlin-reflect` and `coroutines-swing` excludes stay on desktopCore's own configurations only.
- **Tests:** move `desktopApp/src/jvmTest` tests whose subjects moved (backup, history) to `desktopCore/src/test`.

### 3. Runtime exclusions (sidecar only)
- Apply them to `desktopCore` **`runtimeClasspath` only** (compile still sees `shared`'s `api` deps):
  - `org.jetbrains.skiko:*`
  - `org.jetbrains.compose.ui:*`
  - `org.jetbrains.compose.foundation:*`
  - `org.jetbrains.compose.material:*`, `org.jetbrains.compose.material3:*`, `org.jetbrains.compose.material3.adaptive:*`
  - `org.jetbrains.compose.animation:*`
  - `org.jetbrains.compose.desktop:*`
  - `io.coil-kt.coil3:coil-compose*`
  - the composewebview/wrywebview/kdroidfilter groups
  - `org.jetbrains.androidx.navigation3:*`, `org.jetbrains.androidx.navigationevent:*`
  - markdown-renderer, shimmer, reorderable
  - lifecycle-*-compose, savedstate-compose
- Keep `runtime-desktop`, `components-resources` (`library-desktop`), `collection`, `atomicfu`.
- **jlink:** add `--include-locales=en,vi`. `jdk.localedata` then shrinks from about 15 MB.
- Re-run the step-0 audit on the new image. The listed packages must load **zero** classes. If one still loads, add a seam rather than putting the jar back. Exception: if a jar is unavoidable, keep it, name it in the report with its size, and continue.

## Also create (used by M1-2a and later WPs)
- `desktopCore/src/main/kotlin/com/metrolist/core/bridge/AppEvents.kt`:
  ```kotlin
  package com.metrolist.core.bridge
  object AppEvents {
      private val flow = MutableSharedFlow<Pair<String, JsonElement>>(extraBufferCapacity = 64)
      val events: SharedFlow<Pair<String, JsonElement>> = flow
      fun emit(event: String, payload: JsonElement) { flow.tryEmit(event to payload) }
  }
  ```
- `SysApi.appTopic` forwards `AppEvents.events` after its snapshot.
- `CoreNotifier` messages become `AppEvents.emit("app.toast", {i18n?, text, level})`.

## Verify (no builds; the integration agent builds)
1. **Before you change anything:** run the class-load audit (step 0) on the existing dac1f688 image. It needs no Gradle. Commit the result as `desktopCore/docs/m1-1-classload-before.txt`.
2. **`git grep` checks, recorded in the report:**
   - no file under `desktopCore/src/main/kotlin/com/metrolist/desktop/**` imports `com.metrolist.desktop.ui.`, `.window.`, `.input.`, `.web.` or `.youtube.DesktopPageBound`
   - no remaining `org.jetbrains.skia` import in moved files
   - `rg "project\(\":desktopApp\"\)" desktopCore` is empty
3. **Checklist file** `desktopCore/docs/m1-1-checklist.md`, with all four of:
   - every moved file (old → new path)
   - every `internal` that became public
   - every seam (core declaration ↔ desktopApp registration line)
   - every Gradle block changed
   The integration agent uses it to fix compile errors quickly.
4. **Unit tests that integration will run:**
   - `CoreMainDispatcherFactoryTest` (property on and off)
   - `DownloadArtworkImageIoTest`
   - desktopApp `SwingMainDispatcherTest`
5. **Integration acceptance (wave 1):**
   - the after-audit shows 0 excluded classes loaded
   - dist ≤ 200 MB, 7z proxy ≤ 90 MB
   - M0 contract suite green
   - T-P1 and T-P3 green
   - `:desktopApp:compileKotlinJvm` and `:androidApp:compileDebugKotlin` green
6. STATUS.md line with the commit.

## Former done criteria (now checked at integration)

1. The step-3 audit shows 0 classes from the excluded packages after the M0 contract suite plus a 15 s live YouTube play.
2. In `node tests/contract/run.mjs --target real --suite m0`, run with `MINMUSIC_SIDECAR_DIST=D:\Coding_Project\MinMusic-wt-m1-1\build\sidecar\dist` from the M1-1-test checkout, every test is green that was green on the dac1f688 image. List any difference.
3. **Sizes before and after:**
   - `dist` total, `lib`, `runtime` and `core.jsa`
   - the 7-Zip `-mx9` proxy
   - warm READY over 5 runs (≤ 900 ms, no regression > 50 ms)
   - private bytes after READY + `home.get`
4. `:desktopApp:compileKotlinJvm`, `:desktopApp:jvmTest` (including the Swing-dispatcher test) and `:androidApp:compileDebugKotlin` are green.
5. **No-orphan check:** in `scripts/e2e.ps1 -Suite process -Only T-P1,T-P3`, run from the M1-1-test checkout with `sidecar\dist` set as a junction to this worktree's image, both tests pass.
6. Self-verification as in test-guide §0, test data roots only.
   - Append a line to `D:\Coding_Project\MinMusic_4_Windows-wp\STATUS.md`: commit, sizes, number of builds used.
