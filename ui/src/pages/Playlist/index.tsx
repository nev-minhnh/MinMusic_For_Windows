import { Show, createSignal } from "solid-js";
import type { PlaylistGetResult } from "@minmusic/protocol";
import type { RouteName } from "../../router/routes";
import type { PageProps } from "../../router/registry";
import { CollectionHeader } from "../../components/pages/CollectionHeader";
import { CursorTable } from "../../components/pages/CursorTable";
import { createCursorList } from "../../components/pages/cursorList";
import { cacheGet, cacheSet } from "../../components/pages/pageCache";
import { durationText } from "../../components/pages/data";
import { playExtra, playlistContext } from "../../components/pages/playContext";
import { openMenu } from "../../components/Menu";
import { cardMenu } from "../../menus/card";
import { client } from "../../lib/core";
import { player } from "../../state/player";
import { toast } from "../../toast";
import { t } from "../../i18n";
import type { Track } from "../../lib/types";

type Meta = PlaylistGetResult["playlist"];

/** Playlist: header + cursor-paged track Table (60 rows or fewer render plain, more switch to VirtualList with fixed rows). */
export function Playlist(props: PageProps) {
  const id = () => props.params.id;
  const [meta, setMeta] = createSignal<Meta | undefined>(cacheGet<Meta>(`playlistMeta:${props.params.id}`));
  const [saved, setSaved] = createSignal<boolean>(cacheGet<boolean>(`playlistSaved:${props.params.id}`) ?? false);
  const list = createCursorList<Track>(async (cursor) => {
    const r = await client.call<PlaylistGetResult>("playlist.get", { id: id(), cursor });
    setMeta(r.playlist);
    cacheSet(`playlistMeta:${id()}`, r.playlist);
    return { items: r.tracks, next: r.next };
  }, `playlist:${props.params.id}`);
  const play = (extra?: { shuffle?: boolean; startId?: string }) => void player.play(playlistContext(id()), playExtra(extra));

  const save = async () => {
    const on = !saved();
    setSaved(on);
    cacheSet(`playlistSaved:${id()}`, on);
    try {
      await client.call("playlist.save", { id: id(), on });
    } catch {
      setSaved(!on);
      cacheSet(`playlistSaved:${id()}`, !on);
      toast({ i18n: "w2_error_generic", level: "error" });
    }
  };
  const metaLine = () => {
    const m = meta();
    if (!m) return null;
    const parts: string[] = [];
    if (m.owner) parts.push(m.owner);
    if (m.count != null) parts.push(`${m.count} ${t("w2_songs_unit")}`);
    if (m.durationMs) parts.push(durationText(m.durationMs, t));
    return parts.join(" · ");
  };

  return (
    <div class="sc playlist" data-testid="playlist">
      <CollectionHeader
        loading={!meta()}
        art={meta()?.art}
        kicker={t("w2_pg_playlist")}
        title={meta()?.title}
        meta={
          <>
            <Show when={meta()?.description}>
              <div class="ell">{meta()!.description}</div>
            </Show>
            {metaLine()}
          </>
        }
        onPlay={() => play()}
        onShuffle={() => play({ shuffle: true })}
        saved={saved()}
        onSave={save}
        onMore={(at) => meta() && openMenu(cardMenu({ t: "playlist", ...meta()! }), at)}
      />
      <div style={{ "margin-top": "16px" }}>
        <CursorTable list={list} label={meta()?.title ?? t("w2_pg_playlist")} testid="playlist-table" cols={["index", "title", "album", "like", "dur", "more"]} onPlay={(_i, tr) => play({ startId: tr.id })} />
      </div>
    </div>
  );
}

export const routes: RouteName[] = ["playlist"];
export default Playlist;
