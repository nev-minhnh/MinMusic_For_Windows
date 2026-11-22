import type { RouteName } from "../../router/routes";
import { For, Show, batch, createEffect, createMemo, createSignal, onCleanup, onMount, type Accessor } from "solid-js";
import { Icon } from "../../components/Icon";
import { Row, ALL_COLS, type Col, type RowLabels } from "../../components/Row";
import { openMenu } from "../../components/Menu";
import { gridTemplate, visibleCols, HEAD_H as TH_H } from "../../components/Table";
import { delegate, type CtxEvent, type SelectEvent } from "../../lib/delegate";
import { createSelection, setActiveList } from "../../lib/selection";
import { songMenu } from "../../menus/song";
import { SEP, tidy } from "../../menus/types";
import { confirm } from "../../dialogs/Confirm";
import { client } from "../../lib/core";
import { player, playerState } from "../../state/player";
import { navigate } from "../../router/router";
import { toast } from "../../toast";
import { t, plural } from "../../i18n";
import { clockText, keepScroll, onPageEvent } from "../Library/util";
import { createHistoryStore, type HistoryRow } from "./store";
import { HEAD_H, TRACK_H, flatAtY, flatCount, flatOfTrack, heightOf, rowAt, topOf, totalHeight, trackRange } from "./flat";
import "../Library/library.css";

/** `w2_hist_*` labels of `history.window` groups. Written out so the string scanner sees every key. */
const LABELS: Record<string, () => string> = {
  w2_hist_today: () => t("w2_hist_today"),
  w2_hist_yesterday: () => t("w2_hist_yesterday"),
  w2_hist_week: () => t("w2_hist_week"),
  w2_hist_month: () => t("w2_hist_month"),
  w2_hist_older: () => t("w2_hist_older"),
};
export const groupLabel = (key: string) => LABELS[key]?.() ?? key;

/**
 * History: `history.window` as one flat list: a fixed 32 px header row per group (Hôm nay / Hôm qua / ...) in front of 56 px track rows,
 * windowed by hand (positions are arithmetic, see flat.ts) with a viewport of overscan on each side. Del removes the selection
 * (history.remove), "Xoá lịch sử" clears everything after a confirmation.
 */
