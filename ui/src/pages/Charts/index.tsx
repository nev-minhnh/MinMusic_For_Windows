import type { RouteName } from "../../router/routes";
import { For, Show, createSignal, onCleanup, onMount, type Accessor } from "solid-js";
import { Art } from "../../components/Art";
import { Icon } from "../../components/Icon";
import { Meta } from "../../components/Meta";
import { Seg } from "../../components/Seg";
import { VirtualList } from "../../components/VirtualList";
import { openMenu } from "../../components/Menu";
import { delegate, registerRow } from "../../lib/delegate";
import { client } from "../../lib/core";
import { fmtTime } from "../../lib/format";
import { songMenu } from "../../menus/song";
import { player, playerState } from "../../state/player";
import { t } from "../../i18n";
import { chartPlay, trendGlyph } from "./chart";
import "./charts.css";
import type { ChartsResult, Track } from "../../lib/types";

type ChartTrack = ChartsResult["items"][number];

const SOURCES = [
  { key: "zing", label: "Zing MP3", dot: "#9B51E0" },
  { key: "nct", label: "NhacCuaTui", dot: "#2F80ED" },
  { key: "yt", label: "YouTube Music", dot: "#E8453C" },
];

/** Charts (route `charts {source, key?}`): source Seg, tabs from `charts.get().tabs`, up to 100 ranked rows, play all / shuffle. */
export function Charts(props: { params: Record<string, string>; active: Accessor<boolean> }) {
  let root!: HTMLDivElement;
  const [source, setSource] = createSignal(props.params.source ?? "zing");
  const [key, setKey] = createSignal<string | undefined>(props.params.key);
  const [data, setData] = createSignal<ChartsResult | undefined>();
  let seq = 0;

  const load = () => {
    const mine = ++seq;
    setData(undefined);
    client
      .call<ChartsResult>("charts.get", { source: source(), ...(key() ? { key: key() } : {}) })
      .then((r) => mine === seq && setData(r))
      .catch(() => {});
  };
  const items = (): ChartTrack[] => data()?.items ?? [];
  const play = (i: number) => {
    const p = chartPlay(items(), i, data()?.title);
    void player.play(p.context, { startIndex: p.startIndex });
  };
  const ctx = (i: number) => (e: { clientX: number; clientY: number }) => {
    const tr = items()[i];
    if (tr) openMenu(songMenu([tr as Track], {}), { x: e.clientX, y: e.clientY });
  };

  onMount(() => {
    load();
    onCleanup(delegate(root));
  });
  onCleanup(() => seq++);

  const row = (i: () => number) => {
    const x = () => items()[i()];
    return (
      <Show when={x()}>
        {(tr) => (
          <div
            ref={(el) => registerRow(el, () => ({ onContext: ctx(i()), onAct: (_a, b) => ctx(i())({ clientX: b.left, clientY: b.bottom }) }))}
            class="chp-r"
            classList={{ playing: playerState()?.track?.id === tr().id }}
            role="row"
            tabindex="-1"
            data-testid="chart-line"
            data-key={String(i())}
            onDblClick={() => play(i())}
          >
            <div class="chp-rk">{tr().rank}</div>
            <div class="chp-tt">
              <Art art={tr().art} size={40} class="pressable" />
              <div class="m">
                <div class="w6 ell">{tr().title}</div>
                <Meta t={tr()} alt />
              </div>
            </div>
            <div class="chp-trend" classList={{ up: tr().trend === "up" }} data-testid="chart-trend">
              {tr().trend === "new" ? <span class="b exp">{t("w2_new")}</span> : trendGlyph(tr())}
            </div>
            <div class="chp-trend chp-delta" data-testid="chart-delta">
              {tr().delta ?? ""}
            </div>
            <div class="t12 i3 num chp-d">{fmtTime(tr().durationMs ?? 0)}</div>
            <button type="button" class="ib hv" tabindex="-1" aria-label={t("w2_more")} data-act="more">
              <Icon n="more" s={20} />
            </button>
          </div>
        )}
      </Show>
    );
  };

  return (
    <div class="sc charts-page" ref={root} data-testid="charts-page">
      <div class="chp-head">
        <div class="t28 w6">{data()?.title ?? t("w2_charts_vn")}</div>
        <button type="button" class="btn pri" data-testid="chart-play-all" disabled={!items().length} onClick={() => play(0)}>
          <Icon n="play" s={20} />
          {t("w2_dc_play_all")}
        </button>
        <button
          type="button"
          class="btn ton"
          data-testid="chart-shuffle"
          disabled={!items().length}
          onClick={() => void player.play({ kind: "tracks", ids: items().map((x) => x.id), title: data()?.title }, { shuffle: true })}
        >
          <Icon n="shuffle" s={20} />
          {t("w2_dc_shuffle_all")}
        </button>
      </div>
      <div class="chp-tabs">
        <Seg
          label={t("w2_charts_source")}
          value={source()}
          items={SOURCES}
          onChange={(s) => {
            setSource(s);
            setKey(undefined);
            load();
          }}
        />
        <Show when={(data()?.tabs.length ?? 0) > 1}>
          <Seg
            label={t("w2_dc_chart_tabs")}
            value={key() ?? data()!.tabs[0]!.key}
            items={data()!.tabs.map((x) => ({ key: x.key, label: x.title }))}
            class="s1"
            onChange={(k) => {
              setKey(k);
              load();
            }}
          />
        </Show>
        <Show when={data()}>
          <span class="t12 i3" data-testid="chart-count">
            {t("w2_dc_n_songs", items().length)}
          </span>
        </Show>
      </div>
      <div class="chp-list" role="grid" aria-label={t("w2_charts_vn")} data-testid="chart-list">
        <div class="chp-th" role="row">
          <div style={{ "text-align": "center" }}>{"#"}</div>
          <div>{t("w2_col_title")}</div>
          <div>{t("w2_dc_trend")}</div>
          <div class="chp-delta">{t("w2_dc_delta")}</div>
          <div style={{ "text-align": "right" }}>{"⏱"}</div>
          <div />
        </div>
        <Show
          when={items().length}
          fallback={
            <For each={[0, 1, 2, 3, 4, 5, 6, 7]}>
              {() => (
                <div class="chp-r" aria-hidden="true">
                  <div class="chp-rk" />
                  <div class="chp-tt">
                    <div class="art skel-art" />
                    <div class="skel" style={{ width: "40%" }} />
                  </div>
                </div>
              )}
            </For>
          }
        >
          <Show when={items().length > 60} fallback={<For each={items()}>{(_x, i) => row(() => i())}</For>}>
            <VirtualList total={items().length} rowHeight={56} role="rowgroup" testid="chart-vlist" label={t("w2_charts_vn")} render={row} />
          </Show>
        </Show>
      </div>
    </div>
  );
}

export const routes: RouteName[] = ["charts"];
export default Charts;
