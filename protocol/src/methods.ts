// api.md §3: every request method. `Methods[K]["p"]` = params, `Methods[K]["r"]` = result.
// Methods with no meaningful result return `Empty` ({}).
import type { HelloParams, HelloResult } from "./envelope.ts";
import type {
  AlbumCard, ArtistCard, Art, EqBand, EqEffects, EqState, FilterSpec, GreetingKey, Item, LocalList, Lyrics,
  NavTarget, PlayContext, PlaylistCard, Quality, QueueTrack, Shelf, SettingEntry, SortSpec, SourceId, SourceInfo,
  SourceOption, Track,
} from "./models.ts";

export interface Empty {}
export interface NoParams {}

// ---- 3.1 sys, app
export interface AppInfo {
  version: string; core: string; protocol: number; buildTime: string;
  dataDirs: { data: string; config: string; state: string; cache: string; logs: string };
  portable: boolean;
}

// ---- 3.2 home and browse
export interface HomeChip { key: string; title: string; selected: boolean }
export interface HomeGetResult {
  shelves: Shelf[];
  chips: HomeChip[];
  greeting: { key: GreetingKey };
  fromCache: boolean;
  next: string | null;
}
export type ChartTrack = Track & { rank: number; trend: "up" | "down" | "same" | "new"; delta?: number };
export interface ChartsGetResult {
  source: "zing" | "nct" | "yt";
  title: string;
  updatedAt: number;
  tabs: { key: string; title: string }[];
  items: ChartTrack[];
}
export interface BrowsePageResult { title: string; header?: unknown; shelves: Shelf[]; next: string | null }

// ---- 3.3 search
export interface SearchSection { type: string; title: string; items: Item[]; more?: NavTarget }
export type SearchTop = Item & { sources: SourceId[] };
export interface SearchRunResult { top?: SearchTop; sections: SearchSection[]; next: string | null }

// ---- 3.4 library
export type SongWindowParams = {
  list: LocalList; sort: SortSpec; filter?: FilterSpec; offset: number; limit: number /* <= 200 */;
};
export type LibraryItem = Track | AlbumCard | ArtistCard | PlaylistCard;
export interface LibraryWindowResult { total: number; revision: number; offset: number; items: LibraryItem[] }
export interface LibraryCounts {
  songs: number; liked: number; downloaded: number; albums: number; artists: number; playlists: number; userAlbums: number;
}
export interface TrackDetails {
  codec?: string; bitrate?: number; sampleRate?: number; loudnessDb?: number; fileSize?: number; path?: string;
  sources: SourceOption[];
}
export type UserAlbumCard = PlaylistCard & { pinned: boolean; revision: number };
export type HistoryTrack = Track & { playedAt: number };
export interface HistoryWindowResult {
  total: number; revision: number; offset: number; items: HistoryTrack[];
  groups: { label: string; offset: number }[];
}
export type StatsPeriod = "week" | "month" | "year" | "all";
export interface StatsResult {
  minutes: number; topTracks: Track[]; topArtists: ArtistCard[]; topAlbums: AlbumCard[];
}

// ---- 3.5 pages
export interface AlbumGetResult {
  album: AlbumCard & { description?: string; durationMs: number; trackCount: number; year: number; label?: string; saved: boolean };
  tracks: Track[];
  otherVersions: AlbumCard[];
  moreBy?: Shelf;
}
export interface ArtistGetResult {
  artist: ArtistCard & { banner?: Art; subscribers?: string; description?: string; subscribed: boolean; monthly?: string };
  shelves: Shelf[];
  sources: SourceId[];
}
export interface ArtistAboutResult {
  bio?: string;
  stats?: Record<string, unknown>;
  lastfm?: { listeners: number; playcount: number; tags: string[] };
}
export interface TrackPage { items: Track[]; next: string | null }
export interface PlaylistGetResult {
  playlist: PlaylistCard & { description?: string; durationMs?: number; editable: boolean; revision: number };
  tracks: Track[];
  next: string | null;
}

