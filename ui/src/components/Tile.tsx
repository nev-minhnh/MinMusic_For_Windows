import { Art } from "./Art";
import { Icon } from "./Icon";
import type { Art as ArtT } from "../lib/types";

/** Quick pick tile: 64 high, art 64, title clamped to 2 lines, gradient play FAB on hover (pre-rendered, CSS opacity). */
export function Tile(props: { title: string; art?: ArtT; onOpen: () => void; onPlay?: () => void; playLabel: string }) {
  return (
    <div class="qt" data-testid="qp-tile" role="button" tabindex="0" onClick={() => props.onOpen()} onKeyDown={(e) => e.key === "Enter" && props.onOpen()}>
      <Art art={props.art} size={64} class="pressable" />
      <div class="t">{props.title}</div>
      <button
        type="button"
        class="fab"
        aria-label={props.playLabel}
        onClick={(e) => {
          e.stopPropagation();
          props.onPlay?.();
        }}
      >
        <Icon n="play" s={20} />
      </button>
    </div>
  );
}
