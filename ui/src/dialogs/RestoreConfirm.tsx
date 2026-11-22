import { Show, createSignal } from "solid-js";
import { Dialog } from "./Dialog";
import { mountOnce } from "./m4-3b-host";
import { locale, t } from "../i18n";
import { fmtWhen, restoreGate, type Inspect } from "../pages/Settings/Backup/logic";
import "./m4-3b.css";

type Pending = { info: Inspect; file: string; resolve: (ok: boolean) => void };
const [pending, setPending] = createSignal<Pending | null>(null);

/** Restore confirmation (platform, database version, creation time). Resolves true only when the user confirms AND the file passed the gate. */
export function confirmRestore(info: Inspect, file: string): Promise<boolean> {
  mountOnce("restore-confirm", () => <RestoreConfirmHost />);
  pending()?.resolve(false);
  return new Promise((resolve) => setPending({ info, file, resolve }));
}

const platformLabel = (p: string) => {
  const k = p.toLowerCase();
  if (k === "android") return t("w2_bk_platform_android");
  if (k === "desktop-v1") return t("w2_bk_platform_v1");
  if (k === "desktop") return t("w2_bk_platform_desktop");
  return p;
};

function RestoreConfirmHost() {
  const done = (ok: boolean) => {
    const p = pending();
    setPending(null);
    p?.resolve(ok);
  };
  const gate = () => (pending() ? restoreGate(pending()!.info) : { allow: false as const, reason: "invalid" as const });
  return (
    <Dialog
      open={!!pending()}
      title={t("w2_bk_restore_title")}
      onClose={() => done(false)}
      onSubmit={() => done(gate().allow)}
      testid="restore-confirm"
      actions={
        <>
          <button type="button" class="btn txt" attr:data-autofocus={gate().allow ? undefined : ""} data-testid="restore-cancel" onClick={() => done(false)}>
            {t("w2_cancel")}
          </button>
          <button type="button" class="btn danger" classList={{ dis: !gate().allow }} disabled={!gate().allow} attr:data-autofocus={gate().allow ? "" : undefined} data-testid="restore-ok" onClick={() => done(true)}>
            {t("w2_bk_restore_ok")}
          </button>
        </>
      }
    >
      <Show when={pending()}>
        {(p) => (
          <>
            <div class="i2 m3-file" title={p().file}>{p().file}</div>
            <dl class="m3-facts" data-testid="restore-facts">
              <dt class="i3">{t("w2_bk_platform")}</dt>
              <dd data-testid="restore-platform">{platformLabel(p().info.platform)}</dd>
              <dt class="i3">{t("w2_bk_dbversion")}</dt>
              <dd class="num" data-testid="restore-dbversion">{p().info.dbVersion}</dd>
              <dt class="i3">{t("w2_bk_created")}</dt>
              <dd data-testid="restore-created">{fmtWhen(p().info.createdAt, locale())}</dd>
            </dl>
            <Show
              when={gate().allow}
              fallback={
                <div class="m3-warn err" data-testid="restore-blocked">
                  {(gate() as { reason: string }).reason === "android" ? t("w2_bk_android_hint") : p().info.error ?? t("w2_bk_invalid")}
                </div>
              }
            >
              <div class="m3-warn" data-testid="restore-warning">{t("w2_bk_restore_warn")}</div>
            </Show>
          </>
        )}
      </Show>
    </Dialog>
  );
}
