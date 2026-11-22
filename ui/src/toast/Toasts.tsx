import { Show } from "solid-js";
import { t } from "../i18n";
import { toastView, pauseToast, resumeToast, dismissToast } from "./index";

/** Toast host. Always mounted so the polite live region is announced reliably; the toast itself only fades and moves on transform. */
export function Toasts() {
  return (
    <div class="toast-host" aria-live="polite" role="status" data-testid="toast-host">
      <Show when={toastView().current} keyed>
        {(it) => (
          <div class="toast" classList={{ out: toastView().leaving, err: it.level === "error" }} data-testid="toast" onPointerEnter={pauseToast} onPointerLeave={resumeToast}>
            <span class="toast-t">{it.text ?? t(it.i18n ?? "", ...(it.args ?? []))}</span>
            <Show when={it.action}>
              {(a) => (
                <button
                  type="button"
                  class="btn txt sm"
                  onClick={() => {
                    a().run?.();
                    dismissToast();
                  }}
                >
                  {t(a().label)}
                </button>
              )}
            </Show>
          </div>
        )}
      </Show>
    </div>
  );
}
