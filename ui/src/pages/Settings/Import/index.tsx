import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { Art } from "../../../components/Art";
import { Icon } from "../../../components/Icon";
import { VirtualList } from "../../../components/VirtualList";
import { t, plural } from "../../../i18n";
import { client } from "../../../lib/core";
import { navTo } from "../../../lib/nav";
import type { Art as ArtT } from "../../../lib/types";
import { refresh as refreshAlbums, userAlbums } from "../../../state/userAlbums";
import { toast } from "../../../toast";
import { IDLE, bind, fraction, reduce, started, type JobState, type ProgressEvent } from "./job";
import "./import.css";

export const category = { key: "import", order: 82, icon: "import_pl", titleKey: "w2_imp_title" };
/** Literal t() call so the i18n scanner emits the category title (the shell resolves titleKey by name). */
export const categoryTitle = () => t("w2_imp_title");

type ProviderId = "spotify" | "tidal" | "deezer" | "apple" | "amazon";
type Playlist = { id: string; title: string; count: number; art?: ArtT };
const NAMES: Record<ProviderId, () => string> = {
  spotify: () => t("w2_imp_p_spotify"),
  tidal: () => t("w2_imp_p_tidal"),
  deezer: () => t("w2_imp_p_deezer"),
  apple: () => t("w2_imp_p_apple"),
  amazon: () => t("w2_imp_p_amazon"),
};
const VIRTUAL_FROM = 60;
const ROW_H = 56;

function PlaylistRow(props: { p: Playlist; on: boolean; toggle: () => void; disabled: boolean }) {
  return (
    <button type="button" role="checkbox" aria-checked={props.on} class="im-pl" classList={{ on: props.on }} disabled={props.disabled} onClick={props.toggle} data-testid="imp-pl" data-id={props.p.id}>
      <span class="im-chk" aria-hidden="true">{props.on && <Icon n="import_chk" s={16} />}</span>
      <Art art={props.p.art} size={40} />
      <span class="im-pl-t">{props.p.title}</span>
      <span class="im-pl-n i3 num">{plural("w2_imp_tracks", props.p.count)}</span>
    </button>
  );
}

