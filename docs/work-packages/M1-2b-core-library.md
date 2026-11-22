# M1-2b: Core API for the library, local data, user albums, history and art

**Wave 2. Agent:** Sonnet. **Repo:** MinMusic. Conventions apply (`conventions.md`).
- **Worktree:** `D:Coding_ProjectMinMusic-wt-m1-2b`, branch `feat/desktop-core-m1-2b` from `origin/feat/desktop-core` **after INT-W1**, so it includes M1-1 (moved files, same packages) and M1-2a (`ApiRegistry`, `Cards.kt`, `M0Module`).
- **Test checkout:** `D:Coding_ProjectMinMusic_4_Windows-wpM1-2b-test` (detached `origin/main`).

Read first:
- `docs/api.md` §1.8B, §1.9 (`library.changed` ≤ 4 Hz), §1.10 (`core:` art), §2, §3.4, §4 (`library` topic)
- `desktopCore/.../api/{LibraryApi,Dto,Cards,ApiRegistry,ApiModule}.kt`, `api/m0/M0Module.kt`, `server/{CoreServer,Rpc}.kt`

## No Gradle
You run **no Gradle build**. INT-W2 compiles and tests; follow the M1-2a "No Gradle" rules. **Before** coding each method, open the backing function named in the table and copy its exact signature and package into a comment above the call.
- Backing files:
  - `shared/src/commonMain/kotlin/com/metrolist/shared/playlist/PlaylistMutations.kt`
  - `shared/.../db/daos/*`
  - `shared/.../state/{SongLikeState,AlbumLikeState,ArtistSubscribeState}.kt`
  - `shared/.../settings/BlockedContent.kt`
  - `desktopCore/src/main/kotlin/com/metrolist/desktop/history/HistoryRepository.kt` (moved by M1-1)
  - `.../desktop/storage/SongCacheManager.kt`
- Look each one up with `rg -n "fun <name>" shared desktopCore`.

## Ownership
- **Not yours:** `desktopApp/**`, `shared/**`, the build files, `api/{browse,search,pages,queue,app}/**`, `HomeApi.kt`, `PlayerApi.kt`, `CoreRuntime.kt`.
- Replicate `internal` logic rather than editing shared code.

## Owned paths
- `desktopCore/src/main/kotlin/com/metrolist/core/api/{LibraryApi.kt,library/**}`
- `api/m0/M0Module.kt`: remove the library entries; they move to `api/library/LibraryModule.kt` (`object LibraryModule : ApiModule`, with `LibraryApi`, `UserAlbumApi`, `HistoryApi`, `TrackApi` handlers and the topic `"library"`)
- `core/prefs/**`, `core/seed/**`, `server/ArtRoute.kt`
- `CoreServer.kt`: **one** line that installs `ArtRoute`
- `CoreOptions.kt`: the `--seed-library` flag
- `SidecarMain.kt`: one seed call after backend init
- `desktopCore/src/test/kotlin/com/metrolist/core/api/library/**`
- `api/pages/**` and `api/browse/**`: **only** to replace the `TODO(M1-2b) saved/subscribed` placeholders with the real flags

**Keep the signature `LibraryApi.songs(list: String, sort: JsonObject?, filter: JsonObject?)`.** M0's `player.play {kind:"library"}` uses it.

