import { For, Show, createResource } from "solid-js";
import { Art } from "../../components/Art";
import { client } from "../../lib/core";
import { openItem } from "../../lib/nav";
import { artistsText } from "../../lib/format";
import { playerState } from "../../state/player";
import { closeFull } from "../../state/ui";
import { queueApi } from "../../state/queue";
import { t } from "../../i18n";
import type { Item, Shelf } from "../../lib/types";

const sub = (it: Item): string =>
  it.t === "track" ? artistsText(it.artists) : it.t === "album" ? artistsText(it.artists) : it.t === "artist" ? it.subtitle ?? "" : it.subtitle ?? "";
const title = (it: Item): string => (it.t === "artist" ? it.name : it.title);

/** "Liên quan": `related.get` shelves as compact rows. Click a track to queue it, any other item opens its page. */
export function RelatedPanel(props: { active: () => boolean }) {
  const id = () => (props.active() ? playerState()?.track?.id : undefined);
  const [data] = createResource(id, (trackId) => client.call<{ shelves: Shelf[] }>("related.get", { trackId }));
  return (
    <div class="rel" data-testid="related-panel">
      <Show when={data()} fallback={<div class="qp-empty">{data.loading ? t("w2_m22_ly_loading") : t("w2_m22_queue_empty")}</div>}>
        <For each={data()!.shelves}>
          {(sh) => (
            <section class="rel-sh">
              <div class="ovl rel-h">{sh.title}</div>
              <For each={sh.items.slice(0, 12)}>
                {(it) => (
                  <button
                    type="button"
                    class="qr rel-it"
                    data-testid="related-item"
                    onClick={() => {
                      if (it.t === "track") queueApi.addEnd([it.id]);
                      else { closeFull(); openItem(it); }
                    }}
                  >
                    <Art art={it.art} size={40} round={it.t === "artist"} />
                    <div class="f1">
                      <div class="w6 ell">{title(it)}</div>
                      <div class="t12 i3 ell">{sub(it)}</div>
                    </div>
                  </button>
                )}
              </For>
            </section>
          )}
        </For>
      </Show>
    </div>
  );
}
