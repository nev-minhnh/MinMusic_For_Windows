import type { RouteName } from "../../router/routes";
import { For, Show, createResource, onCleanup, onMount, createSignal, type Accessor } from "solid-js";
import { Art } from "../../components/Art";
import { Icon } from "../../components/Icon";
import { IconButton } from "../../components/IconButton";
import { SourceBadge } from "../../components/Badge";
import { Row } from "../../components/Row";
import { client } from "../../lib/core";
import { player, playerState } from "../../state/player";
import { hClass } from "../../lib/layout";
import { t } from "../../i18n";
import type { AlbumResult, Track } from "../../lib/types";

function durationText(ms: number): string {
  const m = Math.round(ms / 60000);
  return m >= 60 ? t("w2_dur_hm", Math.floor(m / 60), m % 60) : t("w2_dur_m", m);
}

/** Album / user album: header (168 short, 232 otherwise) + 12 row table. The header collapses to a sticky 56 bar through an IntersectionObserver sentinel. */
export function Album(props: { params: Record<string, string>; active: Accessor<boolean> }) {
  const [data] = createResource(() => props.params.id, (id) => client.call<AlbumResult>("album.get", { id }));
  const [stuck, setStuck] = createSignal(false);
  let sentinel!: HTMLDivElement;
  onMount(() => {
    const io = new IntersectionObserver(([e]) => setStuck(!e.isIntersecting), { threshold: 0 });
    io.observe(sentinel);
    onCleanup(() => io.disconnect());
  });
  const labels = () => ({ like: t("w2_like"), more: t("w2_more"), play: t("w2_play") });
  const playAll = (shuffle = false, startId?: string) => player.play({ kind: "userAlbum", id: props.params.id, title: data()?.album.title }, { shuffle, startId });
  const counts = (tracks: Track[]) => {
    const m = new Map<string, number>();
    tracks.forEach((x) => m.set(x.source, (m.get(x.source) ?? 0) + 1));
    return [...m.entries()];
  };

  return (
    <div class="sc album" data-testid="album">
      <div class="al-sentinel" ref={sentinel} />
      <div class="al-sticky" aria-hidden={!stuck()}>
        <div class="al-bar" classList={{ on: stuck() }}>
          <Show when={data()}>
            {(d) => (
              <>
                <Art art={d().album.art} size={40} />
                <div class="w6 f1 ell">{d().album.title}</div>
                <button type="button" class="btn pri sm" onClick={() => playAll()}>
                  <Icon n="play" s={16} />
                  {t("w2_play")}
                </button>
              </>
            )}
          </Show>
        </div>
      </div>
      <div class="al-head">
        <Show when={data()} fallback={<div class="art skel-art al-art" style={{ width: hClass() === "short" ? "168px" : "232px", height: hClass() === "short" ? "168px" : "232px" }} />}>
          {(d) => <Art art={d().album.art} size={hClass() === "short" ? 168 : 232} class="al-art" />}
        </Show>
        <div class="f1" style={{ "min-width": "0" }}>
          <Show
            when={data()}
            fallback={
              <>
                <div class="skel" style={{ width: "30%" }} />
                <div class="skel" style={{ width: "50%", "margin-top": "12px" }} />
              </>
            }
          >
            {(d) => (
              <>
                <div class="ovl">{t("w2_album_caps")}</div>
                <div class="t28 w6" style={{ "margin-top": "4px" }}>{d().album.title}</div>
                <div class="i2" style={{ "margin-top": "4px" }}>
                  {t("w2_created_by_you")} · <span class="num">{d().album.trackCount}</span> {t("w2_songs_unit")} · {durationText(d().album.durationMs)}
                </div>
                <div class="row" style={{ gap: "6px", "margin-top": "8px" }}>
                  <For each={counts(d().tracks)}>{([s, n]) => <SourceBadge source={s as any} count={n} />}</For>
                  <span class="t12 i3">{t("w2_downloaded_n", 11)}</span>
                </div>
                <div class="row gap8" style={{ "margin-top": "16px" }}>
                  <button type="button" class="btn pri" onClick={() => playAll()} data-testid="album-play">
                    <Icon n="play" s={20} />
                    {t("w2_play")}
                  </button>
                  <button type="button" class="btn ton" onClick={() => playAll(true)}>
                    <Icon n="shuffle" s={20} />
                    {t("shuffle")}
                  </button>
                  <IconButton icon="dl" label={t("w2_downloads")} tonal size={40} />
                  <IconButton icon="edit" label={t("w2_edit")} tonal size={40} />
                  <IconButton icon="more" label={t("w2_more")} tonal size={40} />
                </div>
              </>
            )}
          </Show>
        </div>
      </div>
      <div class="tbl album-tbl">
        <div class="th">
          <div style={{ "text-align": "center" }}>{"#"}</div>
          <div>{t("w2_col_title")}</div>
          <div class="c-album">{t("w2_col_orig_album")}</div>
          <div class="c-added">{t("w2_col_added")}</div>
          <div />
          <div style={{ "text-align": "right" }}>{"⏱"}</div>
          <div />
        </div>
        <Show when={data()}>
          {(d) => (
            <For each={d().tracks}>
              {(tr, i) => <Row index={i()} track={tr} playing={playerState()?.track?.id === tr.id} labels={labels()} onPlay={(x) => playAll(false, x.id)} />}
            </For>
          )}
        </Show>
      </div>
    </div>
  );
}

export const routes: RouteName[] = ["album"];
export default Album;
