# M1-2a: Core API for browse, search, pages, play contexts, basic queue, plus the API registry

**Wave 1. Agent:** Sonnet. **Repo:** MinMusic. Conventions apply (`conventions.md`).
- **Worktree:** `D:\Coding_Project\MinMusic-wt-m1-2a`, branch `feat/desktop-core-m1-2a` from `origin/feat/desktop-core` (dac1f688 or later).
- **Test checkout:** `D:\Coding_Project\MinMusic_4_Windows-wp\M1-2a-test`.

Read first:
- `docs/api.md` §1.2, §1.5, §1.7, §1.8A, §2, §3.1 (`app.openUrl`, `app.copyLink`), §3.2, §3.3, §3.5, §3.6 (`player.play`, `queue.window/add/addContext/setAutoplay`), §4
- Existing code, for the patterns: `desktopCore/src/main/kotlin/com/metrolist/core/api/{HomeApi,PlayerApi,Dto,LibraryApi,SysApi}.kt`, `server/{Rpc,CoreServer}.kt`, `SidecarMain.kt`

## No Gradle
You run **no Gradle build**. The wave-1 integration agent compiles and tests. So:
- Use only the APIs listed below, with the exact signatures and imports shown. If you need anything else, open its source and copy the signature into a comment above the call.
- Keep handlers small: parse params → call the backing API → map with a **pure** function. Unit-test the pure functions; integration runs the tests.
- Never use an `internal` or `private` member of `shared`/`desktopApp`. Replicate the logic instead, with a comment naming the original.
- Before you finish, re-read every file for imports, nullability and `suspend` context. Every call into `PlayerState` runs in `withContext(Dispatchers.Main)`.

## Owned paths
- `desktopCore/src/main/kotlin/com/metrolist/core/api/{ApiRegistry.kt,ApiModule.kt,Cards.kt}`
- `api/{browse,search,pages,queue,app,m0}/**`
- `api/HomeApi.kt`, `api/PlayerApi.kt`
- `SidecarMain.kt`: one change only (the registry, below)
- `desktopCore/src/test/kotlin/com/metrolist/core/api/**`

**Not yours:**
- `desktopApp/**`, `shared/**`, `*.gradle.kts` (M1-1)
- `CoreRuntime.kt`, `SysApi.kt`, `core/bridge/**` (M1-1)
- `LibraryApi.kt` (read only; M1-2b in wave 2)

## 1. API registry (do this first)
- **`api/ApiModule.kt`:**
  ```kotlin
  package com.metrolist.core.api
  interface ApiModule { val handlers: Map<String, Handler>; val topics: Map<String, Topic> get() = emptyMap() }
  ```
- **`api/ApiRegistry.kt`:** `object ApiRegistry { fun load(): Pair<Map<String, Handler>, Map<String, Topic>> }`.
  - Enumerate class names matching `com/metrolist/core/api/<pkg>/<Name>Module.class` from the code source of `ApiRegistry::class.java.protectionDomain.codeSource.location`. That is a jar (`java.util.jar.JarFile`) or a classes directory (walk the files).
  - `Class.forName(name).getField("INSTANCE").get(null) as ApiModule`.
  - Merge the maps. Throw `IllegalStateException("duplicate method X in A and B")` on a duplicate.
  - Sort the modules by class name for determinism.
- **`api/m0/M0Module.kt`:** `object M0Module : ApiModule` with `handlers = SysApi.handlers + LibraryApi.handlers` and `topics = mapOf("app" to SysApi.appTopic)`. In wave 2, M1-2b moves the library entries into its own module.
- **`api/pages/PagesModule.kt`** etc.: one `object <Area>Module : ApiModule` per area. HomeApi and PlayerApi join `api/browse/BrowseModule` and `api/queue/QueueModule`, which hold `PlayerApi.handlers` and `"player" to PlayerApi.playerTopic`.
- **`SidecarMain.kt`:** replace the `val handlers = …` / `val topics = …` lines with `val (handlers, topics) = ApiRegistry.load()`. Remove the now-unused imports.
- **JUnit `ApiRegistryTest`:** loads from the test classes dir, finds ≥ 5 modules, no duplicates, contains `home.get`, `player.play`, `queue.window`, `search.run`.

