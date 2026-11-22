import { For, Show, createEffect, createResource, createSignal, on } from "solid-js";
import type { RouteName } from "../../router/routes";
import type { PageProps } from "../../router/registry";
import { Icon } from "../../components/Icon";
import { client } from "../../lib/core";
import { playerState } from "../../state/player";
import { setSetting, settingValue } from "../../state/settings";
import { toast } from "../../toast";
import { t } from "../../i18n";
import { hasListenTogether } from "../../shell/DeviceConnectPanel/init";
import { approveSuggestion, ltActions, ltState, ltSuggestions, rejectSuggestion } from "./store";
import "./lt.css";

export const routes: RouteName[] = ["listenTogether"];

const ERR = {
  not_found: () => t("w2_lt_err_not_found"),
  bad_request: () => t("w2_lt_err_code"),
  failed: () => t("w2_error_generic"),
} as const;

const copy = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text);
    toast({ i18n: "w2_link_copied" });
  } catch {
    toast({ i18n: "w2_error_generic", level: "error" });
  }
};

/** Idle: create a room, join with a code, pick the server. */
function Idle() {
  const saved = () => String(settingValue("listenTogetherUsername") ?? "");
  const [name, setName] = createSignal(saved());
  const [code, setCode] = createSignal("");
  const [err, setErr] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  createEffect(on(saved, (s) => !name() && setName(s)));
  const [servers, { refetch }] = createResource(() => client.call<{ items: { url: string; name?: string }[]; current?: string }>("lt.servers"));
  createEffect(on(() => ltState()?.server, () => refetch(), { defer: true }));

  const go = async (join: boolean) => {
    const n = name().trim();
    if (!n || busy() || (join && !code().trim())) return;
    setBusy(true);
    setErr(null);
    void setSetting("listenTogetherUsername", n);
    const e = join ? await ltActions.join(code().trim().toUpperCase(), n) : await ltActions.create(n);
    setBusy(false);
    setErr(e);
  };
  const stateErr = () => (ltState()?.error ? (ltState()!.error === "room_not_found" ? t("w2_lt_err_not_found") : ltState()!.error) : null);

  return (
    <div class="lt-idle" data-testid="lt-idle">
      <div class="box lt-card">
        <label class="lt-field">
          <span class="ovl">{t("w2_lt_name")}</span>
          <input class="lt-input" data-testid="lt-name" maxLength={32} value={name()} onInput={(e) => setName(e.currentTarget.value)} placeholder={t("w2_lt_name_ph")} />
        </label>
      </div>
      <div class="lt-cols">
        <div class="box lt-card">
          <div class="t20 w6">{t("w2_lt_create")}</div>
          <div class="i3 t12">{t("w2_lt_create_hint")}</div>
          <button type="button" class="btn pri" classList={{ dis: !name().trim() || busy() }} data-testid="lt-create" onClick={() => void go(false)}>
            <Icon n="add" s={20} />
            {t("w2_lt_create_go")}
          </button>
        </div>
        <div class="box lt-card">
          <div class="t20 w6">{t("w2_lt_join")}</div>
          <div class="i3 t12">{t("w2_lt_join_hint")}</div>
          <input
            class="lt-input lt-codein num"
            data-testid="lt-code-input"
            maxLength={6}
            spellcheck={false}
            aria-label={t("w2_lt_code")}
            placeholder="ABC123"
            value={code()}
            onInput={(e) => {
              setCode(e.currentTarget.value.toUpperCase());
              setErr(null);
            }}
            onKeyDown={(e) => e.key === "Enter" && void go(true)}
          />
          <button type="button" class="btn ton" classList={{ dis: !name().trim() || !code().trim() || busy() }} data-testid="lt-join" onClick={() => void go(true)}>
            {t("w2_lt_join_go")}
          </button>
        </div>
      </div>
      <Show when={err() || stateErr()}>
        <div class="sr-err" role="alert" data-testid="lt-error">{err() ? ERR[err() as keyof typeof ERR]() : stateErr()}</div>
      </Show>
      <div class="box lt-card">
        <label class="lt-field lt-server">
          <span class="f1">
            <span class="w6">{t("w2_lt_server")}</span>
            <span class="i3 t12 lt-block">{t("w2_lt_server_hint")}</span>
          </span>
          <select
            class="sr-sel"
            data-testid="lt-server"
            aria-label={t("w2_lt_server")}
            onChange={(e) => ltActions.setServer(e.currentTarget.value)}
          >
            <For each={servers()?.items ?? []}>{(s) => <option value={s.url} selected={(ltState()?.server ?? servers()?.current) === s.url}>{s.name ?? s.url}</option>}</For>
          </select>
        </label>
      </div>
    </div>
  );
}

