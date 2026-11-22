import { Show, createEffect, onCleanup, onMount } from "solid-js";
import { Table, type TableApi } from "../Table";
import type { Col } from "../Row";
import { playerState } from "../../state/player";
import { t } from "../../i18n";
import type { CursorList } from "./cursorList";
import type { Track } from "../../lib/types";
import "./pages.css";

/**
 * Songs Table over a cursor list. Up to 60 rows it renders without virtualisation, beyond that Table switches to VirtualList
 * (fixed 56 rows). The next page is requested when a sentinel below the table comes within 800 px of the viewport, or when the
 * virtual window reaches the end of what is loaded. The first page loads on mount unless the list already holds data.
 */
export function CursorTable(props: {
  list: CursorList<Track>;
  label: string;
  testid?: string;
  cols?: Col[];
  onPlay: (index: number, t: Track) => void;
  api?: (a: TableApi) => void;
}) {
  let sentinel!: HTMLDivElement;
  const items = props.list.items;
  onMount(() => {
    if (!items().length) void props.list.loadMore();
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) void props.list.loadMore();
      },
      { rootMargin: "0px 0px 800px 0px" }
    );
    io.observe(sentinel);
    onCleanup(() => io.disconnect());
  });
  // a page that does not fill the viewport leaves the sentinel visible without a new intersection: keep asking while it is
  createEffect(() => {
    items().length;
    if (!props.list.loading() && !props.list.error() && props.list.hasMore() && items().length && sentinel) {
      requestAnimationFrame(() => {
        const r = sentinel.getBoundingClientRect();
        if (r.top < window.innerHeight + 800) void props.list.loadMore();
      });
    }
  });
  return (
    <div>
      <Table
        label={props.label}
        testid={props.testid}
        cols={props.cols ?? ["index", "title", "album", "like", "dur", "more"]}
        total={() => items().length}
        trackAt={(i) => items()[i]}
        playingId={() => playerState()?.track?.id}
        onPlay={(i) => props.onPlay(i, items()[i]!)}
        ensure={(_s, e) => e >= items().length - 20 && void props.list.loadMore()}
        api={props.api}
      />
      <div class="pgx-sentinel" ref={sentinel} data-testid="cursor-sentinel" />
      <Show when={props.list.error() && !props.list.loading()}>
        <div class="pgx-err">
          {t("w2_error_generic")}{" "}
          <button type="button" class="btn txt" onClick={() => void props.list.loadMore()}>
            {t("w2_pg_retry")}
          </button>
        </div>
      </Show>
      <Show when={!items().length && !props.list.loading() && !props.list.hasMore() && !props.list.error()}>
        <div class="pgx-empty">{t("w2_none")}</div>
      </Show>
    </div>
  );
}
