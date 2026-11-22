// Re-export shim of the protocol types (new code imports from "@minmusic/protocol" directly) plus the UI-only types.
import type { PlayerPosition, HomeGetResult, ChartsGetResult, AlbumGetResult, Track as ProtoTrack } from "@minmusic/protocol";
export type {
  Art, SourceId, Quality, ArtistRef, AlbumRef, DownloadState, AlbumCard, ArtistCard, PlaylistCard,
  TrackItem, AlbumItem, ArtistItem, PlaylistItem, Item, NavTarget, Shelf, SortSpec, FilterSpec, LocalList,
  SourceOption, PlayContext, PlayerState, WindowResult, LibraryCounts, UserAlbumCard,
} from "@minmusic/protocol";
export type PositionEvent = PlayerPosition;
export type HomeResult = HomeGetResult;
export type ChartsResult = ChartsGetResult;
export type AlbumResult = AlbumGetResult;

// ---- UI-only types
/** Protocol Track plus the pre-formatted "added" text the table renders (mock and core may send it). */
export type Track = ProtoTrack & { addedText?: string };
export interface Client {
  call<T = any>(m: string, p?: any): Promise<T>;
  sub(topic: string, params: any, onEvent: (name: string, data: any) => void): () => void;
}
