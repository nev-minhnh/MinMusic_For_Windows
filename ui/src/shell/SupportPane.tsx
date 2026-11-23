import { Show, createEffect, createSignal, on, onCleanup } from "solid-js";
import { IconButton } from "../components/IconButton";
import { Seg } from "../components/Seg";
import { QueuePanel } from "./player/QueuePanel";
import { LyricsView } from "../pages/Lyrics/LyricsView";
import { LyricsTools } from "../pages/Lyrics/LyricsTools";
import { LyricsSearchDialog } from "../pages/Lyrics/SearchDialog";
import { PANE_MAX, PANE_MIN, closePane, paneDocked, paneOpen, paneTab, paneWidth, setPaneWidth, setTab, type PaneTab } from "../state/playerExtra";
import { pushEsc } from "../lib/esc";
import { reducedMotion } from "../lib/motion";
import { t } from "../i18n";
import "./player/player.css";

/**
 * Support pane: 336 wide (drag 280-480), docked in grid column 3 while the content keeps >= 760, otherwise an overlay
 * without scrim (a layer in the Esc stack). Tabs: Tiếp theo (queue) and Lời (lyrics).
 */
export function SupportPane() {
  let el: HTMLElement | undefined;
  const [find, setFind] = createSignal(false);
  const [dragging, setDragging] = createSignal(false);
  const tabs = () => [
    { key: "queue", label: t("w2_tab_next") },
    { key: "lyrics", label: t("w2_tab_lyrics") },
  ];

  // overlay mode: Esc peels it, and a slide-in from the right (transform only)
  createEffect(
    on([paneOpen, () => paneDocked()], ([o, d]) => {
      if (!o || d) return;
      const un = pushEsc(closePane);
      queueMicrotask(() => {
        if (el && !reducedMotion()) el.animate([{ transform: "translateX(24px)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 240, easing: "cubic-bezier(0.05,0.7,0.1,1)" });
      });
      onCleanup(un);
    })
  );

  // resize grip: pointer capture, the width is written once per frame
  let raf = 0;
  const grip = (e: PointerEvent) => {
    const g = e.currentTarget as HTMLElement;
    g.setPointerCapture(e.pointerId);
    setDragging(true);
    const move = (ev: PointerEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setPaneWidth(window.innerWidth - ev.clientX, false));
    };
    const up = () => {
      g.removeEventListener("pointermove", move);
      g.removeEventListener("pointerup", up);
      g.removeEventListener("pointercancel", up);
      setDragging(false);
      setPaneWidth(paneWidth(), true);
    };
    g.addEventListener("pointermove", move);
    g.addEventListener("pointerup", up);
    g.addEventListener("pointercancel", up);
  };
  const gripKey = (e: KeyboardEvent) => {
    const d = e.key === "ArrowLeft" ? 16 : e.key === "ArrowRight" ? -16 : 0;
    if (d) { e.preventDefault(); e.stopPropagation(); setPaneWidth(paneWidth() + d); }
  };

  return (
    <Show when={paneOpen()}>
      <aside ref={el} class="sp" classList={{ ovl: !paneDocked(), docked: paneDocked(), dragging: dragging() }} style={{ "--spw": paneWidth() + "px" }} data-testid="support-pane" aria-label={t("w2_tab_next")}>
        <div
          class="sp-grip"
          role="separator"
          aria-orientation="vertical"
          aria-valuemin={PANE_MIN}
          aria-valuemax={PANE_MAX}
          aria-valuenow={paneWidth()}
          aria-label={t("w2_m22_resize")}
          tabindex="0"
          data-testid="pane-grip"
          onPointerDown={grip}
          onKeyDown={gripKey}
        />
        <div class="sp-head">
          <Seg items={tabs()} value={paneTab()} onChange={(k) => setTab(k as PaneTab)} label={t("w2_player")} class="s1" />
          <div class="mla row gap4">
            <Show when={paneTab() === "lyrics"}>
              <LyricsTools onSearch={() => setFind(true)} chips={false} />
            </Show>
            <IconButton icon="close" label={t("w2_close")} onClick={closePane} testid="pane-close" />
          </div>
        </div>
        <div class="sp-body">
          <Show when={paneTab() === "queue"} fallback={<LyricsView variant="pane" onSearch={() => setFind(true)} />}>
            <QueuePanel variant="pane" />
          </Show>
        </div>
      </aside>
      <Show when={find()}>
        <LyricsSearchDialog onClose={() => setFind(false)} />
      </Show>
    </Show>
  );
}
