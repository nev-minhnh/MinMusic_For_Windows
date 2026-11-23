import { Show } from "solid-js";
import { IconButton } from "../../components/IconButton";
import { Chip } from "../../components/Chip";
import { karaoke, lyrics, lyricsApi, setKaraoke, trOn } from "../../state/lyrics";
import { togglePop } from "../../state/playerExtra";
import { t } from "../../i18n";

/** Karaoke + translate chips and the "more" button (offset, romanize, find other lyrics). */
export function LyricsTools(props: { onSearch: () => void; chips?: boolean }) {
  return (
    <div class="row gap8 lyt" data-testid="lyrics-tools">
      <Show when={props.chips !== false}>
        <Show when={lyrics()?.synced === "word"}>
          <Chip on={karaoke()} onClick={() => setKaraoke(!karaoke())}>
            {t("w2_karaoke")}
          </Chip>
        </Show>
        <Chip on={trOn()} onClick={() => lyricsApi.translate(!trOn())}>
          {t("w2_translate")}
        </Chip>
      </Show>
      <IconButton icon="more" label={t("w2_m22_ly_options")} testid="lyrics-more" onClick={(e) => togglePop("lytools", e.currentTarget as HTMLElement, props.onSearch)} />
    </div>
  );
}
