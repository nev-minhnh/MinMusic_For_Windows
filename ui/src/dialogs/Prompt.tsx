import { createSignal } from "solid-js";
import { Dialog } from "./Dialog";
import { t } from "../i18n";

export type PromptOpts = { title: string; label: string; value?: string; okLabel?: string };
type Pending = { opts: PromptOpts; resolve: (v: string | null) => void };

const [pending, setPending] = createSignal<Pending | null>(null);
const [text, setText] = createSignal("");

/** prompt({title, label, value}) -> the trimmed text, or null when cancelled (create / rename album). */
export function prompt(opts: PromptOpts): Promise<string | null> {
  pending()?.resolve(null);
  setText(opts.value ?? "");
  return new Promise((resolve) => setPending({ opts, resolve }));
}

export function PromptHost() {
  const done = (ok: boolean) => {
    const p = pending();
    if (!p) return;
    const v = text().trim();
    if (ok && !v) return; // empty name: stay open
    setPending(null);
    p.resolve(ok ? v : null);
  };
  return (
    <Dialog
      open={!!pending()}
      title={pending()?.opts.title ?? ""}
      onClose={() => done(false)}
      onSubmit={() => done(true)}
      testid="prompt-dialog"
      actions={
        <>
          <button type="button" class="btn txt" onClick={() => done(false)}>
            {t("w2_cancel")}
          </button>
          <button type="button" class="btn pri" classList={{ dis: !text().trim() }} data-testid="prompt-ok" onClick={() => done(true)}>
            {pending()?.opts.okLabel ?? t("w2_ok")}
          </button>
        </>
      }
    >
      <label class="fld">
        <span class="t12 i3">{pending()?.opts.label}</span>
        <input class="fld-in" type="text" value={text()} onInput={(e) => setText(e.currentTarget.value)} data-testid="prompt-input" data-autofocus maxlength={120} />
      </label>
    </Dialog>
  );
}
