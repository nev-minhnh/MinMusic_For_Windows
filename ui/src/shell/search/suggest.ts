// Pure helpers behind the title-bar search field: debounce + stale-answer handling, the Esc steps and the row list.
import type { Item } from "../../lib/types";

export const SUGGEST_DELAY_MS = 120;
export const MAX_ROWS = 8;

export type SuggestResult = { queries: string[]; items: Item[] };
export type SuggestRow = { kind: "query"; q: string } | { kind: "item"; item: Item } | { kind: "hist"; q: string };

/** At most 8 rows in total: queries first, then items. */
export function buildRows(r: SuggestResult): SuggestRow[] {
  const rows: SuggestRow[] = [...r.queries.map((q): SuggestRow => ({ kind: "query", q })), ...r.items.map((item): SuggestRow => ({ kind: "item", item }))];
  return rows.slice(0, MAX_ROWS);
}
export const historyRows = (items: string[]): SuggestRow[] => items.slice(0, MAX_ROWS).map((q): SuggestRow => ({ kind: "hist", q }));

/** Esc in the field, step by step (the third step, leaving the results, is the global back): clear the text, then blur. */
export function escStep(value: string): "clear" | "blur" {
  return value.length > 0 ? "clear" : "blur";
}

/**
 * Debounced `search.suggest`. Typing restarts the timer; a call that was superseded (the core answers `cancelled`, or a newer
 * call finished first) never reaches `onResult`. `cancel()` drops the timer and any answer still in flight.
 */
export function createSuggester(opts: {
  call: (q: string) => Promise<SuggestResult>;
  onResult: (q: string, r: SuggestResult) => void;
  isCancelled?: (e: unknown) => boolean;
  delay?: number;
}) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let seq = 0;
  const cancel = () => {
    clearTimeout(timer);
    timer = undefined;
    seq++;
  };
  const input = (q: string) => {
    cancel();
    const mine = seq;
    timer = setTimeout(() => {
      timer = undefined;
      opts
        .call(q)
        .then((r) => mine === seq && opts.onResult(q, r))
        .catch((e) => {
          if (!opts.isCancelled?.(e)) console.warn("search.suggest failed", e);
        });
    }, opts.delay ?? SUGGEST_DELAY_MS);
  };
  return { input, cancel };
}
