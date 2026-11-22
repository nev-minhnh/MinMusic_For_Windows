import { Art } from "./Art";
import { Icon } from "./Icon";
import type { Art as ArtT } from "../lib/types";

/** Shelf card (184): square art, title 600, subtitle. Hover overlay and FAB are pre-rendered and only change opacity. */
export function Card(props: { title: string; subtitle?: string; art?: ArtT; dashed?: boolean; onOpen: () => void; onPlay?: () => void; playLabel: string; size?: number; children?: any }) {
  return (
    <div class="card" data-testid="card" role="button" tabindex="0" onClick={() => props.onOpen()} onKeyDown={(e) => e.key === "Enter" && props.onOpen()}>
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
