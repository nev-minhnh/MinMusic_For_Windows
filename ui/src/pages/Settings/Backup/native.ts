import { invoke } from "../../../lib/tauri";
import { devBuild } from "../../../lib/core";

type Filter = { name: string; extensions: string[] };

/** Shell command with a test seam: dev and e2e builds let `window.__mmNative[cmd](args)` answer (file dialogs, app_restart). */
export async function native<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T | undefined> {
  if (devBuild) {
    const o = (window as unknown as { __mmNative?: Record<string, (a?: unknown) => unknown> }).__mmNative?.[cmd];
    if (o) return (await o(args)) as T;
  }
  return (await invoke(cmd, args)) as T | undefined;
}

/** `pick_file` (tauri-plugin-dialog): the chosen path, or null when cancelled (or outside the shell). */
export async function pickFile(filters?: Filter[]): Promise<string | null> {
  const p = await native<string | null>("pick_file", { filters });
  return typeof p === "string" && p ? p : null;
}
/** `save_file`: the chosen destination path, or null when cancelled. */
export async function saveFile(defaultName: string): Promise<string | null> {
  const p = await native<string | null>("save_file", { defaultName });
  return typeof p === "string" && p ? p : null;
}
export const restartApp = () => native("app_restart");
export const openLogFolder = () => native("open_log_folder");

export const BACKUP_FILTERS: Filter[] = [{ name: "MinMusic backup", extensions: ["zip", "mmbackup"] }];

/** `MinMusic-backup-2026-11-23.zip` */
export function defaultBackupName(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `MinMusic-backup-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.zip`;
}
