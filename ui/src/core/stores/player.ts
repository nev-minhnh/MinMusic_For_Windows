// Player store: fed by the `player` topic. The playback clock interpolates the position locally.
import { createSignal, type Accessor } from "solid-js";
import { createStore, reconcile, type Store } from "solid-js/store";
import type { PlayerState } from "@minmusic/protocol";
import type { CoreClient } from "../client.ts";
import { PlaybackClock } from "../clock.ts";

export const EMPTY_PLAYER: PlayerState = {
  track: null, playing: false, buffering: false, reconnecting: false,
  posMs: 0, durMs: 0, bufMs: 0, at: 0,
  volume: 1, muted: false, shuffle: false, repeat: "off", speed: 1, pitch: 1,
  eq: { enabled: false, profileName: "" }, canPrev: false, canNext: false,
};

export interface PlayerStore {
  state: Store<PlayerState>;
  /** false until the first snapshot arrives (and again while the connection is down) */
  ready: Accessor<boolean>;
  clock: PlaybackClock;
  /** last `player.error` */
  lastError: Accessor<{ code: string; i18n: string; trackId: string; skipped: boolean } | null>;
  dispose(): void;
}

export function createPlayerStore(client: CoreClient, clock = new PlaybackClock()): PlayerStore {
  const [state, setState] = createStore<PlayerState>({ ...EMPTY_PLAYER });
  const [ready, setReady] = createSignal(false);
  const [lastError, setLastError] = createSignal<PlayerStore["lastError"] extends Accessor<infer T> ? T : never>(null);

  const offStatus = client.onStatus((s) => { if (s !== "ready") setReady(false); });
  const unsub = client.sub("player", (ev, p) => {
    switch (ev) {
      case "player.snapshot": {
        const s = p as PlayerState;
        setState(reconcile(s));
        clock.update({ posMs: s.posMs, durMs: s.durMs, playing: s.playing, rate: s.speed });
        setReady(true);
        break;
      }
      case "player.state": {
        // PlayerState minus position: merge, and rebase the clock without moving the position
        setState(reconcile({ ...state, ...p, posMs: state.posMs, bufMs: state.bufMs, at: state.at }));
        clock.patch({ playing: p.playing, durMs: p.durMs, rate: p.speed });
        break;
      }
      case "player.position": {
        setState({ posMs: p.posMs, durMs: p.durMs, bufMs: p.bufMs, playing: p.playing, at: p.at, speed: p.rate });
        clock.update({ posMs: p.posMs, durMs: p.durMs, playing: p.playing, rate: p.rate });
        break;
      }
      case "player.error":
        setLastError(p);
        break;
    }
  });

  return { state, ready, clock, lastError, dispose() { unsub(); offStatus(); } };
}
