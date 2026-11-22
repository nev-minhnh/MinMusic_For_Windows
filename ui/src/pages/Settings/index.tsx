import { For, Show, createMemo, createSignal } from "solid-js";
import { Dynamic } from "solid-js/web";
import { Icon } from "../../components/Icon";
import { t } from "../../i18n";
import type { PageProps } from "../../router/registry";
import type { RouteName } from "../../router/routes";
import { categories } from "./categories";
import "./settings.css";

/** Minimal Settings shell: category list (248) + detail pane. M4-1b replaces it with the full one. */
export default function Settings(props: PageProps) {
  const cats = categories();
  const [pick, setPick] = createSignal<string | undefined>(undefined);
  const key = createMemo(() => pick() ?? props.params.page ?? cats[0]?.key);
  const cur = () => cats.find((c) => c.key === key());
  return (
    <div class="sc settings" data-testid="settings">
      <div class="t28 w6" style={{ "margin-top": "16px", "margin-bottom": "24px" }}>{t("settings")}</div>
      <div class="set">
        <nav class="set-cats" aria-label={t("settings")}>
          <For each={cats}>
            {(c) => (
              <button type="button" class="set-cat" classList={{ on: key() === c.key }} onClick={() => setPick(c.key)} data-testid={`set-cat-${c.key}`}>
                <Icon n={c.icon} s={20} />
                <span>{t(c.titleKey)}</span>
              </button>
            )}
          </For>
        </nav>
        <div class="set-detail" data-testid="set-detail">
          <Show when={cur()} fallback={<div class="i3">{t("w2_settings_none")}</div>}>
            {(c) => <Dynamic component={c().component} />}
          </Show>
        </div>
      </div>
    </div>
  );
}
export const routes: RouteName[] = ["settings"];
