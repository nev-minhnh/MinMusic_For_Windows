import { Show } from "solid-js";
import { Art } from "./Art";
import { Icon } from "./Icon";
import { Meta } from "./Meta";
import { fmtTime } from "../lib/format";
import { registerRow, type RowHandlers } from "../lib/delegate";
import type { Track } from "../lib/types";

export type RowLabels = { like: string; more: string; play: string };
/** Table columns, in order. A page picks a subset; Table drops "added" below 880 and "album" below 720. */
export type Col = "index" | "title" | "album" | "added" | "like" | "dur" | "more";
export const ALL_COLS: Col[] = ["index", "title", "album", "added", "like", "dur", "more"];
export const COL_W: Record<Col, string> = { index: "32px", title: "minmax(0,1fr)", album: "200px", added: "112px", like: "32px", dur: "40px", more: "32px" };

/**
 * Song table row (56). Pure: everything derives from `track`; hover is CSS only.
 * Selection, context menu and drag are NOT listeners on the row: it registers `onSelect` / `onContext` / `dragIds` with the list
 * delegate (lib/delegate.ts), which owns one listener per list and finds the row through `data-key`.
 */
export function Row(props: {
  index: number;
  track?: Track;
  dataKey?: string;
  selected?: boolean;
  playing?: boolean;
  showAlbum?: boolean;
  /** source badge in the meta line (default on) */
  showSource?: boolean;
  draggable?: boolean;
  cols?: Col[];
  labels: RowLabels;
  onSelect?: RowHandlers["onSelect"];
  onContext?: RowHandlers["onContext"];
  dragIds?: RowHandlers["dragIds"];
  /** legacy per-row click (pages that do not use Table) */
  onPick?: (t: Track) => void;
  onPlay?: (t: Track) => void;
  onOpenAlbum?: (t: Track) => void;
  onLike?: (t: Track) => void;
}) {
  const cols = () => props.cols ?? ALL_COLS;
  const has = (c: Col) => cols().includes(c);
  const reg = (el: HTMLElement) =>
    registerRow(el, () => ({
      onSelect: props.onSelect,
      onContext: props.onContext,
      dragIds: props.dragIds,
      onAct: (act, b) => {
        if (act === "like" && props.track) props.onLike?.(props.track);
        else if (act === "more") props.onContext?.({ clientX: b.left, clientY: b.bottom, target: null, keyboard: true });
      },
    }));
  return (
    <Show
      when={props.track}
      fallback={
        <div class="tr tr-skel" aria-hidden="true">
          <Show when={has("index")}>
            <div class="ix" />
          </Show>
          <div class="tt">
            <div class="art skel-art" />
            <div class="m">
              <div class="skel" style={{ width: "40%" }} />
            </div>
          </div>
          <Show when={has("album")}>
            <div class="c-album" />
          </Show>
          <Show when={has("added")}>
            <div class="c-added" />
          </Show>
          <Show when={has("like")}>
            <div />
          </Show>
          <Show when={has("dur")}>
            <div />
          </Show>
          <Show when={has("more")}>
            <div />
          </Show>
        </div>
      }
    >
      {(t) => (
        <div
          ref={reg}
          class="tr"
          classList={{ sel: props.selected, playing: props.playing }}
          role="row"
          aria-rowindex={props.index + 1}
          aria-selected={props.selected === undefined ? undefined : props.selected}
          data-testid="song-row"
          data-index={props.index}
          data-key={props.dataKey}
          draggable={props.draggable ? "true" : undefined}
          tabindex="-1"
          onClick={() => props.onPick?.(t())}
          onDblClick={() => props.onPlay?.(t())}
        >
          <Show when={has("index")}>
            <div class="ix">
              <Show when={props.playing} fallback={<span class="n">{props.index + 1}</span>}>
                <span class="n bars">
                  <i />
                  <i />
                  <i />
                </span>
              </Show>
              <Icon n="play" s={20} class="hp" />
            </div>
          </Show>
          <div class="tt">
            <Art art={t().art} size={40} class="pressable" />
            <div class="m">
              <div class="n ell">{t().title}</div>
              <Meta t={t()} alt showSource={props.showSource} />
            </div>
          </div>
          <Show when={has("album")}>
            <div class="c-album i3 ell">
              <Show when={t().album}>
                {(a) => (
                  <span
                    class="lnk"
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onOpenAlbum?.(t());
                    }}
                  >
                    {a().title}
                  </span>
                )}
              </Show>
            </div>
          </Show>
          <Show when={has("added")}>
            <div class="c-added i3 t12 num">{t().addedText}</div>
          </Show>
          <Show when={has("like")}>
            <div class="acts">
              <button type="button" class="ib hv" classList={{ liked: t().liked }} tabindex="-1" aria-label={props.labels.like} data-act="like">
                <Icon n={t().liked ? "heartf" : "heart"} s={20} />
              </button>
            </div>
          </Show>
          <Show when={has("dur")}>
            <div class="t12 i3 num dur">{fmtTime(t().durationMs ?? 0)}</div>
          </Show>
          <Show when={has("more")}>
            <div class="acts">
              <button type="button" class="ib hv" tabindex="-1" aria-label={props.labels.more} data-act="more">
                <Icon n="more" s={20} />
              </button>
            </div>
          </Show>
        </div>
      )}
    </Show>
  );
}

/** Chart row (Home charts box). */
export function ChartRow(props: { rank: number; t: Track; trend: string; newLabel: string; onOpen: () => void; onPlay: () => void; labels: RowLabels }) {
  return (
    <div class="crow" data-testid="chart-row" role="button" tabindex="0" onClick={() => props.onOpen()} onDblClick={() => props.onPlay()}>
      <div class="rk">{props.rank}</div>
      <Art art={props.t.art} size={40} class="pressable">
        <div class="hovplay">
          <Icon n="play" s={20} />
        </div>
      </Art>
      <div style={{ "min-width": "0" }}>
        <div class="w6 ell">{props.t.title}</div>
        <Meta t={props.t} />
      </div>
      <div class="trd">{props.trend === "new" ? <span class="b exp">{props.newLabel}</span> : props.trend}</div>
      <div class="t12 i3 num">{fmtTime(props.t.durationMs ?? 0)}</div>
      <button type="button" class="ib hv" style={{ width: "32px", height: "32px" }} tabindex="-1" aria-label={props.labels.more}>
        <Icon n="more" s={20} />
      </button>
    </div>
  );
}
