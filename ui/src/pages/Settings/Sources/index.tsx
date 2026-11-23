import { For, Show, createMemo, createSignal, onCleanup } from "solid-js";
import type { SourceId, SourceInfo } from "@minmusic/protocol";
import { Icon } from "../../../components/Icon";
import { client } from "../../../lib/core";
import { t } from "../../../i18n";
import { NctLogin } from "../../../dialogs/NctLogin";
import { TokenLogin } from "../../../dialogs/TokenLogin";
import { Switch, errCode, errMsg } from "../../../shell/account/kit";
import { account, isWaiting, refreshAccount, setSources, sources, useAccount, withWaiting } from "../../../shell/account/store";
import { dropIndex, moveItem, normalizeOrder, shiftOf } from "./reorder";
import "./sources.css";

export const category = { key: "sources", order: 30, icon: "source", titleKey: "w2_src_title" };

const statusText = (s: string) => (s === "ok" ? t("w2_src_status_ok") : s === "degraded" ? t("w2_src_status_degraded") : t("w2_src_status_off"));
type Drag = { id: SourceId; from: number; to: number; dy: number; rowH: number };

export default function Sources() {
  onCleanup(useAccount());
  const [dialog, setDialog] = createSignal<"nct" | "token" | null>(null);
  const [errs, setErrs] = createSignal<Record<string, string | undefined>>({});
  const [override, setOverride] = createSignal<SourceId[] | null>(null);
  const [drag, setDrag] = createSignal<Drag | null>(null);
  const setErr = (k: string, v: string | undefined) => setErrs((e) => ({ ...e, [k]: v }));

  const order = createMemo<SourceId[]>(() => {
    const s = sources();
    if (!s) return [];
    return override() ?? normalizeOrder(s.priority, s.items.map((i) => i.id));
  });
  const item = (id: SourceId): SourceInfo | undefined => sources()?.items.find((i) => i.id === id);

  // ---- calls (optimistic where the core only echoes the value back)
  async function setPriority(next: SourceId[]) {
    setOverride(next);
    try {
      await client.call("sources.setPriority", { order: next });
    } catch {
      void refreshAccount();
    } finally {
      setOverride(null);
    }
  }
  async function toggleEnabled(id: SourceId, on: boolean) {
    const s = sources();
    if (!s) return;
    setSources({ ...s, items: s.items.map((i) => (i.id === id ? { ...i, enabled: on, status: on ? i.status : "off" } : i)) });
    try {
      await client.call("sources.setEnabled", { id, on });
    } catch {
      void refreshAccount();
    }
  }
  async function toggleAuto(which: "autoBest" | "autoFallback", on: boolean) {
    const s = sources();
    if (!s) return;
    setSources({ ...s, [which]: on });
    try {
      await client.call(which === "autoBest" ? "sources.setAutoBest" : "sources.setAutoFallback", { on });
    } catch {
      void refreshAccount();
    }
  }
  async function web(key: string, method: string) {
    setErr(key, undefined);
    try {
      await withWaiting(key, () => client.call(method, {}));
    } catch (e) {
      setErr(key, errMsg(errCode(e)));
    }
  }
  async function logout(key: string, method: string) {
    setErr(key, undefined);
    try {
      await client.call(method, {});
    } catch (e) {
      setErr(key, errMsg(errCode(e)));
    }
  }

  // ---- drag to reorder: transform only, pointer events on the handle
  function startDrag(e: PointerEvent, id: SourceId) {
    if (e.button !== 0) return;
    const handle = e.currentTarget as HTMLElement;
    const row = handle.closest<HTMLElement>(".sx-row")!;
    const rowH = row.offsetHeight;
    const from = order().indexOf(id);
    const y0 = e.clientY;
    handle.setPointerCapture(e.pointerId);
    setDrag({ id, from, to: from, dy: 0, rowH });
    const move = (ev: PointerEvent) => {
      const dy = ev.clientY - y0;
      setDrag({ id, from, to: dropIndex(from, dy, rowH, order().length), dy, rowH });
    };
    const end = (ev: PointerEvent) => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      const d = drag();
      setDrag(null);
      if (ev.type === "pointerup" && d && d.to !== d.from) void setPriority(moveItem(order(), d.from, d.to));
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  }
  function handleKey(e: KeyboardEvent, id: SourceId) {
    const dir = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
    if (!dir) return;
    e.preventDefault();
    const from = order().indexOf(id);
    const to = from + dir;
    if (to < 0 || to >= order().length) return;
    void setPriority(moveItem(order(), from, to));
  }
  const rowStyle = (i: number, id: SourceId) => {
    const d = drag();
    if (!d) return undefined;
    if (d.id === id) return { transform: `translateY(${d.dy}px)` };
    const s = shiftOf(i, d.from, d.to, d.rowH);
    return s ? { transform: `translateY(${s}px)` } : undefined;
  };

  function Row(props: { id: SourceId; i: () => number }) {
    const it = () => item(props.id);
    const waitKey = () => (props.id === "yt" ? "yt" : props.id);
    return (
      <Show when={it()}>
        {(src) => (
          <div
            class="sx-row"
            classList={{ drag: drag()?.id === props.id, off: !src().enabled }}
            style={rowStyle(props.i(), props.id)}
            data-testid={`sx-row-${props.id}`}
            data-status={src().status}
          >
            <button
              type="button"
              class="sx-handle"
              aria-label={t("w2_src_drag")}
              title={t("w2_src_drag")}
              data-testid={`sx-handle-${props.id}`}
              onPointerDown={(e) => startDrag(e, props.id)}
              onKeyDown={(e) => handleKey(e, props.id)}
            >
              <Icon n="drag" s={20} />
            </button>
            <span class="sx-rank num i3 t12">{props.i() + 1}</span>
            <div class="f1 col gap4 sx-main">
              <div class="row gap8">
                <span class="w6 sx-name">{src().name}</span>
                <span class={`sx-dot ${src().status}`} role="img" aria-label={statusText(src().status)} title={statusText(src().status)} data-testid={`sx-status-${props.id}`} />
                <Show when={src().vip}>
                  <span class="b sx-vip" data-testid={`sx-vip-${props.id}`}>{t("w2_src_vip")}</span>
                </Show>
                <span class="b q" title={t("w2_src_maxq")} data-testid={`sx-q-${props.id}`}>{src().maxQuality.label}</span>
              </div>
              <div class="t12 i3 sx-sub" aria-live="polite">
                <Show
                  when={isWaiting(waitKey())}
                  fallback={
                    <Show when={errs()[props.id]} fallback={<>{src().signedIn ? (src().account ?? (props.id === "yt" ? account().youtube?.name : "") ?? "") : src().canLogin ? t("w2_src_signedout") : t("w2_src_nologin")}</>}>
                      {(m) => <span class="sx-err" data-testid={`sx-err-${props.id}`}>{m()}</span>}
                    </Show>
                  }
                >
                  <span class="acc" data-testid={`sx-waiting-${props.id}`}>{t("w2_src_waiting")}</span>
                </Show>
              </div>
              <Show when={(props.id === "zing" || props.id === "nct") && src().signedIn && !src().vip}>
                <div class="t12 i3">{t("w2_src_vip_hint")}</div>
              </Show>
            </div>
            <div class="row gap8 sx-act">
              <Show when={src().canLogin}>
                <Show
                  when={src().signedIn}
                  fallback={
                    <>
                      <Show when={props.id === "yt"}>
                        <button type="button" class="btn txt sm" onClick={() => setDialog("token")} data-testid="sx-token">{t("w2_src_token_btn")}</button>
                      </Show>
                      <button
                        type="button"
                        class="btn ton sm"
                        disabled={isWaiting(waitKey())}
                        data-testid={`sx-login-${props.id}`}
                        onClick={() => (props.id === "nct" ? setDialog("nct") : void web(props.id, props.id === "yt" ? "account.youtube.login" : "source.zing.login"))}
                      >
                        {t("w2_acct_login")}
                      </button>
                    </>
                  }
                >
                  <Show when={props.id === "yt" && (account().youtube?.channels?.length ?? 0) > 1}>
                    <button type="button" class="btn txt sm" disabled={isWaiting("ytswitch")} onClick={() => void web("ytswitch", "account.youtube.switchChannel")} data-testid="sx-switch-channel">
                      {isWaiting("ytswitch") ? t("w2_src_waiting") : t("w2_acct_switch_channel")}
                    </button>
                  </Show>
                  <button
                    type="button"
                    class="btn txt sm"
                    data-testid={`sx-logout-${props.id}`}
                    onClick={() => void logout(props.id, props.id === "yt" ? "account.youtube.logout" : props.id === "zing" ? "source.zing.logout" : "source.nct.logout")}
                  >
                    {t("w2_acct_logout")}
                  </button>
                </Show>
              </Show>
              <Switch on={src().enabled} label={t("w2_src_enable", src().name)} onChange={(on) => void toggleEnabled(props.id, on)} testid={`sx-enable-${props.id}`} />
            </div>
          </div>
        )}
      </Show>
    );
  }

  return (
    <div class="sx" data-testid="set-sources">
      <div class="t20 w6 sx-h">{t("w2_src_title")}</div>
      <Show when={sources()} fallback={<div class="i3 t14" data-testid="sx-loading">{t("w2_src_loading")}</div>}>
        {(s) => (
          <>
            <div class="sx-card">
              <div class="sx-line">
                <div class="f1">
                  <div class="w6">{t("w2_src_auto_best")}</div>
                  <div class="t12 i3">{t("w2_src_auto_best_d")}</div>
                </div>
                <Switch on={s().autoBest} label={t("w2_src_auto_best")} onChange={(on) => void toggleAuto("autoBest", on)} testid="sx-auto-best" />
              </div>
              <div class="sx-sep" />
              <div class="sx-line">
                <div class="f1">
                  <div class="w6">{t("w2_src_auto_fb")}</div>
                  <div class="t12 i3">{t("w2_src_auto_fb_d")}</div>
                </div>
                <Switch on={s().autoFallback} label={t("w2_src_auto_fb")} onChange={(on) => void toggleAuto("autoFallback", on)} testid="sx-auto-fallback" />
              </div>
            </div>
            <div class="t12 i3 sx-cap">{t("w2_src_priority")}</div>
            <div class="sx-card sx-list" data-testid="sx-list" classList={{ dragging: !!drag() }}>
              <For each={order()}>{(id, i) => <Row id={id} i={i} />}</For>
            </div>
          </>
        )}
      </Show>
      <Show when={dialog() === "nct"}>
        <NctLogin onClose={() => setDialog(null)} />
      </Show>
      <Show when={dialog() === "token"}>
        <TokenLogin onClose={() => setDialog(null)} />
      </Show>
    </div>
  );
}
