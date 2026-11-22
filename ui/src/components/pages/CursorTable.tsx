import { Show } from "solid-js";
import { Table, type TableApi } from "../Table";
import type { Col } from "../Row";
import { playerState } from "../../state/player";
import { t } from "../../i18n";
import type { CursorList } from "./cursorList";
import { useSentinelPaging } from "./paging";
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
  useSentinelPaging(props.list, () => sentinel);
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