// ---- 3.7 lyrics
export interface LyricsCandidate { provider: string; synced: "word" | "line" | "none"; preview: string; id: string }
export interface LyricsProviderState { order: string[]; enabled: Record<string, boolean> }

// ---- 3.8 eq
export type EqBandUpdate = { index: number } & Partial<EqBand>;

// ---- 3.9 downloads
export interface DownloadSummary {
  count: number; bytes: number; byQuality: { label: string; count: number }[]; folder: string; folderOk: boolean;
  active: { done: number; total: number; label?: string }; paused: boolean;
}
export type DownloadQueueItem = Track & {
  state: "queued" | "downloading" | "downloaded" | "failed" | "none"; progress: number; bytes?: number; error?: string;
};
export interface StorageUsage {
  songCache: number; imageCache: number; videoCache: number; animatedArt: number; downloads: number;
  limits?: { songCache?: number; imageCache?: number; videoCache?: number };
}

// ---- 3.11 accounts
export interface YoutubeAccount {
  name: string; email?: string; handle?: string; avatar?: Art; channels?: { id: string; name: string }[];
}
export interface AccountGetResult { youtube?: YoutubeAccount; signedIn: boolean }
export interface SourcesListResult {
  items: SourceInfo[]; priority: SourceId[]; autoBest: boolean; autoFallback: boolean;
}

// ---- 3.13 / 3.14
export interface LtRoom {
  code: string; users: { id: string; name: string; host: boolean }[]; pending: { id: string; name: string }[];
}
export interface LtState {
  status: "idle" | "connecting" | "host" | "guest"; room?: LtRoom; server: string; error?: string;
}
export interface DcDevice { id: string; name: string; type: string; online: boolean; paired: boolean; accountBound: boolean }
export interface DcState {
  enabled: boolean; port: number; addresses: string[]; link: string; qrSvg: string;
  firewall: "allowed" | "blocked" | "no_rule" | "unknown";
  devices: DcDevice[]; session?: { peerId: string; role: "controller" | "player" };
}

// ---- 3.15
export interface UpdateStatus {
  channel: string; lastCheck: number;
  available?: { version: string; notes: string; size: number };
  state: "idle" | "checking" | "downloading" | "ready" | "error"; progress?: number;
}

export interface Methods {
  // 3.1 sys, app
  "sys.hello": { p: HelloParams; r: HelloResult };
  "sys.ping": { p: NoParams; r: { t: number } };
  "app.info": { p: NoParams; r: AppInfo };
  "app.openUrl": { p: { url: string }; r: { handled: boolean; nav?: NavTarget } };
  "app.copyLink": { p: { id: string; kind: string }; r: { url: string } };
  "app.logs.tail": { p: { file: "app" | "shell" | "ui"; lines: number }; r: { text: string } };
  "app.log": { p: { level: "error" | "warn" | "info"; msg: string; stack?: string }; r: Empty };

  // 3.2 home and browse
  "home.get": { p: { chip?: string; refresh?: boolean }; r: HomeGetResult };
  "home.more": { p: { cursor: string }; r: { shelves: Shelf[]; next: string | null } };
  "charts.get": { p: { source: "zing" | "nct" | "yt"; key?: string }; r: ChartsGetResult };
  "browse.page": { p: { browseId: string; params?: string }; r: BrowsePageResult };
  "moods.list": { p: NoParams; r: { items: { key: string; title: string; color?: string }[] } };

  // 3.3 search
  "search.suggest": { p: { q: string }; r: { queries: string[]; items: Item[] } };
  "search.run": {
    p: { q: string; source?: SourceId | "all"; type?: "all" | "track" | "album" | "artist" | "playlist"; cursor?: string };
    r: SearchRunResult;
  };
  "search.history.list": { p: NoParams; r: { items: string[] } };
  "search.history.remove": { p: { q?: string }; r: Empty };

