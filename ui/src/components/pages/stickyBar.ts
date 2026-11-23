/**
 * Header collapse (frontend-spec 5): a 1 px sentinel above the header, observed with an IntersectionObserver.
 * While the sentinel is out of view the 56 px sticky bar is shown. No scroll handler, no style writes.
 */
export type IOCtor = new (cb: (entries: { isIntersecting: boolean }[]) => void, opts?: object) => { observe(el: Element): void; disconnect(): void };

export const isStuck = (entries: { isIntersecting: boolean }[]): boolean => !entries[entries.length - 1]?.isIntersecting;

/** Observes `sentinel`; `onChange(true)` when the header has scrolled away. Returns the disposer. */
export function observeSentinel(sentinel: Element, onChange: (stuck: boolean) => void, IO: IOCtor = IntersectionObserver as unknown as IOCtor): () => void {
  let last: boolean | undefined;
  const io = new IO((entries) => {
    const s = isStuck(entries);
    if (s !== last) onChange((last = s));
  }, { threshold: 0 });
  io.observe(sentinel);
  return () => io.disconnect();
}
