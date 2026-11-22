import { SEP, tidy, type MenuItem } from "./types";
import { t, plural } from "../i18n";
import { client } from "../lib/core";
import { caps } from "../lib/caps";
import { copyLinks } from "../lib/clipboard";
import { openSongInfo } from "../lib/songInfo";
import { navigate } from "../router/router";
import { player } from "../state/player";
import { addDropped, userAlbums } from "../state/userAlbums";
import { prompt } from "../dialogs/Prompt";
import { toast } from "../toast";
import type { SourceId, SourceOption, Track } from "../lib/types";

export type SongMenuCtx = {
  /** set inside a user album: adds "Xoá khỏi album" */
  userAlbumId?: string;
  /** playlist entry ids of `tracks` (same order), for userAlbum.remove */
  entryIds?: string[];
};

const SOURCE_NAME: Record<SourceId, string> = { yt: "YouTube Music", sc: "SoundCloud", zing: "Zing MP3", nct: "NhacCuaTui", local: "Local" };

const hintText = (h: NonNullable<SourceOption["hint"]>) => (h === "vip_login" ? t("w2_src_vip") : h === "region" ? t("w2_src_region") : t("w2_src_preview"));

/** Source options as menu items: real quality badge, check on the auto pick, hint when locked. */
export function sourceItems(trackId: string, options: SourceOption[]): MenuItem[] {
  return options.map((o) => ({
    id: `src-${o.source}`,
    label: SOURCE_NAME[o.source] ?? o.source,
    badge: o.quality?.label,
    checked: o.auto,
    disabled: !o.available,
    hint: !o.available && o.hint ? hintText(o.hint) : undefined,
    run: async () => {
      await client.call("track.setSource", { id: trackId, source: o.source });
    },
  }));
}

/** "Thêm vào album của tôi" targets plus "+ Album mới". */
export function addToAlbumItems(ids: string[]): MenuItem[] {
  return [
    ...userAlbums.all().map((a): MenuItem => ({ id: `ua-${a.id}`, label: a.title, icon: "album", run: () => addDropped(a.id, ids) })),
    { id: "ua-new", label: t("w2_new_album_plus"), icon: "add", run: () => createAlbumWith(ids) },
  ];
}

/** "+ Album mới": ask for a name, create the album with these tracks. */
export async function createAlbumWith(ids: string[] = []): Promise<string | null> {
  const title = await prompt({ title: t("w2_new_album"), label: t("w2_album_name"), value: "", okLabel: t("w2_create") });
  if (!title) return null;
  try {
    const id = await userAlbums.create(title, ids.length ? ids : undefined);
    toast({ i18n: "w2_album_created", args: [title] });
    return id;
  } catch {
    toast({ i18n: "w2_error_generic", level: "error" });
    return null;
  }
}

const queued = (n: number) => toast({ text: plural("w2_queued_n", n) });

/** The song context menu, in MK order (LS 5.3). `tracks` is the whole selection. */
export function songMenu(tracks: Track[], ctx: SongMenuCtx = {}): MenuItem[] {
  if (!tracks.length) return [];
  const ids = tracks.map((x) => x.id);
  const one = tracks.length === 1 ? tracks[0] : null;
  const artistId = one?.artists[0]?.id;
  const albumId = one?.album?.id;
  return tidy([
    { id: "play-next", label: t("w2_play_next"), icon: "queue_play_next", run: async () => (await player.playNext(ids), queued(ids.length)) },
    { id: "add-queue", label: t("w2_add_queue"), icon: "playlist_add", run: async () => (await player.addToQueue(ids), queued(ids.length)) },
    { id: "add-album", label: t("w2_add_to_album"), icon: "library_add", children: () => Promise.resolve(addToAlbumItems(ids)) },
    SEP,
    caps.downloads !== "unsupported" && {
      id: "download",
      label: t("w2_download"),
      icon: "download",
      disabled: caps.downloads === "soon",
      hint: caps.downloads === "soon" ? "M4" : undefined,
      children: caps.downloads === "soon" ? undefined : [],
    },
    one && { id: "sources", label: t("w2_choose_source"), icon: "swap_horiz", children: async () => sourceItems(one.id, (await client.call<{ options: SourceOption[] }>("track.sources", { id: one.id })).options) },
    SEP,
    !!artistId && { id: "go-artist", label: t("w2_go_artist"), icon: "person", run: () => navigate("artist", { id: artistId }) },
    !!albumId && { id: "go-album", label: t("w2_go_album"), icon: "album", run: () => navigate("album", { id: albumId }) },
    { id: "copy-link", label: t("w2_copy_link"), icon: "link", hint: "Ctrl C", run: () => void copyLinks(ids.map((id) => ({ id, kind: "track" }))) },
    one && { id: "info", label: t("w2_song_info"), icon: "info", hint: "Ctrl I", run: () => void openSongInfo(one.id) },
    ctx.userAlbumId && ctx.entryIds?.length
      ? { id: "remove", label: t("w2_remove_from_album"), icon: "delete", hint: "Del", run: () => client.call("userAlbum.remove", { id: ctx.userAlbumId, entryIds: ctx.entryIds }).then(() => undefined) }
      : false,
  ]);
}
