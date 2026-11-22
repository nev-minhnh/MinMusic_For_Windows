// api.md §1.10, §2, §3.6-3.8 models, §4 PlayerState
export type Art = {
  /** https URL or "core:<kind>/<id>" */
  src: string;
  w?: number;
  h?: number;
  /** "#rrggbb", when known */
  dominant?: string;
};

export type SourceId = "yt" | "sc" | "zing" | "nct" | "local";
export type Quality = {
  label: "FLAC" | "Lossless" | "320" | "256" | "Opus 160" | "AAC 256" | "AAC 160" | "128" | string;
  lossless: boolean;
  kbps?: number;
};
export type ArtistRef = { id?: string; name: string };
export type AlbumRef = { id?: string; title: string };
export type DownloadState = "none" | "queued" | "downloading" | "downloaded" | "failed";

export interface Track {
  id: string;
  title: string;
  artists: ArtistRef[];
  album?: AlbumRef;
  durationMs?: number;
  art?: Art;
  explicit?: boolean;
  source: SourceId;
  quality?: Quality;
  /** "+N" */
  altSources?: number;
  liked?: boolean;
  download?: DownloadState;
  isVideo?: boolean;
  playCountText?: string;
  addedAt?: number;
  /** playlist entry id for remove/move */
  setVideoId?: string;
  /** needs VIP */
  vip?: boolean;
}

export interface AlbumCard {
  id: string;
  title: string;
  artists: ArtistRef[];
  year?: number;
  art?: Art;
  source: SourceId;
  kind: "album" | "single" | "ep";
}
export interface ArtistCard { id: string; name: string; art?: Art; subtitle?: string; source: SourceId }
export interface PlaylistCard {
  id: string;
  title: string;
  subtitle?: string;
  art?: Art;
  source: SourceId;
  owner?: string;
  local: boolean;
  count?: number;
}

export interface TrackItem extends Track { t: "track" }
export interface AlbumItem extends AlbumCard { t: "album" }
export interface ArtistItem extends ArtistCard { t: "artist" }
export interface PlaylistItem extends PlaylistCard { t: "playlist" }
export type Item = TrackItem | AlbumItem | ArtistItem | PlaylistItem;

/** route table: frontend-spec §3 */
export type NavTarget = { route: string; params: object };

export interface Shelf {
  key: string;
  title: string;
  subtitle?: string;
  layout: "quickPicks" | "cards" | "chart" | "rows" | "chips";
  items: Item[];
  more?: NavTarget;
}

export type SortSpec = {
  by: "added" | "title" | "artist" | "album" | "duration" | "plays" | "lastPlayed" | "custom";
  desc: boolean;
};
export type FilterSpec = { text?: string; source?: SourceId; downloaded?: boolean; liked?: boolean; explicit?: boolean };
export type LocalList =
  | "songs" | "liked" | "downloaded" | "albums" | "artists" | "playlists"
  | `userAlbum:${string}` | "history" | "cached";

export type GreetingKey = "good_morning" | "good_afternoon" | "good_evening" | "good_night";

export interface SourceOption {
  source: SourceId;
  id: string;
  quality: Quality;
  auto: boolean;
  available: boolean;
  hint?: "vip_login" | "region" | "preview_only";
}

export type PlayContext =
  | { kind: "tracks"; ids: string[]; title?: string }
  | {
      kind: "album" | "playlist" | "artist" | "radio" | "userAlbum" | "library";
      id?: string;
      list?: LocalList;
      sort?: SortSpec;
      filter?: FilterSpec;
    };

export interface Lyrics {
  trackId: string;
  provider: string;
  synced: "word" | "line" | "none";
  offsetMs: number;
  lines: {
    /** ms */
    t: number;
    end?: number;
    text: string;
    words?: { t: number; end: number; text: string }[];
    /** translation */
    tr?: string;
    /** romanized */
    ro?: string;
    agent?: "v1" | "v2" | "bg";
  }[];
}

export interface EqBand { type: "PK" | "LSC" | "HSC" | "LPQ" | "HPQ" | "BP" | "NO"; freq: number; gain: number; q: number }
export interface EqEffects {
  bassDb: number;
  trebleDb: number;
  widthPct: number;
  crossfeed: "off" | "default" | "chuMoy" | "janMeier";
  limiter: boolean;
  outputDb: number;
}
export interface EqState {
  enabled: boolean;
  profileId: string;
  profiles: { id: string; name: string; builtin: boolean }[];
  bands: EqBand[];
  preampDb: number;
  autoPreamp: boolean;
  effects: EqEffects;
  limiterReductionDb: number;
  canUndo: boolean;
  canRedo: boolean;
  deviceProfiles: { deviceId: string; deviceName: string; profileId: string }[];
  maxBands: 32;
}

export interface PlayerState {
  track: Track | null;
  playing: boolean;
  buffering: boolean;
  reconnecting: boolean;
  posMs: number;
  durMs: number;
  bufMs: number;
  /** core epoch ms */
  at: number;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: "off" | "all" | "one";
  speed: number;
  pitch: number;
  context?: { title: string; nav?: NavTarget };
  sleep?: { deadline?: number; endOfTrack: boolean };
  output?: { id: string; name: string; kind: string };
  eq: { enabled: boolean; profileName: string };
  quality?: Quality;
  source?: SourceId;
  canPrev: boolean;
  canNext: boolean;
  remote?: { kind: "deviceConnect" | "cast" | "listenTogether"; name: string };
}

/** `player.state` delta: PlayerState minus the position fields (api.md §4) */
export type PlayerStateDelta = Omit<PlayerState, "posMs" | "bufMs" | "at">;

export interface SettingEntry {
  key: string;
  type: "bool" | "int" | "float" | "string" | "enum" | "json" | "secret";
  default: unknown;
  enumValues?: string[];
  min?: number;
  max?: number;
  step?: number;
  platform?: "all" | "desktop" | "android";
}

export interface SourceInfo {
  id: SourceId;
  name: string;
  enabled: boolean;
  status: "ok" | "degraded" | "off";
  signedIn?: boolean;
  vip?: boolean;
  account?: string;
  maxQuality: Quality;
  canLogin: boolean;
}

export interface QueueTrack extends Track { qid: string }
export interface Pagination<T> { items: T[]; next: string | null }
export interface WindowResult<T> { total: number; revision: number; offset: number; items: T[] }
