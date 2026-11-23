import { type JSX, Show, onCleanup, onMount } from "solid-js";
import { Portal } from "solid-js/web";
import { RpcError } from "@minmusic/protocol";
import { core } from "../../core/index";
import { client } from "../../lib/core";
import { pushEsc } from "../../lib/esc";
import { trackDialog } from "../../state/ui";
import { t } from "../../i18n";
import "./account.css";

/**
 * A call that carries a secret (password, cookie). It goes straight to the core client, so the dev-build call recorder
 * (`window.__mmCalls`, lib/core.ts) never holds the secret. Without a core (offline stub) it falls back to `client`.
 */
const REAL = !!(import.meta.env.VITE_MM_CORE || (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
export function callSecret<T = unknown>(method: string, params: object): Promise<T> {
  return REAL ? (core().call(method as never, params as never) as Promise<T>) : client.call<T>(method, params);
}

/** The error code only: never the message, which could echo what was sent. */
export function errCode(e: unknown): string {
  return e instanceof RpcError ? e.code : "internal";
}
/** Translated message for an error shown inline in a login dialog or row. */
export function errMsg(code: string): string {
  if (code === "unauthorized") return t("w2_acct_err_unauthorized");
  if (code === "network") return t("w2_acct_err_network");
  if (code === "bad_request") return t("w2_acct_err_bad");
  return t("w2_acct_err_other");
}

/** Switch (role=switch). Optimistic callers flip their own state in onChange. */
export function Switch(props: { on: boolean; label: string; onChange: (on: boolean) => void; disabled?: boolean; testid?: string }) {
  return (
    <button
      type="button"
      role="switch"
      class="sw"
      classList={{ on: props.on }}
      aria-checked={props.on}
      aria-label={props.label}
      disabled={props.disabled}
      data-testid={props.testid}
      onClick={() => props.onChange(!props.on)}
    >
      <i />
    </button>
  );
}

const FOCUSABLE = 'button:not([disabled]),input:not([disabled]),select,textarea,[href],[tabindex]:not([tabindex="-1"])';

/** Modal frame: 448 wide, r28, scrim, focus trap, Esc cancels, focus returns to the invoker (frontend-spec 5, 8). */
export function DialogFrame(props: { title: string; onClose: () => void; children: JSX.Element; testid?: string }) {
  let panel!: HTMLDivElement;
  const invoker = document.activeElement as HTMLElement | null;
  const offEsc = pushEsc(() => props.onClose());
  onMount(() => {
    trackDialog(true);
    (panel.querySelector<HTMLElement>("[data-autofocus]") ?? panel.querySelector<HTMLElement>(FOCUSABLE))?.focus();
  });
  onCleanup(() => {
    offEsc();
    trackDialog(false);
    invoker?.focus?.({ preventScroll: true });
  });
  const trap = (e: KeyboardEvent) => {
    if (e.key !== "Tab") return;
    const f = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0]!;
    const last = f[f.length - 1]!;
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  return (
    <Portal>
      <div class="dlg-scrim" onPointerDown={(e) => e.target === e.currentTarget && props.onClose()}>
        <div ref={panel} class="dlg" role="dialog" aria-modal="true" aria-label={props.title} data-testid={props.testid} onKeyDown={trap}>
          <div class="t20 w6 dlg-t">{props.title}</div>
          {props.children}
        </div>
      </div>
    </Portal>
  );
}

export type Field = {
  key: string;
  label: string;
  /** masked, never kept in state, cleared after every submit */
  secret?: boolean;
  optional?: boolean;
  autocomplete?: string;
  /** returns a translated message when the (non-empty) value is invalid */
  check?: (v: string) => string | undefined;
  placeholder?: string;
};

/**
 * The login form shared by NCT, Last.fm and token login. Inputs are uncontrolled: the value is read once at submit, secret
 * inputs are emptied in the same tick (before the call), so no signal, store, log or DOM node keeps a password.
 */
export function CredentialDialog(props: {
  title: string;
  hint?: string;
  fields: Field[];
  submitLabel: string;
  /** receives every field value by key; throws an RpcError on failure */
  submit: (v: Record<string, string>) => unknown;
  onClose: () => void;
  onDone?: () => void;
  testid: string;
}) {
  const refs: Record<string, HTMLInputElement> = {};
  let busy = false;
  let errEl!: HTMLDivElement;
  let btn!: HTMLButtonElement;
  const showErr = (msg: string | null, field?: string) => {
    errEl.textContent = msg ?? "";
    errEl.hidden = !msg;
    for (const f of props.fields) refs[f.key]?.toggleAttribute("aria-invalid", f.key === field && !!msg);
  };
  const clearSecrets = () => {
    for (const f of props.fields) if (f.secret && refs[f.key]) refs[f.key]!.value = "";
  };
  onCleanup(clearSecrets);

  async function onSubmit(e: Event) {
    e.preventDefault();
    if (busy) return;
    const vals: Record<string, string> = {};
    for (const f of props.fields) vals[f.key] = f.secret ? refs[f.key]!.value : refs[f.key]!.value.trim();
    for (const f of props.fields) {
      const v = vals[f.key]!;
      const bad = !v && !f.optional ? t("w2_acct_err_required") : v ? f.check?.(v) : undefined;
      if (bad) {
        showErr(bad, f.key);
        refs[f.key]!.focus();
        for (const k of Object.keys(vals)) vals[k] = "";
        return;
      }
    }
    clearSecrets(); // before the call: the field is empty while the request is in flight
    busy = true;
    btn.disabled = true;
    btn.setAttribute("aria-busy", "true");
    showErr(null);
    try {
      await props.submit(vals);
      busy = false;
      props.onDone?.();
      props.onClose();
    } catch (err) {
      busy = false;
      btn.disabled = false;
      btn.removeAttribute("aria-busy");
      showErr(errMsg(errCode(err)));
      clearSecrets();
      (props.fields.find((f) => f.secret) ? refs[props.fields.find((f) => f.secret)!.key] : refs[props.fields[0]!.key])?.focus();
    } finally {
      for (const k of Object.keys(vals)) vals[k] = "";
    }
  }

  return (
    <DialogFrame title={props.title} onClose={props.onClose} testid={props.testid}>
      <form class="col gap16" onSubmit={onSubmit} autocomplete="off" novalidate>
        <Show when={props.hint}>
          <div class="t14 i2">{props.hint}</div>
        </Show>
        {props.fields.map((f, i) => (
          <label class="fld">
            <span class="t12 i2">{f.label}</span>
            <input
              ref={(el) => (refs[f.key] = el)}
              type={f.secret ? "password" : "text"}
              name={f.key}
              autocomplete={f.secret ? "new-password" : (f.autocomplete ?? "off")}
              autocapitalize="off"
              spellcheck={false}
              placeholder={f.placeholder}
              data-autofocus={i === 0 ? "" : undefined}
              data-testid={`fld-${f.key}`}
              onInput={() => errEl.hidden || showErr(null)}
            />
          </label>
        ))}
        <div ref={errEl} class="dlg-err t14" role="alert" hidden data-testid="dlg-error" />
        <div class="row gap8" style={{ "justify-content": "flex-end", "margin-top": "8px" }}>
          <button type="button" class="btn txt" onClick={() => props.onClose()} data-testid="dlg-cancel">
            {t("w2_acct_cancel")}
          </button>
          <button ref={btn} type="submit" class="btn pri" data-testid="dlg-submit">
            {props.submitLabel}
          </button>
        </div>
      </form>
    </DialogFrame>
  );
}
