export type ToastAction = { label: string; run?: () => void; m?: string; p?: unknown };
export type ToastInput = { i18n?: string; text?: string; args?: unknown[]; level?: "info" | "error"; action?: ToastAction };
export type ToastItem = ToastInput & { id: number };

export const TOAST_MS = 4000;
export const TOAST_OUT_MS = 160;
export const MAX_QUEUE = 3;

/**
 * Toast state machine: one visible toast plus a queue of at most 3 (the oldest queued toast is dropped when it is full),
 * 4 s on screen, the countdown pauses while the pointer is over the toast. No Solid here, so it is unit tested with fake timers.
 */
export class ToastController {
  current: ToastItem | null = null;
  leaving = false;
  queue: ToastItem[] = [];
  private seq = 0;
  private timer = 0;
  private left = TOAST_MS;
  private startedAt = 0;
  constructor(private onChange: () => void = () => {}) {}

  push(t: ToastInput): number {
    const item: ToastItem = { ...t, id: ++this.seq };
    if (!this.current) this.show(item);
    else {
      if (this.queue.length >= MAX_QUEUE) this.queue.shift();
      this.queue.push(item);
    }
    this.onChange();
    return item.id;
  }
  private show(item: ToastItem) {
    this.current = item;
    this.leaving = false;
    this.left = TOAST_MS;
    this.arm();
  }
  private arm() {
    clearTimeout(this.timer);
    this.startedAt = Date.now();
    this.timer = setTimeout(() => this.dismiss(), this.left) as unknown as number;
  }
  pause() {
    if (!this.current || this.leaving) return;
    clearTimeout(this.timer);
    this.left = Math.max(0, this.left - (Date.now() - this.startedAt));
  }
  resume() {
    if (!this.current || this.leaving) return;
    this.arm();
  }
  /** start the exit fade, then show the next queued toast */
  dismiss() {
    if (!this.current || this.leaving) return;
    clearTimeout(this.timer);
    this.leaving = true;
    this.onChange();
    this.timer = setTimeout(() => {
      const next = this.queue.shift();
      this.current = null;
      this.leaving = false;
      if (next) this.show(next);
      this.onChange();
    }, TOAST_OUT_MS) as unknown as number;
  }
}
