import { Show, createEffect, on, onCleanup, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
import { pushEsc } from "../lib/esc";
import { trackDialog } from "../state/ui";

const FOCUSABLE = 'button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Modal dialog (LS 6): 448 wide, r28, scrim 60 % (42 % on light, --scrim), focus trap, Enter submits, Esc cancels,
 * focus returns to the invoker. Opens with opacity + scale(.98 -> 1). Part of the Esc stack and of "dialog open" (plain keys off).
 */
export function Dialog(props: {
  open: boolean;
  title: string;
  onClose: () => void;
  /** Enter in a field (not on a button) */
  onSubmit?: () => void;
  children: JSX.Element;
  actions?: JSX.Element;
  testid?: string;
  width?: number;
}) {
  return (
    <Show when={props.open}>
      <Portal>
        <Inner {...props} />
      </Portal>
    </Show>
  );
}

function Inner(props: Parameters<typeof Dialog>[0]) {
  let card!: HTMLDivElement;
  const invoker = document.activeElement as HTMLElement | null;
  const id = `dlg-${Math.random().toString(36).slice(2, 8)}`;
  trackDialog(true);
  const popEsc = pushEsc(() => props.onClose());
  queueMicrotask(() => {
    const f = card.querySelector<HTMLElement>("[data-autofocus]") ?? card.querySelector<HTMLElement>("input,textarea") ?? card.querySelector<HTMLElement>(FOCUSABLE);
    (f ?? card).focus();
    if (f instanceof HTMLInputElement) f.select();
  });
  onCleanup(() => {
    popEsc();
    trackDialog(false);
    if (invoker && document.contains(invoker)) invoker.focus({ preventScroll: true });
  });
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Tab") {
      const els = [...card.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null);
      if (!els.length) return e.preventDefault();
      const first = els[0];
      const last = els[els.length - 1];
      const a = document.activeElement;
      if (e.shiftKey && (a === first || a === card)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && a === last) {
        e.preventDefault();
        first.focus();
      }
    } else if (e.key === "Enter" && props.onSubmit && !e.shiftKey && !(e.target instanceof HTMLButtonElement) && !(e.target instanceof HTMLTextAreaElement)) {
      e.preventDefault();
      props.onSubmit();
    }
  };
  return (
    <div
      class="dlg-scrim"
      data-testid="dialog-scrim"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div ref={card} class="dlg" role="dialog" aria-modal="true" aria-labelledby={id} tabindex="-1" data-testid={props.testid ?? "dialog"} style={props.width ? { width: props.width + "px" } : undefined} onKeyDown={onKey}>
        <div id={id} class="t20 w6 dlg-title">
          {props.title}
        </div>
        <div class="dlg-body">{props.children}</div>
        <Show when={props.actions}>
          <div class="dlg-actions">{props.actions}</div>
        </Show>
      </div>
    </div>
  );
}
