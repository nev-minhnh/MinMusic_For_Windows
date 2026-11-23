import { For, Show, createMemo } from "solid-js";
import { Icon } from "../Icon";
import { IconButton } from "../IconButton";
import { QualityBadge } from "../Badge";
import { t } from "../../i18n";
import { navigate } from "../../router/router";
import { batchRatio, chooseFolder, downloadSummary, fmtBytes, folderErrorText, queueIds, queueItem, qualityBars, togglePause, useDownloads } from "../../state/downloads";
import { toast } from "../../toast";
import "./downloads.css";

/** The file being downloaded right now: fine-grained, only this line follows the 2 Hz progress. */
function CurrentFile() {
  const cur = createMemo(() => queueIds().map((id) => queueItem(id)).find((i) => i?.state === "downloading"));
  return (
    <Show when={cur()}>
      {(i) => (
        <div class="t12 i3 num" style={{ "margin-top": "6px" }} data-testid="dl-current">
          {t("w2_dl_file", i().title, `${fmtBytes(i().bytes ?? 0)} / ${fmtBytes(Math.round((i().bytes ?? 0) / Math.max(0.01, i().progress)))}`)}
        </div>
      )}
    </Show>
  );
}

/**
 * Library "Đã tải" box (MK 4): count and size, quality distribution (scaleX bars), folder with the unplugged-drive warning,
 * active progress with pause / resume. Mounted by pages/Library (one line at INT-W4).
 */
export function DownloadsBox() {
  useDownloads();
  const s = downloadSummary;
  const bars = createMemo(() => qualityBars(s()?.byQuality ?? [], 4, t("w2_dlx_other")));
  const active = () => (s() && s()!.active.total > 0 ? s()!.active : null);
  const changeFolder = async () => {
    const r = await chooseFolder();
    if (r && !r.ok) toast({ text: folderErrorText(r.error), level: "error" });
  };
  return (
    <div class="box dl-box dlx-box" data-testid="dl-box">
      <div>
        <div class="dlx-head">
          <IconButton icon="dl" label={t("w2_downloads")} tonal onClick={() => navigate("downloads")} />
          <div class="f1">
            <div class="dlx-title" data-testid="dl-box-summary">{t("w2_dl_summary", s()?.count ?? 0, fmtBytes(s()?.bytes ?? 0))}</div>
          </div>
        </div>
        <div class="dlx-bars" data-testid="dl-box-bars">
          <For each={bars()}>
            {(b) => (
              <div class="dlx-qrow" data-label={b.label}>
                <span class="row t12" style={{ gap: "6px" }}>
                  <QualityBadge q={{ label: b.label, lossless: b.lossless }} />
                </span>
                <div class="dlx-track" aria-hidden="true">
                  <div class="dlx-fill" classList={{ ll: b.lossless }} style={{ "--s": String(b.share) }} data-share={b.share.toFixed(3)} />
                </div>
                <span class="num t12 i2 dlx-count">{b.count}</span>
              </div>
            )}
          </For>
        </div>
        <div class="dlx-folder t12" data-testid="dl-box-folder">
          <Show
            when={s()?.folderOk !== false}
            fallback={
              <span class="dlx-warn" data-testid="dl-folder-warn">
                <Icon n="dlx_warn" s={16} />
                {t("w2_dlx_folder_missing")}
              </span>
            }
          >
            <Icon n="dlx_folder" s={16} />
          </Show>
          <span class="dlx-path i3 f1" title={s()?.folder}>{s()?.folder}</span>
          <button type="button" class="dlx-link" data-testid="dl-change-folder" onClick={changeFolder}>{t("w2_change_folder")}</button>
        </div>
      </div>
      <div class="dl-sep" />
      <div data-testid="dl-box-active">
        <Show
          when={active()}
          fallback={
            <div class="dlx-idle">
              <div class="i2">{t("w2_dlx_idle")}</div>
              <button type="button" class="dlx-link" onClick={() => navigate("downloads")}>{t("w2_dlx_open_page")}</button>
            </div>
          }
        >
          {(a) => (
            <>
              <div class="row">
                <div class="f1 w6 ell" data-testid="dl-progress-text">{t("w2_dl_progress", Math.min(a().total, a().done + 1), a().total, a().label ?? "")}</div>
                <button type="button" class="btn txt sm" data-testid="dl-pause" onClick={() => void togglePause()}>{s()?.paused ? t("w2_dlx_resume") : t("w2_pause")}</button>
              </div>
              <div class="dlx-prog" role="progressbar" aria-valuemin={0} aria-valuemax={a().total} aria-valuenow={a().done} aria-label={t("w2_downloads")}>
                <div class="dlx-fill" style={{ "--s": String(batchRatio(a())) }} />
              </div>
              <CurrentFile />
            </>
          )}
        </Show>
      </div>
    </div>
  );
}