## Methods
| Method | Backing | Notes |
|---|---|---|
| `library.window` | Song lists (`songs`, `liked`, `downloaded`) exist. Add `albums` → `albumsByCreateDateAsc()`; `artists` → `artistsByCreateDateAsc()`; `playlists` → `playlistsByCreateDateAsc()` (non-user-album); `userAlbum:<lp:id>` → `PlaylistDao.playlistSongs(id)`; `history` → see `history.window`; `cached` → `SongCacheManager.getCachedSongs()` | **Sorts:** `added`, `title`, `artist`, `album`, `duration` and `plays`, plus `lastPlayed` (from the history last-play map) and `custom` (user album position). Unsupported combinations → `bad_request`. `FilterSpec` text is case- and diacritic-insensitive (`vi`). **Performance:** cache the sorted id list per `(list, sort, filter, revision)` and slice it. A window call at offset 4,900 of 5,000 takes ≤ 30 ms warm |
| `library.counts` | Existing, plus `userAlbums` | – |
| `library.indexOf {list, sort, filter?, id}` | Index in the cached sorted list | `not_found` if absent |
| `library.sync` | `LibraryViewModel.refresh(force=true)` + `SongLikeState.refreshLikesFromRemote(true)` when signed in; otherwise `{}` | Progress arrives as `library.changed` |
| topic `library` | snapshot `{counts, revision}`. Collect the DAO flows for songs, liked, downloaded, albums, artists, playlists, userAlbums and history, then `debounce`/`sample` to ≤ 4 Hz → `library.changed {lists, revision}`. Bump one global `revision` per batch. Send `userAlbums.changed {}` when user albums change | Revision source of truth for every window and for `expectedRevision` |
| `track.like {id, liked}` | `SongLikeState.addLike(song)` / `removeLike(id)`. Resolve the `SongItem` from the DB, else from YouTube metadata | – |
| `album.save` / `artist.subscribe` / `playlist.save {id, on}` | `database.toggleAlbumLiked` (read the state first, no-op if equal); `setArtistSubscribed(...)`; `setStoredPlaylistBookmarked(...)`. Fetch the header if needed | – |
| `track.info {id}` | `Song` + `FormatEntity` + `SongCacheManager.getCachedFilePath` + `loudnessDb` | Unknown fields are omitted. `sources` = the current source only |
| `track.sources {id}` | **M1 stub:** `{options:[{source, id, quality, auto:true, available:true}]}` for the current source only | The full per-track choice is moved to M3-2 (no v1 backing) |
| `track.setSource` | `unsupported` in M1 | M3-2 |
| `track.block` / `artist.block {id, on}` | `SongLikeState.dislike(song)` / `removeDislike(id)`; `BlockedContent.blockArtist(id, name, thumb)` / `unblockArtist(id)` | Bumps the library revision |
| `userAlbum.create {title, trackIds?}` | `createUserAlbum(db, name, songs)`. With no tracks, insert `PlaylistEntity(name, isLocal=true, isUserAlbum=true)` directly | Returns `{id:"lp:<dbId>"}` |
| `userAlbum.rename/delete` | `renameStoredPlaylist` / `deleteStoredPlaylist` | – |
| `userAlbum.setCover {id, path|null}` | Validate with **ImageIO** (≤ 16 MiB, ≤ 16.7 MP, readable) — **not** `readPlaylistCover`, which uses Skia. Copy to the v1 cover dir the way `persistDesktopCoverBytes` does, then `setStoredPlaylistCover`. `null` → `removeStoredPlaylistCover` | Returns `{art:{src:"core:cover/<id>-<sha8>"}}` |
| `userAlbum.add {id, trackIds, dedupe}` | `addSongsToLocalPlaylist(db, id, songs, allowFirstDuplicate=!dedupe)` | `{added, skipped}` |
| `userAlbum.remove {id, entryIds}` | Look up `PlaylistSongMap` by id → `removeSongFromLocalPlaylist` | `entryId` = `PlaylistSongMap.id` as a string; it is exposed as `Track.setVideoId` in `userAlbum:` windows |
| `userAlbum.move {id, from, to, expectedRevision}` | Translate indices → mapping ids → `moveSongInLocalPlaylist(db, id, fromMappingId, toMappingId)` | Stale revision → `conflict` |
| `userAlbum.pin {id, pinned}` | **New:** `CorePrefs` (`core/prefs/CorePrefs.kt`), a small JSON file `<state dir>/core-prefs.json` holding `pinnedUserAlbums: string[]`, written atomically | Backup inclusion is handled in M4-3 |
| `userAlbum.list` | `PlaylistDao.userAlbums()` + `playlistLibraryStats(ids)` + pins | `revision` = the library revision |
| `history.window` | `HistoryRepository.getHistoryPage(limit, offset, "", sort, dir)`, items `Track&{playedAt, eventId}` | `groups`: Hôm nay / Hôm qua / Tuần này / Tháng này / Cũ hơn, computed from `playedAt` in the local zone. Labels are i18n keys `w2_hist_*`; the UI translates them |
| `history.remove {eventIds}` / `history.clear` | `deleteHistoryEntries(ids, deleteRemote = signedIn)`. Clear = `getVisibleHistoryIds("")`, then delete | – |
| `stats.get {period}` | `HistoryRepository.getStatisticsSnapshot(sinceMs, untilMs)` | `minutes` = `playTimeMs / 60000`. Top lists of 10 |
| `import.files` | **Moved to M4-2.** Answer `unsupported` | – |
| `GET /art/<kind>/<id>?w=&k=` | `ArtRoute`: check `k` = artToken (else 403). Kinds: `cover` (user album covers), `local` (embedded art of local/downloaded files via the existing tag reader). ImageIO resize to `w` (bucket), JPEG q85. Cache under `cache\metrolist\image_cache\core\` | `Cache-Control: max-age=31536000, immutable`. No Skia |

### Test-only seed: `--seed-library <file.json>`
It is honoured only when the DB has no songs. It inserts through DAO calls (not raw SQL), with `SongEntity.inLibrary` set. Format (M1-5 generates the file as `tests/fixtures/library-seed.json`):

```json
{"songs":[{"id":"","title":"","artists":[{"id":"","name":""}],"album":{"id":"","title":""},"durationMs":0,"thumbnailUrl":"","liked":false,"addedAt":0,"plays":0}],
 "albums":[{"id":"","title":"","artists":[{"name":""}],"year":0,"thumbnailUrl":""}],
 "artists":[{"id":"","name":"","thumbnailUrl":""}],
 "userAlbums":[{"title":"","songIds":[""],"pinned":false}],
 "history":[{"songId":"","playedAt":0,"playTimeMs":0}]}
```

- **Budget:** 5,000 songs, 40 albums, 10 user albums and 2,000 history events seed in ≤ 10 s.
- It is logged at INFO and never compiled out (harmless without the flag).

## Verify (no builds)
- **JUnit:**
  - sort and filter matrix on an in-memory Room DB
  - window slicing
  - revision bump coalescing (≤ 4 Hz)
  - `userAlbum.move` index → mapping id
  - `conflict` on a stale revision
  - `CorePrefs` atomic write
  - history day groups (DST and midnight edges)
  - ArtRoute token check and resize dimensions
- **Contract:** `--suite m1-library` on the real target, with the seed (M1-5 adds `--seed-library` to the real-target launch when `tests/fixtures/library-seed.json` exists).

Then, at **INT-W2**:
1. `m1-library` (M1-5) is green on the real target (seeded), including:
   - `library.window offset=4900 limit=200` → 100 items, `total` 5000
   - every `LocalList` and every sort
   - `userAlbum.*` round-trips persisting across a core restart
   - `history.window` groups
   - `library.changed` after `track.like`, within 300 ms
2. `library.window` p95 ≤ 30 ms warm over 50 random windows.
3. `/art/cover/...` serves a resized JPEG with the immutable header. A wrong `k` → 403.
4. Your report has a self-review checklist: every file, its imports, and every backing signature copied from source. STATUS.md line.