  // 3.4 library and local data
  "library.counts": { p: NoParams; r: LibraryCounts };
  "library.window": { p: SongWindowParams; r: LibraryWindowResult };
  "library.indexOf": { p: { list: LocalList; sort: SortSpec; filter?: FilterSpec; id: string }; r: { index: number } };
  "library.sync": { p: NoParams; r: Empty };
  "track.like": { p: { id: string; liked: boolean }; r: { liked: boolean } };
  "album.save": { p: { id: string; on: boolean }; r: { on: boolean } };
  "artist.subscribe": { p: { id: string; on: boolean }; r: { on: boolean } };
  "playlist.save": { p: { id: string; on: boolean }; r: { on: boolean } };
  "track.info": { p: { id: string }; r: { track: Track; details: TrackDetails } };
  "track.sources": { p: { id: string }; r: { options: SourceOption[] } };
  "track.setSource": { p: { id: string; source: SourceId }; r: Empty };
  "track.block": { p: { id: string; on: boolean }; r: Empty };
  "artist.block": { p: { id: string; on: boolean }; r: Empty };
  "userAlbum.create": { p: { title: string; trackIds?: string[] }; r: { id: string } };
  "userAlbum.rename": { p: { id: string; title: string }; r: Empty };
  "userAlbum.delete": { p: { id: string }; r: Empty };
  "userAlbum.setCover": { p: { id: string; path: string | null }; r: { art: Art } };
  "userAlbum.add": { p: { id: string; trackIds: string[]; dedupe: true }; r: { added: number; skipped: number } };
  "userAlbum.remove": { p: { id: string; entryIds: string[] }; r: Empty };
  "userAlbum.move": { p: { id: string; from: number; to: number; expectedRevision: number }; r: Empty };
  "userAlbum.pin": { p: { id: string; pinned: boolean }; r: Empty };
  "userAlbum.list": { p: NoParams; r: { items: UserAlbumCard[] } };
  "history.window": { p: SongWindowParams; r: HistoryWindowResult };
  "history.remove": { p: { eventIds: string[] }; r: Empty };
  "history.clear": { p: NoParams; r: Empty };
  "stats.get": { p: { period: StatsPeriod }; r: StatsResult };
  "import.files": { p: { paths: string[] }; r: { imported: number; failed: number } };

  // 3.5 pages
  "album.get": { p: { id: string }; r: AlbumGetResult };
  "artist.get": { p: { id: string }; r: ArtistGetResult };
  "artist.about": { p: { id: string }; r: ArtistAboutResult };
  "artist.tracks": { p: { id: string; cursor?: string }; r: TrackPage };
  "playlist.get": { p: { id: string; cursor?: string }; r: PlaylistGetResult };
  "podcast.get": { p: { id: string }; r: AlbumGetResult };
  "podcast.episodes": { p: { id: string; cursor?: string }; r: TrackPage };
  "related.get": { p: { trackId: string }; r: { shelves: Shelf[] } };

