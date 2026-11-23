import { SettingsPage } from "../RowList";

export const category = { key: "Lyrics", order: 50, icon: "lyrics", titleKey: "w2_set_cat_lyrics" };

export default function LyricsSettings() {
  return <SettingsPage page="Lyrics" />;
}
