import type { RouteName } from "../../router/routes";
import { For, Show, createMemo, createSignal, onCleanup, onMount, type Accessor } from "solid-js";
import { Chip } from "../../components/Chip";
import { Seg } from "../../components/Seg";
import { Tile } from "../../components/Tile";
import { ChartRow } from "../../components/Row";
import { Table } from "../../components/Table";
import { openMenu } from "../../components/Menu";
import { delegate } from "../../lib/delegate";
import { client } from "../../lib/core";
import { idbGet, idbSet } from "../../lib/idb";
import { win } from "../../lib/tauri";
import { wClass } from "../../lib/layout";
import { navigate } from "../../router/router";
import { songMenu } from "../../menus/song";
import { locale, t } from "../../i18n";
import { RowsShelf, Shelf, ShelfSkeleton } from "./Shelf";
import { playList } from "./items";
import { mergeShelves, quickCols, trendText } from "./home";
import "./home.css";
import type { ChartsResult, HomeResult, Item, Shelf as ShelfT, Track } from "../../lib/types";

const HOME_KEY = "mm.home.v1";
type Chart = ChartsResult["items"];

function greeting(key: string | undefined): string {
  return key === "good_morning" ? t("w2_good_morning") : key === "good_afternoon" ? t("w2_good_afternoon") : key === "good_night" ? t("w2_dc_good_night") : t("w2_good_evening");
}

