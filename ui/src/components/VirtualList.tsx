import { Index, Show, batch, createSignal, onCleanup, onMount, type Accessor, type JSX } from "solid-js";

/**
 * Fixed-row-height virtual list that uses an ancestor scroller (the page, `.pg`).
 * - window = visible rows + one viewport of overscan on each side (frontend-spec 6 rule 7)
 * - hysteresis: the window only moves after the view has drifted a third of a viewport, so a wheel notch
 *   usually costs no main-thread work at all and a move touches ~6 rows, not the whole window
 * - DOM recycling: N fixed slots, row i always lives in slot i % N. A move rewrites the few slots that
 *   left the window in place (text, src, `top`); End/Home rewrites every slot but creates no nodes
 * - rows are `position:absolute; top` inside `contain:strict` slots: no per-row transform nodes, one clip each
 * - the passive scroll listener only schedules a rAF; scrollTop/offsetTop are read in that rAF, where layout
 *   is already clean, so scrolling never forces a synchronous layout (rule 4)
 */
export function VirtualList(props: {
  total: number;
  rowHeight: number;
  /** renders one slot; `index` changes when the slot is recycled */
  render: (index: Accessor<number>) => JSX.Element;
  /** called with the first and last (exclusive) index of the window whenever it changes */
  onRange?: (start: number, end: number) => void;
  testid?: string;
  label?: string;
  /** ARIA role of the host (default grid; a Table nests it as rowgroup) */
  role?: "grid" | "rowgroup";
  ref?: (api: { scrollToIndex: (i: number) => void }) => void;
}) {
  let host!: HTMLDivElement;
  let scroller: HTMLElement | null = null;
  // N slots and the first index of the window
  const [shape, setShape] = createSignal<{ n: number; s: number }>({ n: 60, s: 0 });
  // index range that may be rewritten this frame (everything except right after a far jump)
  const [near, setNear] = createSignal<[number, number]>([-Infinity, Infinity]);
  let prev: number[] = [];
  let raf = 0;

  const update = () => {
    raf = 0;
    if (!scroller) return;
    const rh = props.rowHeight;
    const vh = scroller.clientHeight || 800;
    const v = Math.ceil(vh / rh) + 1; // rows in one viewport
    const n = 3 * v; // visible + one viewport above + one below
    const top = Math.floor((scroller.scrollTop - host.offsetTop) / rh);
    const maxS = Math.max(0, props.total - n);
    const want = Math.min(maxS, Math.max(0, top - v));
    const cur = shape();
    const drift = Math.abs(want - cur.s);
    if (cur.n !== n || drift >= Math.max(1, Math.floor(v / 3)) || (want === 0 && cur.s !== 0) || (want === maxS && cur.s !== maxS)) {
      // End/Home or a scrollbar drag replaces every slot: split it so no frame builds the whole window
      // (M0 trace: one 60-90 ms rAF task per jump). Visible rows now, the overscan on the next frame.
      const far = cur.n === n && drift >= n;
      batch(() => {
        setNear(far ? [top - 1, top + v + 1] : [-Infinity, Infinity]);
        setShape({ n, s: want });
      });
      if (far) requestAnimationFrame(() => setNear([-Infinity, Infinity]));
      props.onRange?.(want, Math.min(props.total, want + n));
    }
  };
  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(update);
  };
  // Hover is off while scrolling: rows passing under a still cursor otherwise flip :hover every few frames,
  // start opacity transitions on .hp/.hv and turn each wheel frame into a style + paint + layerize main frame
  // (M0 trace: ~1,800 animation style recalcs per 6 s wheel run). pointer-events is not layout-affecting.
  let scrolling = false;
  let idleT = 0;
  // a timer, not scrollend: wheel notches without smooth scrolling fire scrollend after every notch
  const endScroll = () => {
    clearTimeout(idleT);
    if (!scrolling) return;
    scrolling = false;
    host.classList.remove("vl-scrolling");
  };
  const onScroll = () => {
    schedule();
    if (!scrolling) {
      scrolling = true;
      host.classList.add("vl-scrolling");
    }
    clearTimeout(idleT);
    idleT = window.setTimeout(endScroll, 200);
  };

  onMount(() => {
    scroller = host.closest<HTMLElement>(".pg");
    scroller?.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(schedule);
    if (scroller) ro.observe(scroller);
    update();
    const { n, s } = shape();
    props.onRange?.(s, Math.min(props.total, s + n));
    props.ref?.({
      scrollToIndex: (i) => {
        if (scroller) scroller.scrollTop = host.offsetTop + i * props.rowHeight;
      },
    });
    onCleanup(() => {
      scroller?.removeEventListener("scroll", onScroll);
      clearTimeout(idleT);
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    });
  });

  // total changes (first window, library.changed): re-evaluate after the DOM settles
  let lastTotal = -1;
  const slots = () => {
    const { n, s } = shape();
    if (props.total !== lastTotal) {
      lastTotal = props.total;
      queueMicrotask(schedule);
    }
    const [lo, hi] = near();
    const out = new Array<number>(n);
    for (let k = 0; k < n; k++) {
      // the index in [s, s+n) that maps to slot k
      const i = s + ((k - (s % n) + n) % n);
      // after a far jump only the visible rows are rewritten this frame; the rest keep their old (off-screen) row
      out[k] = i >= props.total ? -1 : i < lo || i >= hi ? (prev[k] ?? i) : i;
    }
    if (prev.length === n || hi === Infinity) prev = out;
    return out;
  };

  return (
    <div ref={host} class="vl" role={props.role ?? "grid"} aria-label={props.label} aria-rowcount={props.role ? undefined : props.total} data-testid={props.testid} style={{ height: props.total * props.rowHeight + "px" }}>
      <Index each={slots()}>
        {(i) => (
          <Show when={i() >= 0}>
            <div class="vl-row" style={{ top: i() * props.rowHeight + "px", height: props.rowHeight + "px" }}>
              {props.render(i)}
            </div>
          </Show>
        )}
      </Index>
    </div>
  );
}