## 2. `api/Cards.kt` (shared DTOs; M1-2b and later WPs use them)
- `@Serializable` `AlbumCard(id, title, artists: List<ArtistRef>, year: Int? = null, art: Art? = null, source: String, kind: String)`.
- `ArtistCard(id, name, art: Art? = null, subtitle: String? = null, source: String)`.
- `PlaylistCard(id, title, subtitle: String? = null, art: Art? = null, source: String, owner: String? = null, local: Boolean, count: Int? = null)`.
- Mappers:
  - `fun AlbumItem.toCard()`, `ArtistItem.toCard()`, `PlaylistItem.toCard()`, using the same `Art`/`ArtistRef` conversion as `Dto.kt` (`toTrack`).
  - `fun cardJson(type: String, card: Any): JsonObject` (adds `"t"`).
  - The existing `YTItem.toItem()` in `Dto.kt` stays the item mapper. Check that its output equals these shapes and note any field mismatch in the report. Do not edit `Dto.kt`.

## 3. Backing APIs (exact)
Imports:
```kotlin
import com.metrolist.shared.state.GlobalYouTubeRepository          // .instance: YouTubeRepository
import com.metrolist.shared.api.YouTubeRepository
import com.metrolist.shared.model.*                                 // SongItem, YTItem, AlbumItem, ArtistItem, PlaylistItem, BrowseItem, HomeSection, AlbumPage, PodcastPage, ArtistPageResult, BrowsePageData, SearchSummaryPage, SearchSummary, SearchResultPage, SearchSuggestions, SearchFilter, Chip
import com.metrolist.shared.source.SourceRegistry                   // GlobalContext.get().get<SourceRegistry>()
import com.metrolist.shared.source.SourceId
import com.metrolist.shared.source.sourceOf
import com.metrolist.shared.ui.components.minmusic.MmVnCharts       // + MmChartTab (same file)
import com.metrolist.shared.utils.ShareUrls
import com.metrolist.shared.utils.parseYouTubeUrl                   // returns YouTubeUrlParser.ParsedUrl? (Video/Playlist/Album/Artist); open YouTubeUrlParsing.kt for the import of ParsedUrl
import com.metrolist.shared.viewmodels.LastFmArtistCache            // LastFmArtistCache.shared (companion)
import com.metrolist.shared.settings.Settings                       // Settings.shared.autoLoadMore: Boolean (var)
import com.metrolist.desktop.state.playback.PlayerState as DesktopPlayerState
import com.metrolist.desktop.utils.DesktopUrlHandler                // object
```

`YouTubeRepository` (`shared/src/commonMain/kotlin/com/metrolist/shared/api/YouTubeRepository.kt`):

| Line | Signature |
|---|---|
| 526 | `suspend fun getBrowsePageData(browseId: String, params: String? = null, title: String? = null, loadAllPages: Boolean = true): BrowsePageData` (fields `title, sections: List<HomeSection>, continuation`) |
| 533 | `suspend fun getHomeSectionsContinuation(token: String, isPersonal: Boolean = false, loadAllPages: Boolean = true): Pair<List<HomeSection>, String?>` |
| 817 | `suspend fun getArtist(channelId: String): ArtistPageResult` (`sections: Map<String, List<YTItem>>`, `sectionBrowseIds: Map<String, Pair<String?, String?>>`, `topTracksSection`, `videoSections`, `librarySection`; key `"header"` holds an `ArtistItem`) |
| 844 | `suspend fun getArtistSongs(channelId: String, page: ArtistPageResult? = null, …)`. Open it and confirm the return type |
| 990 | `fun getPlaylistPages(playlistId: String, applyContentFilters: Boolean = true): Flow<PlaylistPage>` |
| 998 | `suspend fun getPlaylistPlaybackPage(playlistId: String): PlaylistPage` |
| 1006 | `suspend fun continuePlaylistPage(page: PlaylistPage, applyContentFilters: Boolean = true): PlaylistPage`. `PlaylistPage` public: `sections`, `songs: List<SongItem>`, `hasMore`, `isOffline` |
| 1146 | `fun getPodcastPages(podcastId: String, savedEpisodes: List<EpisodeItem> = emptyList(), initialPage: PodcastPage? = null): Flow<PodcastPage>` (`podcast, episodes, description, saved, continuation`) |
| 1389 | `suspend fun getAlbum(albumId: String, loadAllPages: Boolean = true, applyContentFilters: Boolean = true): AlbumPage?` (`album: AlbumItem, songs, otherVersions, artistAlbums, description`) |
| 1556 | `suspend fun getSearchSummary(query: String, recordSearchHistory: Boolean = false): SearchSummaryPage` (`summaries: List<SearchSummary(title, items, isTopResult)>`) |
| 1583 | `suspend fun getSearchSuggestions(query: String): SearchSuggestions?` (`queries`, `recommendedItems`) |
| 1618 | `suspend fun searchFiltered(query: String, filter: SearchFilter, continuation: String? = null, recordSearchHistory: Boolean = false, allowOfflineFallback: Boolean = true): SearchResultPage` (`items, continuation`) |
| 2439 | `suspend fun startRadio(videoId: String): List<SongItem>` |
| 2493 | `suspend fun getSongMetadata(videoId: String): SongItem?` |

