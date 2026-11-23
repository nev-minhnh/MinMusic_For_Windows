import { Show, createSignal, onCleanup, onMount } from "solid-js";
import { Art } from "../components/Art";
import { Icon } from "../components/Icon";
import { ProgressBar } from "../components/Progress";
import { player, playerState } from "../state/player";
import { inTauri, invoke } from "../lib/tauri";
import { t } from "../i18n";

export type MiniMode = "bar" | "square";
export const modeFromHash = (hash: string): MiniMode => (/[?&]mode=square\b/.test(hash) ? "square" : "bar");

/** Mini player (frontend-spec 5): art 64, title/artist, prev/play/next, 2 px progress line; square mode = art 320. */
export function MiniApp() {
  const s = () => playerState();
  const playing = () => s()?.playing ?? false;
  const [mode, setMode] = createSignal<MiniMode>(modeFromHash(location.hash));
  const back = () => void invoke("mini_toggle");
  const switchMode = () => {
    const next: MiniMode = mode() === "bar" ? "square" : "bar";
    setMode(next);
    void invoke("mini_set_mode", { mode: next });
  };
  onMount(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" || (e.ctrlKey && e.key.toLowerCase() === "m")) {
        e.preventDefault();
        back();
      } else if (e.key === " " && !e.repeat) {
        e.preventDefault();
        void player.toggle();
      }
    };
    window.addEventListener("keydown", key);
    const noMenu = (e: MouseEvent) => e.preventDefault();
    window.addEventListener("contextmenu", noMenu);
    let off: (() => void) | undefined;
    if (inTauri) {
      import("@tauri-apps/api/event")
        .then(({ listen }) => listen("mini-mode", (ev: { payload: MiniMode }) => setMode(ev.payload === "square" ? "square" : "bar")))
        .then((un) => (off = un))
        .catch(() => {});
    }
    onCleanup(() => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("contextmenu", noMenu);
      off?.();
    });
  });
  const artSize = () => (mode() === "square" ? 320 : 64);
  return (
    <div class="mini" classList={{ sq: mode() === "square" }} data-mode={mode()} data-testid="mini" onDblClick={back}>
      <div class="mini-art" data-tauri-drag-region data-testid="mini-art">
        <Art art={s()?.track?.art} size={artSize()} reqPx={mode() === "square" ? 320 : 128} />
      </div>
      <div class="mini-body" data-tauri-drag-region={mode() === "square" ? true : undefined}>
        <div class="mini-text" data-tauri-drag-region>
          <div class="w6 ell mini-title" data-testid="mini-title">{s()?.track?.title ?? t("w2_mini_empty")}</div>
          <div class="t12 ell mini-artist">{s()?.track?.artists?.map((a) => a.name).join(", ")}</div>
        </div>
        <div class="mini-ctl" onDblClick={(e) => e.stopPropagation()}>
          <button type="button" class="mini-b" aria-label={t("w2_prev")} disabled={!s()?.canPrev} onClick={() => player.prev()} data-testid="mini-prev">
            <Icon n="prev" s={20} />
          </button>
          <button type="button" class="mini-b pp" aria-label={playing() ? t("w2_pause") : t("w2_play")} disabled={!s()?.track} onClick={() => player.toggle()} data-testid="mini-play">
            <Icon n={playing() ? "pause" : "play"} s={20} />
          </button>
          <button type="button" class="mini-b" aria-label={t("w2_next")} disabled={!s()?.canNext} onClick={() => player.next()} data-testid="mini-next">
            <Icon n="next" s={20} />
          </button>
          <span class="mini-sp" />
          <button type="button" class="mini-b" aria-label={mode() === "bar" ? t("w2_mini_square") : t("w2_mini_bar")} onClick={switchMode} data-testid="mini-mode">
            <Icon n={mode() === "bar" ? "mini_square" : "mini_bar"} s={20} />
          </button>
          <button type="button" class="mini-b" aria-label={t("w2_mini_back")} onClick={back} data-testid="mini-back">
            <Icon n="close" s={20} />
          </button>
        </div>
      </div>
      <div class="mini-line">
        <ProgressBar line label={t("w2_seek")} />
      </div>
    </div>
  );
}
