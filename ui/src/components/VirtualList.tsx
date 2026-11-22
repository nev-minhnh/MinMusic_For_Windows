import { For, createEffect, createMemo, createSignal, onCleanup, onMount, type JSX } from "solid-js";

/**
 * Fixed-row-height virtual list that uses an ancestor scroller (the page, `.pg`).
 * - overscan of one viewport on each side, ranges quantised to 4 rows so DOM churn is bursty and rare
 * - rows are keyed by index, positioned with transform (no layout), contained with `contain: layout paint style`
 * - only a passive scroll listener that updates a signal when the range changes (no style writes)
 */
export function VirtualList(props: {
  total: number;
  rowHeight: number;
  render: (index: number) => JSX.Element;
  /** called with the first and last visible+overscan index whenever the range changes */
  onRange?: (start: number, end: number) => void;
  testid?: string;
  label?: string;
  ref?: (api: { scrollToIndex: (i: number) => void }) => void;
}) {
  let host!: HTMLDivElement;
  let scroller: HTMLElement | null = null;
  const [range, setRange] = createSignal<[number, number]>([0, 40]);
  const Q = 4;

  const compute = () => {
    if (!scroller) return;
    const rh = props.rowHeight;
    const st = scroller.scrollTop - host.offsetTop;
    const vh = scroller.clientHeight || 800;
    let s = Math.floor((st - vh) / rh);
    let e = Math.ceil((st + 2 * vh) / rh);
    s = Math.max(0, Math.floor(s / Q) * Q);
    e = Math.min(props.total, Math.ceil(e / Q) * Q);
    if (e < s) e = s;
    const cur = range();
    if (cur[0] !== s || cur[1] !== e) {
      setRange([s, e]);
      props.onRange?.(s, e);
    }
  };

  onMount(() => {
    scroller = host.closest<HTMLElement>(".pg");
    scroller?.addEventListener("scroll", compute, { passive: true });
    const ro = new ResizeObserver(compute);
    if (scroller) ro.observe(scroller);
    compute();
    props.onRange?.(range()[0], range()[1]);
    props.ref?.({
      scrollToIndex: (i) => {
        if (scroller) scroller.scrollTop = host.offsetTop + i * props.rowHeight;
      },
    });
    onCleanup(() => {
      scroller?.removeEventListener("scroll", compute);
      ro.disconnect();
    });
  });

  createEffect(() => {
    props.total;
    queueMicrotask(compute);
  });

  const indices = createMemo(() => {
    const [s, e] = range();
    const end = Math.min(e, props.total);
    const out: number[] = [];
    for (let i = s; i < end; i++) out.push(i);
    return out;
  });

  return (
    <div ref={host} class="vl" role="grid" aria-label={props.label} aria-rowcount={props.total} data-testid={props.testid} style={{ height: props.total * props.rowHeight + "px" }}>
      <For each={indices()}>
        {(i) => (
          <div class="vl-row" style={{ transform: `translateY(${i * props.rowHeight}px)`, height: props.rowHeight + "px" }}>
            {props.render(i)}
          </div>
        )}
      </For>
    </div>
  );
}
