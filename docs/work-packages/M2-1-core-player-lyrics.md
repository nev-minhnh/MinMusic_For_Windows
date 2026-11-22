# M2-1: Core player complete, remaining queue methods, lyrics API

**Wave 3. Agent:** Sonnet. **Repo:** MinMusic. Conventions apply.
- **Worktree:** `D:\Coding_Project\MinMusic-wt-m2-1`, branch `feat/desktop-core-m2-1` from `origin/feat/desktop-core` **after INT-W2**.
- **Test checkout:** `…-wp\M2-1-test`.

Read first:
- `docs/api.md` §3.6, §3.7, §4 (`player`, `queue`, `lyrics` topics)
- `M1-2a-core-browse.md` ("No Gradle" rules, `ApiRegistry`/`ApiModule`, server helpers)
- the existing `api/PlayerApi.kt` and `api/queue/**`

## No Gradle
You run **no Gradle**; INT-W3 builds. Use only the signatures below. Open each source line and copy its signature into a comment above the call. Every `PlayerState`/`LyricsState` call runs in `withContext(Dispatchers.Main)`. Abbreviations: `DA` = `desktopCore/src/main/kotlin/com/metrolist/desktop` (moved by M1-1, same packages), `SH` = `shared/src/commonMain/kotlin/com/metrolist/shared`, `SD` = `shared/src/desktopMain/kotlin/com/metrolist/shared`.

## Owned paths
- `desktopCore/.../core/api/PlayerApi.kt`
- `api/queue/**`, `api/lyrics/**` (new `LyricsModule : ApiModule` with the topic `"lyrics"`), `api/output/**`
- `desktopCore/src/test/.../api/{queue,lyrics,output}/**`
- `shared/src/desktopMain/kotlin/com/metrolist/shared/playback/ffmpeg/{AudioRenderer.kt,AudioOutput.kt}`: **only** the output-device selection described below (desktopMain; Android untouched)
- `docs/api.md`: additions inside a `<!-- M2-1 -->` section only (the `locked` field)

