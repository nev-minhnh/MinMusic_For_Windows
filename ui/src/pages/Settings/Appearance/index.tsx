import { SettingsPage } from "../RowList";

export const category = { key: "Appearance", order: 10, icon: "set_palette", titleKey: "w2_set_cat_appearance" };

export default function AppearanceSettings() {
  return <SettingsPage page="Appearance" />;
}
