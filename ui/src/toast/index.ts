import { createSignal } from "solid-js";
import { ToastController, type ToastInput, type ToastItem } from "./controller";
import { client } from "../lib/core";

export type { ToastInput, ToastItem };

const [view, setView] = createSignal<{ current: ToastItem | null; leaving: boolean }>({ current: null, leaving: false });
const ctl = new ToastController(() => setView({ current: ctl.current, leaving: ctl.leaving }));
export const toastView = view;
export const pauseToast = () => ctl.pause();
export const resumeToast = () => ctl.resume();
export const dismissToast = () => ctl.dismiss();

/** toast({i18n | text, args, level, action?}): bottom-centre, 4 s, 1 visible + a queue of 3. */
export function toast(t: ToastInput): number {
  return ctl.push(t);
}

/** `app.toast {i18n, args?, level, action?:{label, m, p}}` events from the core (topic `app`). */
export function initToasts() {
  return client.sub("app", {}, (name, d) => {
    if (name !== "app.toast") return;
    const a = d.action as { label: string; m: string; p?: unknown } | undefined;
    toast({
      i18n: d.i18n,
      text: d.text,
      args: d.args,
      level: d.level === "error" ? "error" : "info",
      action: a ? { label: a.label, run: () => void client.call(a.m, a.p).catch(() => {}) } : undefined,
    });
  });
}
