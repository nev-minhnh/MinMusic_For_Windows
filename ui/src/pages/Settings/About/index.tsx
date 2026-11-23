import { For, Show, createResource } from "solid-js";
import type { AppInfo } from "@minmusic/protocol";
import { client } from "../../../lib/core";
import { inTauri, invoke } from "../../../lib/tauri";
import { t } from "../../../i18n";

export const category = { key: "About", order: 130, icon: "info", titleKey: "w2_set_cat_about" };

type CoreStatus = { state: "starting" | "ready" | "restarting" | "failed"; restarts: number; lastError?: string };

const DIRS = [
  ["data", () => t("w2_about_dir_data")],
  ["config", () => t("w2_about_dir_config")],
  ["state", () => t("w2_about_dir_state")],
  ["cache", () => t("w2_about_dir_cache")],
  ["logs", () => t("w2_about_dir_logs")],
] as const;

function Fact(props: { k: string; v: string; testid?: string }) {
  return (
    <div class="sr-row ab-row">
      <div class="sr-lbl"><span class="sr-name">{props.k}</span></div>
      <div class="ab-val num" data-testid={props.testid}>{props.v}</div>
    </div>
  );
}

export default function AboutSettings() {
  const [info] = createResource<AppInfo | undefined>(() => client.call<AppInfo>("app.info").catch(() => undefined));
  const [status] = createResource<CoreStatus | undefined>(async () => (inTauri ? ((await invoke("core_status")) as CoreStatus | undefined) : undefined));
  const STATE = { starting: () => t("w2_about_st_starting"), ready: () => t("w2_about_st_ready"), restarting: () => t("w2_about_st_restarting"), failed: () => t("w2_about_st_failed") };
  const stateLabel = (s?: CoreStatus["state"]) => (s && STATE[s] ? STATE[s]() : t("w2_about_unknown"));
  return (
    <div class="sr-page" data-testid="set-page" data-page="About">
      <section class="sr-group">
        <h2 class="ovl sr-title">{t("w2_set_cat_about")}</h2>
        <div class="box sr-box" data-testid="about-info">
          <Show when={info()} fallback={<div class="sr-row i3">{t("w2_set_loading")}</div>}>
            {(i) => (
              <>
                <Fact k={t("w2_about_version")} v={i().version} testid="about-version" />
                <Fact k={t("w2_about_core")} v={i().core} />
                <Fact k={t("w2_about_protocol")} v={String(i().protocol)} />
                <Fact k={t("w2_about_build")} v={i().buildTime} />
                <Fact k={t("w2_about_portable")} v={i().portable ? t("w2_about_yes") : t("w2_about_no")} />
              </>
            )}
          </Show>
        </div>
      </section>

      <Show when={info()}>
        {(i) => (
          <section class="sr-group">
            <h2 class="ovl sr-title">{t("w2_about_dirs")}</h2>
            <div class="box sr-box" data-testid="about-dirs">
              <For each={DIRS}>
                {([d, label]) => (
                  <div class="sr-row ab-row" data-dir={d}>
                    <div class="sr-lbl"><span class="sr-name">{label()}</span></div>
                    <div class="ab-path t12 i2">{i().dataDirs[d]}</div>
                  </div>
                )}
              </For>
              <div class="sr-row ab-row">
                <div class="sr-lbl" />
                <button type="button" class="sr-btn" data-testid="open-logs" onClick={() => void invoke("open_log_folder")}>{t("w2_about_open_logs")}</button>
              </div>
            </div>
          </section>
        )}
      </Show>

      <section class="sr-group">
        <h2 class="ovl sr-title">{t("w2_about_licenses")}</h2>
        <div class="box sr-box"><p class="sr-row ab-text i2">{t("w2_about_license_text")}</p></div>
      </section>

      <section class="sr-group">
        <h2 class="ovl sr-title">{t("w2_about_diag")}</h2>
        <div class="box sr-box" data-testid="about-diag">
          <Fact k={t("w2_about_core_state")} v={stateLabel(status()?.state)} testid="about-core-state" />
          <Fact k={t("w2_about_restarts")} v={status() ? String(status()!.restarts) : t("w2_about_unknown")} />
          <Fact k={t("w2_about_last_error")} v={status()?.lastError ?? t("w2_about_none")} />
        </div>
      </section>
    </div>
  );
}
