import { createEffect, createUniqueId } from "solid-js";
import { prog, player, playerState } from "../state/player";
import { fmtTime } from "../lib/format";
import { positionNow } from "../state/player";

type Pair = [string, string];
/** Applies the progress descriptor: CSS vars + a CSS animation on the compositor. No per-frame JS. */
function drive(el: HTMLElement | undefined, names: Pair, p: ReturnType<typeof prog>) {
  if (!el) return;
  el.style.setProperty("--p0", String(p.p0));
  // alternating names restart the animation without forcing a reflow
  el.style.animation = `${names[p.n % 2]} ${Math.max(1, Math.round(p.remainMs))}ms linear forwards`;
  el.style.animationPlayState = p.playing ? "running" : "paused";
}

function seekFromEvent(e: MouseEvent, host: HTMLElement) {
  const r = host.getBoundingClientRect();
  const pct = Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100));
  player.seekPercent(pct);
}

function sliderAria() {
  const s = playerState();
  const dur = s?.durMs ?? 0;
  return {
    "aria-valuemin": 0,
    "aria-valuemax": 100,
    "aria-valuenow": dur ? Math.round((positionNow() / dur) * 100) : 0,
    "aria-valuetext": `${fmtTime(positionNow())} / ${fmtTime(dur)}`,
  };
}

/** Plain progress bar (player bar). `line` = 2 px line (compact / thin style). */
export function ProgressBar(props: { line?: boolean; testid?: string; label: string }) {
  let fill: HTMLDivElement | undefined;
  let thumb: HTMLDivElement | undefined;
  let host!: HTMLDivElement;
  createEffect(() => {
    const p = prog();
    drive(fill, ["mm-progress-a", "mm-progress-b"], p);
    drive(thumb, ["mm-thumb-a", "mm-thumb-b"], p);
  });
  return (
    <div
      ref={host}
      class="bar"
      classList={{ line: props.line }}
      role="slider"
      tabindex="0"
      aria-label={props.label}
      data-testid={props.testid}
      {...sliderAria()}
      onClick={(e) => seekFromEvent(e, host)}
    >
      <div class="bar-fill" ref={fill} />
      <div class="bar-thumb" ref={thumb}>
        <b />
      </div>
    </div>
  );
}

function wavePath(width: number, amp = 3, wl = 28): string {
  let d = "M0 8";
  for (let x = 0; x <= width + wl; x += 2) d += ` L${x} ${(8 + amp * Math.sin((x / wl) * 2 * Math.PI)).toFixed(2)}`;
  return d;
}

/** Wavy progress (full player). Clip window A and content B move in lock step with the same linear animation. */
export function WaveProgress(props: { width: number; label: string }) {
  let a: HTMLDivElement | undefined;
  let b: HTMLDivElement | undefined;
  let thumb: HTMLDivElement | undefined;
  let host!: HTMLDivElement;
  const gid = "wg" + createUniqueId();
  createEffect(() => {
    const p = prog();
    drive(a, ["mm-clip-a", "mm-clip-b"], p);
    drive(b, ["mm-unclip-a", "mm-unclip-b"], p);
    drive(thumb, ["mm-thumb-a", "mm-thumb-b"], p);
    host.classList.toggle("paused", !p.playing);
  });
  return (
    <div ref={host} class="wave" style={{ width: "100%" }} role="slider" tabindex="0" aria-label={props.label} {...sliderAria()} onClick={(e) => seekFromEvent(e, host)}>
      <div class="wave-rest" />
      <div class="wave-a" ref={a}>
        <div class="wave-b" ref={b}>
          <div class="wave-flat" />
          <svg class="wave-run" width={props.width + 28} height="16" viewBox={`0 0 ${props.width + 28} 16`} aria-hidden="true">
            <defs>
              <linearGradient id={gid} gradientUnits="userSpaceOnUse" x1="0" x2={props.width} y1="0" y2="0">
                <stop offset="0" stop-color="#A6E3A1" />
                <stop offset=".42" stop-color="#76C6B4" />
                <stop offset=".8" stop-color="#6396EB" />
                <stop offset="1" stop-color="#5B7CFA" />
              </linearGradient>
            </defs>
            <path d={wavePath(props.width)} fill="none" stroke={`url(#${gid})`} stroke-width="4" stroke-linecap="round" />
          </svg>
        </div>
      </div>
      <div class="wave-thumb" ref={thumb}>
        <i />
      </div>
    </div>
  );
}
