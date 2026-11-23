import { SEP, tidy, type MenuItem } from "./types";
import { t } from "../i18n";
import { caps } from "../lib/caps";
import { downloadMenu } from "./ext/download";
import { copyLinks } from "../lib/clipboard";
import { player, addContextToQueue } from "../state/player";
import { userAlbums } from "../state/userAlbums";
import { toast } from "../toast";
import type { Item, PlayContext } from "../lib/types";

/** The play context behind an album / playlist / artist card. */
export function contextOf(item: Item): PlayContext | null {
  switch (item.t) {
    case "album":
      return { kind: "album", id: item.id };
    case "playlist":
      return { kind: item.local ? "userAlbum" : "playlist", id: item.id };
    case "artist":
      return { kind: "artist", id: item.id };
    default:
      return null;
  }
}

/** Card menu (album, playlist, artist): Phát, Trộn bài, Thêm vào hàng đợi, Tải xuống ›, Ghim vào sidebar (user albums), Sao chép liên kết. */
export function cardMenu(item: Item): MenuItem[] {
  const ctx = contextOf(item);
  if (!ctx) return [];
  const local = item.t === "playlist" && item.local;
  const pinned = local ? !!userAlbums.get(item.id)?.pinned : false;
  return tidy([
    { id: "play", label: t("w2_play"), icon: "play", run: () => void player.play(ctx) },
    { id: "shuffle", label: t("w2_shuffle"), icon: "shuffle", run: () => void player.play(ctx, { shuffle: true }) },
    { id: "add-queue", label: t("w2_add_queue"), icon: "playlist_add", run: async () => (await addContextToQueue(ctx, "end"), toast({ i18n: "w2_queued_one" })) },
    SEP,
    caps.downloads !== "unsupported" && { id: "download", label: t("w2_download"), icon: "download", disabled: caps.downloads === "soon", hint: caps.downloads === "soon" ? "M4" : undefined, children: caps.downloads === "soon" ? undefined : downloadMenu({ context: ctx, title: "title" in item ? item.title : item.name }) },
    local && { id: "pin", label: pinned ? t("w2_unpin_sidebar") : t("w2_pin_sidebar"), icon: "push_pin", run: () => userAlbums.pin(item.id, !pinned) },
    { id: "copy-link", label: t("w2_copy_link"), icon: "link", hint: "Ctrl C", run: () => void copyLinks([{ id: item.id, kind: item.t === "playlist" && item.local ? "userAlbum" : item.t }]) },
  ]);
}
