/** Priority reorder maths (pure, unit tested). */

/** Moves the item at `from` to index `to` (both clamped). Returns a new array. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const out = list.slice();
  if (from < 0 || from >= out.length) return out;
  const dest = Math.max(0, Math.min(out.length - 1, to));
  const [x] = out.splice(from, 1);
  out.splice(dest, 0, x!);
  return out;
}

/** Index the dragged row lands on after moving `dy` px, rows being `rowH` px tall. */
export function dropIndex(from: number, dy: number, rowH: number, n: number): number {
  if (rowH <= 0 || n <= 0) return from;
  return Math.max(0, Math.min(n - 1, from + Math.round(dy / rowH)));
}

/** translateY (px) of row `i` while row `from` is dragged to `to`: rows in between shift by one row. */
export function shiftOf(i: number, from: number, to: number, rowH: number): number {
  if (i === from) return 0;
  if (from < to && i > from && i <= to) return -rowH;
  if (from > to && i < from && i >= to) return rowH;
  return 0;
}

/** Keeps the order a permutation of `ids`: unknown ids dropped, missing ones appended. */
export function normalizeOrder<T>(order: readonly T[], ids: readonly T[]): T[] {
  const set = new Set(ids);
  const seen = new Set<T>();
  const out: T[] = [];
  for (const x of order) if (set.has(x) && !seen.has(x)) { seen.add(x); out.push(x); }
  for (const x of ids) if (!seen.has(x)) out.push(x);
  return out;
}
