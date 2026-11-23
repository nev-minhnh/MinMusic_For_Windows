# UI ↔ core protocol (v1)

Normative. Both sides implement exactly this spec.

| Side | Code |
|---|---|
| Kotlin | `core/MinMusic/desktopCore/src/main/kotlin/com/metrolist/core/api/` (DTOs `@Serializable`) |
| TypeScript | `protocol/src/` (types), `ui/src/core/client.ts` |
| Mock | `mock-core/` |

Any change goes through this file first.

## 1. Transport

### 1.1 Connection
- `ws://127.0.0.1:<port>/rpc`, text frames, UTF-8 JSON, one message per frame. Max frame 4 MiB (lists are paged well below this).
- `permessage-deflate` is off. It is loopback, so CPU matters more than bytes.
- `port`, `token` and `artToken` come from the Tauri command `core_config`, which the client caches in `window.__MM_CORE__` (see architecture §4).

### 1.2 Envelope
```ts
type Req   = { id: number; m: string; p?: object }                    // client → server request
type Res   = { id: number; r?: unknown; e?: ApiError }                // response (exactly one of r/e)
type Evt   = { ev: string; p: unknown; sub?: number; seq?: number }   // server → client push
type SrvReq= { sid: number; m: string; p?: object }                   // core → shell request (role=shell only)
type SrvRes= { sid: number; r?: unknown; e?: ApiError }               // shell → core response
```
- `id` is assigned by the client, increments per connection, and starts at 1.
- Requests may complete out of order.
- The client timeout default is 15 s. `search.*` and `*.page` use 20 s, and `shell.webLogin` has none.

### 1.3 Handshake
The first frame must be `sys.hello`. The server closes the connection with code 4401 after 2 s, or immediately on a bad token.

```ts
m:"sys.hello" p:{ token:string, role:"ui"|"mini"|"shell", protocol:1, client:string /* "ui/0.1.0" */, locale:string /* "vi" */ }
r:{ protocol:1, core:string /* semver */, sessionId:string, capabilities:string[], serverTime:number /* epoch ms */ }
```
- `capabilities` names optional features, e.g. `"listenTogether"`, `"deviceConnect"`, `"video"`, `"lastfm"`, `"discord"`.
- The UI hides a feature whose capability is absent.

### 1.4 Versioning
- `protocol` is an integer.
- **Additive changes do not bump it:** a new method, a new event, a new optional field, or a new enum value. Clients must ignore unknown fields. Unknown enum values map to `"unknown"`.
- **Breaking changes bump it.** The server accepts `protocol ∈ [current-1, current]` for one release.
- On a mismatch the UI shows "Phiên bản lõi không khớp" with a reload.

### 1.5 Errors
```ts
type ApiError = { code: ErrorCode; msg: string /* English, for logs */; i18n?: string /* string key */; args?: string[]; retryable: boolean; details?: object }
type ErrorCode =
 | "bad_request" | "not_found" | "unauthorized" /* token */ | "not_signed_in" | "vip_required"
 | "region_blocked" | "source_disabled" | "source_degraded" | "network" | "rate_limited"
 | "timeout" | "conflict" /* stale revision */ | "busy" | "unsupported" | "cancelled" | "internal"
```
- The UI shows `i18n` (with `args`) when present, otherwise a generic string per code.
- `retryable` errors get a "Thử lại" action.
- `details.sourceId` is set for source errors.

### 1.6 Reconnect
- On close (not 4401), the client reconnects with back-off 100 ms, 250 ms, 500 ms, 1 s, then 2 s repeating. Before each attempt it re-reads `core_config`, because a restarted core has a new port and token.
- After `sys.hello` it re-sends every active `sub.*`.
- The server sends a full snapshot as the first event of each subscription, so there is no gap handling.
- `seq` is per-subscription and monotonic. A gap means the client re-subscribes.

### 1.7 Subscriptions
```ts
m:"sub.open"  p:{ topic: Topic, params?: object }  r:{ sub:number }
m:"sub.close" p:{ sub:number }                       r:{}
```
- The first event on a new `sub` is always `{ev:"<topic>.snapshot"}`. Deltas follow.
- Topics are listed in §4.

### 1.8 Pagination
**A. Remote cursor lists** (YouTube, sources):
```ts
p:{ ..., cursor?: string }   r:{ items: T[], next: string|null }
```

