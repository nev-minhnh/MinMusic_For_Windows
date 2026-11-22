import { client } from "../../lib/core";
import { copyLinks } from "../../lib/clipboard";
import { openSongInfo } from "../../lib/songInfo";
import { activeList } from "../../lib/selection";
import { player, playerState } from "../../state/player";
import { toggleSidebar } from "../../state/shell";
import { toast } from "../../toast";
import type { Command } from "../ctx";

/** ids the user means: the selection of the focused list, else the track that is playing */
const targetIds = (): string[] => {
  const sel = activeList()?.ids() ?? [];
  if (sel.length) return sel;
  const cur = playerState()?.track;
  return cur ? [cur.id] : [];
};

export const commands: Command[] = [
  { id: "sidebar.toggle", run: toggleSidebar },
  {
    id: "track.like",
    run: () => {
      const tr = playerState()?.track;
      if (tr) void player.like(tr.id, !tr.liked);
    },
  },
  {
    id: "track.info",
    run: () => {
      const id = targetIds()[0];
      if (id && !openSongInfo(id)) void client.call("app.log", { level: "info", msg: "track.info: no song info dialog registered" }).catch(() => {});
    },
  },
  {
    id: "link.copy",
    run: () => {
      const ids = targetIds();
      if (ids.length) void copyLinks(ids.map((id) => ({ id, kind: "track" })));
      else toast({ i18n: "w2_nothing_selected" });
    },
  },
];
