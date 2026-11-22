import { For, Show, createResource, createSignal, onCleanup, onMount, type Accessor } from "solid-js";
import { Chip } from "../components/Chip";
import { Seg } from "../components/Seg";
import { Tile } from "../components/Tile";
import { Card } from "../components/Card";
import { ChartRow } from "../components/Row";
import { IconButton } from "../components/IconButton";
import { client } from "../lib/core";
import { idbGet, idbSet } from "../lib/idb";
import { win } from "../lib/tauri";
import { wClass } from "../lib/layout";
import { navigate } from "../router/router";
import { player } from "../state/player";
import { locale, t } from "../i18n";
import type { HomeResult, ChartsResult, Item, Shelf } from "../lib/types";

const HOME_KEY = "mm.home.v1";

function greeting(key: string): string {
  switch (key) {
    case "good_morning":
      return t("w2_good_morning");
    case "good_afternoon":
      return t("w2_good_afternoon");
    default:
      return t("w2_good_evening");
  }
}

function open(it: Item) {
  if (it.t === "track") navigate("album", { id: it.album?.id ?? it.id });
  else navigate("album", { id: it.id });
}
function play(it: Item) {
  player.play({ kind: it.t === "playlist" && it.local ? "userAlbum" : "playlist", id: it.id, title: it.t === "track" ? it.title : it.title });
}
const sub = (it: Item) => (it.t === "playlist" ? it.subtitle : it.t === "album" ? it.artists.map((a) => a.name).join(", ") : "");

function ShelfRow(props: { shelf: Shelf; below?: boolean }) {
  let sc!: HTMLDivElement;
  const by = (dir: number) => sc.scrollBy({ left: dir * 3 * (184 + 24), behavior: "smooth" });
  return (
    <section class="sec" classList={{ below: props.below }} data-testid="shelf-section">
      <div class="sh">
        <h3>{props.shelf.title}</h3>
        <IconButton icon="back" label={t("w2_scroll_left")} tonal onClick={() => by(-1)} />
        <IconButton icon="right" label={t("w2_scroll_right")} tonal onClick={() => by(1)} />
      </div>
      <div class="shelf" ref={sc} data-testid="shelf">
        <For each={props.shelf.items}>{(it) => <Card title={it.title} subtitle={sub(it)} art={it.art} onOpen={() => open(it)} onPlay={() => play(it)} playLabel={t("w2_play")} />}</For>
      </div>
    </section>
  );
}

export function Home(_props: { params: Record<string, string>; active: Accessor<boolean> }) {
  let root!: HTMLDivElement;
  const [home, setHome] = createSignal<HomeResult | undefined>();
  const [src, setSrc] = createSignal("zing");
  const [chart] = createResource(src, (source) => client.call<ChartsResult>("charts.get", { source }));
  const [mood, setMood] = createSignal(0);

  onMount(() => {
    // cached Home first (IndexedDB), then the live result swaps shelves by key without a fade
    idbGet<HomeResult>(HOME_KEY).then((c) => c && !home() && setHome(c));
    client.call<HomeResult>("home.get", {}).then((h) => {
      setHome(h);
      idbSet(HOME_KEY, h);
    });
    // after the first paint of Home
    requestAnimationFrame(() => requestAnimationFrame(() => win.uiReady()));
    // quick pick columns: clamp(floor(W/280), 3, 6); 2 / 3 in compact / medium
    const ro = new ResizeObserver(() => {
      const w = root.clientWidth - 2 * parseFloat(getComputedStyle(root).paddingLeft);
      const cls = wClass();
      const n = cls === "compact" ? 2 : cls === "medium" ? 3 : Math.min(6, Math.max(3, Math.floor(w / 280)));
      root.style.setProperty("--qc", String(n));
    });
    ro.observe(root);
    onCleanup(() => ro.disconnect());
  });

  const quick = () => home()?.shelves.find((s) => s.key === "quick")?.items ?? [];
  const shelves = () => home()?.shelves.filter((s) => s.layout === "cards") ?? [];
  const dateText = () => new Intl.DateTimeFormat(locale(), { weekday: "long", day: "numeric", month: "long" }).format(new Date());
  const moods = () => [t("w2_mood_relax"), t("w2_mood_focus"), t("w2_mood_workout"), t("w2_mood_sad"), t("w2_mood_party"), t("w2_mood_drive")];
  const labels = () => ({ like: t("w2_like"), more: t("w2_more"), play: t("w2_play") });
  const timeText = () => {
    const d = new Date(chart()?.updatedAt ?? Date.now());
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  return (
    <div class="sc home" ref={root} data-testid="home">
      <div class="greet">
        <div class="f1">
          <div class="t28 w6">{greeting(home()?.greeting.key ?? "good_evening")}</div>
          <div class="t14 i3" style={{ "margin-top": "4px" }}>{t("w2_home_sub", dateText())}</div>
        </div>
        <div class="chips">
          <For each={moods()}>{(m, i) => <Chip on={mood() === i()} onClick={() => setMood(i())}>{m}</Chip>}</For>
        </div>
      </div>
      <div class="qp">
        <For each={quick()}>{(it) => <Tile title={it.title} art={it.art} onOpen={() => open(it)} onPlay={() => play(it)} playLabel={t("w2_play")} />}</For>
      </div>
      <div class="sh">
        <h3>
          {t("w2_charts_vn")}
          <span class="t12 i3 upd">{t("w2_updated_at", timeText())}</span>
        </h3>
        <Seg
          label={t("w2_charts_source")}
          value={src()}
          onChange={setSrc}
          items={[
            { key: "zing", label: "Zing MP3", dot: "#9B51E0" },
            { key: "nct", label: "NhacCuaTui", dot: "#2F80ED" },
            { key: "yt", label: "YouTube Music", dot: "#E8453C" },
          ]}
        />
        <span class="more">{t("w2_see_all")}</span>
      </div>
      <div class="box charts" data-testid="charts">
        <Show when={chart()}>
          {(c) => (
            <>
              <div class="ch-col">
                <For each={c().items.slice(0, 5)}>
                  {(x) => <ChartRow rank={x.rank} t={x} trend={trendText(x)} newLabel={t("w2_new")} labels={labels()} onOpen={() => navigate("album", { id: x.album?.id ?? x.id })} onPlay={() => player.play({ kind: "tracks", ids: [x.id] })} />}
                </For>
              </div>
              <div class="ch-col">
                <For each={c().items.slice(5, 10)}>
                  {(x) => <ChartRow rank={x.rank} t={x} trend={trendText(x)} newLabel={t("w2_new")} labels={labels()} onOpen={() => navigate("album", { id: x.album?.id ?? x.id })} onPlay={() => player.play({ kind: "tracks", ids: [x.id] })} />}
                </For>
              </div>
            </>
          )}
        </Show>
      </div>
      <For each={shelves()}>{(s, i) => <ShelfRow shelf={s} below={i() > 0} />}</For>
    </div>
  );
}

function trendText(x: { trend: string; delta?: number }): string {
  return x.trend === "up" ? `▲ ${x.delta}` : x.trend === "down" ? `▼ ${x.delta}` : x.trend === "same" ? "—" : "new";
}