Other APIs:

| API | Signature |
|---|---|
| `SourceRegistry` (`shared/.../source/SourceRegistry.kt:62`) | `suspend fun <T> call(id: SourceId, block: suspend (MusicSource) -> T): T`; it throws `SourceUnavailableException`, whose `reason` is `NOT_REGISTERED`, `DISABLED` or `DEGRADED` |
| `MusicSource` (`source/MusicSource.kt`) | `search(query: String, filter: SearchFilter, page: Int): SourcePage<YTItem>`, `album(id): AlbumPage?`, `chartPage(chartId, continuation): SourcePage<YTItem>` |
| `MmVnCharts.load(registry: SourceRegistry, sources: List<SourceId>, force: Boolean = false): List<MmChartTab>` | `MmChartTab(key, source, title, songs: List<SongItem>, chartId, continuation)` |
| `MmVnCharts.loadMore(registry, tab, continuation: String): Pair<List<SongItem>, String?>` | – |
| `HomeViewModel` (`shared/.../viewmodels/HomeViewModel.kt`) | `toggleChip(chip: Chip?)` (:1187) and `loadMoreSections()` (:802). `HomeApi.kt` already holds the VM instance and its `uiState`; extend that code, do not create a second VM |
| `LastFmArtistCache.shared` | `suspend refresh(artistId: String, artistName: String, catalogTitles: List<String>)`, then `get(artistId): LastFmArtistData?` (`tags, summary, listeners: String?, scrobbles: String?`) |
| `ShareUrls` | `song(…)`, `playlist(id)`, `album(id)`, `artist(id)`, `podcast(id)` |
| `DesktopUrlHandler` | `canHandle(rawInput: String?): Boolean` and `normalizeUrl(raw: String): String?`. Never call `handleUrl` |
| `DesktopPlayerState` (`desktopApp/.../state/playback/PlayerState.kt`, `object PlayerState`) | `playTrack(track: SongItem, list: List<SongItem>? = null, songsOnly: Boolean = false, shuffleModeEnabled: Boolean? = null)`, `shuffleQueue(songs, songsOnly = false)`, `addToQueue(songs: List<SongItem>)`, `playNext(songs: List<SongItem>)`, `moveQueueItem(fromKey: Long, toKey: Long, selectedEntryKeys: Set<Long> = emptySet())`, `startRadio(song: SongItem)`, `val queue` (`queue.state: StateFlow<MusicQueueState(entries: List<MusicQueueEntry(key: Long, song)>, currentIndex: Int)>`, from `com.metrolist.shared.playback`) |
| Server helpers (`com.metrolist.core.server`) | `handler{}`, `topic{}`, `backendReady()`, `badRequest/unsupported/notFound`, `ApiException(code, msg)`, `JsonObject.str/int/long/bool/obj/requireStr/requireLong`, `emptyResult()`, `Conn` |