export default function ImportSettings() {
  const [providers, setProviders] = createSignal<{ id: ProviderId; signedIn: boolean }[]>([]);
  const [waiting, setWaiting] = createSignal<ProviderId | null>(null);
  const [cur, setCur] = createSignal<ProviderId | null>(null);
  const [lists, setLists] = createSignal<Playlist[] | null>(null);
  const [picked, setPicked] = createSignal<Set<string>>(new Set());
  const [target, setTarget] = createSignal("newUserAlbum");
  const [job, setJob] = createSignal<JobState>(IDLE);
  let listSeq = 0;

  const loadProviders = async () => {
    try {
      setProviders((await client.call<{ items: { id: ProviderId; signedIn: boolean }[] }>("import.providers")).items);
    } catch {
      toast({ i18n: "w2_imp_err", level: "error" });
    }
  };

  onMount(() => {
    void loadProviders();
    void refreshAlbums();
    const off = client.sub("app", {}, (name, d) => {
      if (name === "import.progress") setJob((s) => reduce(s, d as ProgressEvent));
    });
    onCleanup(off);
  });

  const busy = () => job().phase === "running";

  const open = async (id: ProviderId) => {
    const seq = ++listSeq;
    setCur(id);
    setLists(null);
    setPicked(new Set<string>());
    setJob(IDLE);
    try {
      const r = await client.call<{ items: Playlist[] }>("import.playlists", { provider: id });
      if (seq === listSeq) setLists(r.items);
    } catch {
      if (seq === listSeq) {
        setCur(null);
        toast({ i18n: "w2_imp_err", level: "error" });
      }
    }
  };

  const login = async (id: ProviderId) => {
    if (waiting()) return;
    setWaiting(id);
    try {
      await client.call("import.login", { provider: id });
      await loadProviders();
      if (providers().find((p) => p.id === id)?.signedIn) await open(id);
    } catch {
      toast({ i18n: "w2_imp_err", level: "error" });
    } finally {
      setWaiting(null);
    }
  };

  const toggle = (id: string) => {
    const s = new Set(picked());
    if (!s.delete(id)) s.add(id);
    setPicked(s);
  };
  const allOn = () => !!lists()?.length && picked().size === lists()!.length;
  const toggleAll = () => setPicked(allOn() ? new Set<string>() : new Set(lists()!.map((l) => l.id)));
  const totalTracks = createMemo(() => (lists() ?? []).filter((l) => picked().has(l.id)).reduce((n, l) => n + l.count, 0));

  const run = async () => {
    const id = cur();
    if (!id || !picked().size || busy()) return;
    setJob(started(totalTracks()));
    try {
      const r = await client.call<{ jobId: string }>("import.run", { provider: id, playlistIds: [...picked()], target: target() });
      setJob((s) => bind(s, r.jobId));
    } catch {
      setJob(IDLE);
      toast({ i18n: "w2_imp_err", level: "error" });
    }
  };

  const fin = () => {
    const s = job();
    return s.phase === "done" ? s : null;
  };
  const countText = () => {
    const s = job();
    return s.phase === "idle" ? "" : t("w2_imp_count", s.done, s.total, s.failed);
  };

  return (
    <div class="sr-page im" data-testid="set-page" data-page="import">
      <section class="sr-group" data-testid="imp-providers">
        <h2 class="ovl sr-title">{t("w2_imp_providers")}</h2>
        <div class="box sr-box">
          <For each={providers()}>
            {(p) => (
              <div class="sr-row im-prov" classList={{ on: cur() === p.id }} data-testid="imp-provider" data-provider={p.id} data-signed={p.signedIn}>
                <span class="im-mono" aria-hidden="true">{NAMES[p.id]().charAt(0)}</span>
                <div class="sr-lbl">
                  <span class="sr-name w6">{NAMES[p.id]()}</span>
                  <span class="t12 i3" data-testid="imp-state">
                    {waiting() === p.id ? t("w2_imp_waiting") : p.signedIn ? t("w2_imp_signed_in") : t("w2_imp_signed_out")}
                  </span>
                </div>
                <Show
                  when={p.signedIn}
                  fallback={
                    <button type="button" class="btn ton sm" classList={{ dis: !!waiting() }} disabled={!!waiting()} onClick={() => void login(p.id)} data-testid="imp-login">
                      {t("w2_imp_login")}
                    </button>
                  }
                >
                  <button type="button" class="btn ton sm" classList={{ dis: busy() }} disabled={busy()} onClick={() => void open(p.id)} data-testid="imp-open">
                    {t("w2_imp_choose")}
                  </button>
                </Show>
              </div>
            )}
          </For>
        </div>
      </section>

      <Show when={cur()}>
        {(id) => (
          <section class="sr-group" data-testid="imp-picker">
            <h2 class="ovl sr-title">{t("w2_imp_playlists", NAMES[id()]())}</h2>
            <Show when={lists()} fallback={<div class="i3 im-pad">{t("w2_loading")}</div>}>
              {(ls) => (
                <>
                  <div class="box sr-box">
                    <Show when={ls().length} fallback={<div class="i3 im-pad">{t("w2_imp_none")}</div>}>
                      <div class="sr-row im-bar">
                        <button type="button" class="btn txt sm" disabled={busy()} onClick={toggleAll} data-testid="imp-all">
                          {allOn() ? t("w2_imp_none_sel") : t("w2_imp_all")}
                        </button>
                        <span class="t12 i3 num" data-testid="imp-sel">{t("w2_imp_selected", picked().size, totalTracks())}</span>
                      </div>
                      <Show
                        when={ls().length > VIRTUAL_FROM}
                        fallback={<For each={ls()}>{(p) => <PlaylistRow p={p} on={picked().has(p.id)} toggle={() => toggle(p.id)} disabled={busy()} />}</For>}
                      >
                        <VirtualList
                          total={ls().length}
                          rowHeight={ROW_H}
                          testid="imp-vlist"
                          label={t("w2_imp_playlists", NAMES[id()]())}
                          render={(i) => {
                            const p = () => ls()[i()];
                            return <Show when={p()}>{(pl) => <PlaylistRow p={pl()} on={picked().has(pl().id)} toggle={() => toggle(pl().id)} disabled={busy()} />}</Show>;
                          }}
                        />
                      </Show>
                    </Show>
                  </div>
                  <div class="im-run">
                    <label class="im-tgt">
                      <span class="t12 i2">{t("w2_imp_target")}</span>
                      <select class="sr-sel" value={target()} disabled={busy()} onChange={(e) => setTarget(e.currentTarget.value)} data-testid="imp-target" aria-label={t("w2_imp_target")}>
                        <option value="newUserAlbum">{t("w2_imp_new_album")}</option>
                        <For each={userAlbums.all()}>{(a) => <option value={a.id}>{a.title}</option>}</For>
                      </select>
                    </label>
                    <button type="button" class="btn pri" classList={{ dis: !picked().size || busy() }} disabled={!picked().size || busy()} onClick={() => void run()} data-testid="imp-run">
                      {t("w2_imp_run")}
                    </button>
                  </div>
                </>
              )}
            </Show>
          </section>
        )}
      </Show>

      <Show when={job().phase !== "idle"}>
        <section class="sr-group" data-testid="imp-job" data-phase={job().phase}>
          <h2 class="ovl sr-title">{t("w2_imp_progress")}</h2>
          <div class="box sr-box im-job">
            <div class="im-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fraction(job()) * 100)} aria-label={t("w2_imp_progress")}>
              <div class="im-fill" style={{ transform: `scaleX(${fraction(job())})` }} />
            </div>
            <div class="t14 num" data-testid="imp-count">{countText()}</div>
            <Show when={fin()}>
              {(f) => (
                <div class="im-sum" data-testid="imp-summary">
                  <div class="w6">{t("w2_imp_done", f().done - f().failed, f().failed)}</div>
                  <Show when={f().failedTracks.length}>
                    <div class="t12 i3">{t("w2_imp_failed_list")}</div>
                    <ul class="im-fails" data-testid="imp-failed">
                      <For each={f().failedTracks}>{(x) => <li class="t12">{x}</li>}</For>
                    </ul>
                  </Show>
                  <Show when={f().albumId}>
                    <button type="button" class="btn ton sm" onClick={() => navTo({ route: "userAlbum", params: { id: f().albumId! } })} data-testid="imp-open-album">
                      {t("w2_imp_open_album")}
                    </button>
                  </Show>
                </div>
              )}
            </Show>
          </div>
        </section>
      </Show>
    </div>
  );
}
