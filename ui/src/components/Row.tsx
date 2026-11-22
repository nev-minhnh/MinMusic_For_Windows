import { Show } from "solid-js";
import { Art } from "./Art";
import { Icon } from "./Icon";
import { Meta } from "./Meta";
import { fmtTime } from "../lib/format";
import type { Track } from "../lib/types";

export type RowLabels = { like: string; more: string; play: string };

/** Song table row (56). Pure: everything derives from `track`; hover is CSS only. Columns hide through container queries in base.css. */
export function Row(props: {
  index: number;
  track?: Track;
  selected?: boolean;
  playing?: boolean;
  showAlbum?: boolean;
  labels: RowLabels;
  onSelect?: (t: Track) => void;
  onPlay?: (t: Track) => void;
  onOpenAlbum?: (t: Track) => void;
}) {
  return (
    <Show
      when={props.track}
      fallback={
        <div class="tr tr-skel" aria-hidden="true">
          <div class="ix" />
          <div class="tt">
            <div class="art skel-art" />
            <div class="m">
              <div class="skel" style={{ width: "40%" }} />
            </div>
          </div>
          <div class="c-album" />
          <div class="c-added" />
          <div />
          <div />
          <div />
        </div>
      }
    >
      {(t) => (
        <div
          class="tr"
          classList={{ sel: props.selected, playing: props.playing }}
          role="row"
          aria-rowindex={props.index + 1}
          data-testid="song-row"
          data-index={props.index}
          onClick={() => props.onSelect?.(t())}
          onDblClick={() => props.onPlay?.(t())}
        >
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
          <div class="tt">
            <Art art={t().art} size={40} class="pressable" />
            <div class="m">
              <div class="n ell">{t().title}</div>
              <Meta t={t()} alt />
            </div>
          </div>
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
          <div class="c-added i3 t12 num">{t().addedText}</div>
          <div class="acts">
            <button type="button" class="ib hv" classList={{ liked: t().liked }} tabindex="-1" aria-label={props.labels.like}>
              <Icon n={t().liked ? "heartf" : "heart"} s={20} />
            </button>
          </div>
          <div class="t12 i3 num dur">{fmtTime(t().durationMs ?? 0)}</div>
          <div class="acts">
            <button type="button" class="ib hv" tabindex="-1" aria-label={props.labels.more}>
              <Icon n="more" s={20} />
            </button>
          </div>
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
