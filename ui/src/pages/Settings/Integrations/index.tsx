import { Show, createResource, createSignal, onCleanup } from "solid-js";
import { Icon } from "../../../components/Icon";
import { client } from "../../../lib/core";
import { navigate } from "../../../router/router";
import { t } from "../../../i18n";
import { LastfmLogin } from "../../../dialogs/LastfmLogin";
import { callSecret, errCode, errMsg } from "../../../shell/account/kit";
import { isWaiting, withWaiting } from "../../../shell/account/store";
import "./integrations.css";

export const category = { key: "integrations", order: 80, icon: "integration", titleKey: "w2_int_title" };

type Lastfm = { user?: string; expired: boolean; scrobbling: boolean; nowPlaying: boolean; pending: number };
type Discord = { user?: string; enabled: boolean };

export default function Integrations() {
  // a failed status call leaves the card in its signed-out state instead of throwing into the page
  const safe = <T,>(m: string) => () => client.call<T>(m, {}).catch(() => undefined);
  const [lastfm, { refetch: refetchLf }] = createResource<Lastfm | undefined>(safe<Lastfm>("lastfm.status"));
  const [lb, { refetch: refetchLb }] = createResource<{ user?: string } | undefined>(safe<{ user?: string }>("listenbrainz.status"));
  const [discord, { refetch: refetchDc }] = createResource<Discord | undefined>(safe<Discord>("discord.status"));
  const [dialog, setDialog] = createSignal(false);
  const [errs, setErrs] = createSignal<Record<string, string | undefined>>({});
  const setErr = (k: string, v: string | undefined) => setErrs((e) => ({ ...e, [k]: v }));
  let tokenEl!: HTMLInputElement;
  const [lbBusy, setLbBusy] = createSignal(false);
  onCleanup(() => tokenEl && (tokenEl.value = ""));

  async function lastfmLogout() {
    setErr("lastfm", undefined);
    try {
      await client.call("lastfm.logout", {});
    } catch (e) {
      setErr("lastfm", errMsg(errCode(e)));
    }
    void refetchLf();
  }

  // The ListenBrainz token is read from the DOM once, the field is emptied before the call, nothing keeps it.
  async function saveToken(e: Event) {
    e.preventDefault();
    if (lbBusy()) return;
    const tok = tokenEl.value.trim();
    tokenEl.value = "";
    if (!tok) {
      setErr("lb", t("w2_acct_err_required"));
      tokenEl.focus();
      return;
    }
    setErr("lb", undefined);
    setLbBusy(true);
    try {
      await callSecret("listenbrainz.setToken", { token: tok });
      void refetchLb();
    } catch (err) {
      setErr("lb", errMsg(errCode(err)));
      tokenEl.focus();
    } finally {
      setLbBusy(false);
    }
  }
  async function clearToken() {
    setErr("lb", undefined);
    try {
      await client.call("listenbrainz.setToken", { token: null });
    } catch (e) {
      setErr("lb", errMsg(errCode(e)));
    }
    void refetchLb();
  }

  async function discordLogin() {
    setErr("discord", undefined);
    try {
      await withWaiting("discord", () => client.call("discord.login", {}));
    } catch (e) {
      setErr("discord", errMsg(errCode(e)));
    }
    void refetchDc();
  }
  async function discordLogout() {
    setErr("discord", undefined);
    try {
      await client.call("discord.logout", {});
    } catch (e) {
      setErr("discord", errMsg(errCode(e)));
    }
    void refetchDc();
  }

  const yn = (v: boolean) => (v ? t("w2_int_on") : t("w2_int_off"));

  return (
    <div class="ig" data-testid="set-integrations">
      <div class="t20 w6 ig-h">{t("w2_int_title")}</div>

      <section class="ig-card" data-testid="ig-lastfm">
        <div class="ig-top">
          <div class="f1">
            <div class="w6">Last.fm</div>
            <div class="t12 i3" data-testid="ig-lastfm-user">
              <Show when={lastfm()?.user} fallback={t("w2_int_signedout")}>
                {(u) => t("w2_int_signedin_as", u())}
              </Show>
            </div>
          </div>
          <Show
            when={lastfm()?.user}
            fallback={
              <button type="button" class="btn ton sm" onClick={() => setDialog(true)} data-testid="ig-lastfm-login">
                {t("w2_acct_login")}
              </button>
            }
          >
            <Show when={lastfm()?.expired}>
              <button type="button" class="btn ton sm" onClick={() => setDialog(true)} data-testid="ig-lastfm-relogin">
                {t("w2_acct_login")}
              </button>
            </Show>
            <button type="button" class="btn txt sm" onClick={() => void lastfmLogout()} data-testid="ig-lastfm-logout">
              {t("w2_acct_logout")}
            </button>
          </Show>
        </div>
        <Show when={lastfm()?.user}>
          <div class="ig-stats t14" data-testid="ig-lastfm-status">
            <Show when={lastfm()?.expired}>
              <div class="ig-err">{t("w2_int_expired")}</div>
            </Show>
            <div class="ig-kv"><span class="i2">{t("w2_int_scrobbling")}</span><span class="w6">{yn(lastfm()!.scrobbling)}</span></div>
            <div class="ig-kv"><span class="i2">{t("w2_int_nowplaying")}</span><span class="w6">{yn(lastfm()!.nowPlaying)}</span></div>
            <div class="ig-kv"><span class="i2">{t("w2_int_pending")}</span><span class="w6 num" data-testid="ig-lastfm-pending">{lastfm()!.pending}</span></div>
          </div>
        </Show>
        <Show when={errs().lastfm}>{(m) => <div class="ig-err t12">{m()}</div>}</Show>
      </section>

      <section class="ig-card" data-testid="ig-lb">
        <div class="ig-top">
          <div class="f1">
            <div class="w6">{"ListenBrainz"}</div>
            <div class="t12 i3" data-testid="ig-lb-user">
              <Show when={lb()?.user} fallback={t("w2_int_lb_none")}>
                {(u) => t("w2_int_signedin_as", u())}
              </Show>
            </div>
          </div>
          <Show when={lb()?.user}>
            <button type="button" class="btn txt sm" onClick={() => void clearToken()} data-testid="ig-lb-clear">
              {t("w2_int_lb_clear")}
            </button>
          </Show>
        </div>
        <form class="ig-token" onSubmit={saveToken} autocomplete="off" novalidate>
          <input
            ref={tokenEl}
            type="password"
            name="lbtoken"
            autocomplete="new-password"
            spellcheck={false}
            autocapitalize="off"
            aria-label={t("w2_int_lb_token")}
            placeholder={t("w2_int_lb_token")}
            data-testid="ig-lb-token"
            onInput={() => errs().lb && setErr("lb", undefined)}
          />
          <button type="submit" class="btn ton sm" disabled={lbBusy()} data-testid="ig-lb-save">{t("w2_acct_save")}</button>
        </form>
        <Show when={errs().lb}>{(m) => <div class="ig-err t12" data-testid="ig-lb-error" role="alert">{m()}</div>}</Show>
      </section>

      <section class="ig-card" data-testid="ig-discord">
        <div class="ig-top">
          <div class="f1">
            <div class="w6">{"Discord"}</div>
            <div class="t12 i3" aria-live="polite" data-testid="ig-discord-status">
              <Show when={!isWaiting("discord")} fallback={<span class="acc" data-testid="ig-discord-waiting">{t("w2_src_waiting")}</span>}>
                <Show when={discord()?.user} fallback={t("w2_int_signedout")}>
                  {(u) => t("w2_int_signedin_as", u())}
                </Show>
              </Show>
            </div>
          </div>
          <Show
            when={discord()?.user}
            fallback={
              <button type="button" class="btn ton sm" disabled={isWaiting("discord")} onClick={() => void discordLogin()} data-testid="ig-discord-login">
                {t("w2_acct_login")}
              </button>
            }
          >
            <button type="button" class="btn txt sm" onClick={() => void discordLogout()} data-testid="ig-discord-logout">
              {t("w2_acct_logout")}
            </button>
          </Show>
        </div>
        <Show when={errs().discord}>{(m) => <div class="ig-err t12">{m()}</div>}</Show>
      </section>

      <div class="t12 i3 ig-cap">{t("w2_int_more")}</div>
      <div class="ig-card ig-links">
        <button type="button" class="ig-link" onClick={() => navigate("settings", { page: "deviceConnect" })} data-testid="ig-link-dc">
          <span class="f1">{t("w2_int_dc")}</span>
          <Icon n="chevron_right" s={20} />
        </button>
        <button type="button" class="ig-link" onClick={() => navigate("listenTogether")} data-testid="ig-link-lt">
          <span class="f1">{t("w2_int_lt")}</span>
          <Icon n="chevron_right" s={20} />
        </button>
        <button type="button" class="ig-link" onClick={() => navigate("settings", { page: "import" })} data-testid="ig-link-import">
          <span class="f1">{t("w2_int_import")}</span>
          <Icon n="chevron_right" s={20} />
        </button>
      </div>

      <Show when={dialog()}>
        <LastfmLogin onClose={() => setDialog(false)} onDone={() => void refetchLf()} />
      </Show>
    </div>
  );
}
