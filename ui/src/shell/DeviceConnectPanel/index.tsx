import { For, Show, createEffect, createMemo, createSignal, on } from "solid-js";
import { Dialog } from "../../dialogs/Dialog";
import { confirm } from "../../dialogs/Confirm";
import { Icon } from "../../components/Icon";
import { toast } from "../../toast";
import { t } from "../../i18n";
import { dcActions, dcOpen, dcRequests, dcState, closeDc } from "./store";
import { sasGroups, withPort, type DcRequest } from "./model";
import { sanitizeSvg } from "./sanitize";
import "./dc.css";

export { openDc, closeDc, toggleDc, dcOpen } from "./store";

const FIREWALL = {
  allowed: () => t("w2_dc_fw_allowed"),
  blocked: (port: number) => t("w2_dc_fw_blocked", port),
  no_rule: (port: number) => t("w2_dc_fw_no_rule", port),
  unknown: () => t("w2_dc_fw_unknown"),
} as const;

export function DcSwitch(props: { on: boolean; label: string; onChange: (on: boolean) => void; testid?: string }) {
  return (
    <button type="button" role="switch" class="sr-sw" classList={{ on: props.on }} aria-checked={props.on} aria-label={props.label} data-testid={props.testid} onClick={() => props.onChange(!props.on)}>
      <span class="sr-knob" />
    </button>
  );
}

/** QR block: `dc.state.qrSvg` through the sanitiser (never raw), the link under it, copy button. */
function Qr(props: { svg: string; link: string }) {
  const safe = createMemo(() => sanitizeSvg(props.svg));
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(props.link);
      toast({ i18n: "w2_link_copied" });
    } catch {
      toast({ i18n: "w2_error_generic", level: "error" });
    }
  };
  return (
    <div class="dc-qrbox">
      <div class="dc-qr" data-testid="dc-qr" data-link={props.link} role="img" aria-label={t("w2_dc_qr_label")} innerHTML={safe()} />
      <div class="dc-linkrow">
        <span class="dc-link num ell" data-testid="dc-link" title={props.link}>{props.link}</span>
        <button type="button" class="ib" data-testid="dc-copy-link" aria-label={t("w2_dc_copy_link")} title={t("w2_dc_copy_link")} onClick={copy}>
          <Icon n="link" s={20} />
        </button>
      </div>
    </div>
  );
}

export function DcPortField(props: { port: number }) {
  const [v, setV] = createSignal(String(props.port));
  createEffect(on(() => props.port, (p) => setV(String(p))));
  const num = () => (/^\d{4,5}$/.test(v().trim()) ? Number(v()) : NaN);
  const valid = () => num() >= 1024 && num() <= 65535;
  const apply = () => {
    if (!valid()) return setV(String(props.port));
    if (num() !== props.port) void dcActions.setPort(num());
  };
  return (
    <input
      class="dc-input dc-port num"
      data-testid="dc-port"
      inputmode="numeric"
      aria-label={t("w2_dc_port")}
      aria-invalid={!valid()}
      value={v()}
      onInput={(e) => setV(e.currentTarget.value)}
      onBlur={apply}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation(); // not the dialog's submit
          apply();
        }
      }}
    />
  );
}

function RequestCard(props: { r: DcRequest }) {
  return (
    <div class="dc-req" data-testid="dc-request" data-request={props.r.requestId} role="group" aria-label={t("w2_dc_req_title", props.r.peer)}>
      <div class="w6">{t("w2_dc_req_title", props.r.peer)}</div>
      <Show when={props.r.sas} fallback={<div class="i2 t12">{t("w2_dc_req_plain")}</div>}>
        {(sas) => (
          <>
            <div class="dc-sas num" data-testid="dc-sas" aria-label={t("w2_dc_sas_label")}>{sasGroups(sas())}</div>
            <div class="i2 t12">{t("w2_dc_sas_hint", props.r.peer)}</div>
          </>
        )}
      </Show>
      <div class="dc-req-act">
        <button type="button" class="btn txt sm" data-testid="dc-reject" onClick={() => void dcActions.decide(props.r, false)}>
          {props.r.sas ? t("w2_dc_sas_no") : t("w2_dc_reject")}
        </button>
        <button type="button" class="btn pri sm" data-testid="dc-confirm" onClick={() => void dcActions.decide(props.r, true)}>
          {props.r.sas ? t("w2_dc_sas_yes") : t("w2_dc_accept")}
        </button>
      </div>
    </div>
  );
}