export function History(props: { params: Record<string, string>; active: Accessor<boolean> }) {
  const store = createHistoryStore();
  const sel = createSelection(
    () => Array.from({ length: store.total() }, (_, i) => String(i)),
    { onPlay: (keys) => keys.length && playAt(Number(keys[0])) }
  );
  const [width, setWidth] = createSignal(1000);
  const [active, setActive] = createSignal(-1);
  const [likes, setLikes] = createSignal<Record<string, boolean>>({});
  const [win, setWin] = createSignal<[number, number]>([0, 40]);
  const [settled, setSettled] = createSignal(false);
  let root!: HTMLDivElement;
  let host!: HTMLDivElement;
  let scroller: HTMLElement | null = null;
  let band: [number, number] = [-1, -1]; // px band currently rendered
  let raf = 0;
  let idleT = 0;
  let scrolling = false;

  const cols = createMemo<Col[]>(() => visibleCols(ALL_COLS, width()));
  const labels = (): RowLabels => ({ like: t("w2_like"), more: t("w2_more"), play: t("w2_play") });
  const flatTotal = () => flatCount(store.total(), store.groups());
  const height = () => totalHeight(store.total(), store.groups());

  // ---- windowing: visible rows + one viewport on each side; the band only moves after a third of a viewport of drift
  const update = (force = false) => {
    raf = 0;
    if (!scroller) return;
    const vh = scroller.clientHeight || 800;
    const top = scroller.scrollTop - host.offsetTop;
    const h = height();
    const near = (band[0] <= 0 || top - band[0] > vh / 3) && (band[1] >= h || band[1] - (top + vh) > vh / 3);
    if (!force && band[0] >= 0 && near) return;
    const y0 = Math.max(0, top - vh);
    const y1 = Math.min(h, top + 2 * vh);
    band = [y0, y1];
    const g = store.groups();
    const n = store.total();
    const lo = flatAtY(y0, n, g);
    const hi = Math.min(flatCount(n, g), flatAtY(y1, n, g) + 1);
    const [a, b] = n ? trackRange(lo, Math.max(lo + 1, hi), g) : [0, 0];
    batch(() => setWin([lo, hi]));
    store.ensure(a, Math.max(a + 1, b));
  };
  const schedule = (force = false) => {
    if (force) band = [-1, -1];
    if (!raf) raf = requestAnimationFrame(() => update(force));
  };
  const onScroll = () => {
    schedule();
    // hover off while scrolling (frontend-spec 6, rule 9: no :hover flips under a still cursor)
    if (!scrolling) {
      scrolling = true;
      host.classList.add("vl-scrolling");
    }
    clearTimeout(idleT);
    idleT = window.setTimeout(() => {
      scrolling = false;
      host.classList.remove("vl-scrolling");
    }, 200);
  };
  createEffect(() => {
    store.total();
    store.groups();
    queueMicrotask(() => schedule(true));
  });

  // ---- actions
  const playAt = (i: number) => {
    const tr = store.track(i);
    if (tr) void player.play({ kind: "library", list: "history", sort: { by: "lastPlayed", desc: true } }, { startIndex: i, startId: tr.id });
  };
  const eventIds = (rows: HistoryRow[]) => rows.map((r) => r.eventId ?? r.id);
  const rowsOf = (idx: number[]) => idx.map((i) => store.track(i)).filter((x): x is HistoryRow => !!x);
  const selectedIdx = () => sel.keys().map(Number);
  const removeRows = async (rows: HistoryRow[]) => {
    if (!rows.length) return;
    try {
      await client.call("history.remove", { eventIds: eventIds(rows) });
      sel.clear();
      toast({ text: plural("w2_hist_removed_n", rows.length) });
    } catch {
      toast({ i18n: "w2_error_generic", level: "error" });
    }
  };
  const clearAll = async () => {
    if (!store.total()) return;
    const ok = await confirm({ title: t("w2_hist_clear_q"), body: t("w2_hist_clear_body"), danger: true, okLabel: t("w2_hist_clear") });
    if (!ok) return;
    try {
      await client.call("history.clear");
      sel.clear();
    } catch {
      toast({ i18n: "w2_error_generic", level: "error" });
    }
  };

  // ---- row handlers (delegated: one listener set on the table, see lib/delegate.ts)
  const onSelect = (i: number) => (e: SelectEvent, phase: "down" | "click") => {
    const key = String(i);
    const plain = !e.ctrlKey && !e.metaKey && !e.shiftKey;
    if (plain && sel.has(key) && sel.count() > 1) {
      if (phase === "click") sel.selectOnly(key);
      return;
    }
    if (phase === "down") {
      sel.click(key, e);
      setActive(i);
    }
  };
  const onContext = (i: number) => (e: CtxEvent) => {
    const key = String(i);
    if (!sel.has(key)) sel.selectOnly(key);
    setActive(i);
    const rows = rowsOf(selectedIdx());
    if (!rows.length) return;
    openMenu(
      tidy([...songMenu(rows), SEP, { id: "hist-remove", label: t("w2_hist_remove"), icon: "delete", hint: "Del", run: () => removeRows(rows) }]),
      { x: e.clientX, y: e.clientY }
    );
  };
  const dragIds = (i: number) => () => {
    const key = String(i);
    if (!sel.has(key)) sel.selectOnly(key);
    const ids = rowsOf(selectedIdx()).map((x) => x.id);
    return ids.length ? { ids, from: "history" } : null;
  };
  const like = (tr: HistoryRow) => {
    const next = !(likes()[tr.id] ?? tr.liked);
    setLikes((m) => ({ ...m, [tr.id]: next }));
    void player.like(tr.id, next);
  };

  // ---- keyboard: arrows, Home/End, Page keys (role=grid), Ctrl A and Enter through the selection
  const reveal = (i: number) => {
    if (!scroller) return;
    const f = flatOfTrack(i, store.groups());
    const top = host.offsetTop + topOf(f, store.groups());
    const bottom = top + heightOf(f, store.groups());
    if (top - TH_H < scroller.scrollTop) scroller.scrollTop = Math.max(0, top - TH_H - (store.groups().some((g) => g.offset === i) ? HEAD_H : 0));
    else if (bottom > scroller.scrollTop + scroller.clientHeight) scroller.scrollTop = bottom - scroller.clientHeight;
  };
  const move = (to: number, extend: boolean) => {
    const n = store.total();
    if (!n) return;
    const i = Math.max(0, Math.min(n - 1, to));
    if (extend) sel.click(String(i), { shiftKey: true });
    else sel.selectOnly(String(i));
    setActive(i);
    reveal(i);
    requestAnimationFrame(() => requestAnimationFrame(() => root.querySelector<HTMLElement>(`[data-key="${i}"]`)?.focus({ preventScroll: true })));
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (sel.onKeyDown(e)) return e.preventDefault();
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const cur = active();
    const k = e.key;
    const to = k === "ArrowDown" ? cur + 1 : k === "ArrowUp" ? Math.max(0, cur - 1) : k === "Home" ? 0 : k === "End" ? store.total() - 1 : k === "PageDown" ? cur + 10 : k === "PageUp" ? cur - 10 : null;
    if (to === null) return;
    e.preventDefault();
    move(to, e.shiftKey && (k === "ArrowDown" || k === "ArrowUp"));
  };

  onMount(() => {
    scroller = root.closest<HTMLElement>(".pg");
    scroller?.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(([e]) => {
      setWidth(Math.round(e.contentRect.width));
      schedule(true);
    });
    ro.observe(root);
    setWidth(root.clientWidth || 1000);
    const off = delegate(root);
    const focusIn = () => setActiveList({ ids: () => rowsOf(selectedIdx()).map((x) => x.id) });
    root.addEventListener("focusin", focusIn);
    keepScroll(root, props.active);
    onPageEvent(root, "mm-delete", () => void removeRows(rowsOf(selectedIdx())));
    onPageEvent(root, "mm-refresh", () => store.reload());
    const tid = setTimeout(() => setSettled(true), 500);
    store.ensure(0, 40);
    update(true);
    onCleanup(() => {
      scroller?.removeEventListener("scroll", onScroll);
      ro.disconnect();
      off();
      root.removeEventListener("focusin", focusIn);
      setActiveList(null);
      clearTimeout(idleT);
      clearTimeout(tid);
      if (raf) cancelAnimationFrame(raf);
    });
  });

  const range = createMemo(() => {
    const [lo, hi] = win();
    const n = Math.min(hi, flatTotal());
    return Array.from({ length: Math.max(0, n - lo) }, (_, k) => lo + k);
  });

  const item = (f: number) => {
    const r = createMemo(() => rowAt(f, store.groups()));
    const top = createMemo(() => topOf(f, store.groups()));
    const head = () => {
      const x = r();
      return x.kind === "head" ? x.group : -1;
    };
    const idx = () => {
      const x = r();
      return x.kind === "track" ? x.index : -1;
    };
    const track = createMemo(() => {
      const x = idx() >= 0 ? store.track(idx()) : undefined;
      if (!x) return undefined;
      const liked = likes()[x.id] ?? x.liked;
      return { ...x, liked, addedText: clockText(x.playedAt) };
    });
    return (
      <div class="hs-item" style={{ top: `${top()}px`, height: `${r().kind === "head" ? HEAD_H : TRACK_H}px` }}>
        <Show
          when={head() < 0}
          fallback={
            <div class="hs-head" role="row" data-testid="hist-group" data-group={store.groups()[head()]?.label}>
              <span>{groupLabel(store.groups()[head()]?.label ?? "")}</span>
            </div>
          }
        >
          <Row
            index={idx()}
            track={track()}
            dataKey={String(idx())}
            selected={sel.has(String(idx()))}
            playing={!!track() && playerState()?.track?.id === track()!.id}
            cols={cols()}
            labels={labels()}
            draggable
            onSelect={onSelect(idx())}
            onContext={onContext(idx())}
            dragIds={dragIds(idx())}
            onPlay={() => playAt(idx())}
            onOpenAlbum={(x) => x.album?.id && navigate("album", { id: x.album.id })}
            onLike={(x) => like(x as HistoryRow)}
          />
        </Show>
      </div>
    );
  };

  const head = (c: Col) => (
    <div role="columnheader" classList={{ "c-album": c === "album", "c-added": c === "added" }} style={c === "index" ? { "text-align": "center" } : c === "dur" ? { "text-align": "right" } : undefined}>
      {c === "index" ? "#" : c === "dur" ? "⏱" : c === "title" ? t("w2_col_title") : c === "album" ? t("w2_col_album") : c === "added" ? t("w2_hist_col_played") : ""}
    </div>
  );

  return (
    <div class="sc library history" data-testid="history">
      <div class="hs-bar">
        <div class="f1" style={{ "min-width": "0" }}>
          <div class="t28 w6">{t("history")}</div>
          <div class="i2" style={{ "margin-top": "4px" }} data-testid="hist-count">
            {plural("w2_n_songs", store.total())}
          </div>
        </div>
        <button type="button" class="btn ton sm" data-testid="hist-clear" classList={{ dis: !store.total() }} onClick={() => void clearAll()}>
          <Icon n="delete" s={16} />
          {t("w2_hist_clear")}
        </button>
      </div>
      <div ref={root} class="tbl tbl2" role="grid" aria-label={t("history")} aria-rowcount={store.total()} aria-multiselectable="true" tabindex="0" data-testid="hist-table" style={{ "--tcols": gridTemplate(cols()), "margin-top": "16px" }} onKeyDown={onKeyDown}>
        <div class="th" role="row">
          <For each={cols()}>{(c) => head(c)}</For>
        </div>
        <div ref={host} class="hs-vl" role="rowgroup" data-testid="hist-list" style={{ height: `${height()}px` }}>
          <For each={range()}>{(f) => item(f)}</For>
        </div>
      </div>
      <Show when={store.total() === 0 && settled()}>
        <div class="empty-state" data-testid="hist-empty">
          <Icon n="history" s={32} />
          <div>{t("w2_hist_empty")}</div>
        </div>
      </Show>
    </div>
  );
}

export const routes: RouteName[] = ["history"];
export default History;
