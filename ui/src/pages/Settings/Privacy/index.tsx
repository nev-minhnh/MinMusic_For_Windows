import { SettingsPage } from "../RowList";

export const category = { key: "Privacy", order: 100, icon: "set_shield", titleKey: "w2_set_cat_privacy" };

export default function PrivacySettings() {
  return <SettingsPage page="Privacy" />;
}
