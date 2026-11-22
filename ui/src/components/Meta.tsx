import { Show } from "solid-js";
import { AltBadge, QualityBadge, SourceBadge } from "./Badge";
import { artistsText } from "../lib/format";
import type { Track } from "../lib/types";

/** Meta line under a title: source badge, quality badge, +N alt sources, artists. */
export function Meta(props: { t: Track; alt?: boolean; showSource?: boolean }) {
  return (
    <div class="meta-l">
      <Show when={props.showSource !== false}>
        <SourceBadge source={props.t.source} />
      </Show>
      <QualityBadge q={props.t.quality} />
      <Show when={props.alt}>
        <AltBadge n={props.t.altSources} />
      </Show>
      <span class="t">{artistsText(props.t.artists)}</span>
    </div>
  );
}
