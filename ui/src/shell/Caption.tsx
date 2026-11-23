import { createSignal, onCleanup, onMount } from "solid-js";
import { inTauri, win } from "../lib/tauri";
import "./caption-snap.css";
import { t } from "../i18n";

/** Custom caption buttons (46 wide, close hover #C42B1C). The max button reports its rect for Snap Layouts. */
export function Caption(props: { reportRect?: boolean }) {
  let max!: HTMLButtonElement;
  // hover / pressed of the maximize button, reported by the native overlay (shell/src/snap)
  const [hov, setHov] = createSignal(false);
  const [down, setDown] = createSignal(false);
  const report = () => {
    const r = max.getBoundingClientRect();
    const d = window.devicePixelRatio;
    win.captionRects([Math.round(r.left * d), Math.round(r.top * d), Math.round(r.width * d), Math.round(r.height * d)]);
  };
  onMount(() => {
    if (!props.reportRect) return;
    report();
    window.addEventListener("resize", report, { passive: true });
    onCleanup(() => window.removeEventListener("resize", report));
    if (inTauri) {
      let off: (() => void) | undefined;
      import("@tauri-apps/api/event")
        .then(({ listen }) => listen("mm-caption", (ev: { payload: { hover: boolean; down: boolean } }) => { setHov(ev.payload.hover); setDown(ev.payload.down); }))
        .then((un) => (off = un))
        .catch(() => {});
      onCleanup(() => off?.());
    }
  });
  return (
    <div class="cap">
      <button type="button" aria-label={t("w2_minimize")} onClick={() => win.minimize()}>
        <svg viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0 5.5h10" />
        </svg>
      </button>
      <button type="button" ref={max} classList={{ sh: hov(), sd: down() }} data-testid="caption-max" aria-label={t("w2_maximize")} onClick={() => win.toggleMaximize()}>
        <svg viewBox="0 0 10 10" aria-hidden="true">
          <rect x=".5" y=".5" width="9" height="9" rx="1" />
        </svg>
      </button>
      <button type="button" class="xh" aria-label={t("w2_close")} onClick={() => win.close()}>
        <svg viewBox="0 0 10 10" aria-hidden="true">
          <path d="M.5.5l9 9M9.5.5l-9 9" />
        </svg>
      </button>
    </div>
  );
}
