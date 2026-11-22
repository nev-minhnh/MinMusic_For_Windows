import { t } from "../../i18n";

/** Category titles as literal t() calls: the i18n scanner only emits keys it can see, and categories name theirs by string. */
export const categoryTitles: Record<string, () => string> = {
  w2_set_cat_appearance: () => t("w2_set_cat_appearance"),
  w2_set_cat_playback: () => t("w2_set_cat_playback"),
  w2_set_cat_lyrics: () => t("w2_set_cat_lyrics"),
  w2_set_cat_content: () => t("w2_set_cat_content"),
  w2_set_cat_privacy: () => t("w2_set_cat_privacy"),
  w2_set_cat_shortcuts: () => t("w2_set_cat_shortcuts"),
  w2_set_cat_about: () => t("w2_set_cat_about"),
  w2_set_cat_equalizer: () => t("w2_set_cat_equalizer"),
};
