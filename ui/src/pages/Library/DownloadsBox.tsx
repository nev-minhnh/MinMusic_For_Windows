import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { QualityBadge } from "../../components/Badge";
import { IconButton } from "../../components/IconButton";
import { client } from "../../lib/core";
import { onLibraryEvent } from "../../state/library";
import { t } from "../../i18n";
import { fmtBytes } from "./util";
import type { DownloadSummary } from "@minmusic/protocol";

/**
 * Downloads summary box (MK 4). `download.summary` answers on a real core from M4-2a; until then it fails (`unsupported`) and the box
 * stays hidden. Refreshed on `library.changed` and `download.summary` pushes.
 */
export function DownloadsBox() {
  const [sum, setSum] = createSignal<DownloadSummary | null>(null);
  let off2: (() => void) | undefined;
  const summary = (): Promise<DownloadSummary> => client.call("download.summary");
  const load = () =>
    summary()
      .then((s) => {
        setSum(s);
        // the topic exists only where the method answers
        off2 ??= client.sub("downloads", {}, (name, d) => (name === "download.summary" || name === "downloads.snapshot") && setSum(d as DownloadSummary));
      })
      .catch(() => setSum(null));
  onMount(() => {
    void load();
    const off = onLibraryEvent((name) => name === "library.changed" && void load());
    onCleanup(() => {
      off();
      off2?.();
    });
  });
  const togglePause = () => void client.call(sum()?.paused ? "download.resume" : "download.pause").then(load, load);
  return (
    <Show when={sum()}>
      {(s) => (
        <div class="box dl-box" data-testid="dl-box">
          <div class="row gap12">
            <IconButton icon="dl" label={t("w2_downloads")} tonal />
            <div class="f1">
              <div class="w6">{t("w2_dl_summary", s().count.toLocaleString("vi-VN"), fmtBytes(s().bytes))}</div>
              <div class="t12 i3 row" style={{ gap: "6px", "margin-top": "4px", "flex-wrap": "wrap" }}>
                <For each={s().byQuality}>
                  {(q) => (
                    <>
                      <QualityBadge q={{ label: q.label, lossless: q.label === "FLAC" || q.label === "Lossless" }} />
                      <span class="num">{q.count}</span>
                    </>
                  )}
                </For>
              </div>
              <div class="t12 i3 row" style={{ gap: "8px", "margin-top": "4px" }}>
                <span class="ell" classList={{ err: !s().folderOk }}>{s().folder}</span>
                <span class="acc w6">{t("w2_change_folder")}</span>
              </div>
            </div>
          </div>
          <div class="dl-sep" />
          <div>
            <Show when={s().active.total > 0} fallback={<div class="i3">{t("w2_lib_dl_idle")}</div>}>
              <div class="row">
                <div class="f1 w6 ell">{t("w2_dl_progress", s().active.done, s().active.total, s().active.label ?? "")}</div>
                <button type="button" class="btn txt sm" onClick={togglePause}>
                  {s().paused ? t("w2_lib_resume") : t("w2_pause")}
                </button>
              </div>
              <div class="bar" style={{ "margin-top": "8px" }}>
                <div class="bar-fill" style={{ transform: `scaleX(${Math.min(1, s().active.done / s().active.total)})` }} />
              </div>
            </Show>
          </div>
        </div>
      )}
    </Show>
  );
}
