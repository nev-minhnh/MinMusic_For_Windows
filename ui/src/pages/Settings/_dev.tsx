import { Show } from "solid-js";
import { Dynamic } from "solid-js/web";
import { t } from "../../i18n";
import { categories } from "./categories";
import "./settings.css";

/** Dev/e2e only: `#/dev/settings/<key>` renders one category alone, so a category WP can test before M4-1b lands. */
export default function DevSettings(props: { k: string }) {
  const cat = () => categories().find((c) => c.key === props.k);
  return (
    <div class="pg" data-testid="dev-settings" data-category={props.k}>
      <div class="sc">
        <Show when={cat()} fallback={<div class="i3">{t("w2_settings_none")}</div>}>
          {(c) => <Dynamic component={c().component} />}
        </Show>
      </div>
    </div>
  );
}
