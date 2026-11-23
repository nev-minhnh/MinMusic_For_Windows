import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { useSentinelPaging } from "../../components/pages/paging";
import type { TrackPage } from "@minmusic/protocol";
import type { RouteName } from "../../router/routes";
import type { PageProps } from "../../router/registry";
import { LoadError } from "../../components/pages/LoadError";
import { CollectionHeader } from "../../components/pages/CollectionHeader";
import { createCursorList } from "../../components/pages/cursorList";
import { albumData, durationText } from "../../components/pages/data";
import { playExtra } from "../../components/pages/playContext";
import { Art } from "../../components/Art";
import { Icon } from "../../components/Icon";
import { VirtualList } from "../../components/VirtualList";
import { openMenu } from "../../components/Menu";
import { cardMenu } from "../../menus/card";
import { songMenu } from "../../menus/song";
import { delegate, registerRow } from "../../lib/delegate";
import { client } from "../../lib/core";
import { artistsText } from "../../lib/format";
import { player, playerState, elapsed } from "../../state/player";
import { toast } from "../../toast";
import { t } from "../../i18n";
import "./podcast.css";
import type { Track } from "../../lib/types";

const EP_H = 72;
const SHORT = 60;

/** One episode row (72): art, title, one-line description, duration, and a 2 px progress line for the episode that is playing. */
function Episode(props: { tr?: Track; index: number; playing: boolean; onPlay: (t: Track) => void }) {
  const progress = () => {
    const tr = props.tr;
    return props.playing && tr?.durationMs ? Math.min(1, elapsed() / tr.durationMs) : 0;
  };
  const reg = (el: HTMLElement) =>
    registerRow(el, () => ({ onContext: (e) => props.tr && openMenu(songMenu([props.tr], {}), { x: e.clientX, y: e.clientY }) }));
  return (
    <Show when={props.tr} fallback={<div class="ep ep-skel" aria-hidden="true" />}>
      {(tr) => (
        <div ref={reg} class="ep" classList={{ playing: props.playing }} data-testid="episode-row" data-key={String(props.index)} tabindex="-1" onDblClick={() => props.onPlay(tr())}>
          <Art art={tr().art} size={48} class="pressable" />
          <div class="f1 ep-m">
            <div class="w6 ell">{tr().title}</div>
            <div class="t12 i3 ell">{artistsText(tr().artists)}</div>
          </div>
          <div class="t12 i3 num ep-d">{durationText(tr().durationMs ?? 0, t)}</div>
          <button type="button" class="ib ep-p" aria-label={t("w2_play")} data-testid="episode-play" onClick={() => props.onPlay(tr())}>
            <Icon n="play" s={20} />
          </button>
          <div class="ep-bar" aria-hidden="true">
            <i style={{ transform: `scaleX(${progress()})` }} />
          </div>
        </div>
      )}
    </Show>
  );
}

/** Podcast: CollectionHeader + episode list (podcast.episodes cursor; VirtualList beyond 60). */
export function Podcast(props: PageProps) {
  const id = () => props.params.id;
  const { data, mutate, error, reload } = albumData(id, "podcast.get");
  const list = createCursorList<Track>((cursor) => client.call<TrackPage>("podcast.episodes", { id: id(), cursor }), `podcastEps:${props.params.id}`);
  const items = list.items;
  let host!: HTMLDivElement;
  let sentinel!: HTMLDivElement;
  const play = (extra?: { shuffle?: boolean; startId?: string }) => void player.play({ kind: "album", id: id() }, playExtra(extra));
  const playEp = (tr: Track) => play({ startId: tr.id });

  const [busy, setBusy] = createSignal(false);
  const save = async () => {
    const d = data();
    if (!d || busy()) return;
    const on = !d.album.saved;
    setBusy(true);
    mutate((v) => ({ ...v, album: { ...v.album, saved: on } }));
    try {
      await client.call("album.save", { id: id(), on });
    } catch {
      mutate((v) => ({ ...v, album: { ...v.album, saved: !on } }));
      toast({ i18n: "w2_error_generic", level: "error" });
    } finally {
      setBusy(false);
    }
  };

  onMount(() => onCleanup(delegate(host)));
  useSentinelPaging(list, () => sentinel);
  const row = (i: () => number) => <Episode tr={items()[i()]} index={i()} playing={!!items()[i()] && playerState()?.track?.id === items()[i()]!.id} onPlay={playEp} />;

  return (
    <div class="sc podcast" data-testid="podcast">
      <CollectionHeader
        loading={!data()}
        art={data()?.album.art}
        kicker={t("w2_pg_podcast")}
        title={data()?.album.title}
        meta={
          <Show when={data()}>
            {(d) => (
              <>
                {artistsText(d().album.artists)} · <span class="num">{d().album.trackCount}</span> {t("w2_pg_episodes")}
                <Show when={d().album.description}>
                  <div class="ell">{d().album.description}</div>
                </Show>
              </>
            )}
          </Show>
        }
        onPlay={() => play()}
        saved={data()?.album.saved}
        onSave={save}
        onMore={(at) => data() && openMenu(cardMenu({ t: "album", ...data()!.album }), at)}
      />
      <LoadError error={error()} hasData={!!data()} retry={reload} />
      <div class="pod-list" ref={host} role="list" aria-label={t("w2_pg_episodes")} data-testid="episodes" style={{ "margin-top": "16px" }}>
        <Show
          when={items().length > SHORT}
          fallback={<For each={items()}>{(_tr, i) => row(i)}</For>}
        >
          <VirtualList total={items().length} rowHeight={EP_H} role="rowgroup" testid="episodes-virtual" label={t("w2_pg_episodes")} onRange={(_s, e) => e >= items().length - 20 && void list.loadMore()} render={(i) => row(i)} />
        </Show>
      </div>
      <div class="pgx-sentinel" ref={sentinel} />
    </div>
  );
}

export const routes: RouteName[] = ["podcast"];
export default Podcast;
