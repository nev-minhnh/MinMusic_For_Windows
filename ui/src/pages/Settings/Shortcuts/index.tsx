import { t } from "../../../i18n";
import { ShortcutTable } from "./Table";

export const category = { key: "Shortcuts", order: 90, icon: "set_keyboard", titleKey: "w2_set_cat_shortcuts" };

export default function ShortcutsSettings() {
  return (
    <div class="sr-page" data-testid="set-page" data-page="Shortcuts">
      <p class="i3 t12 sc-note">{t("w2_sc_note")}</p>
      <ShortcutTable />
    </div>
  );
}
