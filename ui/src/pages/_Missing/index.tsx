import { Icon } from "../../components/Icon";
import { t } from "../../i18n";
import type { PageProps } from "../../router/registry";

/** Rendered for a route that no page module registered yet (empty state). */
export default function Missing(props: PageProps) {
  return (
    <div class="sc missing" data-testid="missing-page" data-route-params={JSON.stringify(props.params)}>
      <div class="empty-state">
        <Icon n="music_note" s={32} />
        <div class="t20 w6">{t("w2_missing_title")}</div>
        <div class="i3">{t("w2_missing_body")}</div>
      </div>
    </div>
  );
}
export const routes: never[] = [];
