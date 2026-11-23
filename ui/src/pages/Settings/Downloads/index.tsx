import { For, Show, createSignal } from "solid-js";
import { Icon } from "../../../components/Icon";
import { t } from "../../../i18n";
import { settingsReady } from "../../../state/settings";
import {
  QUALITY_CHOICES, chooseFolder, downloadQuality, downloadSummary, folderErrorText, setDownloadFolder, setDownloadQuality, useDownloads, type FolderResult,
} from "../../../state/downloads";
import type { GroupDef } from "../layout";
import { SettingGroup } from "../RowList";
import "../rows.css";
import "../../../components/downloads/downloads.css";

export const category = { key: "Downloads", order: 35, icon: "download", titleKey: "w2_set_cat_downloads" };
/** the string scanner only sees literal keys: this keeps the category title in en/vi.json */
export const titleScan = { i18n: "w2_set_cat_downloads" };

/** Related schema keys (api.md 3.10) that the desktop shows on this page. */
const autoGroup: GroupDef = {
  id: "dl-auto",
  title: () => t("w2_dlx_g_auto"),
  rows: [
    { key: "autoDownloadOnLike", label: () => t("w2_dlx_set_autoDownloadOnLike") },
    { key: "autoDownloadSavedCollections", label: () => t("w2_dlx_set_autoDownloadSavedCollections") },
  ],
};

const qLabel = (q: string) => (q === "best" ? t("w2_dlx_best") : q);

/** Folder row: path, unplugged-drive warning, "Chọn thư mục…" (native dialog -> download.setFolder), "Mặc định" (null). Errors show inline. */
function FolderRow() {
  const s = downloadSummary;
  const [err, setErr] = createSignal<FolderResult["error"] | "generic" | undefined>(undefined);
  const apply = (r: FolderResult | null) => {
    if (!r) return;
    setErr(r.ok ? undefined : r.error ?? "generic");
  };
  return (
    <div class="dlx-fold" data-testid="dl-folder-row">
      <div class="sr-name">{t("w2_dlx_folder")}</div>
      <div class="dlx-fold-row">
        <Show when={s()?.folderOk === false} fallback={<Icon n="dlx_folder" s={16} />}>
          <span class="dlx-warn" data-testid="dl-set-warn">
            <Icon n="dlx_warn" s={16} />
          </span>
        </Show>
        <span class="dlx-path f1 t14" data-testid="dl-set-path" title={s()?.folder}>{s()?.folder ?? ""}</span>
        <button type="button" class="sr-btn acc-btn" data-testid="dl-set-pick" onClick={async () => apply(await chooseFolder())}>{t("w2_dlx_pick")}</button>
        <button type="button" class="sr-btn" data-testid="dl-set-default" onClick={async () => apply(await setDownloadFolder(null))}>{t("w2_dlx_default")}</button>
      </div>
      <Show when={s()?.folderOk === false && !err()}>
        <div class="t12 dlx-fold-err" role="alert">{t("w2_dlx_folder_missing")}</div>
      </Show>
      <Show when={err()}>
        <div class="t12 dlx-fold-err" role="alert" data-testid="dl-set-error" data-error={err()}>
          {folderErrorText(err() === "generic" ? undefined : (err() as FolderResult["error"]))}
        </div>
      </Show>
    </div>
  );
}

/** Settings > Tải xuống: folder, default quality, auto-download keys. */
export default function DownloadsSettings() {
  useDownloads();
  return (
    <div class="sr-page" data-testid="set-page" data-page="Downloads">
      <section class="sr-group" data-testid="set-group" data-group="dl-folder">
        <h2 class="ovl sr-title">{t("w2_dlx_g_folder")}</h2>
        <div class="box sr-box">
          <FolderRow />
        </div>
      </section>
      <section class="sr-group" data-testid="set-group" data-group="dl-quality">
        <h2 class="ovl sr-title">{t("w2_dlx_g_quality")}</h2>
        <div class="box sr-box">
          <div class="sr-row" data-testid="dl-quality-row">
            <div class="sr-lbl">
              <span class="sr-name">{t("w2_dlx_quality_default")}</span>
              <span class="t12 i3">{t("w2_dlx_quality_note")}</span>
            </div>
            <div class="sr-ctl">
              <select class="sr-sel" aria-label={t("w2_dlx_quality_default")} data-testid="dl-quality-select" value={downloadQuality()} onChange={(e) => setDownloadQuality(e.currentTarget.value)}>
                <For each={QUALITY_CHOICES as readonly string[]}>{(q) => <option value={q} selected={downloadQuality() === q}>{qLabel(q)}</option>}</For>
              </select>
            </div>
          </div>
        </div>
      </section>
      <Show when={settingsReady()} fallback={<div class="i3">{t("w2_set_loading")}</div>}>
        <SettingGroup group={autoGroup} />
      </Show>
    </div>
  );
}