  // 3.6 player and queue
  "player.play": { p: { context: PlayContext; startIndex?: number; startId?: string; shuffle?: boolean }; r: Empty };
  "player.toggle": { p: NoParams; r: Empty };
  "player.pause": { p: NoParams; r: Empty };
  "player.resume": { p: NoParams; r: Empty };
  "player.next": { p: NoParams; r: Empty };
  "player.prev": { p: NoParams; r: Empty };
  "player.seek": { p: { ms: number }; r: Empty };
  "player.seekRelative": { p: { deltaMs: number }; r: Empty };
  "player.seekPercent": { p: { pct: number }; r: Empty };
  "player.setVolume": { p: { v: number }; r: Empty };
  "player.mute": { p: { on: boolean }; r: Empty };
  "player.setShuffle": { p: { on: boolean }; r: Empty };
  "player.setRepeat": { p: { mode: "off" | "all" | "one" }; r: Empty };
  "player.cycleRepeat": { p: NoParams; r: Empty };
  "player.setSpeed": { p: { speed: number; pitch?: number }; r: Empty };
  "player.sleepTimer": { p: { minutes?: number; endOfTrack?: boolean; cancel?: boolean }; r: { deadline?: number } };
  "player.output.list": {
    p: NoParams;
    r: {
      devices: { id: string; name: string; kind: "speaker" | "wired" | "bluetooth" | "usb" | "other"; default: boolean }[];
      current: string;
    };
  };
  "player.output.set": { p: { id: string }; r: Empty };
  "player.video": { p: { on: boolean }; r: Empty };
  "queue.window": {
    p: { offset: number; limit: number };
    r: { total: number; revision: number; currentIndex: number; items: QueueTrack[] };
  };
  "queue.add": { p: { ids: string[]; position: "next" | "end" | number }; r: { revision: number } };
  "queue.addContext": { p: { context: PlayContext; position: "next" | "end" | number }; r: { revision: number } };
  "queue.remove": { p: { qids: string[] }; r: Empty };
  "queue.move": { p: { from: number; to: number; expectedRevision: number }; r: Empty };
  "queue.select": { p: { qid: string }; r: Empty };
  "queue.clear": { p: { keepCurrent: true }; r: Empty };
  "queue.setAutoplay": { p: { on: boolean }; r: Empty };
  "queue.radio": { p: { seedId: string }; r: Empty };

  // 3.7 lyrics
  "lyrics.get": { p: { trackId: string }; r: Lyrics };
  "lyrics.search": { p: { trackId: string; query?: string }; r: { candidates: LyricsCandidate[] } };
  "lyrics.choose": { p: { trackId: string; candidateId: string }; r: Empty };
  "lyrics.setOffset": { p: { trackId: string; ms: number }; r: Empty };
  "lyrics.translate": { p: { trackId: string; on: boolean; target?: string }; r: Empty };
  "lyrics.romanize": { p: { trackId: string; on: boolean }; r: Empty };
  "lyrics.edit": { p: { trackId: string; lrc: string }; r: Empty };
  "lyrics.providers": { p: NoParams; r: LyricsProviderState };
  "lyrics.providers.set": { p: { order: string[]; enabled: Record<string, boolean> }; r: Empty };
  "lyrics.ai.setKey": { p: { provider: string; key: string }; r: Empty };
  "lyrics.ai.test": { p: { provider?: string }; r: { ok: boolean; error?: string } };

  // 3.8 equalizer
  "eq.get": { p: NoParams; r: EqState };
  "eq.setEnabled": { p: { on: boolean }; r: Empty };
  "eq.setProfile": { p: { id: string }; r: Empty };
  "eq.updateBand": { p: EqBandUpdate; r: Empty };
  "eq.addBand": { p: { freq: number }; r: Empty };
  "eq.removeBand": { p: { index: number }; r: Empty };
  "eq.resetBand": { p: { index: number }; r: Empty };
  "eq.setPreamp": { p: { db: number }; r: Empty };
  "eq.setAutoPreamp": { p: { on: boolean }; r: Empty };
  "eq.setEffects": { p: Partial<EqEffects>; r: Empty };
  "eq.profile.save": { p: { name: string; asNew: boolean }; r: { id: string } };
  "eq.profile.rename": { p: { id: string; name: string }; r: Empty };
  "eq.profile.delete": { p: { id: string }; r: Empty };
  "eq.undo": { p: NoParams; r: Empty };
  "eq.redo": { p: NoParams; r: Empty };
  "eq.reset": { p: NoParams; r: Empty };
  "eq.importFile": { p: { path: string }; r: { id: string } };
  "eq.exportFile": { p: { id: string; path: string }; r: Empty };
  "eq.autoeq.search": { p: { q: string }; r: { items: { name: string; source: string; variants: string[] }[] } };
  "eq.autoeq.apply": { p: { name: string; variant?: string }; r: { id: string } };
  "eq.device.bind": { p: { deviceId: string; profileId: string | null }; r: Empty };
  "eq.response": { p: { points: number }; r: { hz: number[]; db: number[] } };

