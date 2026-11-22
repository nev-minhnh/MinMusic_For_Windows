import { SettingsPage } from "../RowList";

export const category = { key: "Playback", order: 20, icon: "play", titleKey: "w2_set_cat_playback" };

export default function PlaybackSettings() {
  return <SettingsPage page="Playback" />;
}
