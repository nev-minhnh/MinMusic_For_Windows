import type { RouteName } from "../../router/routes";
import { For, Show, createResource, createSignal, onMount, type Accessor } from "solid-js";
import type { StatsPeriod, StatsResult } from "@minmusic/protocol";
import { Card } from "../../components/Card";
import { Icon } from "../../components/Icon";
import { Seg } from "../../components/Seg";
import { Table } from "../../components/Table";
import { client } from "../../lib/core";
import { player, playerState } from "../../state/player";
import { navigate } from "../../router/router";
import { artistsText } from "../../lib/format";
import { t } from "../../i18n";
import { onPageEvent } from "../Library/util";
import "../Library/library.css";

export const PERIODS: StatsPeriod[] = ["week", "month", "year", "all"];
const PERIOD_MIN: Record<StatsPeriod, number> = { week: 7 * 1440, month: 30 * 1440, year: 365 * 1440, all: 0 };

/** Share of the period spent listening, 0..1 (the bar is a scaleX transform). "all" has no length to compare with. */
export function listenShare(minutes: number, period: StatsPeriod): number {
  const total = PERIOD_MIN[period];
  return total ? Math.min(1, Math.max(0, minutes / total)) : 0;
}

/** "12 h 05 min" for >= 60 minutes, "45 min" below. */
export function minutesText(m: number): string {
  return m >= 60 ? t("w2_dur_hm", Math.floor(m / 60), String(m % 60).padStart(2, "0")) : t("w2_dur_m", m);
}

/** Statistics: period segment (Tuần / Tháng / Năm / Tất cả) -> `stats.get`; minutes tile, top 10 songs, top artists and albums as card rows. */
export function Stats(props: { params: Record<string, string>; active: Accessor<boolean> }) {
  const [period, setPeriod] = createSignal<StatsPeriod>("week");
  const [data, { refetch }] = createResource(period, (p) => client.call<StatsResult>("stats.get", { period: p }));
  let root!: HTMLDivElement;
  const items = () => [
    { key: "week", label: t("w2_stats_week") },
    { key: "month", label: t("w2_stats_month") },
    { key: "year", label: t("w2_stats_year") },
    { key: "all", label: t("w2_stats_all") },
  ];
  const share = () => listenShare(data()?.minutes ?? 0, period());
  const tracks = () => data()?.topTracks ?? [];
  const playTrack = (i: number) => {
    const ids = tracks().map((x) => x.id);
    if (ids[i]) void player.play({ kind: "tracks", ids, title: t("w2_stats_top_tracks") }, { startIndex: i });
  };
  onMount(() => {
    onPageEvent(root, "mm-refresh", () => void refetch());
  });
  const empty = () => !!data() && !data()!.minutes && !tracks().length;

  return (
    <div ref={root} class="sc library stats" data-testid="stats">
      <div class="st-top">
        <div class="t28 w6 f1">{t("w2_stats")}</div>
        <Seg items={items()} value={period()} onChange={(k) => setPeriod(k as StatsPeriod)} label={t("w2_stats")} class="s1" />
      </div>

      <div class="box st-tile" data-testid="stats-minutes">
        <div class="ovl">{t("w2_stats_minutes")}</div>
        <div class="st-min">
          <span class="t28 w6 num" data-testid="stats-minutes-n">
            {data()?.minutes ?? 0}
          </span>
          <span class="i2">{t("w2_stats_min_unit")}</span>
          <Show when={(data()?.minutes ?? 0) >= 60}>
            <span class="i3 t12">· {minutesText(data()!.minutes)}</span>
          </Show>
        </div>
        <Show when={period() !== "all"}>
          <div class="st-bar" role="img" aria-label={t("w2_stats_share", Math.round(share() * 100))}>
            <i style={{ transform: `scaleX(${share()})`, width: "100%" }} data-testid="stats-bar" />
          </div>
          <div class="t12 i3">{t("w2_stats_share", (share() * 100).toFixed(1).replace(".", ","))}</div>
        </Show>
      </div>

      <Show when={!empty()} fallback={
        <div class="empty-state" data-testid="stats-empty">
          <Icon n="bar_chart" s={32} />
          <div>{t("w2_stats_empty")}</div>
        </div>
      }>
        <div class="sh">
          <h3>{t("w2_stats_top_tracks")}</h3>
        </div>
        <Table
          total={() => tracks().length}
          trackAt={(i) => tracks()[i]}
          label={t("w2_stats_top_tracks")}
          testid="stats-tracks"
          cols={["index", "title", "album", "like", "dur", "more"]}
          playingId={() => playerState()?.track?.id}
          onPlay={playTrack}
          onOpenAlbum={(tr) => tr.album?.id && navigate("album", { id: tr.album.id })}
        />

        <Show when={(data()?.topArtists.length ?? 0) > 0}>
          <div class="sh">
            <h3>{t("w2_stats_top_artists")}</h3>
          </div>
          <div class="shelf" data-testid="stats-artists">
            <For each={data()!.topArtists}>
              {(a) => (
                <Card title={a.name} subtitle={a.subtitle} art={a.art} onOpen={() => navigate("artist", { id: a.id })} onPlay={() => void player.play({ kind: "artist", id: a.id })} playLabel={t("w2_play")} />
              )}
            </For>
          </div>
        </Show>
        <Show when={(data()?.topAlbums.length ?? 0) > 0}>
          <div class="sh">
            <h3>{t("w2_stats_top_albums")}</h3>
          </div>
          <div class="shelf" data-testid="stats-albums">
            <For each={data()!.topAlbums}>
              {(a) => (
                <Card
                  title={a.title}
                  subtitle={[artistsText(a.artists), a.year].filter(Boolean).join(" · ")}
                  art={a.art}
                  onOpen={() => navigate("album", { id: a.id })}
                  onPlay={() => void player.play({ kind: "album", id: a.id })}
                  playLabel={t("w2_play")}
                />
              )}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  );
}

export const routes: RouteName[] = ["stats"];
export default Stats;
