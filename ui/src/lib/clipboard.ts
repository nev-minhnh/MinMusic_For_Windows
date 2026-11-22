import { client } from "./core";
import { toast } from "../toast";

/** `app.copyLink` for each item, joined by newlines onto the clipboard (Ctrl C and the "Sao chép liên kết" menu entry). */
export async function copyLinks(items: { id: string; kind: string }[]): Promise<boolean> {
  if (!items.length) return false;
  try {
    const urls = await Promise.all(items.map((i) => client.call<{ url: string }>("app.copyLink", i).then((r) => r.url)));
    await navigator.clipboard.writeText(urls.join("\n"));
    toast({ i18n: "w2_link_copied" });
    return true;
  } catch {
    toast({ i18n: "w2_error_generic", level: "error" });
    return false;
  }
}
