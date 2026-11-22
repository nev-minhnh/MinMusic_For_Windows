import { Show, createEffect, createMemo, createSignal, on, onCleanup } from "solid-js";
import { lyricsFs, setLyricsFs } from "../../state/playerExtra";
import { playerState } from "../../state/player";
import { pushEsc } from "../../lib/esc";
import { tintFor } from "../../shell/player/tint";
import { IconButton } from "../../components/IconButton";
import { artistsText } from "../../lib/format";
import { t } from "../../i18n";
import { LyricsView } from "./LyricsView";
import { LyricsTools } from "./LyricsTools";
import { LyricsSearchDialog } from "./SearchDialog";
import "./lyrics.css";

/** Fullscreen lyrics: an overlay in the Esc stack (not a route). 40/52 type, centred, max width 960. */
export function LyricsFullscreen() {
  let unEsc: (() => void) | undefined;
  const [find, setFind] = createSignal(false);
  createEffect(
    on(lyricsFs, (o) => {
      unEsc?.();
      unEsc = o ? pushEsc(() => setLyricsFs(false)) : undefined;
    })
  );
  onCleanup(() => unEsc?.());
  const tr = () => playerState()?.track;
  const tint = createMemo(() => tintFor(tr()?.art?.dominant, tr()?.id));
  return (
    <Show when={lyricsFs()}>
      <div class="lyfs" role="dialog" aria-modal="true" aria-label={t("lyrics")} data-testid="lyrics-fullscreen" style={{ "--tint": tint() }}>
        <div class="lyfs-top">
          <div class="f1" style={{ "min-width": "0" }}>
            <div class="w6 ell">{tr()?.title}</div>
            <div class="t12 i3 ell">{artistsText(tr()?.artists ?? [])}</div>
          </div>
          <LyricsTools onSearch={() => setFind(true)} />
          <IconButton icon="fs_exit" label={t("w2_m22_exit_fs")} onClick={() => setLyricsFs(false)} testid="lyrics-fs-exit" />
        </div>
        <LyricsView variant="fs" onSearch={() => setFind(true)} />
      </div>
      <Show when={find()}>
        <LyricsSearchDialog onClose={() => setFind(false)} />
      </Show>
    </Show>
  );
}
