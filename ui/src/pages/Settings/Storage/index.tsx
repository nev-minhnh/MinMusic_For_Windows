import { For, Show, createMemo, onMount } from "solid-js";
import { t } from "../../../i18n";
import { entryOf, isDesktopKey, setSetting, settingValue, settingsReady } from "../../../state/settings";
import { SettingGroup } from "../RowList";
import {
  CACHE_NAME, clearCache, fmtBytes, refreshUsage, storageUsage, usageRatio, useDownloads, type CacheKind,
} from "../../../state/downloads";
import { navigate } from "../../../router/router";
import type { GroupDef } from "../layout";
import "../rows.css";
import "../../../components/downloads/downloads.css";

export const category = { key: "Storage", order: 70, icon: "dlx_storage", titleKey: "w2_set_cat_storage" };
/** the string scanner only sees literal keys: this keeps the category title in en/vi.json */
export const titleScan = { i18n: "w2_set_cat_storage" };

const CACHES: CacheKind[] = ["songCache", "imageCache", "videoCache", "animatedArt"];
const MB = 1024 * 1024;
/** limits the schema keys offer, in MB */
const LIMIT_STEPS = [128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536];

const switchGroup: GroupDef = {
  id: "st-cache",
  title: () => t("w2_dlx_g_cache"),
  rows: [{ key: "songCacheEnabled", label: () => t("w2_dlx_set_songCacheEnabled") }],
};

/** A cache-size limit in MB (maxSongCacheSize / maxImageCacheSize): a preset list, the current value is always an option. */
function LimitRow(props: { k: string; label: () => string }) {
  const cur = () => Number(settingValue(props.k) ?? 0);
  const opts = () => (LIMIT_STEPS.includes(cur()) ? LIMIT_STEPS : [...LIMIT_STEPS, cur()].sort((a, b) => a - b));
  const text = (mb: number) => fmtBytes(mb * MB);
  return (
    <Show when={entryOf(props.k) && isDesktopKey(props.k)}>
      <div class="sr-row" data-testid="set-row" data-setting={props.k} data-kind="select">
        <div class="sr-lbl">
          <span class="sr-name">{props.label()}</span>
        </div>
        <div class="sr-ctl">
          <select class="sr-sel" aria-label={props.label()} value={String(cur())} onChange={(e) => void setSetting(props.k, Number(e.currentTarget.value))}>
            <For each={opts()}>{(mb) => <option value={String(mb)} selected={cur() === mb}>{text(mb)}</option>}</For>
          </select>
        </div>
      </div>
    </Show>
  );
}

/** One bar row: name, used (of the limit), clear button; the bar is a scaleX transform. */
function UsageRow(props: { what: CacheKind; used: number; limit?: number; total: number }) {
  return (
    <div class="dlx-sr" data-testid="st-row" data-cache={props.what}>
      <div>
        <div class="nm">{CACHE_NAME[props.what]()}</div>
        <div class="t12 i3 num" data-testid="st-used">
          {props.limit ? t("w2_dlx_used_of", fmtBytes(props.used), fmtBytes(props.limit)) : fmtBytes(props.used)}
        </div>
      </div>
      <button type="button" class="sr-btn" data-testid="st-clear" disabled={props.used <= 0} onClick={() => void clearCache(props.what)}>{t("w2_dlx_clear")}</button>
      <div class="dlx-track" aria-hidden="true">
        <div class="dlx-fill" style={{ "--s": String(usageRatio(props.used, props.limit, props.total)) }} data-testid="st-fill" />
      </div>
    </div>
  );
}

/** Settings > Bộ nhớ và bộ đệm: storage.usage bars with limits, clear buttons (storage.clear, confirm), cache settings. */
export default function StorageSettings() {
  useDownloads();
  onMount(() => void refreshUsage());
  const u = storageUsage;
  const total = createMemo(() => (u() ? u()!.songCache + u()!.imageCache + u()!.videoCache + u()!.animatedArt + u()!.downloads : 0));
  return (
    <div class="sr-page" data-testid="set-page" data-page="Storage">
      <section class="sr-group" data-testid="set-group" data-group="st-usage">
        <h2 class="ovl sr-title">{t("w2_dlx_g_usage")}</h2>
        <div class="box sr-box">
          <Show when={u()} fallback={<div class="dlx-sum i3">{t("w2_set_loading")}</div>}>
            {(x) => (
              <>
                <div class="dlx-sum">
                  <span class="t20 w6 num" data-testid="st-total">{fmtBytes(total())}</span>
                  <span class="i3 t12">{t("w2_dlx_total")}</span>
                </div>
                <For each={CACHES}>{(c) => <UsageRow what={c} used={x()[c]} limit={c === "animatedArt" ? undefined : x().limits?.[c]} total={total()} />}</For>
                <div class="dlx-sr" data-testid="st-row" data-cache="downloads">
                  <div>
                    <div class="nm">{CACHE_NAME.downloads()}</div>
                    <div class="t12 i3 num" data-testid="st-used">{fmtBytes(x().downloads)}</div>
                  </div>
                  <button type="button" class="sr-btn" data-testid="st-open-downloads" onClick={() => navigate("downloads")}>{t("w2_dlx_manage")}</button>
                  <div class="dlx-track" aria-hidden="true">
                    <div class="dlx-fill" style={{ "--s": String(usageRatio(x().downloads, undefined, total())) }} />
                  </div>
                </div>
              </>
            )}
          </Show>
        </div>
      </section>
      <Show when={settingsReady()} fallback={<div class="i3">{t("w2_set_loading")}</div>}>
        <SettingGroup group={switchGroup} />
        <section class="sr-group" data-testid="set-group" data-group="st-limits">
          <h2 class="ovl sr-title">{t("w2_dlx_g_limits")}</h2>
          <div class="box sr-box">
            <LimitRow k="maxSongCacheSize" label={() => t("w2_dlx_set_maxSongCacheSize")} />
            <LimitRow k="maxImageCacheSize" label={() => t("w2_dlx_set_maxImageCacheSize")} />
          </div>
        </section>
      </Show>
    </div>
  );
}