export function DeviceConnectPanel() {
  const s = dcState;
  const [link, setLink] = createSignal("");
  const [linkErr, setLinkErr] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);

  const connect = async () => {
    if (!link().trim() || busy()) return;
    setBusy(true);
    const err = await dcActions.connectLink(link());
    setBusy(false);
    setLinkErr(err);
    if (!err) {
      setLink("");
      toast({ i18n: "w2_dc_link_sent" });
    }
  };
  const forget = async (id: string, name: string) => {
    if (await confirm({ title: t("w2_dc_forget_title", name), body: t("w2_dc_forget_body"), danger: true, okLabel: t("w2_dc_forget") })) void dcActions.forget(id);
  };

  return (
    <Dialog open={dcOpen()} title={t("w2_dc_title")} onClose={closeDc} testid="dc-panel" width={480} actions={<button type="button" class="btn txt" data-testid="dc-close" onClick={closeDc}>{t("w2_dc_close")}</button>}>
      <div class="dc-body">
        <Show when={s()} fallback={<div class="i3" data-testid="dc-loading">{t("w2_dc_loading")}</div>}>
          {(st) => (
            <>
              <div class="dc-row">
                <div class="f1">
                  <div class="w6">{t("w2_dc_enable")}</div>
                  <div class="i3 t12">{t("w2_dc_enable_hint")}</div>
                </div>
                <DcSwitch on={st().enabled} label={t("w2_dc_enable")} testid="dc-enable" onChange={(on) => void dcActions.enable(on)} />
              </div>

              <For each={dcRequests()}>{(r) => <RequestCard r={r} />}</For>

              <Show when={st().enabled}>
                <div class="dc-sec" data-testid="dc-conn">
                  <Show when={st().qrSvg}>
                    <Qr svg={st().qrSvg} link={st().link} />
                  </Show>
                  <div class="dc-info">
                    <div class="ovl">{t("w2_dc_addresses")}</div>
                    <ul class="dc-addr" data-testid="dc-addresses">
                      <For each={st().addresses}>{(a) => <li class="num">{withPort(a, st().port)}</li>}</For>
                    </ul>
                    <label class="dc-portrow">
                      <span class="ovl">{t("w2_dc_port")}</span>
                      <DcPortField port={st().port} />
                    </label>
                    <div class="dc-fw" data-testid="dc-firewall" data-state={st().firewall}>
                      <span class="dc-fwdot" data-state={st().firewall} />
                      <span class="f1 t12">{(FIREWALL[st().firewall] as (p: number) => string)(st().port)}</span>
                    </div>
                    <Show when={st().firewall !== "allowed"}>
                      <button type="button" class="btn ton sm" data-testid="dc-firewall-open" onClick={() => void dcActions.openFirewall()}>
                        <Icon n="open_in_new" s={16} />
                        {t("w2_dc_fw_open")}
                      </button>
                    </Show>
                  </div>
                </div>
              </Show>

              <div class="dc-sec dc-col">
                <div class="ovl">{t("w2_dc_devices")}</div>
                <div class="dc-devs" data-testid="dc-devices">
                  <For each={st().devices} fallback={<div class="i3 t12 dc-empty" data-testid="dc-no-devices">{t("w2_dc_no_devices")}</div>}>
                    {(d) => {
                      const mine = () => st().session?.peerId === d.id;
                      return (
                        <div class="dc-dev" data-testid="dc-device" data-device={d.id} data-online={d.online} data-session={mine()}>
                          <Icon n="phones" s={20} />
                          <div class="f1 dc-devname">
                            <div class="w6 ell">{d.name}</div>
                            <div class="dc-tags t12">
                              <span class="dc-tag" classList={{ on: d.online }}>{d.online ? t("w2_dc_online") : t("w2_dc_offline")}</span>
                              <Show when={d.paired}><span class="dc-tag">{t("w2_dc_paired")}</span></Show>
                              <Show when={d.accountBound}><span class="dc-tag">{t("w2_dc_account")}</span></Show>
                              <Show when={mine()}><span class="dc-tag on">{st().session?.role === "player" ? t("w2_dc_role_player") : t("w2_dc_role_controller")}</span></Show>
                            </div>
                          </div>
                          <div class="dc-dact">
                            <Show
                              when={!mine()}
                              fallback={<button type="button" class="btn ton sm" data-testid="dc-release" onClick={() => void dcActions.release(d.id)}>{t("w2_dc_release")}</button>}
                            >
                              <Show when={d.online}>
                                <button type="button" class="btn ton sm" data-testid="dc-transfer" onClick={() => void dcActions.transferTo(d.id)}>{t("w2_dc_transfer")}</button>
                                <button type="button" class="btn txt sm" data-testid="dc-attach" onClick={() => void dcActions.attach(d.id)}>{t("w2_dc_attach")}</button>
                              </Show>
                            </Show>
                            <button type="button" class="ib" data-testid="dc-forget" aria-label={t("w2_dc_forget")} title={t("w2_dc_forget")} onClick={() => void forget(d.id, d.name)}>
                              <Icon n="delete" s={20} />
                            </button>
                          </div>
                        </div>
                      );
                    }}
                  </For>
                </div>
              </div>

              <div class="dc-sec dc-col">
                <div class="ovl">{t("w2_dc_by_link")}</div>
                <div class="dc-linkin">
                  <input
                    class="dc-input f1"
                    data-testid="dc-link-input"
                    placeholder="metrolist://device-connect?a=..."
                    aria-label={t("w2_dc_by_link")}
                    aria-invalid={!!linkErr()}
                    spellcheck={false}
                    value={link()}
                    onInput={(e) => {
                      setLink(e.currentTarget.value);
                      setLinkErr(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        e.stopPropagation();
                        void connect();
                      }
                    }}
                  />
                  <button type="button" class="btn pri sm" classList={{ dis: !link().trim() || busy() }} data-testid="dc-link-go" onClick={() => void connect()}>{t("w2_dc_connect")}</button>
                </div>
                <Show when={linkErr()}>
                  <div class="sr-err t12" role="alert" data-testid="dc-link-err">{linkErr() === "bad_request" ? t("w2_dc_link_bad") : t("w2_dc_link_fail")}</div>
                </Show>
              </div>
            </>
          )}
        </Show>
      </div>
    </Dialog>
  );
}
