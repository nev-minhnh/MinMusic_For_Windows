import { Show, createSignal, onCleanup } from "solid-js";
import { Icon } from "../../components/Icon";
import { artUrl, client } from "../../lib/core";
import { pushEsc } from "../../lib/esc";
import { navigate } from "../../router/router";
import { t } from "../../i18n";
import { TokenLogin } from "../../dialogs/TokenLogin";
import { account, isWaiting, useAccount, withWaiting } from "./store";
import { errCode, errMsg } from "./kit";
import "./account.css";

/** Title-bar avatar and its menu: name, channel switch, sign out, settings. Signed out: sign-in entries instead. */
export function AccountButton() {
  onCleanup(useAccount());
  const [open, setOpen] = createSignal(false);
  const [err, setErr] = createSignal<string | undefined>();
  const [token, setToken] = createSignal(false);
  let btn!: HTMLButtonElement;
  let menu: HTMLDivElement | undefined;
  let offEsc: (() => void) | null = null;

  const yt = () => account().youtube;
  const initial = () => (yt()?.name ?? "").trim().charAt(0).toUpperCase();

  const close = (refocus = true) => {
    setOpen(false);
    offEsc?.();
    offEsc = null;
    document.removeEventListener("pointerdown", away, true);
    if (refocus) btn?.focus({ preventScroll: true });
  };
  const away = (e: PointerEvent) => {
    const n = e.target as Node;
    if (!menu?.contains(n) && !btn.contains(n)) close(false);
  };
  const toggle = () => {
    if (open()) return close();
    setErr(undefined);
    setOpen(true);
    offEsc = pushEsc(() => close());
    document.addEventListener("pointerdown", away, true);
    queueMicrotask(() => (menu?.querySelector('[role="menuitem"]') as HTMLElement | null)?.focus());
  };
  onCleanup(() => {
    offEsc?.();
    document.removeEventListener("pointerdown", away, true);
  });

  const onMenuKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    const items = [...(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])];
    if (!items.length) return;
    e.preventDefault();
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : (i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next]!.focus();
  };

  async function run(key: string, method: string, closeAfter: boolean) {
    setErr(undefined);
    try {
      await withWaiting(key, () => client.call(method, {}));
      if (closeAfter) close();
    } catch (e) {
      setErr(errMsg(errCode(e)));
    }
  }

  return (
    <div class="am">
      <button
        ref={btn}
        type="button"
        class="avatar am-btn"
        aria-haspopup="menu"
        aria-expanded={open()}
        aria-label={t("w2_acct_menu")}
        title={yt()?.name ?? t("w2_acct_menu")}
        data-testid="account-btn"
        onClick={toggle}
      >
        <Show when={yt()?.avatar} fallback={<Show when={initial()} fallback={<Icon n="person" s={16} />}>{initial()}</Show>}>
          {(a) => <img src={artUrl(a(), 32)} width="32" height="32" alt="" />}
        </Show>
      </button>
      <Show when={open()}>
        <div ref={menu} class="am-menu" role="menu" aria-label={t("w2_acct_menu")} data-testid="account-menu" onKeyDown={onMenuKey}>
          <Show
            when={account().signedIn && yt()}
            fallback={
              <>
                <div class="am-head">
                  <div class="w6">{t("w2_acct_signedout")}</div>
                  <div class="t12 i3">{t("w2_acct_signedout_d")}</div>
                </div>
                <button type="button" role="menuitem" class="am-item" disabled={isWaiting("yt")} onClick={() => void run("yt", "account.youtube.login", true)} data-testid="am-login">
                  <Icon n="user" s={20} />
                  <span class="f1">{isWaiting("yt") ? t("w2_src_waiting") : t("w2_acct_login_yt")}</span>
                </button>
                <button type="button" role="menuitem" class="am-item" onClick={() => { close(false); setToken(true); }} data-testid="am-token">
                  <Icon n="key" s={20} />
                  <span class="f1">{t("w2_src_token_btn")}</span>
                </button>
              </>
            }
          >
            {(a) => (
              <>
                <div class="am-head" data-testid="am-head">
                  <div class="w6" data-testid="am-name">{a().name}</div>
                  <div class="t12 i3">{a().email ?? a().handle ?? ""}</div>
                </div>
                <Show when={(a().channels?.length ?? 0) > 1}>
                  <button type="button" role="menuitem" class="am-item" disabled={isWaiting("ytswitch")} onClick={() => void run("ytswitch", "account.youtube.switchChannel", false)} data-testid="am-switch">
                    <Icon n="swap_horiz" s={20} />
                    <span class="f1">{isWaiting("ytswitch") ? t("w2_src_waiting") : t("w2_acct_switch_channel")}</span>
                  </button>
                </Show>
                <button type="button" role="menuitem" class="am-item" onClick={() => void run("ytout", "account.youtube.logout", true)} data-testid="am-logout">
                  <Icon n="logout" s={20} />
                  <span class="f1">{t("w2_acct_logout")}</span>
                </button>
              </>
            )}
          </Show>
          <div class="am-sep" />
          <button type="button" role="menuitem" class="am-item" onClick={() => { close(false); navigate("settings", { page: "sources" }); }} data-testid="am-settings">
            <Icon n="gear" s={20} />
            <span class="f1">{t("settings")}</span>
          </button>
          <Show when={err()}>{(m) => <div class="am-err t12" role="alert">{m()}</div>}</Show>
        </div>
      </Show>
      <Show when={token()}>
        <TokenLogin onClose={() => setToken(false)} />
      </Show>
    </div>
  );
}