**B. Local DB windows** (library, downloads, history, a user album's songs). These are random-access so the virtualiser can jump anywhere.
```ts
m:"library.window" p:{ list: LocalList, sort: SortSpec, filter?: FilterSpec, offset:number, limit:number /* ≤ 200 */ }
r:{ total:number, revision:number, offset:number, items: T[] }
```
- The UI asks for the visible range ±1 screen, and in chunks of 100 aligned to multiples of 100.
- On a `library.changed {lists:[...], revision}` event the UI drops cached chunks with an older revision and refetches the visible ones.
- Write methods taking `expectedRevision` may return `conflict`.

### 1.9 Flood control
- `player.position` is sent only:
  - on state change (play, pause, seek, track change, buffering)
  - every 1000 ms while playing, as a drift correction
- The UI interpolates locally (frontend-spec §6.4). The server never sends position faster than 4 Hz.
- `download.progress` is coalesced to ≤ 2 Hz per download and ≤ 4 Hz in total.
- `eq.spectrum` is opt-in, ≤ 30 Hz, and only while the EQ page is visible (32 bands, `Uint8` values encoded as one base64 string).
- `library.changed` is coalesced to ≤ 4 Hz.

### 1.10 Artwork
Every model field `art` is an `Art`:
```ts
type Art = { src: string /* https URL or "core:<kind>/<id>" */, w?: number, h?: number, dominant?: string /* "#rrggbb", when known */ }
```

**UI resolution** (`ui/src/core/art.ts`, `artUrl(art, cssPx)`). Let `px = ceil(cssPx * devicePixelRatio)`, rounded up to a bucket of {64, 128, 256, 384, 512, 768, 1080}.
- **https URLs:** rewrite by host (rules are fixed in that file and covered by tests):
  - `lh3.googleusercontent.com` / `yt3.ggpht.com` / `yt3.googleusercontent.com`: replace a trailing `=w..-h..[...]` or `=s..` with `=w{px}-h{px}-l90-rj`.
  - `i.ytimg.com/vi/<id>/<name>.jpg`: px ≤ 120 → `default`, ≤ 320 → `mqdefault`, ≤ 480 → `hqdefault`, else `maxresdefault`, with `onerror` falling back to `hqdefault`.
  - `*.sndcdn.com`: `-large|-t500x500|-original` → px ≤ 100 `-large`, ≤ 300 `-t300x300`, else `-t500x500`.
  - `photo-resize-zmp3.zmdcdn.me/w{n}_r1x1_...`: replace `w{n}` with `w{px}` (cap 600).
  - Anything else: unchanged.
- **`core:` sources:** these are local art such as `playlist_covers`, embedded tags of downloaded files and local files. They map to `http://127.0.0.1:<port>/art/<kind>/<id>?w=<px>&k=<artToken>`.
  - The core serves a JPEG resized with `ImageIO` and caches it under `cache\metrolist\image_cache\core\`.
  - The response sets `Cache-Control: max-age=31536000, immutable`. The `id` includes a content hash so changes bust the cache.
- **Caching:** the WebView2 HTTP cache in the UI profile. There is no extra JS cache.

### 1.11 Ids
- Track, album, artist and playlist ids are the core's existing namespaced ids: bare YouTube ids, `sc:`, `zing:`, `nct:`, `local_`.
- Local playlists (user albums) use the DB id with prefix `lp:`.
- Ids are opaque to the UI.

## 2. Common models (TS notation; Kotlin mirrors names exactly)
```ts
type SourceId = "yt"|"sc"|"zing"|"nct"|"local"
type Quality  = { label: "FLAC"|"Lossless"|"320"|"256"|"Opus 160"|"AAC 256"|"AAC 160"|"128"|string, lossless: boolean, kbps?: number }
type ArtistRef= { id?: string, name: string }
type AlbumRef = { id?: string, title: string }
type Track = {
  id: string, title: string, artists: ArtistRef[], album?: AlbumRef, durationMs?: number, art?: Art,
  explicit?: boolean, source: SourceId, quality?: Quality, altSources?: number /* "+N" */,
  liked?: boolean, download?: DownloadState, isVideo?: boolean, playCountText?: string, addedAt?: number,
  setVideoId?: string /* playlist entry id for remove/move */, vip?: boolean /* needs VIP */
}
type DownloadState = "none"|"queued"|"downloading"|"downloaded"|"failed"
type AlbumCard   = { id, title, artists: ArtistRef[], year?: number, art?: Art, source: SourceId, kind:"album"|"single"|"ep" }
type ArtistCard  = { id, name, art?: Art, subtitle?: string, source: SourceId }
type PlaylistCard= { id, title, subtitle?: string, art?: Art, source: SourceId, owner?: string, local: boolean, count?: number }
type Item = ({t:"track"}&Track)|({t:"album"}&AlbumCard)|({t:"artist"}&ArtistCard)|({t:"playlist"}&PlaylistCard)
type Shelf = { key: string, title: string, subtitle?: string, layout: "quickPicks"|"cards"|"chart"|"rows"|"chips", items: Item[], more?: NavTarget }
type NavTarget = { route: string, params: object }   // see frontend-spec §3 route table
type SortSpec  = { by: "added"|"title"|"artist"|"album"|"duration"|"plays"|"lastPlayed"|"custom", desc: boolean }
type FilterSpec= { text?: string, source?: SourceId, downloaded?: boolean, liked?: boolean, explicit?: boolean }
type LocalList = "songs"|"liked"|"downloaded"|"albums"|"artists"|"playlists"|"userAlbum:<lp:id>"|"history"|"cached"
```

## 3. Methods

Notation: `m` is followed by params, then `→` and the result. All methods are requests. Methods with no meaningful result return `{}`.

### 3.1 sys, app
| Method | Params → Result |
|---|---|
| `sys.hello` | §1.3 |
| `sys.ping` | `{}` → `{t}` |
| `app.info` | → `{version, core, protocol, buildTime, dataDirs:{data,config,state,cache,logs}, portable}` |
| `app.openUrl` | `{url}` → `{handled:boolean, nav?:NavTarget}`. Deep links and pasted links; uses `DesktopUrlHandler` logic |
| `app.copyLink` | `{id, kind}` → `{url}` (the UI writes it to the clipboard) |
| `app.logs.tail` | `{file:"app"|"shell"|"ui", lines≤2000}` → `{text}` |
| `app.log` | `{level:"error"|"warn"|"info", msg, stack?}` → `{}` (UI log → `ui.log`) |
| `app.toast` | (event only, §4) |

### 3.2 Home and browse
| Method | Params → Result |
|---|---|
| `home.get` | `{chip?:string, refresh?:boolean}` → `{shelves:Shelf[], chips:{key,title,selected}[], greeting:{key:"good_morning"|...}, fromCache:boolean, next:string|null}`. Returns the DB/cache result immediately (`fromCache:true`). When the network version differs it pushes the `home.updated` event |
| `home.more` | `{cursor}` → `{shelves, next}` |
| `charts.get` | `{source:"zing"|"nct"|"yt", key?:string}` → `{source, title, updatedAt, tabs:{key,title}[], items:(Track&{rank, trend:"up"|"down"|"same"|"new", delta?})[]}` |
| `browse.page` | `{browseId, params?}` → `{title, header?, shelves, next}` (moods, genres, `HomeSection`) |
| `moods.list` | → `{items:{key,title,color?}[]}` |

### 3.3 Search
| Method | Params → Result |
|---|---|
| `search.suggest` | `{q}` → `{queries:string[], items:Item[] /* ≤ 8 total rows */}`. The UI debounces at 120 ms and the server cancels the previous call per connection |
| `search.run` | `{q, source?:SourceId|"all", type?:"all"|"track"|"album"|"artist"|"playlist", cursor?}` → `{top?:Item&{sources:SourceId[]}, sections:{type, title, items:Item[], more?:NavTarget}[], next}` |
| `search.history.list` | → `{items:string[]}` |
| `search.history.remove` | `{q?}` (none = clear all) |
| `recognize.*` | not on desktop v1 (Shazam needs a mic). Capability `"recognition"` is absent |

### 3.4 Library and local data
| Method | Params → Result |
|---|---|
| `library.counts` | → `{songs, liked, downloaded, albums, artists, playlists, userAlbums}` |
| `library.window` | §1.8B. `T` is `Track` for song lists, `AlbumCard`/`ArtistCard`/`PlaylistCard` for others |
| `library.indexOf` | `{list, sort, filter?, id}` → `{index}` (scroll-to-playing) |
| `library.sync` | `{}` → `{}`. Pulls the YouTube library; progress arrives via `library.changed` |
| `track.like` | `{id, liked}` → `{liked}` |
| `album.save` / `artist.subscribe` / `playlist.save` | `{id, on}` → `{on}` |
| `track.info` | `{id}` → `{track:Track, details:{codec?, bitrate?, sampleRate?, loudnessDb?, fileSize?, path?, sources:SourceOption[]}}` |
| `track.sources` | `{id}` → `{options:SourceOption[]}` with `SourceOption={source, id, quality:Quality, auto:boolean, available:boolean, hint?:"vip_login"|"region"|"preview_only"}` |
| `track.setSource` | `{id, source}` → `{}` (persisted choice for "Chọn nguồn") |
| `track.block` / `artist.block` | `{id, on}` |
| `userAlbum.create` | `{title, trackIds?:string[]}` → `{id}` |
| `userAlbum.rename` | `{id, title}` |
| `userAlbum.delete` | `{id}` |
| `userAlbum.setCover` | `{id, path|null}` → `{art}` (path from the UI file dialog) |
| `userAlbum.add` | `{id, trackIds, dedupe:true}` → `{added, skipped}` |
| `userAlbum.remove` | `{id, entryIds:string[]}` |
| `userAlbum.move` | `{id, from:number, to:number, expectedRevision}` |
| `userAlbum.pin` | `{id, pinned}` (sidebar) |
| `userAlbum.list` | → `{items:(PlaylistCard&{pinned:boolean, revision:number})[]}` |
| `history.window` | §1.8B with `list:"history"`, items `Track&{playedAt}`, plus `{groups:{label,offset}[]}` (Hôm nay / Hôm qua / …) |
| `history.remove` | `{eventIds}` |
| `history.clear` | `{}` |
| `stats.get` | `{period:"week"|"month"|"year"|"all"}` → `{minutes, topTracks, topArtists, topAlbums}` |
| `import.files` | `{paths:string[]}` → `{imported, failed}` (dropped audio files) |

### 3.5 Pages
| Method | Params → Result |
|---|---|
| `album.get` | `{id}` → `{album:AlbumCard&{description?, durationMs, trackCount, year, label?, saved}, tracks:Track[], otherVersions:AlbumCard[], moreBy?:Shelf}` |
| `artist.get` | `{id}` → `{artist:ArtistCard&{banner?:Art, subscribers?, description?, subscribed, monthly?}, shelves:Shelf[] /* top songs, albums, singles, videos, related */, sources:SourceId[]}` |
| `artist.about` | `{id}` → `{bio?, stats?, lastfm?:{listeners, playcount, tags[]}}` |
| `artist.tracks` | `{id, cursor?}` → cursor list of `Track` |
| `playlist.get` | `{id, cursor?}` → `{playlist:PlaylistCard&{description?, durationMs?, editable, revision}, tracks:Track[], next}`. User albums use `library.window userAlbum:` for tracks instead |
| `podcast.get` / `podcast.episodes` | as for `album` / `artist.tracks` |
| `related.get` | `{trackId}` → `{shelves}` |

### 3.6 Player and queue
| Method | Params → Result |
|---|---|
| `player.play` | `{context: PlayContext, startIndex?:number, startId?:string, shuffle?:boolean}`. `PlayContext = {kind:"tracks", ids:string[], title?} \| {kind:"album"\|"playlist"\|"artist"\|"radio"\|"userAlbum"\|"library", id?, list?:LocalList, sort?, filter?}`. Replaces the queue. The core resolves the ids so the UI never sends 5k tracks |
| `player.toggle` / `player.pause` / `player.resume` | `{}` |
| `player.next` / `player.prev` | `{}` |
| `player.seek` | `{ms}` |
| `player.seekRelative` | `{deltaMs}` |
| `player.seekPercent` | `{pct:0..100}` |
| `player.setVolume` | `{v:0..1}` |
| `player.mute` | `{on}` |
| `player.setShuffle` | `{on}` |
| `player.setRepeat` | `{mode:"off"|"all"|"one"}` |
| `player.cycleRepeat` | `{}` |
| `player.setSpeed` | `{speed, pitch?}` |
| `player.sleepTimer` | `{minutes?:number, endOfTrack?:boolean, cancel?:boolean}` → `{deadline?:number}` |
| `player.output.list` | → `{devices:{id,name,kind:"speaker"|"wired"|"bluetooth"|"usb"|"other", default:boolean}[], current}` |
| `player.output.set` | `{id}` |
| `player.video` | `{on}` (capability `video`; M5) |
| `queue.window` | `{offset, limit}` → `{total, revision, currentIndex, items:(Track&{qid:string})[]}` |
| `queue.add` | `{ids:string[], position:"next"|"end"|number}` → `{revision}` |
| `queue.addContext` | `{context, position}` → `{revision}` |
| `queue.remove` | `{qids}` |
| `queue.move` | `{from, to, expectedRevision}` |
| `queue.select` | `{qid}` |
| `queue.clear` | `{keepCurrent:true}` |
| `queue.setAutoplay` | `{on}` |
| `queue.radio` | `{seedId}` (start radio) |

### 3.7 Lyrics
| Method | Params → Result |
|---|---|
| `lyrics.get` | `{trackId}` → `Lyrics` (below). Also pushed by `lyrics.updated` when async providers finish |
| `lyrics.search` | `{trackId, query?}` → `{candidates:{provider, synced:"word"|"line"|"none", preview, id}[]}` |
| `lyrics.choose` | `{trackId, candidateId}` |
| `lyrics.setOffset` | `{trackId, ms}` |
| `lyrics.translate` | `{trackId, on, target?}`. Results arrive by `lyrics.updated` |
| `lyrics.romanize` | `{trackId, on}` |
| `lyrics.edit` | `{trackId, lrc}` |
| `lyrics.providers` | → order and toggles. `lyrics.providers.set {order, enabled}` |

```ts
type Lyrics = { trackId, provider, synced:"word"|"line"|"none", offsetMs:number,
  lines: { t:number /*ms*/, end?:number, text:string, words?:{t:number,end:number,text:string}[], tr?:string /*translation*/, ro?:string /*romanized*/, agent?:"v1"|"v2"|"bg" }[] }
```

<!-- M2-1 -->
#### 3.7a M2-1 additions (player, queue, lyrics)
| Item | Behaviour |
|---|---|
| `queue.setLocked` | `{on:boolean}`. Sets the v1 queue lock (`Settings.isQueueLocked`, **default true**). The UI must show the lock and offer "Mở khoá". The core reports the flag but does not enforce it on `queue.remove` / `queue.move` / `queue.clear` |
| `locked` | Additive boolean on `queue.window`, `queue.snapshot` and `queue.changed {revision, currentIndex, locked}`. `queue.changed` is also sent when only the lock flips |
| `queue.add` with a number | Inserts at that index, clamped to the old end; **before** the playing entry is allowed and `currentIndex` follows |
| `queue.move` | `from` / `to` are queue indices, `expectedRevision` must equal the revision of the last `queue.window` or `queue.changed`, else `conflict`. Out of range: `bad_request` |
| `queue.remove` | Unknown `qid`s are ignored. Removing the playing entry is allowed |
| `queue.clear {keepCurrent}` | `true` (default): every entry except the playing one is removed. `false`: pauses and empties the queue |
| `queue.radio {seedId}` | Returns once the radio tracks are loaded (at most 12 s) |
| `player.next` | At the end of a queue with autoplay on, returns once the radio tracks are appended (at most 10 s) |
| `player.state` | Carries `posMs`, `durMs`, `bufMs`, `at` too (the UI clock reads them). `muted` = volume 0. `sleep` and `output` are filled. `speed` / `pitch` are rounded to 2 decimals |
| `player.sleepTimer` | `{minutes}` returns `{deadline}` (epoch ms); `{endOfTrack:true}` and `{cancel:true}` return `{}` |
| `player.output.set {id}` | Unknown id: `not_found`. The choice is persisted by the core and applies from the next line open (track change or seek) |
| `lyrics.get {trackId}` | Playing track: the core starts the provider fetch itself and waits (at most 15 s). Any other track: read from the lyrics cache or the providers, without changing the playing track's lyrics. No lyrics: `{synced:"none", lines:[]}` |
| `Lyrics.lines[].words[].text` | Includes the trailing space of the word, so `words.map(w => w.text).join("")` equals the line text. In a `word` track a line without word timing has one word spanning the line |
| `Lyrics.lines[].agent` | `bg` for background lines, else `v1` for the first agent, `v2` for the second; more agents have none |
| `lyrics.search/choose/setOffset/translate/romanize/edit` | Playing track only (other ids: `not_found`; `setOffset` also saves for another track). Candidate id = `<PROVIDER>:<index>` |
| `lyrics.providers` / `.set` | `{order:string[], enabled:{[provider]:boolean}}` over the user-configurable providers. `set` takes the same shape (`enabled` may also be a list of names; an empty set is stored as `NONE`) |
<!-- /M2-1 -->

### 3.8 Equalizer
| Method | Params → Result |
|---|---|
| `eq.get` | → `EqState` (below) |
| `eq.setEnabled` | `{on}` |
| `eq.setProfile` | `{id}` |
| `eq.updateBand` | `{index, type?, freq?, gain?, q?}`. While dragging the UI sends at most 1 per rAF frame and the last one wins. The audio applies it on the next PCM block |
| `eq.addBand` / `eq.removeBand` | `{freq}` / `{index}` |
| `eq.resetBand` | `{index}` |
| `eq.setPreamp` | `{db}` |
| `eq.setAutoPreamp` | `{on}` |
| `eq.setEffects` | `{bassDb?, trebleDb?, widthPct?, crossfeed?:"off"|"default"|"chuMoy"|"janMeier", limiter?:boolean, outputDb?}` |
| `eq.profile.save` | `{name, asNew:boolean}` → `{id}` |
| `eq.profile.rename` / `.delete` | `{id, name}` / `{id}` |
| `eq.undo` / `eq.redo` / `eq.reset` | `{}` |
| `eq.importFile` | `{path}` → `{id}` (APO / AutoEQ ParametricEQ txt) |
| `eq.exportFile` | `{id, path}` |
| `eq.autoeq.search` | `{q}` → `{items:{name, source, variants[]}[]}` |
| `eq.autoeq.apply` | `{name, variant?}` → `{id}` |
| `eq.device.bind` | `{deviceId, profileId|null}` (per-output-device profile; uses `player.output`) |
| `eq.response` | `{points:256}` → `{hz:number[], db:number[]}` (curve for the graph, computed by the core biquads so the drawing equals the sound) |

```ts
type EqState = { enabled, profileId, profiles:{id,name,builtin:boolean}[], bands:{type:"PK"|"LSC"|"HSC"|"LPQ"|"HPQ"|"BP"|"NO", freq, gain, q}[],
  preampDb, autoPreamp, effects:{bassDb,trebleDb,widthPct,crossfeed,limiter,outputDb}, limiterReductionDb:number,
  canUndo, canRedo, deviceProfiles:{deviceId,deviceName,profileId}[], maxBands:32 }
```

### 3.9 Downloads and storage
| Method | Params → Result |
|---|---|
| `download.tracks` | `{ids}` |
| `download.context` | `{context}` (album, playlist, user album) |
| `download.cancel` | `{ids?, all?}` |
| `download.pause` / `download.resume` | `{}` (global) |
| `download.retry` | `{ids?}` |
| `download.remove` | `{ids, deleteFiles:true}` |
| `download.summary` | → `{count, bytes, byQuality:{label,count}[], folder, folderOk:boolean, active:{done,total,label?}, paused:boolean}` |
| `download.window` | §1.8B `list:"downloaded"` |
| `download.queue` | → `{items:(Track&{state, progress:0..1, bytes?, error?})[]}` |
| `download.setFolder` | `{path|null}` → `{ok, error?:"not_writable"|"missing"}` (null = default) |
| `download.saveTo` | `{ids, path}` (export copies) |
| `storage.usage` | → `{songCache, imageCache, videoCache, animatedArt, downloads}` (bytes) + limits |
| `storage.clear` | `{what:"songCache"|"imageCache"|"videoCache"|"animatedArt"}` |

### 3.10 Settings
| Method | Params → Result |
|---|---|
| `settings.schema` | → `{entries: SettingEntry[]}` where `SettingEntry={key, type:"bool"|"int"|"float"|"string"|"enum"|"json"|"secret", default, enumValues?:string[], min?, max?, step?, platform?:"all"|"desktop"|"android"}`. Generated from `Settings.kt` delegates; android-only keys are flagged and the UI hides them |
| `settings.get` | `{keys?:string[]}` → `{values:{[k]:unknown}}`. Secrets come back as `{set:boolean}` |
| `settings.set` | `{values:{[k]:unknown}}` → `{}`. Validates type and range, else `bad_request` |
| `settings.reset` | `{keys}` |
| sub `settings` | snapshot of all values, then `{changed:{[k]:v}}` deltas |

Secret keys cannot be written through `settings.set`. Use the dedicated methods instead (lyrics AI keys: `lyrics.ai.setKey {provider, key}`, `lyrics.ai.test`).

### 3.11 Accounts and sources
| Method | Params → Result |
|---|---|
| `account.get` | → `{youtube?:{name, email?, handle?, avatar?:Art, channels?}, signedIn:boolean}` |
| `account.youtube.login` | `{}` → `{ok}`. The core drives `shell.webLogin` and returns when done or cancelled |
| `account.youtube.switchChannel` | `{}` (webLogin with the channel URL) |
| `account.youtube.logout` | `{}` |
| `account.youtube.tokenLogin` | `{cookie, visitorData?, dataSyncId?}` (advanced "token login") |
| `sources.list` | → `{items:{id:SourceId, name, enabled, status:"ok"|"degraded"|"off", signedIn?:boolean, vip?:boolean, account?:string, maxQuality:Quality, canLogin:boolean}[], priority:SourceId[], autoBest:boolean, autoFallback:boolean}` |
| `sources.setEnabled` | `{id, on}` |
| `sources.setPriority` | `{order}` |
| `sources.setAutoBest` / `setAutoFallback` | `{on}` |
| `source.zing.login` | `{}` → `{ok, vip}` (webLogin) |
| `source.zing.logout` | `{}` |
| `source.nct.login` | `{account, password, phone?, countryCode?}` → `{ok, vip}`. Errors `unauthorized` or `network`. The password is not logged; the handler zeroes its char array after the call |
| `source.nct.logout` | `{}` |

### 3.12 Integrations
| Method | Params → Result |
|---|---|
| `lastfm.login` | `{username, password}` → `{ok, user}` (mobile session; password not stored) |
| `lastfm.logout` | `{}` |
| `lastfm.status` | → `{user?, expired:boolean, scrobbling:boolean, nowPlaying:boolean, pending:number}` |
| `listenbrainz.setToken` | `{token|null}` |
| `listenbrainz.status` | → `{user?}` |
| `discord.login` | `{}` (OAuth PKCE via webLogin `navPrefix`) |
| `discord.logout` | `{}` |
| `discord.status` | → `{user?, enabled}` |
| `import.providers` | → `{items:{id:"spotify"|"tidal"|"deezer"|"apple"|"amazon", signedIn}[]}` |
| `import.login` | `{provider}` |
| `import.playlists` | `{provider}` → `{items:{id,title,count,art?}[]}` |
| `import.run` | `{provider, playlistIds, target:"newUserAlbum"|"lp:<id>"}` → `{jobId}`. Progress via `import.progress` events |

### 3.13 Listen Together (capability `listenTogether`)
| Method | Params → Result |
|---|---|
| `lt.state` | → `{status:"idle"|"connecting"|"host"|"guest", room?:{code, users:{id,name,host}[], pending:{id,name}[]}, server, error?}` |
| `lt.create` | `{name}` |
| `lt.join` | `{code, name}` |
| `lt.leave` | `{}` |
| `lt.approve` / `lt.reject` / `lt.kick` / `lt.transferHost` | `{userId}` |
| `lt.suggest` | `{trackId}` |
| `lt.suggestion.approve` / `.reject` | `{id}` |
| `lt.servers` / `lt.setServer` | `{url}` |
| `lt.blocked` / `lt.unblock` | `{id}` |
| `lt.invite` | → `{url}` |

### 3.14 Device Connect (capability `deviceConnect`)
| Method | Params → Result |
|---|---|
| `dc.state` | → `{enabled, port, addresses:string[], link:string, qrSvg:string, firewall:"allowed"|"blocked"|"no_rule"|"unknown", devices:{id,name,type,online,paired,accountBound}[], session?:{peerId, role:"controller"|"player"}}` |
| `dc.enable` | `{on}` |
| `dc.setPort` | `{port}` |
| `dc.requireApproval` | `{on}` |
| `dc.connectLink` | `{link}` (scanned or pasted link; shows the request, does not auto-connect) |
| `dc.accept` / `dc.reject` | `{requestId}` |
| `dc.confirmSas` | `{requestId, match:boolean}` |
| `dc.forget` | `{deviceId}` |
| `dc.transferTo` | `{deviceId}` |
| `dc.attach` / `dc.release` | `{deviceId}` |
| `dc.openFirewallSettings` | `{}` (core runs `control.exe` as v1 does) |

### 3.15 Backup, updates, misc
| Method | Params → Result |
|---|---|
| `backup.create` | `{path}` → `{bytes}` |
| `backup.inspect` | `{path}` → `{ok, platform, dbVersion, createdAt?, error?}` |
| `backup.restore` | `{path}` → `{staged:true}`. The UI then calls the shell command `app_restart` |
| `import.foreignBackup` | `{path}` → `{imported}` |
| `update.status` | → `{channel, lastCheck, available?:{version, notes, size}, state:"idle"|"checking"|"downloading"|"ready"|"error", progress?}`. Implemented in Rust (`tauri-plugin-updater`). The UI calls the Tauri command `update_status`, not the core. Listed here so the UI contract is in one place |
| `crash.pending` | → `{report?:{when, summary, path}}` |
| `crash.dismiss` | `{}` |
| `onboarding.state` / `onboarding.complete` | `{}` |

## 4. Events and topics

Subscriptions (`sub.open topic`) emit `<topic>.snapshot`, then deltas:

| Topic | Snapshot | Deltas |
|---|---|---|
| `player` | `PlayerState` | `player.state` (full `PlayerState` minus position; sent on any change), `player.position {posMs, durMs, bufMs, playing, rate, at /* core epoch ms */}`, `player.error {code, i18n, trackId, skipped:boolean}` |
| `queue` | `{total, revision, currentIndex, head:(Track&{qid})[] /* first 50 from current-5 */}` | `queue.changed {revision, currentIndex}`. The UI refetches its visible window |
| `lyrics` | `Lyrics\|null` for the current track | `lyrics.updated Lyrics`, `lyrics.cleared` |
| `library` | `{counts, revision}` | `library.changed {lists:LocalList[], revision}`, `userAlbums.changed {}` |
| `downloads` | `download.summary` result | `download.progress {id, state, progress, bytes?}`, `download.summary` |
| `settings` | §3.10 | `settings.changed` |
| `eq` | `EqState` | `eq.state`, `eq.spectrum {b64}` (only when the sub has params `{spectrum:true}`) |
| `account` | `account.get` + `sources.list` | `account.changed`, `sources.changed` |
| `lt` | `lt.state` | `lt.state`, `lt.joinRequest`, `lt.suggestion` |
| `dc` | `dc.state` | `dc.state`, `dc.request {requestId, peer, sas?}` |
| `app` | `{toasts:[]}` | `app.toast {i18n, args?, level:"info"|"error", action?:{label, m, p}}`, `home.updated {shelves}`, `import.progress {jobId, done, total, failed}`, `core.shuttingDown` |

```ts
type PlayerState = {
  track: Track|null, playing: boolean, buffering: boolean, reconnecting: boolean,
  posMs: number, durMs: number, bufMs: number, at: number,
  volume: number, muted: boolean, shuffle: boolean, repeat: "off"|"all"|"one", speed: number, pitch: number,
  context?: { title: string, nav?: NavTarget },
  sleep?: { deadline?: number, endOfTrack: boolean },
  output?: { id, name, kind }, eq: { enabled: boolean, profileName: string },
  quality?: Quality, source?: SourceId, canPrev: boolean, canNext: boolean,
  remote?: { kind:"deviceConnect"|"cast"|"listenTogether", name: string }
}
```

## 5. Shell channel (role `shell`, Rust client only)
The shell subscribes to `player` (for SMTC, tray, taskbar and mini window title) and `settings`. It reads `minimizeToTrayOnClose`, `desktopMiniPlayerWindow`, `desktopMiniPlayerOnMinimize`, `desktopTaskbarButtons` and `desktopTrayToggleOnClick`.

Core → shell requests (`SrvReq`). The shell must answer every one.

| `m` | Params → Result |
|---|---|
| `shell.webLogin` | `{url, allowedHosts:string[], userAgent?, title, banner?, window:{w,h,maximizable:false}, done:{cookies?:{names:string[], urls:string[]}, navPrefix?:string, script?:string /* returns truthy JSON when done */}, collect:{cookieUrls:string[], script?:string}, timeoutMs?}` → `{cancelled?:true, cookies?:{[name]:string}, cookieHeader?:string, scriptResult?:unknown, finalUrl?:string}` |
| `shell.po.evaluate` | `{script, timeoutMs:10000}` → `{result:string}` (raw `ExecuteScript` JSON) |
| `shell.po.reset` | `{}` → `{}` (navigate the hidden webview to `about:blank`) |
| `shell.po.available` | → `{available:boolean}` |
| `shell.focusMain` | `{}` (e.g. after a deep link or a Listen Together invite) |
| `shell.openExternal` | `{url}` (https only; opens in the default browser) |

## 6. Shell ↔ UI (Tauri commands, not the core)
| Command | Purpose |
|---|---|
| `window_minimize`, `window_toggle_maximize`, `window_close` | custom title bar; close obeys the tray setting |
| `window_start_drag` | — |
| `window_set_fullscreen` | `{on}` |
| `mini_toggle` / `mini_set_mode {"bar"\|"square"}` | mini player |
| `pick_folder` / `pick_file {filters}` / `save_file {defaultName}` | wraps `tauri-plugin-dialog` |
| `app_quit`, `app_restart` | normal-quit path (architecture §3.3) |
| `update_check`, `update_status`, `update_install` | — |
| `core_status` | → `{state:"starting"|"ready"|"restarting"|"failed", restarts, lastError?}`; plus the event `core-status` |
| `log_ui` | `{level, msg}` → `ui.log` |
| `open_log_folder` | — |
| `shell_settings_get` / `_set` | sidebar width, pane width, window placement (`shell.json`) |
