import { onCleanup, onMount, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
import { pushEsc } from "../../lib/esc";
import { trackDialog } from "../../state/ui";

/** Modal 448 wide, r28, scrim 60 % (42 % light), focus trap, Enter submits, Esc cancels (frontend-spec 5 Dialogs). */
export function Dialog(props: { title: string; onClose: () => void; onSubmit?: () => void; actions: JSX.Element; children: JSX.Element; testid?: string }) {
  let box!: HTMLDivElement;
  let prev: Element | null = null;
  onMount(() => {
    prev = document.activeElement;
    trackDialog(true);
    const off = pushEsc(props.onClose);
    (box.querySelector<HTMLElement>("input, select, button.eqp-pri") ?? box).focus();
    onCleanup(() => {
      off();
      trackDialog(false);
      (prev as HTMLElement | null)?.focus?.({ preventScroll: true });
    });
  });
  function onKey(e: KeyboardEvent) {
    if (e.key === "Tab") {
      const f = [...box.querySelectorAll<HTMLElement>("input, select, button:not([disabled]), [tabindex='0']")].filter((x) => x.offsetParent !== null);
      if (!f.length) return;
      const first = f[0]!, last = f[f.length - 1]!;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    } else if (e.key === "Enter" && props.onSubmit && (e.target as HTMLElement).tagName !== "BUTTON" && (e.target as HTMLElement).tagName !== "SELECT") {
      e.preventDefault();
      props.onSubmit();
    }
  }
  return (
    <Portal>
      <div class="eqp-scrim" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
        <div ref={box} class="eqp-dlg" role="dialog" aria-modal="true" aria-label={props.title} tabindex="-1" data-testid={props.testid} onKeyDown={onKey}>
          <div class="t20 w6">{props.title}</div>
          <div class="eqp-dlg-body">{props.children}</div>
          <div class="eqp-dlg-act">{props.actions}</div>
        </div>
      </div>
    </Portal>
  );
}
