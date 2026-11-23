import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { Seg } from "../../../components/Seg";
import { inTauri, invoke } from "../../../lib/tauri";
import { t } from "../../../i18n";
import { setSetting, settingValue } from "../../../state/settings";
import { CHANNELS, channelOf, type Listen, formatSize, noteParagraphs, viewOf, type Channel, type UpdateStatus } from "./model";
import "./updates.css";

export const category = { key: "Updates", order: 120, icon: "set_update", titleKey: "w2_set_cat_updates" };

/** Settings live in the core; the shell also reads them from shell.json until the core is connected. */
const mirror = (patch: Record<string, unknown>) => void invoke("shell_settings_set", { patch });

export default function UpdatesSettings() {
  const [status, setStatus] = createSignal<UpdateStatus | undefined>(undefined);
  const view = () => viewOf(status());
  const channel = (): Channel => channelOf(settingValue("updateChannel"));
  const auto = () => settingValue("checkForUpdates") !== false;

  onMount(() => {
    void invoke("update_status").then((s) => s && setStatus(s as UpdateStatus));
    let off: (() => void) | undefined;
    let gone = false;
    const listen = (window as any).__TAURI__?.event?.listen as Listen | undefined;
    if (listen) {
      void listen("update-status", (e) => setStatus(e.payload as UpdateStatus)).then((u) => (gone ? u() : (off = u)));
    }
    onCleanup(() => {
      gone = true;
      off?.();
    });
  });

  const check = async () => {
    const s = (await invoke("update_check")) as UpdateStatus | undefined;
    if (s) setStatus(s);
  };
  const install = () => void invoke("update_install");
  const setChannel = (c: string) => {
    void setSetting("updateChannel", c);
    mirror({ updateChannel: c });
  };
  const setAuto = (on: boolean) => {
    void setSetting("checkForUpdates", on);
    mirror({ checkForUpdates: on });
  };

  const headline = () => {
    const s = status();
    const v = view();
    switch (v.headline) {
      case "available":
        return t("w2_upd_available", s?.available?.version ?? "");
      case "checking":
        return t("w2_upd_checking");
      case "downloading":
        return t("w2_upd_downloading", String(v.percent ?? 0));
      case "ready":
        return t("w2_upd_ready");
      case "error":
        return t("w2_upd_error");
      case "uptodate":
        return t("w2_upd_uptodate");
      default:
        return t("w2_upd_never");
    }
  };
  const lastCheck = () => {
    const ms = status()?.lastCheck;
    return ms ? new Date(ms).toLocaleString() : t("w2_upd_never_short");
  };

  return (
    <div class="sr-page" data-testid="set-page" data-page="Updates">
      <section class="sr-group">
        <h2 class="ovl sr-title">{t("w2_set_cat_updates")}</h2>
        <div class="box sr-box" data-testid="upd-settings">
          <div class="sr-row" data-testid="upd-auto">
            <div class="sr-lbl"><span class="sr-name">{t("w2_upd_auto")}</span></div>
            <div class="sr-ctl">
              <button type="button" role="switch" class="sr-sw" classList={{ on: auto() }} aria-checked={auto()} aria-label={t("w2_upd_auto")} disabled={status()?.portable} onClick={() => setAuto(!auto())}>
                <span class="sr-knob" />
              </button>
            </div>
          </div>
          <div class="sr-row" data-testid="upd-channel">
            <div class="sr-lbl"><span class="sr-name">{t("w2_upd_channel")}</span></div>
            <div class="sr-ctl">
              <Seg class="sr-seg" label={t("w2_upd_channel")} value={channel()} onChange={setChannel} items={CHANNELS.map((c) => ({ key: c, label: c === "stable" ? t("w2_upd_ch_stable") : t("w2_upd_ch_prerelease") }))} />
            </div>
          </div>
          <Show when={status()?.portable}>
            <p class="sr-row ab-text i2" data-testid="upd-portable-note">{t("w2_upd_portable")}</p>
          </Show>
        </div>
      </section>

      <section class="sr-group">
        <h2 class="ovl sr-title">{t("w2_upd_status")}</h2>
        <div class="box sr-box" data-testid="upd-status" data-state={status()?.state ?? "unknown"}>
          <div class="sr-row">
            <div class="sr-lbl">
              <span class="sr-name" data-testid="upd-headline" role="status">{headline()}</span>
              <span class="t12 i3 num" data-testid="upd-versions">{t("w2_upd_current", status()?.currentVersion ?? "")} · {t("w2_upd_last", lastCheck())}</span>
              <Show when={view().headline === "error" && status()?.error}>
                <span class="sr-err t12" role="alert" data-testid="upd-error">{status()!.error}</span>
              </Show>
            </div>
            <div class="sr-ctl upd-btns">
              <button type="button" class="btn ton sm" data-testid="upd-check" disabled={!view().canCheck} onClick={() => void check()}>{t("w2_upd_check")}</button>
              <Show when={view().canInstall}>
                <button type="button" class="btn pri sm" data-testid="upd-install" onClick={install}>{t("w2_upd_install")}</button>
              </Show>
              <Show when={view().showReleasePage}>
                <button type="button" class="btn pri sm" data-testid="upd-release-page" onClick={() => void invoke("update_open_release_page")}>{t("w2_upd_release_page")}</button>
              </Show>
            </div>
          </div>
          <Show when={view().percent !== null}>
            <div class="sr-row upd-prog" data-testid="upd-progress">
              <progress class="upd-bar" max="100" value={view().percent ?? 0} aria-label={t("w2_upd_downloading", String(view().percent ?? 0))} />
              <span class="num t12 i2">{view().percent}%</span>
            </div>
          </Show>
        </div>
      </section>

      <Show when={status()?.available}>
        {(a) => (
          <section class="sr-group">
            <h2 class="ovl sr-title">{t("w2_upd_notes", a().version)}{formatSize(a().size) ? ` · ${formatSize(a().size)}` : ""}</h2>
            <div class="box sr-box upd-notes" data-testid="upd-notes">
              <For each={noteParagraphs(a().notes)} fallback={<p class="sr-row ab-text i2">{t("w2_upd_no_notes")}</p>}>
                {(p) => <p class="upd-p">{p}</p>}
              </For>
            </div>
          </section>
        )}
      </Show>

      <Show when={!inTauri}>
        <p class="t12 i3" data-testid="upd-browser">{t("w2_upd_browser")}</p>
      </Show>
    </div>
  );
}
