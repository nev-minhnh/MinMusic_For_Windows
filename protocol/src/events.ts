// api.md §4: events pushed by the core. `Events[name]` is the `p` payload.
import type { DcState, DownloadSummary, LtState, AccountGetResult, SourcesListResult, LibraryCounts } from "./methods.ts";
import type { EqState, Lyrics, LocalList, NavTarget, PlayerState, PlayerStateDelta, QueueTrack, Track } from "./models.ts";
import type { Shelf } from "./models.ts";

export interface PlayerPosition {
  posMs: number; durMs: number; bufMs: number; playing: boolean; rate: number;
  /** core epoch ms */
  at: number;
}
export interface PlayerError { code: string; i18n: string; trackId: string; skipped: boolean }
export interface QueueSnapshot { total: number; revision: number; currentIndex: number; head: QueueTrack[] }
export interface AppToast {
  i18n: string; args?: string[]; level: "info" | "error";
  action?: { label: string; m: string; p?: object };
}

export interface Events {
  // player
  "player.snapshot": PlayerState;
  "player.state": PlayerStateDelta;
  "player.position": PlayerPosition;
  "player.error": PlayerError;
  // queue
  "queue.snapshot": QueueSnapshot;
  "queue.changed": { revision: number; currentIndex: number };
  // lyrics
  "lyrics.snapshot": Lyrics | null;
  "lyrics.updated": Lyrics;
  "lyrics.cleared": Record<string, never>;
  // library
  "library.snapshot": { counts: LibraryCounts; revision: number };
  "library.changed": { lists: LocalList[]; revision: number };
  "userAlbums.changed": Record<string, never>;
  // downloads
  "downloads.snapshot": DownloadSummary;
  "download.progress": { id: string; state: "queued" | "downloading" | "downloaded" | "failed" | "none"; progress: number; bytes?: number };
  "download.summary": DownloadSummary;
  // settings
  "settings.snapshot": { values: Record<string, unknown> };
  "settings.changed": { changed: Record<string, unknown> };
  // eq
  "eq.snapshot": EqState;
  "eq.state": EqState;
  "eq.spectrum": { b64: string };
  // account
  "account.snapshot": { account: AccountGetResult; sources: SourcesListResult };
  "account.changed": AccountGetResult;
  "sources.changed": SourcesListResult;
  // lt
  "lt.snapshot": LtState;
  "lt.state": LtState;
  "lt.joinRequest": { userId: string; name: string };
  "lt.suggestion": { id: string; trackId: string; by: string; track?: Track };
  // dc
  "dc.snapshot": DcState;
  "dc.state": DcState;
  "dc.request": { requestId: string; peer: string; sas?: string };
  // app
  "app.snapshot": { toasts: AppToast[] };
  "app.toast": AppToast;
  "home.updated": { shelves: Shelf[] };
  "import.progress": { jobId: string; done: number; total: number; failed: number };
  "core.shuttingDown": Record<string, never>;
}

export type EventName = keyof Events;
