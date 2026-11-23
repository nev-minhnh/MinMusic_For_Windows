import { For, Index, Show, createSignal, onCleanup } from "solid-js";
import { Chip } from "../../components/Chip";
import { Icon } from "../../components/Icon";
import { IconButton } from "../../components/IconButton";
import { invoke } from "../../lib/tauri";
import { t } from "../../i18n";
import { eqApi, eqState, setEqStatus } from "../../state/eq";
import { Dialog } from "./Dialog";

type Dlg = null | "save" | "rename" | "delete";

/** Profile chips, "+ Lưu hồ sơ", and rename / delete for the current user profile. */
export function ProfileBar() {
  const [dlg, setDlg] = createSignal<Dlg>(null);
  const cur = () => eqState()?.profiles.find((p) => p.id === eqState()?.profileId);
  return (
    <div class="eqp-profiles" data-testid="eq-profiles">
      <div class="chips eqp-chips" role="group" aria-label={t("w2_eq_profiles")}>
        <Index each={eqState()?.profiles ?? []}>
          {(p) => (
            <Chip on={p().id === eqState()?.profileId} onClick={() => void eqApi.setProfile(p().id).catch(() => {})}>
              <span data-testid="eq-profile-chip" data-id={p().id}>{p().name}</span>
            </Chip>
          )}
        </Index>
      </div>
      <button type="button" class="btn ton sm" data-testid="eq-save" onClick={() => setDlg("save")}>
        <Icon n="plus" s={16} />{t("w2_eq_save_profile")}
      </button>
      <Show when={cur() && !cur()!.builtin}>
        <IconButton icon="edit" label={t("w2_eq_rename_profile")} size={32} iconSize={20} testid="eq-rename" onClick={() => setDlg("rename")} />
        <IconButton icon="delete" label={t("w2_eq_delete_profile")} size={32} iconSize={20} testid="eq-delete" onClick={() => setDlg("delete")} />
      </Show>
      <Show when={dlg() === "save"}><SaveDialog onClose={() => setDlg(null)} /></Show>
      <Show when={dlg() === "rename" && cur()}><RenameDialog id={cur()!.id} name={cur()!.name} onClose={() => setDlg(null)} /></Show>
      <Show when={dlg() === "delete" && cur()}><DeleteDialog id={cur()!.id} name={cur()!.name} onClose={() => setDlg(null)} /></Show>
    </div>
  );
}

function SaveDialog(props: { onClose: () => void }) {
  const cur = () => eqState()?.profiles.find((p) => p.id === eqState()?.profileId);
  const canOverwrite = () => !!cur() && !cur()!.builtin;
  const [name, setName] = createSignal(canOverwrite() ? cur()!.name : "");
  const [asNew, setAsNew] = createSignal(!canOverwrite());
  const go = async () => {
    const n = name().trim();
    if (!n) return;
    try {
      await eqApi.saveProfile(n, asNew());
      setEqStatus({ kind: "ok", key: "w2_eq_saved", arg: n });
      props.onClose();
    } catch { /* eqApi reported it */ }
  };
  return (
    <Dialog title={t("w2_eq_save_profile")} onClose={props.onClose} onSubmit={go} testid="eq-dlg-save"
      actions={<><button type="button" class="btn txt" onClick={props.onClose}>{t("w2_eq_cancel")}</button><button type="button" class="btn pri eqp-pri" data-testid="eq-dlg-ok" disabled={!name().trim()} onClick={go}>{t("w2_eq_save")}</button></>}>
      <label class="eqp-field">
        <span class="eqp-lbl">{t("w2_eq_profile_name")}</span>
        <input class="eqp-text" data-testid="eq-profile-name" value={name()} maxLength={48} onInput={(e) => setName(e.currentTarget.value)} />
      </label>
      <Show when={canOverwrite()}>
        <label class="row gap8 t14" style={{ "margin-top": "12px" }}>
          <input type="checkbox" checked={asNew()} onChange={(e) => setAsNew(e.currentTarget.checked)} data-testid="eq-save-as-new" />
          {t("w2_eq_save_as_new")}
        </label>
      </Show>
    </Dialog>
  );
}

function RenameDialog(props: { id: string; name: string; onClose: () => void }) {
  const [name, setName] = createSignal(props.name);
  const go = async () => {
    const n = name().trim();
    if (!n) return;
    try { await eqApi.renameProfile(props.id, n); props.onClose(); } catch { /* reported */ }
  };
  return (
    <Dialog title={t("w2_eq_rename_profile")} onClose={props.onClose} onSubmit={go} testid="eq-dlg-rename"
      actions={<><button type="button" class="btn txt" onClick={props.onClose}>{t("w2_eq_cancel")}</button><button type="button" class="btn pri eqp-pri" data-testid="eq-dlg-ok" disabled={!name().trim()} onClick={go}>{t("w2_eq_save")}</button></>}>
      <label class="eqp-field">
        <span class="eqp-lbl">{t("w2_eq_profile_name")}</span>
        <input class="eqp-text" data-testid="eq-profile-name" value={name()} maxLength={48} onInput={(e) => setName(e.currentTarget.value)} />
      </label>
    </Dialog>
  );
}