## 4. Methods
| Method | Implementation |
|---|---|
| `home.get {chip?, refresh?}` | Existing `HomeApi.get`, plus: when `chip` is given, find it in `uiState.chips` by `chip.params ?: chip.browseId ?: chip.title`, call `toggleChip(it)` on Main, and wait for `uiState.first { !it.isLoading }` (timeout 8 s). Push `home.updated {shelves}` through `com.metrolist.core.bridge.AppEvents.emit("home.updated", json)` when the network result differs from the cached one. `AppEvents` is created by M1-1 (`object AppEvents { fun emit(event: String, payload: JsonElement) }`); call only that function |
| `home.more {cursor}` | `getHomeSectionsContinuation(cursor, isPersonal = false, loadAllPages = false)` → `{shelves, next}` |
| `charts.get {source, key?}` | `zing`/`nct`: `tabs = MmVnCharts.load(registry, listOf(SourceId.ZING or NCT))`. Pick the tab by `key` (default the first). Items = `tab.songs`, extended once by `loadMore(registry, tab, "full")` when `tab.continuation != null`, deduped by id. `rank = i+1`, `trend = "same"`. `yt`: `getBrowsePageData("FEmusic_charts", loadAllPages = false)`, first section whose items are all `SongItem`. `SourceUnavailableException` → `ApiException(if (DISABLED) "source_disabled" else "source_degraded", …, details {sourceId})` (look at the `ApiException` constructor in Rpc.kt for `details`) |
| `browse.page {browseId, params?}` | `getBrowsePageData(browseId, params, null, loadAllPages = false)`; `next = continuation`. Continuation calls go through `home.more`-style handling with `isPersonal = usesLogin(browseId)`, replicating `browseUsesLogin`: id starts with `FEmusic_library`, `FEmusic_moods_and_genres`, `VLSE` or `VLRDPN` |
| `moods.list` | `getBrowsePageData("FEmusic_moods_and_genres", loadAllPages = false)`; every `BrowseItem` → `{key: "${id}|${params ?: ""}", title}` |
| `search.suggest {q}` | `getSearchSuggestions(q)` → `{queries (≤ 8), items (fill to 8 rows total)}`. Cancel the previous suggest on the same `Conn`: keep a `ConcurrentHashMap<Conn, Job>`; the cancelled call throws `ApiException("cancelled")` |
| `search.run {q, source="all", type="all", cursor?}` | **yt + type all:** `getSearchSummary(q)`; `top` = the first item of the `isTopResult` summary; sections = the other summaries. **yt typed:** `searchFiltered(q, filterOf(type), cursor)`, where `filterOf`: track→SONG, album→ALBUM, artist→ARTIST, playlist→FEATURED_PLAYLIST. **sc/zing/nct:** `registry.call(src) { it.search(q, SearchFilter.SONG, page) }`, cursor `"$src:$page"`. **all:** yt summary + one songs section per enabled source (`registry.available(src) != null`), run in parallel with `supervisorScope`; a failing source is dropped. `next` only for single-source typed queries |
| `search.history.list` / `.remove {q?}` | Local only: `Settings.shared.searchHistory` decoded with `SearchHistoryCodec` (find it: `rg "object SearchHistoryCodec" shared`). `.remove` with no `q` clears all |
| `album.get {id}` | YouTube ids: `getAlbum(id)`. Ids with prefix `sc:`/`zing:`/`nct:` (`sourceOf(id)`): `registry.call(src) { it.album(id) }`. Null → `notFound`. Map: `album` card + `durationMs` (sum), `trackCount`, `year`, `description`, `saved = false` (M1-2b adds the real flag in wave 2: leave `// TODO(M1-2b) saved`), `tracks`, `otherVersions` cards, `moreBy` = `rows` shelf of `artistAlbums` |
| `artist.get {id}` | `getArtist(id)`. Header = `sections["header"]?.firstOrNull() as? ArtistItem`. Shelves = the other entries, in order. Shelf key = `sectionBrowseIds[title]?.first ?: slug(title)`. Layout: `rows` for `topTracksSection`, else `cards`. `subscribed = false` (TODO M1-2b). `sources = ["yt"]` |
| `artist.about {id, name}` | Call `artist.get` internally for `catalogTitles` (song titles of the top tracks), then `LastFmArtistCache.shared.refresh(id, name, titles)` and `.get(id)`. Result: `bio = summary`, `lastfm = {listeners, playcount = scrobbles?.filter(Char::isDigit)?.toLongOrNull(), tags}` |
| `artist.tracks {id, cursor?}` | First page: `getBrowsePageData(browseId, params, loadAllPages = false)`, where `(browseId, params)` = `getArtist(id).sectionBrowseIds[topTracksSection]`. Then `getHomeSectionsContinuation(cursor, isPersonal = true, loadAllPages = false)` |
| `playlist.get {id, cursor?}` | No cursor: `getPlaylistPages(id, false).first()`. With a cursor: look up the `PlaylistPage` in `PageCursors` (below) and `continuePlaylistPage(page, false)`. `next` = `PageCursors.put(page)` if `page.hasMore`, else null. Header = `page.sections["header"]?.firstOrNull() as? PlaylistItem`. `editable = false`. `revision = tracks.map { it.id }.hashCode()` |
| `podcast.get` / `podcast.episodes` | `getPodcastPages(id).first()`. For `episodes {id, cursor}`, keep the `PodcastPage` in `PageCursors` and take the next emission from `getPodcastPages(id, initialPage = page).drop(1).first()`. Verify that against the function body; if the semantics differ, use `getPodcast(id, initialPage)` |
| `related.get {trackId}` | YouTube id: `startRadio(trackId).drop(1).take(25)` → one `rows` shelf `{key:"related"}`. Otherwise `{shelves:[]}` |
| `app.openUrl {url}` | `DesktopUrlHandler.canHandle(url)` → `normalizeUrl(url)` → `parseYouTubeUrl(norm)`. Album → `{route:"album", params:{id}}`; Playlist → `playlist`; Artist → `artist`; Video → `player.play tracks [id]`, then `{handled:true}`. Not parsable → `{handled:false}`. Pure mapping function `navFor(parsed)`, unit tested |
| `app.copyLink {id, kind}` | YouTube ids → `ShareUrls.song/album/artist/playlist/podcast`. Other namespaces → `unsupported`. Pure, unit tested |
| `player.play` | Extend `PlayerApi.play`: `album` → `getAlbum(id)!!.songs`; `playlist` → `getPlaylistPlaybackPage(id)`, then `continuePlaylistPage` while `hasMore` and `songs.size < 5000`; `artist` → `getArtistSongs(id)` with `songsOnly = true`; `radio` → `DesktopPlayerState.startRadio(resolve(listOf(id)).first())` and return; `userAlbum` → `GlobalContext.get().get<DatabaseDao>().playlistSongs(id.removePrefix("lp:")).first().map { it.song.toSongItem() }` (open `PlaylistDao.playlistSongs` and confirm the entity property names). Keep `tracks`/`library`. Make `resolve` `internal` |
| `queue.window {offset, limit≤200}` | `DesktopPlayerState.queue.state.value` → `{total, revision, currentIndex, items: entries.slice(..).map { it.song.toTrack() + ("qid" to it.key.toString()) }}` |
| `queue.add {ids, position}` | Resolve the songs. `"next"` → `playNext`; `"end"` → `addToQueue`; a number `n` → `addToQueue`, then for each added entry `moveQueueItem(fromKey = newKey, toKey = entries[n].key)`. Return `{revision}` |
| `queue.addContext {context, position}` | The context resolver (`PlayerApi.resolveContext(context): List<SongItem>`, extracted from `play`) + the `queue.add` logic |
| `queue.setAutoplay {on}` | `Settings.shared.autoLoadMore = on` |
| topic `queue` | `QueueApi.queueTopic`. Snapshot = `{total, revision, currentIndex, head}` (50 entries from `currentIndex-5`). Then collect `queue.state`, `sample(250)`, emit `queue.changed {revision, currentIndex}`. `QueueRevision`: an `AtomicLong` bumped on each distinct `queue.state` emission (collector started lazily on first use) |

