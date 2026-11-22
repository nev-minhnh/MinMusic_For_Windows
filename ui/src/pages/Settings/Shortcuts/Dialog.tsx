import { Show, createEffect, createSignal, onCleanup } from "solid-js";
import { render } from "solid-js/web";
import { Icon } from "../../../components/Icon";
import { pushEsc } from "../../../lib/esc";
import { t } from "../../../i18n";
import { trackDialog } from "../../../state/ui";
import { ShortcutTable } from "./Table";

const [open, setOpen] = createSignal(false);
export const shortcutsOpen = open;
export const closeShortcuts = () => setOpen(false);

function Dialog() {
  let box!: HTMLDivElement;
  let invoker: Element | null = null;
  createEffect(() => {
    if (!open()) return;
    invoker = document.activeElement;
    trackDialog(true);
    const off = pushEsc(closeShortcuts);
    queueMicrotask(() => box?.focus());
    onCleanup(() => {
      off();
      trackDialog(false);
      (invoker as HTMLElement | null)?.focus?.();
    });
  });
  // focus stays inside the dialog
  const trap = (e: KeyboardEvent) => {
    if (e.key !== "Tab") return;
    const f = [...box.querySelectorAll<HTMLElement>("button,[tabindex]")].filter((x) => x.tabIndex >= 0);
    if (!f.length) { e.preventDefault(); return; }
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === box)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  return (
    <Show when={open()}>
      <div class="dlg-scrim" data-testid="shortcuts-dialog" onMouseDown={(e) => e.target === e.currentTarget && closeShortcuts()}>
        <div ref={box} class="dlg-box" role="dialog" aria-modal="true" aria-label={t("w2_sc_title")} tabindex="-1" onKeyDown={trap}>
          <div class="dlg-head">
            <div class="t20 w6 f1">{t("w2_sc_title")}</div>
            <button type="button" class="ib" aria-label={t("w2_sc_close")} onClick={closeShortcuts}><Icon n="close" s={20} /></button>
          </div>
          <div class="dlg-body"><ShortcutTable /></div>
        </div>
      </div>
    </Show>
  );
}

let mounted = false;
/** Ctrl ` / Ctrl /: opens the sheet as a dialog. The host is created on first use (the app shell does not mount it). */
export function openShortcuts() {
  if (!mounted) {
    mounted = true;
    const host = document.createElement("div");
    host.dataset.host = "shortcuts";
    document.body.appendChild(host);
    render(() => <Dialog />, host);
  }
  setOpen(true);
}
