# M4-4a: Core third-party playlist import (Spotify, Tidal, Deezer, Apple, Amazon)

**Wave 5. Agent:** Sonnet. **Repo:** MinMusic. Conventions apply.
- **Worktree:** `D:\Coding_Project\MinMusic-wt-m4-4a`, branch `feat/desktop-core-m4-4a` (after INT-W4, which includes M3-2's `WebLoginConfigs` and the shell request channel).
- **Test checkout:** `…-wp\M4-4a-test`.

Read first:
- `docs/api.md` §3.12 `import.*`, §4 `app` (`import.progress`), §5 `shell.webLogin`
- `docs/architecture.md` §5.1
- `M3-2-core-accounts-sources.md` (how `WebLogin.request(cfg)` is called)

## No Gradle
INT-W5 builds. The v1 orchestrators (`DesktopPlaylistImportExecutor`, `Desktop*ImportFlow`) are `internal` and Compose-bound: **do not use them.** Use the shared managers below. Copy each signature into a comment above its call.

## Owned paths
- `desktopCore/.../core/api/importlists/**` (`ImportListsModule`) + tests
- `desktopCore/.../core/shell/WebLoginConfigs.kt`: append the provider configs **only inside** a `// <M4-4a>` block. M3-2 created the file.

## Backing (exact; `SC` = `shared/src/commonMain/kotlin/com/metrolist/shared`)
| Provider | Login cookie → auth | List | Tracks |
|---|---|---|---|
| spotify | `spotifySessionCookie(cookieHeader: String?): String?` (`SC/spotifyimport/SpotifySessionCookie.kt:3`) → `SpotifyImportManager.authenticate(spDc: String)`. Manager: `class SpotifyImportManager(clientFactory: () -> SpotifyClient, loadStoredSession: () -> String? = { null }, saveStoredSession: (String) -> Unit = {})` (`shared/src/jvmSharedMain/.../spotifyimport/SpotifyImportManager.kt:23`). Construct it as v1 does (`rg -n "SpotifyImportManager\(" desktopCore desktopApp`) with load/save of `Settings.shared.spotifySession`. `restorePersistedSession(): Boolean` at start | `loadPlaylists(): List<PlaylistMeta>` | `loadPlaylist(playlist: PlaylistMeta, onTrackProgress: ((Int, Int) -> Unit)? = null): LoadedPlaylist` |
| tidal | `TidalImportManager.extractSessionCredentials(cookieHeader): Pair<String,String>?` → `authenticate(sessionId, userId)` | `loadPlaylists(likedSongsName: String = "Liked Songs"): List<LoadedPlaylist>` | `loadPlaylist(playlist: LoadedPlaylist, likedSongsName, onProgress: (Int, Int?) -> Unit): ImportedPlaylistData` |
| deezer | `DeezerImportManager.extractArl(cookieHeader): String?` → `authenticate(arl)` | same as tidal | same (`:99`) |
| amazon | `AmazonMusicImportManager.extractSessionCookie(cookieHeader): String?` → `authenticate(cookies, host)` (host from the final URL; must be one of `AmazonMusicPlaylistImporter.marketplaceHosts`) | same | same (`:104`) |
| apple | `AppleMusicPlaylistImporter.extractAppleMusicUserToken(cookieHeader: String?): String?` (object) | `loadUserPlaylists(userToken: String): Result<List<PlaylistMeta>>` | `loadUserPlaylistTracks(userToken, playlistUriOrId, playlistName = "", onProgress): Result<ImportedPlaylistData>` |

Packages: `com.metrolist.shared.spotifyimport`, `.tidalimport`, `.deezerimport`, `.amazonmusicimport`, `.playlistimport`. `PlaylistMeta` is in `meow.nyx.spotlib` (`SC/meow/nyx/spotlib/Models.kt:10`). **Confirm each import line from the source file headers.**

**Run:**
- `class PlaylistImportManager(database: MusicDatabase, repository: YouTubeRepository)` (`SC/playlistimport/PlaylistImportManager.kt:53`):
  - `resolveImportTracks(tracks: List<CsvTrack>, destination: Destination?, provider: ImportSourceType?, …progress)` (:57; **open it and copy the full parameter list**)
  - then `importResolvedTracks(name, matches, destination, provider, sourceYouTubePlaylistId = null, coverUrl = null, onProgress: (Int, Int, SongItem?) -> Unit): Result<ImportResult>` (:123)
- `Destination` = `NewLocal` (then mark the created playlist as a user album: find the `isUserAlbum` flag write used by `createUserAlbum` in `PlaylistMutations.kt:621`) or `EXISTING(playlist: PlaylistEntity)`.
- `ImportSourceType` = SPOTIFY, APPLE_MUSIC, DEEZER, TIDAL, AMAZON.
- Convert provider tracks → `CsvTrack(title, artist, videoId = null, …)` (open `PlaylistImportManager.kt:620`).
- Concurrency gate: `SpotifyImportOperationGate.tryStart()` / `finish()` (`SpotifyImportManager.kt:333`).

## Methods
| Method | Implementation |
|---|---|
| `import.providers` | 5 items; `signedIn` = the manager's `isAuthenticated` (Spotify also `Settings.shared.spotifySession.isNotBlank()`) |
| `import.login {provider}` | `WebLogin.request(WebLoginConfigs.<provider>)` (M3-2 API). Configs for the URLs, hosts and done-cookies: spotify `sp_dc` on `open.spotify.com`, tidal `sid`+`userId` on `listen.tidal.com`, deezer `arl` on `www.deezer.com`, amazon a session cookie on the marketplace host, apple `media-user-token` on `music.apple.com`. Take each from the v1 provider dialogs (`rg -n "sp_dc\|arl\|media-user-token\|listen.tidal" desktopCore desktopApp shared`). Then `authenticate`. Cancelled → `cancelled` |
| `import.playlists {provider}` | List → `{id, title, count, art}` (Spotify/Apple `PlaylistMeta.uri`, others `LoadedPlaylist.id`) |
| `import.run {provider, playlistIds, target}` | Start a job in the core scope and return `{jobId}` at once. Per playlist: load tracks → `CsvTrack`s → resolve → import into `NewLocal` (name = the playlist name) or `EXISTING(lp:id)`. Emit `AppEvents.emit("import.progress", {jobId, done, total, failed})` throttled to 4 Hz. At the end emit `library.changed` through M1-2b's library revision bump (call its public bump function; find it in `api/library/`) |

## Verify (no builds)
1. JUnit (pure): `CsvTrackMapperTest` (per provider model → `CsvTrack`), `ProgressAggregateTest`, `TargetMapTest`.
2. INT-W5 runs `m4-import.mjs` on real for the shapes. A live import is manual QA (needs accounts: Minh). STATUS line.