## Methods
| Method | Backing (exact; import `com.metrolist.desktop.state.playback.PlayerState`) |
|---|---|
| `player.mute {on}` | No API. On: `if (PlayerState.volume > 0f) { PlayerState.previousVolume = PlayerState.volume; PlayerState.setVolumeLevel(0f) }`. Off: `PlayerState.setVolumeLevel(PlayerState.previousVolume)`. `val volume: Float` (PS.kt:747), `var previousVolume` (:749, Float), `fun setVolumeLevel(level: Float)` (:2514). `PlayerState.muted` in `stateNow()` = `volume == 0f` |
| `player.setSpeed {speed, pitch?}` | `fun setPlaybackSpeed(speed: Float)` (:2618, coerced 0.5..2), `fun setPlaybackPitch(pitch: Float)` (:2633). Read back from `Settings.shared.playbackSpeed/playbackPitch` |
| `player.sleepTimer {minutes?, endOfTrack?, cancel?}` | `fun startSleepTimer(durationMs: Long, stopAfterCurrentSong: Boolean, fadeOut: Boolean, finishCurrentSong: Boolean = false)` (:3492). End of track = `startSleepTimer(0L, stopAfterCurrentSong = true, fadeOut = false)`. Cancel: `fun clearSleepTimer()` (:3553). Result `{deadline}` = `System.currentTimeMillis() + PlayerState.sleepTimerTimeLeftMs.value` (`MutableStateFlow<Long>`, :2429–2434). `stateNow().sleep` = `{deadline?, endOfTrack = sleepTimerStopAfterCurrentSong}` when `sleepTimerEnabled` |
| `player.output.list` | **New** (`api/output/OutputDevices.kt`): `javax.sound.sampled.AudioSystem.getMixerInfo()`, keeping mixers where `AudioSystem.getMixer(info).isLineSupported(DataLine.Info(SourceDataLine::class.java, AudioFormat(44100f, 16, 2, true, false)))`. Id = `info.name`. Kind by name keywords (pure function, unit-tested): bluetooth/bt → `bluetooth`, usb → `usb`, headphone/headset → `wired`, speaker/loa → `speaker`, else `other`. Default = "Primary Sound Driver" or the first. `current` = the persisted choice or the default |
| `player.output.set {id}` | Persist in `CorePrefs`? Not available until M1-2b (merged in W2), so use `com.metrolist.core.prefs.CorePrefs` key `outputDevice`. Then **implement routing in shared desktopMain:** `AudioRenderer.setPreferredDevice(device: Any?)` (`SD/playback/ffmpeg/AudioRenderer.kt:461`, empty body today) stores a mixer name; `AudioOutput.kt`'s `openAudioLine` (internal) prefers `AudioSystem.getMixer(info)` whose `info.name == preferred` and falls back to today's logic; the change applies on the next line open (track change or seek). Call it through `MusicPlayer.setPreferredDevice(device: Any?)` (`SD/playback/MusicPlayer.kt:1162`) via `PlayerState.player`. Finally `EqualizerProfiles.onOutputDeviceChanged(EqualizerOutputDevice(key = id, kind = <EqualizerOutputKind>, productName = id))` on Main (`com.metrolist.shared.equalizer`). `EqualizerOutputKind { SPEAKER, WIRED, BLUETOOTH, USB, OTHER }`. **Keep the shared change minimal and fully guarded** (null preferred → identical v1 behaviour) |
| `queue.remove {qids}` | qid → index (`entries.indexOfFirst { it.key == qid }`), then `fun removeQueueItems(indices: Set<Int>, expectedQueue: MusicQueueSnapshot = queue.snapshots.value): QueueRemoval?` (:3611). `null` → `ApiException("busy", "queue locked")` when `Settings.shared.isQueueLocked`, else `conflict` |
| `queue.move {from, to, expectedRevision}` | Check the revision (M1-2a `QueueRevision`), then `fun moveQueueItem(from: Int, to: Int, expectedQueue: MusicQueueSnapshot = queue.snapshots.value)` (:3675). Indices ≤ `currentIndex` → `bad_request`; locked → `busy` |
| `queue.select {qid}` | `fun playQueueOccurrence(key: Long)` (:2657) |
| `queue.clear {keepCurrent}` | `removeQueueItems(((cur+1) until entries.size).toSet())`; `keepCurrent=false` additionally `PlayerState.pause()` + removes the current entry if allowed |
| `queue.radio {seedId}` | Resolve the `SongItem` (M1-2a `PlayerApi.resolve`), then `fun startRadio(song: SongItem)` (:3738) |
| `queue` snapshot | Add `locked: Settings.shared.isQueueLocked` (api.md additive field, in your marked section). **Note:** the default is `true`, so the UI must show the lock and offer "Mở khoá" → new method `queue.setLocked {on}` (`Settings.shared.isQueueLocked = on`); add it to api.md in your section and to `protocol` in a `// <M2-1>` block |
| `lyrics.get {trackId}` | Current track only. Read `LyricsState` (`com.metrolist.desktop.state.playback.LyricsState`, an object) on Main: `currentLyricsEntries: List<LyricsEntry>`, `currentLyricsAgents`, `currentLyricsProvider: String?`, `currentLyricsOffsetMs: Int`, `currentLyricsSongId`, `isLyricsLoading`. Map with the pure `LyricsMapper` (`api/lyrics/LyricsMapper.kt`). `LyricsEntry.time`/`endTime` are **ms**; `WordTimestamp.startTime`/`endTime` are **seconds** (×1000). `synced` = "word" if any `words != null && words.none { it.isLineTimed }`, else "line" if `LyricsUtils.hasPlaybackTiming(entries)` (`com.metrolist.shared.api.lyrics.LyricsUtils`), else "none". `tr = translatedText`, `ro = romanizedText`. `agent`: `isBackground` → "bg"; otherwise the first distinct agent id → "v1", the second → "v2". Not the current track → `notFound` |
| topic `lyrics` | snapshot = `lyrics.get` for the current track or `null`. Then `snapshotFlow { LyricsState.currentLyricsSongId to LyricsState.currentLyricsEntries }` + offset + loading, collected on Main, `distinctUntilChanged`, `sample(250)` → `lyrics.updated` / `lyrics.cleared` (when entries become empty and the song changes) |
| `lyrics.search {trackId, query?}` | `LyricsState.fetchProviderResults(song: SongItem, customTitle: String? = null, customArtist: String? = null)` (LyricsState.kt:436) on Main. Then await `LyricsState.providerSearch?.groups` (`StateFlow<List<LyricsProviderGroup>>`, `com.metrolist.shared.repository`) until no group is `loading` (timeout 15 s). Candidate id = `"${group.provider.name}:$index"`. `synced` from `LyricsProviderResult.timingKind` (`UNSYNCED`/`LINE_SYNCED`/`WORD_SYNCED`). `preview` = `result.preview` |
| `lyrics.choose {trackId, candidateId}` | Map back through `providerSearch.groups.value`, then `LyricsState.selectProviderResult(song: SongItem, result: LyricsProviderResult)` (:464) |
| `lyrics.setOffset {trackId, ms}` | Current track: `LyricsState.updateLyricsOffset(offsetMs: Int)` (:524). Otherwise `LyricsRepository.setLyricsOffset(videoId: String, offsetMs: Int): Boolean` (`SH/repository/LyricsRepository.kt:806`; obtain the instance via Koin `GlobalContext.get().get<LyricsRepository>()`; check how LyricsState obtains it and do the same) |
| `lyrics.translate {trackId, on, target?}` | `target` → `Settings.shared.lyricsAiTargetLanguage = target`. Then `LyricsState.setManualLyricsTranslation(enabled: Boolean)` (:576). Results arrive via the topic |
| `lyrics.romanize {trackId, on}` | `Settings.shared.lyricsRomanizationEnabled = on`, then `LyricsState.refreshEditedLyrics(song)` (:531) |
| `lyrics.edit {trackId, lrc}` | `LyricsState.saveCustomLyrics(song: SongItem, lyricsText: String)` (:537) |
| `lyrics.providers` / `.set {order, enabled}` | Read `LyricsState.lyricsProviderOrder: List<LyricsProvider>` and `lyricsEnabledProviders: Set<LyricsProvider>`. Write `Settings.shared.lyricsProviderOrder = order.joinToString(",")` and `lyricsEnabledProviders = enabled.joinToString(",")`. Validate names against `LyricsProvider.userConfigurable` (`com.metrolist.shared.model.LyricsProvider`) |

**Never call** (internal or private): `DesktopLyricsOffsetWrites`, `LyricsState.enrichLyrics`, `PlayerState.applyPlaybackSpeed/sleepTimerJob/volumeState`.

## Verify (no builds)
1. **JUnit (pure):**
   - `OutputKindTest`
   - `LyricsMapperTest` (seconds→ms, synced detection, agents → v1/v2/bg, tr/ro)
   - `QueueIndexTest` (qid→index, the `clear` range)
   - `CandidateIdTest`
   - `SleepDeadlineTest`
2. **Contract:** M2-2 wrote `tests/contract/suites/m2-player.mjs`; INT-W3 runs it on real. It must be green except `player.output.set` audible routing (manual QA).
3. Report: a self-review checklist plus the exact shared diff (`git diff origin/feat/desktop-core -- shared`) with the reasoning that v1 behaviour is unchanged when no device is chosen. STATUS line.