  // 3.9 downloads and storage
  "download.tracks": { p: { ids: string[] }; r: Empty };
  "download.context": { p: { context: PlayContext }; r: Empty };
  "download.cancel": { p: { ids?: string[]; all?: boolean }; r: Empty };
  "download.pause": { p: NoParams; r: Empty };
  "download.resume": { p: NoParams; r: Empty };
  "download.retry": { p: { ids?: string[] }; r: Empty };
  "download.remove": { p: { ids: string[]; deleteFiles: true }; r: Empty };
  "download.summary": { p: NoParams; r: DownloadSummary };
  "download.window": { p: SongWindowParams; r: LibraryWindowResult };
  "download.queue": { p: NoParams; r: { items: DownloadQueueItem[] } };
  "download.setFolder": { p: { path: string | null }; r: { ok: boolean; error?: "not_writable" | "missing" } };
  "download.saveTo": { p: { ids: string[]; path: string }; r: Empty };
  "storage.usage": { p: NoParams; r: StorageUsage };
  "storage.clear": { p: { what: "songCache" | "imageCache" | "videoCache" | "animatedArt" }; r: Empty };

  // 3.10 settings
  "settings.schema": { p: NoParams; r: { entries: SettingEntry[] } };
  "settings.get": { p: { keys?: string[] }; r: { values: Record<string, unknown> } };
  "settings.set": { p: { values: Record<string, unknown> }; r: Empty };
  "settings.reset": { p: { keys: string[] }; r: Empty };

  // 3.11 accounts and sources
  "account.get": { p: NoParams; r: AccountGetResult };
  "account.youtube.login": { p: NoParams; r: { ok: boolean } };
  "account.youtube.switchChannel": { p: NoParams; r: Empty };
  "account.youtube.logout": { p: NoParams; r: Empty };
  "account.youtube.tokenLogin": { p: { cookie: string; visitorData?: string; dataSyncId?: string }; r: Empty };
  "sources.list": { p: NoParams; r: SourcesListResult };
  "sources.setEnabled": { p: { id: SourceId; on: boolean }; r: Empty };
  "sources.setPriority": { p: { order: SourceId[] }; r: Empty };
  "sources.setAutoBest": { p: { on: boolean }; r: Empty };
  "sources.setAutoFallback": { p: { on: boolean }; r: Empty };
  "source.zing.login": { p: NoParams; r: { ok: boolean; vip: boolean } };
  "source.zing.logout": { p: NoParams; r: Empty };
  "source.nct.login": {
    p: { account: string; password: string; phone?: string; countryCode?: string };
    r: { ok: boolean; vip: boolean };
  };
  "source.nct.logout": { p: NoParams; r: Empty };

  // 3.12 integrations
  "lastfm.login": { p: { username: string; password: string }; r: { ok: boolean; user: string } };
  "lastfm.logout": { p: NoParams; r: Empty };
  "lastfm.status": {
    p: NoParams;
    r: { user?: string; expired: boolean; scrobbling: boolean; nowPlaying: boolean; pending: number };
  };
  "listenbrainz.setToken": { p: { token: string | null }; r: Empty };
  "listenbrainz.status": { p: NoParams; r: { user?: string } };
  "discord.login": { p: NoParams; r: Empty };
  "discord.logout": { p: NoParams; r: Empty };
  "discord.status": { p: NoParams; r: { user?: string; enabled: boolean } };
  "import.providers": {
    p: NoParams;
    r: { items: { id: "spotify" | "tidal" | "deezer" | "apple" | "amazon"; signedIn: boolean }[] };
  };
  "import.login": { p: { provider: string }; r: Empty };
  "import.playlists": {
    p: { provider: string };
    r: { items: { id: string; title: string; count: number; art?: Art }[] };
  };
  "import.run": { p: { provider: string; playlistIds: string[]; target: "newUserAlbum" | `lp:${string}` }; r: { jobId: string } };