function Users(props: { host: boolean }) {
  const room = () => ltState()?.room;
  return (
    <div class="lt-sec">
      <div class="ovl">{t("w2_lt_users", room()?.users.length ?? 0)}</div>
      <div class="box lt-list" data-testid="lt-users">
        <For each={room()?.users ?? []}>
          {(u) => (
            <div class="lt-row" data-testid="lt-user" data-user={u.id} data-host={u.host}>
              <Icon n="person" s={20} />
              <span class="f1 ell w6">{u.name}</span>
              <Show when={u.host}><span class="lt-tag on">{t("w2_lt_host")}</span></Show>
              <Show when={props.host && !u.host}>
                <button type="button" class="btn txt sm" data-testid="lt-transfer" onClick={() => ltActions.transferHost(u.id)}>{t("w2_lt_transfer")}</button>
                <button type="button" class="btn txt sm lt-danger" data-testid="lt-kick" onClick={() => ltActions.kick(u.id)}>{t("w2_lt_kick")}</button>
              </Show>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}

function Host() {
  const room = () => ltState()!.room!;
  const [invite, setInvite] = createSignal("");
  const doInvite = async () => {
    try {
      const { url } = await client.call<{ url: string }>("lt.invite");
      setInvite(url);
      void copy(url);
    } catch {
      toast({ i18n: "w2_error_generic", level: "error" });
    }
  };
  const [blockedBump, setBump] = createSignal(0);
  const [blocked] = createResource(() => `${room().users.length}:${blockedBump()}`, () => client.call<{ items: { id: string; name?: string }[] }>("lt.blocked"));
  return (
    <>
      <div class="box lt-card lt-room">
        <div class="ovl">{t("w2_lt_room_code")}</div>
        <div class="lt-code num" data-testid="lt-code">{room().code}</div>
        <div class="lt-actions">
          <button type="button" class="btn ton sm" data-testid="lt-copy-code" onClick={() => void copy(room().code)}>
            <Icon n="link" s={16} />
            {t("w2_lt_copy_code")}
          </button>
          <button type="button" class="btn ton sm" data-testid="lt-invite" onClick={() => void doInvite()}>
            <Icon n="link" s={16} />
            {t("w2_lt_invite")}
          </button>
        </div>
        <Show when={invite()}>
          <div class="lt-inv num t12" data-testid="lt-invite-url">{invite()}</div>
        </Show>
      </div>

      <Show when={room().pending.length}>
        <div class="lt-sec">
          <div class="ovl">{t("w2_lt_pending", room().pending.length)}</div>
          <div class="box lt-list" data-testid="lt-pending">
            <For each={room().pending}>
              {(u) => (
                <div class="lt-row" data-testid="lt-pending-user" data-user={u.id}>
                  <Icon n="person" s={20} />
                  <span class="f1 ell w6">{u.name}</span>
                  <button type="button" class="btn txt sm" data-testid="lt-reject" onClick={() => ltActions.reject(u.id)}>{t("w2_lt_reject")}</button>
                  <button type="button" class="btn ton sm" data-testid="lt-approve" onClick={() => ltActions.approve(u.id)}>{t("w2_lt_approve")}</button>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>

      <Show when={ltSuggestions().length}>
        <div class="lt-sec">
          <div class="ovl">{t("w2_lt_suggestions", ltSuggestions().length)}</div>
          <div class="box lt-list" data-testid="lt-suggestions">
            <For each={ltSuggestions()}>
              {(s) => (
                <div class="lt-row" data-testid="lt-suggestion" data-suggestion={s.id}>
                  <Icon n="music_note" s={20} />
                  <span class="f1 lt-sg">
                    <span class="w6 ell lt-block">{s.track?.title ?? s.trackId}</span>
                    <span class="i3 t12 ell lt-block">{t("w2_lt_suggested_by", s.by)}</span>
                  </span>
                  <button type="button" class="btn txt sm" data-testid="lt-sg-reject" onClick={() => rejectSuggestion(s.id)}>{t("w2_lt_reject")}</button>
                  <button type="button" class="btn ton sm" data-testid="lt-sg-approve" onClick={() => approveSuggestion(s.id)}>{t("w2_lt_approve")}</button>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>

      <Users host />

      <Show when={blocked()?.items.length}>
        <div class="lt-sec">
          <div class="ovl">{t("w2_lt_blocked", blocked()!.items.length)}</div>
          <div class="box lt-list" data-testid="lt-blocked">
            <For each={blocked()!.items}>
              {(b) => (
                <div class="lt-row" data-testid="lt-blocked-user" data-user={b.id}>
                  <Icon n="block" s={20} />
                  <span class="f1 ell">{b.name ?? b.id}</span>
                  <button type="button" class="btn txt sm" data-testid="lt-unblock" onClick={() => { ltActions.unblock(b.id); setBump((n) => n + 1); }}>{t("w2_lt_unblock")}</button>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>
    </>
  );
}

function Guest() {
  const track = () => playerState()?.track ?? null;
  return (
    <>
      <div class="box lt-card lt-room">
        <div class="ovl">{t("w2_lt_room_code")}</div>
        <div class="lt-code num" data-testid="lt-code">{ltState()!.room!.code}</div>
        <div class="i3 t12">{t("w2_lt_guest_hint")}</div>
        <div class="lt-actions">
          <button type="button" class="btn ton sm" classList={{ dis: !track() }} data-testid="lt-suggest" onClick={() => track() && ltActions.suggest(track()!.id)}>
            <Icon n="music_note" s={16} />
            {track() ? t("w2_lt_suggest_cur", track()!.title) : t("w2_lt_suggest_none")}
          </button>
        </div>
      </div>
      <Users host={false} />
    </>
  );
}

export default function ListenTogether(_props: PageProps) {
  const st = () => ltState();
  const inRoom = () => (st()?.status === "host" || st()?.status === "guest") && !!st()?.room;
  return (
    <div class="sc lt" data-testid="listen-together" data-status={st()?.status ?? "none"}>
      <div class="lt-head">
        <div class="t28 w6 f1">{t("w2_lt_title")}</div>
        <Show when={inRoom()}>
          <button type="button" class="btn ton" data-testid="lt-leave" onClick={() => ltActions.leave()}>{st()!.status === "host" ? t("w2_lt_close_room") : t("w2_lt_leave")}</button>
        </Show>
      </div>
      <Show when={hasListenTogether()} fallback={<div class="empty-state" data-testid="lt-unavailable"><Icon n="block" s={32} /><div class="i3">{t("w2_lt_unavailable")}</div></div>}>
        <Show when={st()} fallback={<div class="i3">{t("w2_dc_loading")}</div>}>
          <Show when={st()!.status !== "connecting"} fallback={<div class="i3" data-testid="lt-connecting">{t("w2_lt_connecting")}</div>}>
            <Show when={inRoom()} fallback={<Idle />}>
              <div class="lt-room-col">
                <Show when={st()!.status === "host"} fallback={<Guest />}>
                  <Host />
                </Show>
              </div>
            </Show>
          </Show>
        </Show>
      </Show>
    </div>
  );
}
