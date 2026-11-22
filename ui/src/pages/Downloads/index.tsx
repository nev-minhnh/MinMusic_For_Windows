import { Show, createEffect, createSignal, on, onCleanup } from "solid-js";
import type { RouteName } from "../../router/routes";
import type { PageProps } from "../../router/registry";
import { Icon } from "../../components/Icon";
import { Seg } from "../../components/Seg";
import { Table, createTableSelection, type TableApi } from "../../components/Table";
import { VirtualList } from "../../components/VirtualList";
import { DownloadsBox } from "../../components/downloads/DownloadsBox";
import { t } from "../../i18n";
import { navigate } from "../../router/router";
import { player, playerState } from "../../state/player";
import {
  cancelAll, createDownloadedStore, downloadSummary, downloadedRev, failedCount, queueCount, queueIds, removeDownloads, retryFailed, saveCopies, togglePause, useDownloads,
} from "../../state/downloads";
import type { SortSpec, Track } from "../../lib/types";
import { QueueRow } from "./QueueRow";
import "../../components/downloads/downloads.css";

export const routes: RouteName[] = ["downloads"];

const COLS = ["index", "title", "album", "added", "dur", "more"] as const;
type Tab = "done" | "queue";

/**
 * Downloads page: "Đã tải" (download.window in the songs Table) and "Hàng đợi" (download.queue, per-item progress as a transform).
 * Replaces M1-3c's simple list at INT-W4.
 */
export default function Downloads(props: PageProps) {
  useDownloads();
  const [tab, setTab] = createSignal<Tab>(props.params.tab === "queue" ? "queue" : "done");
  const store = createDownloadedStore({ by: "added", desc: true });
  let api: TableApi | undefined;
  const play = (i: number) => {
    const tr = store.track(i);
    if (tr) void player.play({ kind: "library", list: "downloaded", sort: store.sort() }, { startId: tr.id });
  };
  const sel = createTableSelection(store.total, play);
  createEffect(on(downloadedRev, () => store.invalidate(), { defer: true }));
  const summary = downloadSummary;
  const paused = () => summary()?.paused === true;
  const selected = () => api?.selectedTracks().map((x) => x.id) ?? [];

  const remove = async () => {
    const ids = selected();
    if (await removeDownloads(ids)) sel.clear?.();
  };
  const onKey = (e: KeyboardEvent) => {
    if (tab() !== "done" || e.key !== "Delete" || (e.target as HTMLElement).closest("input,textarea")) return;
    e.preventDefault();
    void remove();
  };
  const dead = () => !props.active();
  createEffect(() => {
    if (dead()) return;
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  return (
    <div class="sc dlx-page" data-testid="downloads-page">
      <div class="row gap8" style={{ "margin-top": "16px" }}>
        <div class="t28 w6 f1">{t("w2_downloads")}</div>
        <button type="button" class="btn txt sm" onClick={() => navigate("settings", { page: "Downloads" })} data-testid="dl-open-settings">
          <Icon n="gear" s={16} />
          {t("w2_dlx_settings")}
        </button>
      </div>
      <DownloadsBox />
      <Seg
        class="dlx-tabs s1"
        label={t("w2_downloads")}
        value={tab()}
        onChange={(k) => setTab(k as Tab)}
        items={[
          { key: "done", label: `${t("w2_downloaded")}` },
          { key: "queue", label: `${t("w2_dlx_queue")}` },
        ]}
      />
      <div class="dlx-bar" data-testid="dl-actions">
        <Show
          when={tab() === "queue"}
          fallback={
            <>
              <button type="button" class="btn ton sm" disabled={sel.count() === 0} classList={{ dis: sel.count() === 0 }} data-testid="dl-save-to" onClick={() => void saveCopies(selected())}>
                <Icon n="dlx_copy" s={16} />
                {t("w2_dlx_save_to_btn")}
              </button>
              <button type="button" class="btn txt sm" disabled={sel.count() === 0} classList={{ dis: sel.count() === 0 }} data-testid="dl-remove" onClick={() => void remove()}>
                <Icon n="delete" s={16} />
                {t("w2_dlx_remove")}
              </button>
              <span class="t12 i3 num" data-testid="dl-done-count">{t("w2_dlx_count", store.total())}</span>
            </>
          }
        >
          <button type="button" class="btn ton sm" data-testid="dl-pause-page" onClick={() => void togglePause()}>
            <Icon n={paused() ? "play" : "pause"} s={16} />
            {paused() ? t("w2_dlx_resume") : t("w2_pause")}
          </button>
          <button type="button" class="btn txt sm" classList={{ dis: failedCount() === 0 }} disabled={failedCount() === 0} data-testid="dl-retry-failed" onClick={() => void retryFailed()}>
            <Icon n="dlx_refresh" s={16} />
            {`${t("w2_dlx_retry_failed")} (${failedCount()})`}
          </button>
          <button type="button" class="btn txt sm" classList={{ dis: queueCount() === 0 }} disabled={queueCount() === 0} data-testid="dl-cancel-all" onClick={() => void cancelAll()}>
            <Icon n="close" s={16} />
            {t("w2_dlx_cancel_all")}
          </button>
          <span class="t12 i3 num" data-testid="dl-queue-count">{t("w2_dlx_count", queueCount())}</span>
        </Show>
      </div>

      <Show when={tab() === "done"}>
        <div class="dlx-q" data-testid="dl-done">
          <Show when={store.total() > 0 || summary() === null} fallback={<div class="dlx-empty" data-testid="dl-done-empty">{t("w2_dlx_empty_done")}</div>}>
            <Table
              total={store.total}
              trackAt={store.track}
              ensure={store.ensure}
              label={t("w2_downloaded")}
              testid="dl-table"
              cols={[...COLS]}
              sort={store.sort()}
              onSort={(s: SortSpec) => store.setSort(s)}
              sel={sel}
              playingId={() => playerState()?.track?.id}
              onPlay={play}
              onOpenAlbum={(tr: Track) => tr.album?.id && navigate("album", { id: tr.album.id })}
              api={(a) => (api = a)}
            />
          </Show>
        </div>
      </Show>
      <Show when={tab() === "queue"}>
        <div class="dlx-q" data-testid="dl-queue">
          <Show when={queueCount() > 0} fallback={<div class="dlx-empty" data-testid="dl-queue-empty">{t("w2_dlx_empty_queue")}</div>}>
            <div class="dlx-qh" aria-hidden="true">
              <div>{t("w2_col_title")}</div>
              <div>{t("w2_dlx_col_state")}</div>
              <div />
            </div>
            <VirtualList total={queueCount()} rowHeight={56} testid="dl-queue-list" label={t("w2_dlx_queue")} render={(i) => <QueueRow id={() => queueIds()[i()]} />} />
          </Show>
        </div>
      </Show>
    </div>
  );
}

