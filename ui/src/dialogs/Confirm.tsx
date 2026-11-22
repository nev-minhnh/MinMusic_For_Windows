import { createSignal } from "solid-js";
import { Dialog } from "./Dialog";
import { t } from "../i18n";

export type ConfirmOpts = { title: string; body?: string; danger?: boolean; okLabel?: string; cancelLabel?: string };
type Pending = { opts: ConfirmOpts; resolve: (ok: boolean) => void };

const [pending, setPending] = createSignal<Pending | null>(null);

/** confirm({title, body, danger}) -> true when confirmed. A second call while one is open resolves the first with false. */
export function confirm(opts: ConfirmOpts): Promise<boolean> {
  pending()?.resolve(false);
  return new Promise((resolve) => setPending({ opts, resolve }));
}

export function ConfirmHost() {
  const done = (ok: boolean) => {
    const p = pending();
    setPending(null);
    p?.resolve(ok);
  };
  return (
    <Dialog
      open={!!pending()}
      title={pending()?.opts.title ?? ""}
      onClose={() => done(false)}
      onSubmit={() => done(true)}
      testid="confirm-dialog"
      actions={
        <>
          <button type="button" class="btn txt" onClick={() => done(false)}>
            {pending()?.opts.cancelLabel ?? t("w2_cancel")}
          </button>
          <button type="button" class="btn" classList={{ pri: !pending()?.opts.danger, danger: pending()?.opts.danger }} data-autofocus data-testid="confirm-ok" onClick={() => done(true)}>
            {pending()?.opts.okLabel ?? t("w2_ok")}
          </button>
        </>
      }
    >
      <div class="i2">{pending()?.opts.body}</div>
    </Dialog>
  );
}
