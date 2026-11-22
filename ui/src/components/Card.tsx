import { Art } from "./Art";
import { Icon } from "./Icon";
import { registerRow, type RowHandlers } from "../lib/delegate";
import type { Art as ArtT } from "../lib/types";

/**
 * Shelf card (184): square art, title 600, subtitle. Hover overlay and FAB are pre-rendered and only change opacity.
 * Context menu, selection and drag go through the list delegate (data-key + registerRow), not per-card listeners.
 */
export function Card(props: {
  title: string;
  subtitle?: string;
  art?: ArtT;
  dashed?: boolean;
  onOpen: () => void;
  onPlay?: () => void;
  playLabel: string;
  size?: number;
  children?: any;
  dataKey?: string;
  selected?: boolean;
  draggable?: boolean;
  onSelect?: RowHandlers["onSelect"];
  onContext?: RowHandlers["onContext"];
  dragIds?: RowHandlers["dragIds"];
}) {
  return (
    <div
      ref={(el) => registerRow(el, () => ({ onSelect: props.onSelect, onContext: props.onContext, dragIds: props.dragIds }))}
      class="card"
      classList={{ sel: props.selected }}
      data-testid="card"
      data-key={props.dataKey}
      aria-selected={props.selected === undefined ? undefined : props.selected}
      draggable={props.draggable ? "true" : undefined}
      role="button"
      tabindex="0"
      onClick={() => props.onOpen()}
      onKeyDown={(e) => e.key === "Enter" && props.onOpen()}
    >
      {props.dashed ? (
        <div class="art dash" style={{ width: "100%", "aspect-ratio": "1/1" }}>
          {props.children}
        </div>
      ) : (
        <Art art={props.art} size={props.size ?? 184} fill class="pressable">
          <span class="card-dim" />
          <button
            type="button"
            class="fab cfab"
            aria-label={props.playLabel}
            onClick={(e) => {
              e.stopPropagation();
              props.onPlay?.();
            }}
          >
            <Icon n="play" s={20} />
          </button>
        </Art>
      )}
      <div class="ct ell">{props.title}</div>
      <div class="t12 i3 ell">{props.subtitle}</div>
    </div>
  );
}