**`PageCursors`** (`api/pages/PageCursors.kt`): `object PageCursors { fun put(v: Any): String; fun <T> get(id: String): T? }`. The id is 12 random base36 characters. Use an access-ordered `LinkedHashMap` (LRU 64) with a 10 min TTL. An unknown id → `ApiException("bad_request", "stale cursor", retryable = true)`.

**Auto-advance:**
- In `PlayerApi.stateNow()` set `canNext = queue.currentIndex + 1 < queue.entries.size || repeat == RepeatMode.ALL || (Settings.shared.autoLoadMore && repeat == RepeatMode.OFF && track != null && sourceOf(track.id) == SourceId.YT)`.
- Log `CoreLog.info("queue end: autoplay=$x seed=$id")` when the current index reaches the last entry.

Out of scope (M2-1): `queue.remove/move/select/clear/radio`, sleep timer, output, lyrics.

## Verify (no builds)
1. **JUnit** in `desktopCore/src/test/kotlin/com/metrolist/core/api/**`, pure functions only, no network or DB:
   - `ApiRegistryTest`
   - `PageCursorsTest` (LRU, TTL via an injectable clock)
   - `UsesLoginTest`
   - `SearchCursorTest` (`"zing:3"` round-trip)
   - `OpenUrlTest` (≥ 12 URLs: music.youtube.com watch/playlist/browse MPREb/channel, youtu.be, `minmusic://`, `metrolist://`, zing, nct, junk)
   - `CopyLinkTest`
   - `CanNextTest` (a pure `canNext(...)` function)
2. **Self-review checklist** in the report: every new file with its imports verified against the source paths above, and every `PlayerState` call inside Main.
3. Wave-1 integration runs `--suite m1-browse,m1-queue` (written by M1-5) against the real core. Also list in the report the 3 riskiest calls you could not verify.
4. STATUS.md line with the commit.