function DeleteDialog(props: { id: string; name: string; onClose: () => void }) {
  const go = async () => { try { await eqApi.deleteProfile(props.id); props.onClose(); } catch { /* reported */ } };
  return (
    <Dialog title={t("w2_eq_delete_profile")} onClose={props.onClose} onSubmit={go} testid="eq-dlg-delete"
      actions={<><button type="button" class="btn txt" onClick={props.onClose}>{t("w2_eq_cancel")}</button><button type="button" class="btn pri eqp-pri" data-testid="eq-dlg-ok" onClick={go}>{t("w2_eq_delete")}</button></>}>
      <div class="t14 i2">{t("w2_eq_delete_confirm", props.name)}</div>
    </Dialog>
  );
}

/** AutoEq wizard: search a headphone, choose the variant, apply (eq.autoeq.search / apply). */
export function AutoEqDialog(props: { onClose: () => void }) {
  type Item = { name: string; source: string; variants: string[] };
  const [q, setQ] = createSignal("");
  const [items, setItems] = createSignal<Item[] | null>(null);
  const [variant, setVariant] = createSignal<Record<string, string>>({});
  const [busy, setBusy] = createSignal(false);
  let timer = 0;
  let seq = 0;
  onCleanup(() => clearTimeout(timer));
  const search = (v: string) => {
    setQ(v);
    clearTimeout(timer);
    if (!v.trim()) { setItems(null); return; }
    timer = window.setTimeout(async () => {
      const mine = ++seq;
      try {
        const r = await eqApi.autoeqSearch(v.trim());
        if (mine === seq) setItems(r.items);
      } catch { if (mine === seq) setItems([]); }
    }, 200);
  };
  const apply = async (it: Item) => {
    setBusy(true);
    try {
      await eqApi.autoeqApply(it.name, variant()[it.name] ?? it.variants[0]);
      setEqStatus({ kind: "ok", key: "w2_eq_applied", arg: it.name });
      props.onClose();
    } catch { /* reported */ } finally { setBusy(false); }
  };
  return (
    <Dialog title={t("w2_eq_autoeq")} onClose={props.onClose} testid="eq-dlg-autoeq"
      actions={<button type="button" class="btn txt" onClick={props.onClose}>{t("w2_eq_close")}</button>}>
      <label class="eqp-field">
        <span class="eqp-lbl">{t("w2_eq_autoeq_search")}</span>
        <input class="eqp-text" data-testid="eq-autoeq-q" value={q()} placeholder={t("w2_eq_autoeq_ph")} onInput={(e) => search(e.currentTarget.value)} />
      </label>
      <div class="eqp-results" aria-live="polite" data-testid="eq-autoeq-results">
        <Show when={items()} fallback={<div class="t12 i3">{t("w2_eq_autoeq_hint")}</div>}>
          {(list) => (
            <Show when={list().length} fallback={<div class="t12 i3">{t("w2_eq_autoeq_none")}</div>}>
              <For each={list()}>
                {(it) => (
                  <div class="eqp-res" data-testid="eq-autoeq-item">
                    <div class="f1" style={{ "min-width": "0" }}>
                      <div class="ell w6 t14">{it.name}</div>
                      <div class="ell t12 i3">{it.source}</div>
                    </div>
                    <Show when={it.variants.length > 1}>
                      <select class="eqp-select sm" aria-label={t("w2_eq_variant")} onChange={(e) => setVariant({ ...variant(), [it.name]: e.currentTarget.value })}>
                        <For each={it.variants}>{(v) => <option value={v}>{v}</option>}</For>
                      </select>
                    </Show>
                    <button type="button" class="btn ton sm" disabled={busy()} data-testid="eq-autoeq-apply" onClick={() => void apply(it)}>{t("w2_eq_apply")}</button>
                  </div>
                )}
              </For>
            </Show>
          )}
        </Show>
      </div>
    </Dialog>
  );
}

// ---- Nhập / Xuất APO through the shell's file dialogs (api.md 6: pick_file / save_file). Outside Tauri they resolve to nothing.
const pathOf = (r: unknown): string | null => (typeof r === "string" && r ? r : typeof (r as { path?: unknown } | null)?.path === "string" ? (r as { path: string }).path : null);
export async function importApo() {
  const p = pathOf(await invoke("pick_file", { filters: [{ name: "Equalizer APO / AutoEq", extensions: ["txt"] }] }));
  if (!p) return;
  try {
    await eqApi.importFile(p);
    setEqStatus({ kind: "ok", key: "w2_eq_imported", arg: p.split(/[\\/]/).pop() });
  } catch { /* reported */ }
}
export async function exportApo() {
  const s = eqState();
  if (!s) return;
  const name = s.profiles.find((p) => p.id === s.profileId)?.name ?? "EQ";
  const p = pathOf(await invoke("save_file", { defaultName: `${name}.txt` }));
  if (!p) return;
  try {
    await eqApi.exportFile(s.profileId, p);
    setEqStatus({ kind: "ok", key: "w2_eq_exported", arg: p.split(/[\\/]/).pop() });
  } catch { /* reported */ }
}
