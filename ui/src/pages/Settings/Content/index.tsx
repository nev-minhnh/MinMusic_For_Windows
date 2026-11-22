import { SettingsPage } from "../RowList";

export const category = { key: "Content", order: 25, icon: "music_note", titleKey: "w2_set_cat_content" };

export default function ContentSettings() {
  return <SettingsPage page="Content" />;
}
