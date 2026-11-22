// Subset of docs/api.md section 2 and section 4 used by M0. Replaced by protocol types once M0-D lands.
export type SourceId = "yt" | "sc" | "zing" | "nct" | "local";
export type Art = { src: string; w?: number; h?: number; dominant?: string };
export type Quality = { label: string; lossless: boolean; kbps?: number };
export type ArtistRef = { id?: string; name: string };
export type AlbumRef = { id?: string; title: string };
export type Track = {
  id: string;
  title: string;
  artists: ArtistRef[];
  album?: AlbumRef;
  durationMs?: number;
  art?: Art;
  explicit?: boolean;
  source: SourceId;
  quality?: Quality;
  altSources?: number;
  liked?: boolean;
  addedAt?: number;
  addedText?: string;
};
export type AlbumCard = { id: string; title: string; artists: ArtistRef[]; year?: number; art?: Art; source: SourceId; kind: "album" | "single" | "ep" };
export type PlaylistCard = { id: string; title: string; subtitle?: string; art?: Art; source: SourceId; local: boolean; count?: number };
export type Item = ({ t: "track" } & Track) | ({ t: "album" } & AlbumCard) | ({ t: "playlist" } & PlaylistCard);
export type NavTarget = { route: string; params: Record<string, string> };
export type Shelf = { key: string; title: string; subtitle?: string; layout: "quickPicks" | "cards" | "chart" | "rows" | "chips"; items: Item[]; more?: NavTarget };
export type HomeResult = {
  shelves: Shelf[];
  chips: { key: string; title: string; selected: boolean }[];
  greeting: { key: string };
  fromCache: boolean;
  next: string | null;
};
export type ChartsResult = {
  source: "zing" | "nct" | "yt";
  title: string;
  updatedAt: number;
  tabs: { key: string; title: string }[];
  items: (Track & { rank: number; trend: "up" | "down" | "same" | "new"; delta?: number })[];
};
export type SortSpec = { by: string; desc: boolean };
export type WindowResult<T> = { total: number; revision: number; offset: number; items: T[] };
export type AlbumResult = {
  album: AlbumCard & { description?: string; durationMs: number; trackCount: number; year: number; saved: boolean };
  tracks: Track[];
};
export type PlayerState = {
  track: Track | null;
  playing: boolean;
  buffering: boolean;
  reconnecting: boolean;
  posMs: number;
  durMs: number;
  bufMs: number;
  at: number;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: "off" | "all" | "one";
  speed: number;
  pitch: number;
  context?: { title: string; nav?: NavTarget };
  eq: { enabled: boolean; profileName: string };
  quality?: Quality;
  source?: SourceId;
  canPrev: boolean;
  canNext: boolean;
};
export type PositionEvent = { posMs: number; durMs: number; bufMs: number; playing: boolean; rate: number; at: number };

export interface Client {
  call<T = any>(m: string, p?: any): Promise<T>;
  sub(topic: string, params: any, onEvent: (name: string, data: any) => void): () => void;
}
