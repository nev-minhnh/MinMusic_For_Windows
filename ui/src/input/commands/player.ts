// M2-2 player commands. The basics of section 7 (Space, seek, volume, mute, 0-9, next/prev, S/R, T) are bound in m1.ts; this
// file binds what needs the pane, the lyrics overlay and the full-player tabs: L / Q / F11 / Ctrl L, and overrides the M1 stubs.
import { client } from "../../lib/core";
import { player, playerState } from "../../state/player";
import { fullOpen, toggleFull } from "../../state/ui";
import { fpLayer, fpTab, lyricsFs, paneOpen, paneTab, setFpLayer, setFpTab, setLyricsFs, togglePane, type FpTab } from "../../state/playerExtra";
import type { Command } from "../ctx";

/** L / Q inside the full player: select the tab and raise the one-pane layer (a no-op visually when both panes show). */
function showTab(tab: FpTab) {
  if (fpTab() === tab) setFpLayer(!fpLayer());
  else { setFpTab(tab); setFpLayer(true); }
}

export const commands: Command[] = [
  { id: "pane.lyrics", run: () => (fullOpen() ? showTab("lyrics") : togglePane("lyrics")) },
  { id: "pane.queue", run: () => (fullOpen() ? showTab("queue") : togglePane("queue")) },
  {
    // F11: lyrics fullscreen when the lyrics are on screen (full player, lyrics tab of the pane, or already fullscreen);
    // otherwise the window fullscreen of the shell (not part of M2-2: logged like the M1 stub).
    id: "fullscreen.toggle",
    run: () => {
      if (lyricsFs()) setLyricsFs(false);
      else if (fullOpen() || (paneOpen() && paneTab() === "lyrics")) setLyricsFs(true);
      else void client.call("app.log", { level: "info", msg: "noop: fullscreen.toggle" }).catch(() => {});
    },
  },
  {
    id: "track.like",
    run: () => {
      const tr = playerState()?.track;
      if (tr) void player.like(tr.id, !tr.liked);
    },
  },
  { id: "fullPlayer.toggle", run: toggleFull },
];
