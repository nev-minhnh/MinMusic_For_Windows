# M4-2a: Core downloads, storage, `import.files`

**Wave 5. Agent:** Sonnet. **Repo:** MinMusic. Conventions apply.
- **Worktree:** `D:\Coding_Project\MinMusic-wt-m4-2a`, branch `feat/desktop-core-m4-2a` (after INT-W4).
- **Test checkout:** `…-wp\M4-2a-test`.

Read first:
- `docs/api.md` §3.4 `import.files`, §3.9, §4 `downloads`, §1.9 (progress ≤ 2 Hz per item, ≤ 4 Hz total), §1.10 (`core:local/…` art)
- `M1-2a-core-browse.md` ("No Gradle" rules)

## No Gradle
INT-W5 builds. `DownloadManager` is `object DownloadManager` in package `com.metrolist.desktop.storage` (file `desktopCore/src/main/kotlin/com/metrolist/desktop/storage/DownloadManager.kt` after M1-1). It runs on its own IO scope: any thread is fine and no Main is needed. Koin must be started (it is, after `backendReady()`). Copy each signature into a comment above its call.

## Owned paths
- `desktopCore/.../core/api/{download,storage,importfiles}/**` (modules `DownloadModule` with topic `"downloads"`, `StorageModule`, `ImportFilesModule`)
- `api/library/LibraryModule.kt`: remove the `import.files` → `unsupported` stub only
- `desktopCore/src/main/kotlin/com/metrolist/desktop/storage/DownloadManager.kt`: **additive** only: `fun cancelDownloads(ids: Collection<String>)` (wraps the internal `cancelDownloadJobs(ids, activeJobs)`), a `val paused = MutableStateFlow(false)` with a gate before acquiring `downloadSemaphore`, and `val downloadErrors: StateFlow<Map<String,String>>` (set where state becomes FAILED). v1 behaviour is unchanged when `paused` stays false.
- `desktopCore/src/test/.../api/{download,storage,importfiles}/**`

## Methods
| Method | Backing |
|---|---|
| `download.tracks {ids}` | Resolve `SongItem`s (M1-2a `PlayerApi.resolve`) → `DownloadManager.downloadAll(songs: List<SongItem>)` (:978) |
| `download.context {context}` | Songs via M1-2a `PlayerApi.resolveContext` → `downloadPlaylist(playlistId: String, songs: List<SongItem>)` (:934). For a user album use its DB id |
| `download.cancel {ids?, all?}` | `all` → `stopActiveDownloads()` (:1270); ids → `cancelDownloads(ids)` (new) |
| `download.pause/resume` | `DownloadManager.paused.value = true/false`; resume re-dispatches queued ids |
| `download.retry {ids?}` | `retryFailedDownload(songId: String)` (:1201) per id; no ids → every FAILED id from `downloadStates.value` |
| `download.remove {ids, deleteFiles}` | `deleteDownloads(songIds: Collection<String>)` (:1221). `deleteFiles:false` → `unsupported` |
| `download.summary` | Pure `SummaryBuilder`: count = `downloadedFiles.value.size`; bytes = the sum of `File(audioFilePath).length()` + thumbnail; byQuality grouped by `mimeType` → labels (`audio/flac` → "FLAC", `audio/mp4` → "AAC", `audio/webm`/opus → "Opus", mp3 → "MP3"); folder = `getDownloadDir()`; `folderOk = isDirectory && Files.isWritable`; active = QUEUED+DOWNLOADING counts (replicates the internal `downloadQueueSummary`); `paused` |
| `download.window` | `library.window` over `downloaded` (exists, M1-2b): delegate to `LibraryApi.window` with `list:"downloaded"` |
| `download.queue` | From `downloadStates`, `downloadProgress`, `downloadTitles`, `downloadErrors` → items for QUEUED/DOWNLOADING/FAILED |
| topic `downloads` | snapshot = summary. `download.progress {id, state, progress}` from `downloadStates` + `downloadProgress`, coalesced with a pure `ProgressThrottle` (≤ 2 Hz per id, ≤ 4 Hz total); `download.summary` on any count change (`sample(500)`) |
| `download.setFolder {path\|null}` | Validate (missing → `{ok:false, error:"missing"}`, a non-writable probe → `not_writable`), then `changeDownloadDirectory(directory: File?)` (:286) |
| `download.saveTo {ids, path}` | `suspend saveDownloadsToFolder(songIds: List<String>, folder: File, userAlbum: UserAlbumExport? = null): SaveToFolderResult` (:879) → `{saved, failed}` |
| `storage.usage` | songCache `SongCacheManager.getCacheSizeBytes()`; imageCache `(DesktopImageLoader.create(PlatformContext.INSTANCE).diskCache as ResizableImageDiskCache).size` (**only if the coil classes are still on the runtime classpath after M1-1**; else compute the directory size of `cache\metrolist\image_cache` with `Files.walk`); animatedArt `DesktopAnimatedArtworkCache.get().sizeBytes()`; videoCache: directory size of the video cache dir (find it in `MusicVideoResolver`); downloads = the summary bytes. Limits: `SongCacheManager.getMaxCacheSizeMB()`, `Settings.shared.maxImageCacheSize`, `animatedArtworkCacheSize` |
| `storage.clear {what}` | `SongCacheManager.clearCache()`; image: delete the image-cache directory contents (avoid coil if excluded); `DesktopAnimatedArtworkCache.get().clear()`; video `MusicVideoResolver.clearCache()` (suspend; get it via Koin) |
| `import.files {paths}` | **New** `LocalImporter`: JavaCV FFmpeg `avformat_open_input` + `avformat_find_stream_info` + `av_dict_get(ctx.metadata(), key, null, 0)` for title, artist, album, date, track; `duration()/AV_TIME_BASE` seconds. Id `local_` + sha1(absolute path) first 16 hex. Insert `SongEntity(id, title, duration = seconds, albumName, year, isLocal = true, inLibrary = now)` via the DAO (open `SongEntity.kt:25` for the exact constructor). **Path storage:** find how `PlayerState.kt:2813` resolves `local_` ids to a file (`rg -n "local_" desktopCore/src/main/kotlin/com/metrolist/desktop/state/playback/PlayerState.kt shared/src`). If no path column exists, store `id → path` in `CorePrefs` key `localFiles` and register a resolver at that call site only if a public hook exists; otherwise report it as blocked and return `unsupported` (do not edit PlayerState). Embedded art is served by M1-2b's `ArtRoute` kind `local` |

## Verify (no builds)
1. JUnit (pure): `SummaryBuilderTest`, `ProgressThrottleTest`, `FolderValidateTest` (temp dirs), `LocalIdTest`, `MimeLabelTest`.
2. INT-W5 runs `m4-downloads.mjs` on real plus a live download of one YouTube track into a test folder (format kept: `ffprobe` codec equals the source). Self-review checklist and STATUS line.
