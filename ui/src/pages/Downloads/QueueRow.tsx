import { Show } from "solid-js";
import { Art } from "../../components/Art";
import { IconButton } from "../../components/IconButton";
import { artistsText } from "../../lib/format";
import { t } from "../../i18n";
import { cancelOne, downloadSummary, fmtBytes, queueItem, retryOne } from "../../state/downloads";

const KNOWN_ERRORS: Record<string, () => string> = {
  network: () => t("w2_dlx_e_network"),
  disk_full: () => t("w2_dlx_e_disk_full"),
  not_writable: () => t("w2_dlx_e_not_writable"),
  not_found: () => t("w2_dlx_e_not_found"),
  unavailable: () => t("w2_dlx_e_unavailable"),
};
export const errorText = (e?: string) => (e && KNOWN_ERRORS[e] ? KNOWN_ERRORS[e]!() : e || t("w2_error_generic"));

/**
 * One queue row (56). It reads its own item from the store, so a 2 Hz progress tick re-runs only the three bindings below
 * (fill transform, percent text, bytes), never the list. The bar is a scaleX transform.
 */
export function QueueRow(props: { id: () => string | undefined }) {
  const it = () => (props.id() ? queueItem(props.id()!) : undefined);
  const stateLabel = () => {
    const s = it()?.state;
    if (s === "downloading") return downloadSummary()?.paused ? t("w2_dlx_s_paused") : t("w2_dlx_s_downloading");
    if (s === "failed") return t("w2_dlx_s_failed");
    return t("w2_dlx_s_queued");
  };
  return (
    <Show when={it()}>
      {(i) => (
        <div class={`dlx-qr ${i().state}`} role="row" data-testid="dl-qrow" data-id={i().id} data-state={i().state}>
          <div class="dlx-qm">
            <Art art={i().art} size={40} />
            <div class="t">
              <div class="ell w6">{i().title}</div>
              <div class="ell t12 i3">{artistsText(i().artists)}</div>
            </div>
          </div>
          <div class="dlx-qs">
            <div class="st t12">
              <span class="i2" data-testid="dl-qstate">{stateLabel()}</span>
              <span class="num i3" data-testid="dl-qpct">{`${Math.round(i().progress * 100)}%`}</span>
            </div>
            <div class="dlx-track" aria-hidden="true">
              <div class="dlx-fill" style={{ "--s": String(i().progress) }} data-testid="dl-qfill" />
            </div>
            <Show when={i().state === "failed"}>
              <div class="err t12 ell" data-testid="dl-qerr" title={errorText(i().error)}>{errorText(i().error)}</div>
            </Show>
            <Show when={i().state === "downloading" && i().bytes}>
              <div class="t12 i3 num ell">{fmtBytes(i().bytes ?? 0)}</div>
            </Show>
          </div>
          <div class="dlx-qa">
            <Show when={i().state === "failed"}>
              <IconButton icon="dlx_refresh" label={t("w2_dlx_retry")} size={32} testid="dl-qretry" onClick={() => void retryOne(i().id)} />
            </Show>
            <IconButton icon="close" label={t("w2_dlx_cancel_one")} size={32} testid="dl-qcancel" onClick={() => void cancelOne(i().id)} />
          </div>
        </div>
      )}
    </Show>
  );
}
