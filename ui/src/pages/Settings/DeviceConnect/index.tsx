import { Show } from "solid-js";
import { Icon } from "../../../components/Icon";
import { t } from "../../../i18n";
import { navigate } from "../../../router/router";
import { DcPortField, DcSwitch } from "../../../shell/DeviceConnectPanel";
import { hasDeviceConnect, hasListenTogether } from "../../../shell/DeviceConnectPanel/init";
import { dcActions, dcState, openDc } from "../../../shell/DeviceConnectPanel/store";
import { settingsReady } from "../../../state/settings";
import type { GroupDef } from "../layout";
import { SettingGroup } from "../RowList";

// Category key = the page name M3-3 links to: settings {page:"deviceConnect"}.
export const category = { key: "deviceConnect", order: 85, icon: "phones", titleKey: "w2_set_cat_deviceconnect" };

const DC_ROWS: GroupDef = {
  id: "dc-device",
  title: () => t("w2_dcs_g_device"),
  rows: [{ key: "deviceConnectDeviceName", label: () => t("w2_dcs_device_name"), kind: "text" }],
};
const LT_ROWS: GroupDef = {
  id: "lt",
  title: () => t("w2_dcs_g_lt"),
  rows: [
    { key: "listenTogetherUsername", label: () => t("w2_dcs_lt_username"), kind: "text" },
    { key: "listenTogetherAutoApproveJoinRequests", label: () => t("w2_dcs_lt_auto_join"), kind: "switch" },
    { key: "listenTogetherAutoApproveSongSuggestions", label: () => t("w2_dcs_lt_auto_suggest"), kind: "switch" },
    { key: "listenTogetherSyncHostVolume", label: () => t("w2_dcs_lt_sync_volume"), kind: "switch" },
  ],
};

export default function DeviceConnectSettings() {
  const s = dcState;
  return (
    <div class="sr-page" data-testid="set-page" data-page="deviceConnect">
      <section class="sr-group" data-testid="dcs-dc">
        <h2 class="ovl sr-title">{t("w2_dcs_g_dc")}</h2>
        <div class="box sr-box">
          <Show when={hasDeviceConnect()} fallback={<div class="sr-row i3" data-testid="dcs-unavailable">{t("w2_dc_unavailable")}</div>}>
            <div class="sr-row" data-testid="set-row" data-setting="dc.enabled">
              <div class="sr-lbl">
                <span class="sr-name">{t("w2_dc_enable")}</span>
                <span class="i3 t12">{t("w2_dc_enable_hint")}</span>
              </div>
              <div class="sr-ctl"><DcSwitch on={s()?.enabled === true} label={t("w2_dc_enable")} testid="dcs-enable" onChange={(on) => void dcActions.enable(on)} /></div>
            </div>
            <Show when={s()}>
              {(st) => (
                <div class="sr-row" data-testid="set-row" data-setting="dc.port">
                  <div class="sr-lbl"><span class="sr-name">{t("w2_dc_port")}</span></div>
                  <div class="sr-ctl"><DcPortField port={st().port} /></div>
                </div>
              )}
            </Show>
            <div class="sr-row">
              <div class="sr-lbl"><span class="sr-name">{t("w2_dcs_open_panel")}</span><span class="i3 t12">{t("w2_dcs_open_panel_hint")}</span></div>
              <div class="sr-ctl">
                <button type="button" class="btn ton sm" data-testid="dcs-open-panel" onClick={openDc}>
                  <Icon n="phones" s={16} />
                  {t("w2_dcs_open_panel_go")}
                </button>
              </div>
            </div>
          </Show>
        </div>
      </section>
      <Show when={hasDeviceConnect() && settingsReady()}>
        <SettingGroup group={DC_ROWS} />
      </Show>
      <Show when={hasListenTogether()}>
        <Show when={settingsReady()}>
          <SettingGroup group={LT_ROWS} />
        </Show>
        <section class="sr-group" data-testid="dcs-lt">
          <div class="box sr-box">
            <div class="sr-row">
              <div class="sr-lbl"><span class="sr-name">{t("w2_dcs_open_lt")}</span><span class="i3 t12">{t("w2_dcs_open_lt_hint")}</span></div>
              <div class="sr-ctl">
                <button type="button" class="btn ton sm" data-testid="dcs-open-lt" onClick={() => navigate("listenTogether")}>
                  {t("w2_dcs_open_lt_go")}
                </button>
              </div>
            </div>
          </div>
        </section>
      </Show>
    </div>
  );
}
