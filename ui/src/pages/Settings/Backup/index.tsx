import { Show, createSignal } from "solid-js";
import { Icon } from "../../../components/Icon";
import { client } from "../../../lib/core";
import { plural, t } from "../../../i18n";
import { toast } from "../../../toast";
import { confirmRestore } from "../../../dialogs/RestoreConfirm";
import { BACKUP_FILTERS, defaultBackupName, pickFile, restartApp, saveFile } from "./native";
import { fmtBytes, type Inspect } from "./logic";
import "../rows.css";
import "./backup.css";

export const category = { key: "Backup", order: 110, icon: "set_backup", titleKey: "w2_set_cat_backup" };

type Op = "create" | "restore" | "import";
type Status = { op: Op; kind: "ok" | "err"; text: string };

const errText = (e: unknown) => (e as { msg?: string; message?: string })?.msg ?? (e as Error)?.message ?? t("w2_error_generic");

export default function BackupSettings() {
  const [busy, setBusy] = createSignal<Op | null>(null);
  const [status, setStatus] = createSignal<Status | null>(null);
  const say = (op: Op, kind: Status["kind"], text: string) => setStatus({ op, kind, text });

  const create = async () => {
    if (busy()) return;
    const path = await saveFile(defaultBackupName());
    if (!path) return; // cancelled
    setBusy("create");
    setStatus(null);
    try {
      const r = await client.call<{ bytes: number }>("backup.create", { path });
      say("create", "ok", t("w2_bk_created_ok", fmtBytes(r.bytes)));
      toast({ text: t("w2_bk_created_ok", fmtBytes(r.bytes)) });
    } catch (e) {
      say("create", "err", t("w2_bk_failed", errText(e)));
    } finally {
      setBusy(null);
    }
  };

  const restore = async () => {
    if (busy()) return;
    const path = await pickFile(BACKUP_FILTERS);
    if (!path) return;
    setBusy("restore");
    setStatus(null);
    try {
      const info = await client.call<Inspect>("backup.inspect", { path });
      // the confirm dialog shows platform, dbVersion and createdAt; its button stays off when the file cannot be restored
      if (!(await confirmRestore(info, path))) return;
      await client.call("backup.restore", { path });
      say("restore", "ok", t("w2_bk_restoring"));
      await restartApp(); // normal quit + relaunch; the core applies the staged restore at boot
    } catch (e) {
      say("restore", "err", t("w2_bk_failed", errText(e)));
    } finally {
      setBusy(null);
    }
  };

  const importForeign = async () => {
    if (busy()) return;
    const path = await pickFile(BACKUP_FILTERS);
    if (!path) return;
    setBusy("import");
    setStatus(null);
    try {
      const r = await client.call<{ imported: number }>("import.foreignBackup", { path });
      say("import", "ok", plural("w2_bk_imported", r.imported));
      toast({ text: plural("w2_bk_imported", r.imported) });
    } catch (e) {
      say("import", "err", t("w2_bk_failed", errText(e)));
    } finally {
      setBusy(null);
    }
  };

  const Row = (p: { op: Op; name: string; desc: string; label: string; icon: string; run: () => void; testid: string }) => (
    <div class="sr-row bk-row" data-testid={`bk-${p.op}`}>
      <div class="sr-lbl">
        <span class="sr-name">{p.name}</span>
        <span class="t12 i3">{p.desc}</span>
        <Show when={status()?.op === p.op ? status() : null}>
          {(s) => (
            <span class="t12 bk-status" classList={{ err: s().kind === "err" }} role="status" data-testid={`bk-${p.op}-status`}>
              {s().text}
            </span>
          )}
        </Show>
      </div>
      <button type="button" class="sr-btn bk-btn" disabled={!!busy()} data-testid={p.testid} onClick={p.run}>
        <Icon n={p.icon} s={16} />
        <span>{busy() === p.op ? t("w2_bk_working") : p.label}</span>
      </button>
    </div>
  );

  return (
    <div class="sr-page" data-testid="set-page" data-page="Backup">
      <section class="sr-group">
        <h2 class="ovl sr-title">{t("w2_set_cat_backup")}</h2>
        <div class="box sr-box">
          <Row op="create" name={t("w2_bk_create")} desc={t("w2_bk_create_desc")} label={t("w2_bk_create_btn")} icon="set_backup" run={() => void create()} testid="bk-create-btn" />
          <Row op="restore" name={t("w2_bk_restore")} desc={t("w2_bk_restore_desc")} label={t("w2_bk_restore_btn")} icon="restore" run={() => void restore()} testid="bk-restore-btn" />
        </div>
      </section>
      <section class="sr-group">
        <h2 class="ovl sr-title">{t("w2_bk_import_group")}</h2>
        <div class="box sr-box">
          <Row op="import" name={t("w2_bk_import")} desc={t("w2_bk_import_desc")} label={t("w2_bk_import_btn")} icon="download" run={() => void importForeign()} testid="bk-import-btn" />
        </div>
      </section>
    </div>
  );
}
