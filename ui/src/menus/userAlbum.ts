import { SEP, tidy, type MenuItem } from "./types";
import { cardMenu } from "./card";
import { t } from "../i18n";
import { inTauri } from "../lib/tauri";
import { confirm } from "../dialogs/Confirm";
import { prompt } from "../dialogs/Prompt";
import { userAlbums, type UserAlbum } from "../state/userAlbums";
import { toast } from "../toast";
import type { Item } from "../lib/types";

const asItem = (a: UserAlbum): Item => ({ t: "playlist", id: a.id, title: a.title, art: a.art, source: "local", local: true, count: a.count });

export async function renameAlbum(a: UserAlbum): Promise<void> {
  const title = await prompt({ title: t("w2_rename_album"), label: t("w2_album_name"), value: a.title, okLabel: t("w2_rename") });
  if (title && title !== a.title) await userAlbums.rename(a.id, title).catch(() => toast({ i18n: "w2_error_generic", level: "error" }));
}

export async function deleteAlbum(a: UserAlbum): Promise<boolean> {
  const ok = await confirm({ title: t("w2_delete_album_q", a.title), body: t("w2_delete_album_body"), danger: true, okLabel: t("w2_delete") });
  if (!ok) return false;
  await userAlbums.remove(a.id).catch(() => toast({ i18n: "w2_error_generic", level: "error" }));
  return true;
}

/** "Đổi ảnh bìa": the native file dialog (Tauri plugin), then userAlbum.setCover. A plain browser has no dialog: no-op. */
export async function changeCover(a: UserAlbum): Promise<void> {
  if (!inTauri) return;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const path = await open({ multiple: false, directory: false, filters: [{ name: t("w2_images"), extensions: ["jpg", "jpeg", "png", "webp"] }] });
  if (typeof path === "string") await userAlbums.setCover(a.id, path).catch(() => toast({ i18n: "w2_error_generic", level: "error" }));
}

/** User album card / sidebar entry: the card menu plus Đổi tên (F2), Đổi ảnh bìa, Xoá (Del, with confirmation). */
export function userAlbumMenu(a: UserAlbum): MenuItem[] {
  return tidy([
    ...cardMenu(asItem(a)),
    SEP,
    { id: "rename", label: t("w2_rename_album"), icon: "edit", hint: "F2", run: () => renameAlbum(a) },
    { id: "cover", label: t("w2_change_cover"), icon: "image", run: () => changeCover(a) },
    { id: "delete", label: t("w2_delete"), icon: "delete", hint: "Del", danger: true, run: () => void deleteAlbum(a) },
  ]);
}