/** Home: greeting + chips, quick picks, charts box, shelves (frontend-spec 5). The IndexedDB copy paints first; the live result swaps in. */
export function Home(_props: { params: Record<string, string>; active: Accessor<boolean> }) {
  let root!: HTMLDivElement;
  const [main, setMain] = createSignal<HomeResult | undefined>();
  const [chip, setChip] = createSignal<string | null>(null);
  const chipCache = new Map<string, HomeResult>();
  const [chipView, setChipView] = createSignal<HomeResult | undefined>();
  const [loading, setLoading] = createSignal(false);
  const [more, setMore] = createSignal<ShelfT[]>([]);
  let nextCursor: string | null = null;
  let loadingMore = false;
  const [qc, setQc] = createSignal(4);

  const view = () => (chip() ? chipView() : main());
  const shelves = createMemo(() => [...(view()?.shelves ?? []), ...(chip() ? [] : more())]);
  const quick = createMemo(() => {
    const items = (shelves().find((s) => s.layout === "quickPicks")?.items ?? []).filter((i): i is Item & { t: "track" } => i.t === "track");
    return items.slice(0, Math.max(qc() * 2, 8));
  });
  const body = createMemo(() => shelves().filter((s) => s.layout === "cards" || s.layout === "rows"));

  const setLive = (h: HomeResult) => {
    setMain(h);
    nextCursor = h.next;
    void idbSet(HOME_KEY, h);
  };

  // --- charts box (charts.get per source, answers cached per source)
  const [src, setSrc] = createSignal("zing");
  const chartCache = new Map<string, ChartsResult>();
  const [chart, setChart] = createSignal<ChartsResult | undefined>();
  const loadChart = (s: string) => {
    const hit = chartCache.get(s);
    if (hit) return setChart(hit);
    setChart(undefined);
    client
      .call<ChartsResult>("charts.get", { source: s })
      .then((c) => {
        chartCache.set(s, c);
        if (src() === s) setChart(c);
      })
      .catch(() => {});
  };
  const pickSource = (s: string) => {
    setSrc(s);
    loadChart(s);
  };
  const chartItems = (): Chart => chart()?.items ?? [];

  const pickChip = (key: string) => {
    if (chip() === key) {
      setChip(null);
      return;
    }
    setChip(key);
    const hit = chipCache.get(key);
    if (hit) return setChipView(hit);
    setChipView(undefined);
    setLoading(true); // skeleton on screen in this frame (well within 60 ms)
    client
      .call<HomeResult>("home.get", { chip: key })
      .then((h) => {
        chipCache.set(key, h);
        if (chip() === key) setChipView(h);
      })
      .catch(() => {})
      .finally(() => chip() === key && setLoading(false));
  };

  onMount(() => {
    // cached Home first (IndexedDB), then the live result
    void idbGet<HomeResult>(HOME_KEY).then((c) => c && !main() && setMain(c));
    client
      .call<HomeResult>("home.get", {})
      .then(setLive)
      .catch(() => {});
    loadChart(src());
    const offUpd = client.sub("app", {}, (name, d) => {
      if (name !== "home.updated") return;
      const cur = main();
      if (cur) setLive({ ...cur, shelves: mergeShelves(cur.shelves, d.shelves ?? []) });
    });
    onCleanup(offUpd);
    // after the first paint of Home
    requestAnimationFrame(() => requestAnimationFrame(() => win.uiReady()));

    const ro = new ResizeObserver(() => {
      const w = root.clientWidth - 2 * parseFloat(getComputedStyle(root).paddingLeft);
      const n = quickCols(w, wClass());
      root.style.setProperty("--qc", String(n));
      setQc(n);
    });
    ro.observe(root);
    onCleanup(() => ro.disconnect());

    // home.more: a sentinel at the bottom, no scroll handler
    const io = new IntersectionObserver(
      (es) => {
        if (!es.some((e) => e.isIntersecting) || !nextCursor || loadingMore || chip()) return;
        loadingMore = true;
        const cursor = nextCursor;
        client
          .call<{ shelves: ShelfT[]; next: string | null }>("home.more", { cursor })
          .then((r) => {
            nextCursor = r.next;
            setMore((m) => [...m, ...r.shelves]);
          })
          .catch(() => {})
          .finally(() => (loadingMore = false));
      },
      { rootMargin: "600px 0px" }
    );
    io.observe(sentinel);
    onCleanup(() => io.disconnect());
    onCleanup(delegate(root));
  });
  let sentinel!: HTMLDivElement;

  // --- quick picks: double-click / Enter / the FAB play the whole list from that tile
  const playQuick = (i: number) => playList(quick(), i, t("w2_dc_quick_picks"));
  const idxOf = (el: EventTarget | null) => {
    const tile = el instanceof Element ? el.closest<HTMLElement>(".qt") : null;
    return tile?.parentElement ? Array.prototype.indexOf.call(tile.parentElement.children, tile) : -1;
  };

  // --- charts rows
  const playChart = (i: number) => playList(chartItems(), i, chart()?.title);
  const onChartCtx = (from: number) => (e: MouseEvent) => {
    const row = (e.target as Element).closest(".crow");
    if (!row?.parentElement) return;
    e.preventDefault();
    const tr = chartItems()[from + Array.prototype.indexOf.call(row.parentElement.children, row)];
    if (tr) openMenu(songMenu([tr as Track], {}), { x: e.clientX, y: e.clientY });
  };

  const dateText = () => new Intl.DateTimeFormat(locale(), { weekday: "long", day: "numeric", month: "long" }).format(new Date());
  const labels = () => ({ like: t("w2_like"), more: t("w2_more"), play: t("w2_play") });
  const timeText = () => {
    const d = new Date(chart()?.updatedAt ?? Date.now());
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };
  const chartCol = (from: number) => (
    <div class="ch-col" onContextMenu={onChartCtx(from)}>
      <For each={chartItems().slice(from, from + 5)}>
        {(x, k) => (
          <ChartRow
            rank={x.rank}
            t={x}
            trend={trendText(x)}
            newLabel={t("w2_new")}
            labels={labels()}
            onOpen={() => x.album?.id && navigate("album", { id: x.album.id })}
            onPlay={() => playChart(from + k())}
          />
        )}
      </For>
    </div>
  );

  return (
    <div class="sc home" ref={root} data-testid="home">
      <div class="greet">
        <div class="f1">
          <div class="t28 w6" data-testid="greeting">
            {greeting(main()?.greeting.key)}
          </div>
          <div class="t14 i3" style={{ "margin-top": "4px" }}>
            {t("w2_home_sub", dateText())}
          </div>
        </div>
        <div class="chips" data-testid="home-chips">
          <For each={main()?.chips ?? []}>
            {(c) => (
              <Chip on={chip() === c.key} onClick={() => pickChip(c.key)}>
                {c.title}
              </Chip>
            )}
          </For>
          <Show when={main()}>
            <Chip onClick={() => navigate("browse", { browseId: "moods" })}>{t("w2_dc_moods")}</Chip>
          </Show>
        </div>
      </div>
      <div
        class="qp"
        data-testid="quick-picks"
        onDblClick={(e) => idxOf(e.target) >= 0 && playQuick(idxOf(e.target))}
        onKeyDown={(e) => e.key === "Enter" && idxOf(e.target) >= 0 && playQuick(idxOf(e.target))}
      >
        <Show when={quick().length} fallback={<For each={Array.from({ length: qc() * 2 })}>{() => <div class="qt qt-skel" />}</For>}>
          <For each={quick()}>
            {(it, i) => (
                              <Tile
                  title={it.title}
                  art={it.art}
                  dataKey={it.id}
                  playLabel={t("w2_play")}
                  onOpen={() => {}}
                  onPlay={() => playQuick(i())}
                  onContext={(e) => openMenu(songMenu([it as Track], {}), { x: e.clientX, y: e.clientY })}
                />
            )}
          </For>
        </Show>
      </div>
      <div class="sh">
        <h3>
          {t("w2_charts_vn")}
          <span class="t12 i3 upd">{t("w2_updated_at", timeText())}</span>
        </h3>
        <Seg
          label={t("w2_charts_source")}
          value={src()}
          onChange={pickSource}
          items={[
            { key: "zing", label: "Zing MP3", dot: "#9B51E0" },
            { key: "nct", label: "NhacCuaTui", dot: "#2F80ED" },
            { key: "yt", label: "YouTube Music", dot: "#E8453C" },
          ]}
        />
        <button type="button" class="more" style={{ "margin-left": "16px" }} data-testid="charts-all" onClick={() => navigate("charts", { source: src() })}>
          {t("w2_see_all")}
        </button>
      </div>
      <div class="box charts" data-testid="charts">
        <Show
          when={chart()}
          fallback={
            <For each={[0, 1]}>
              {() => (
                <div class="ch-col">
                  <For each={[0, 1, 2, 3, 4]}>{() => <div class="crow crow-skel" />}</For>
                </div>
              )}
            </For>
          }
        >
          {chartCol(0)}
          {chartCol(5)}
        </Show>
      </div>
              <Show when={body().length} fallback={<ShelfSkeleton />}>
          <For each={body()}>
            {(s, i) => (
              <Show when={s.layout === "cards"} fallback={<RowsShelf shelf={s} below={i() > 0} />}>
                <Shelf shelf={s} below={i() > 0} round={s.items[0]?.t === "artist"} />
              </Show>
            )}
          </For>
        </Show>
      <div ref={sentinel} class="hm-sentinel" data-testid="home-sentinel" aria-hidden="true" />
    </div>
  );
}

export const routes: RouteName[] = ["home"];
export default Home;
