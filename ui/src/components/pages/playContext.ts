import type { PlayContext } from "../../lib/types";

/** Play contexts of the collection pages. The core resolves the ids, the UI never sends the track list. */
export const albumContext = (id: string): PlayContext => ({ kind: "album", id });
export const playlistContext = (id: string): PlayContext => ({ kind: "playlist", id });
export const artistContext = (id: string): PlayContext => ({ kind: "artist", id });
export const radioContext = (id: string): PlayContext => ({ kind: "radio", id });

export type PlayExtra = { shuffle?: boolean; startId?: string };
/** The `player.play` params (without the context) for a Phát / Trộn bài / double-click action. */
export function playExtra(o: PlayExtra = {}): Record<string, unknown> {
  const x: Record<string, unknown> = {};
  if (o.shuffle) x.shuffle = true;
  if (o.startId) x.startId = o.startId;
  return x;
}
