import { createSignal, onCleanup } from "solid-js";
import { player, playerState } from "../../state/player";
import { t } from "../../i18n";

/**
 * Volume slider: role=slider, drag with pointer capture, arrows +/-5 %, Home/End. The fill and thumb move by transform
 * only. While dragging the local value wins and the core is told at most every 60 ms (plus the last value).
 */
export function VolumeSlider(props: { class?: string; testid?: string }) {
  let host!: HTMLDivElement;
  const [drag, setDrag] = createSignal<number | null>(null);
  const muted = () => playerState()?.muted ?? false;
  const value = () => drag() ?? (muted() ? 0 : playerState()?.volume ?? 0);
  let last = 0;
  let timer = 0;
  let pending: number | null = null;
  const send = (v: number) => {
    pending = v;
    const now = performance.now();
    if (now - last >= 60) { last = now; pending = null; player.setVolume(v); }
    else if (!timer) timer = window.setTimeout(() => { timer = 0; last = performance.now(); if (pending !== null) player.setVolume(pending); pending = null; }, 60 - (now - last));
  };
  onCleanup(() => clearTimeout(timer));
  const fromEvent = (e: PointerEvent) => {
    const r = host.getBoundingClientRect();
    return Math.round(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * 100) / 100;
  };
  const down = (e: PointerEvent) => {
    host.setPointerCapture(e.pointerId);
    const v = fromEvent(e);
    setDrag(v);
    send(v);
  };
  const move = (e: PointerEvent) => {
    if (drag() === null) return;
    const v = fromEvent(e);
    setDrag(v);
    send(v);
  };
  const up = () => setDrag(null);
  const key = (e: KeyboardEvent) => {
    const step = e.key === "ArrowLeft" || e.key === "ArrowDown" ? -0.05 : e.key === "ArrowRight" || e.key === "ArrowUp" ? 0.05 : 0;
    let v: number | null = null;
    if (step) v = Math.min(1, Math.max(0, Math.round((value() + step) * 100) / 100));
    else if (e.key === "Home") v = 0;
    else if (e.key === "End") v = 1;
    if (v === null) return;
    e.preventDefault();
    e.stopPropagation(); // the global ArrowUp/Down shortcut would add another 10 %
    player.setVolume(v);
  };
  return (
    <div
      ref={host}
      class={`vslider ${props.class ?? ""}`}
      role="slider"
      tabindex="0"
      aria-label={t("w2_volume")}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value() * 100)}
      aria-valuetext={`${Math.round(value() * 100)} %`}
      data-testid={props.testid ?? "volume-slider"}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onKeyDown={key}
    >
      <div class="vs-fill" style={{ transform: `scaleX(${value()})` }} />
      <div class="vs-thumb" style={{ transform: `translateX(calc(${value()} * 100cqw))` }} />
    </div>
  );
}
