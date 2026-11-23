import { back, forward, current, navigate } from "../../router/router";
import { client } from "../../lib/core";
import { player, playerState } from "../../state/player";
import { toggleFull } from "../../state/ui";
import { keyCtx, type Command } from "../ctx";

const SEEK_MS = 10_000; // seekDurationSeconds default; M4 binds it to settings
const VOL_STEP = 0.1;
const sign = (a?: string) => (Number(a) < 0 ? -1 : 1);

/** Features that belong to a later milestone: logged, so tests can spy on the call and nothing else happens. */
const noop = (id: string): Command => ({ id, run: () => void client.call("app.log", { level: "info", msg: `noop: ${id}` }).catch(() => {}) });

/** DOM event for the page that is on screen (Del -> mm-delete, F2 -> mm-rename, F5 -> mm-refresh). */
const toPage = (name: string) => () => {
  document.querySelector(`[data-key="${current().key}"]`)?.dispatchEvent(new CustomEvent(name, { bubbles: false }));
};

export const commands: Command[] = [
  { id: "player.toggle", run: () => void player.toggle() },
  { id: "seek.rel", run: (c) => void player.seekRelative(sign(c.arg) * SEEK_MS) },
  { id: "seek.pct", run: (c) => void player.seekPercent(Number(c.arg)) },
  { id: "volume.rel", run: (c) => void player.setVolume(Math.min(1, Math.max(0, Math.round(((playerState()?.volume ?? 0.5) + sign(c.arg) * VOL_STEP) * 100) / 100))) },
  { id: "player.mute", run: () => void player.mute(!playerState()?.muted) },
  { id: "player.next", run: () => void player.next() },
  { id: "player.prev", run: () => void player.prev() },
  { id: "player.shuffle", run: () => void player.setShuffle(!playerState()?.shuffle) },
  { id: "player.repeat", run: () => void player.cycleRepeat() },
  { id: "fullPlayer.toggle", run: toggleFull },
  { id: "search.focus", run: () => keyCtx.focusSearch() },
  { id: "equalizer.open", run: () => navigate("equalizer") },
  { id: "nav.back", run: back },
  { id: "nav.forward", run: forward },
  { id: "page.refresh", run: toPage("mm-refresh") },
  { id: "page.delete", run: toPage("mm-delete") },
  { id: "page.rename", run: toPage("mm-rename") },
  // not implemented yet: wired, logged, spied in tests. Ids with a real command elsewhere (player, mini, settings, logs) are
  // not listed: the glob registry lets the file that sorts last win, so a no-op here would shadow them.
  ...["video.captions", "video.mode", "window.fullscreen", "app.quit"].map(noop),
];