  // 3.13 Listen Together (capability listenTogether)
  "lt.state": { p: NoParams; r: LtState };
  "lt.create": { p: { name: string }; r: Empty };
  "lt.join": { p: { code: string; name: string }; r: Empty };
  "lt.leave": { p: NoParams; r: Empty };
  "lt.approve": { p: { userId: string }; r: Empty };
  "lt.reject": { p: { userId: string }; r: Empty };
  "lt.kick": { p: { userId: string }; r: Empty };
  "lt.transferHost": { p: { userId: string }; r: Empty };
  "lt.suggest": { p: { trackId: string }; r: Empty };
  "lt.suggestion.approve": { p: { id: string }; r: Empty };
  "lt.suggestion.reject": { p: { id: string }; r: Empty };
  "lt.servers": { p: NoParams; r: { items: { url: string; name?: string }[]; current?: string } };
  "lt.setServer": { p: { url: string }; r: Empty };
  "lt.blocked": { p: NoParams; r: { items: { id: string; name?: string }[] } };
  "lt.unblock": { p: { id: string }; r: Empty };
  "lt.invite": { p: NoParams; r: { url: string } };

  // 3.14 Device Connect (capability deviceConnect)
  "dc.state": { p: NoParams; r: DcState };
  "dc.enable": { p: { on: boolean }; r: Empty };
  "dc.setPort": { p: { port: number }; r: Empty };
  "dc.requireApproval": { p: { on: boolean }; r: Empty };
  "dc.connectLink": { p: { link: string }; r: Empty };
  "dc.accept": { p: { requestId: string }; r: Empty };
  "dc.reject": { p: { requestId: string }; r: Empty };
  "dc.confirmSas": { p: { requestId: string; match: boolean }; r: Empty };
  "dc.forget": { p: { deviceId: string }; r: Empty };
  "dc.transferTo": { p: { deviceId: string }; r: Empty };
  "dc.attach": { p: { deviceId: string }; r: Empty };
  "dc.release": { p: { deviceId: string }; r: Empty };
  "dc.openFirewallSettings": { p: NoParams; r: Empty };

  // 3.15 backup, updates, misc
  "backup.create": { p: { path: string }; r: { bytes: number } };
  "backup.inspect": { p: { path: string }; r: { ok: boolean; platform: string; dbVersion: number; createdAt?: number; error?: string } };
  "backup.restore": { p: { path: string }; r: { staged: true } };
  "import.foreignBackup": { p: { path: string }; r: { imported: number } };
  "update.status": { p: NoParams; r: UpdateStatus };
  "crash.pending": { p: NoParams; r: { report?: { when: number; summary: string; path: string } } };
  "crash.dismiss": { p: NoParams; r: Empty };
  "onboarding.state": { p: NoParams; r: { completed: boolean } };
  "onboarding.complete": { p: NoParams; r: Empty };

  // 1.7 subscriptions
  "sub.open": { p: { topic: Topic; params?: { spectrum?: boolean; [k: string]: unknown } }; r: { sub: number } };
  "sub.close": { p: { sub: number }; r: Empty };
}

export type Topic = "player" | "queue" | "lyrics" | "library" | "downloads" | "settings" | "eq" | "account" | "lt" | "dc" | "app";
export const TOPICS: readonly Topic[] = ["player", "queue", "lyrics", "library", "downloads", "settings", "eq", "account", "lt", "dc", "app"];

export type MethodName = keyof Methods;
export type Params<K extends MethodName> = Methods[K]["p"];
export type Result<K extends MethodName> = Methods[K]["r"];

