import { For, Show, createMemo, createSignal } from "solid-js";
import { Dynamic } from "solid-js/web";
import { Icon } from "../../components/Icon";
import { t } from "../../i18n";
import type { PageProps } from "../../router/registry";
import { navigate, type RouteName } from "../../router/router";
import { isDesktopKey, settingsSchema } from "../../state/settings";
import { categories } from "./categories";
import { layout, type GroupDef, type PageId, type RowDef } from "./layout";
import { SettingGroup } from "./RowList";
import { filterRows } from "./search";
import { categoryTitles } from "./titles";
import "./settings.css";
import "./rows.css";

export const routes: RouteName[] = ["settings"];

/** Equalizer has its own route: the category list shows it, a click navigates. */
const EQUALIZER = { key: "Equalizer", order: 60, icon: "tune", titleKey: "w2_set_cat_equalizer" };
const title = (key: string) => (categoryTitles[key] ?? (() => t(key)))();

/** Settings shell: 248 px category list + a detail pane (<= 760). Categories come from the glob (conventions section 2). */
export default function Settings(props: PageProps) {
  const cats = categories();
  const items = [...cats.map(({ key, order, icon, titleKey }) => ({ key, order, icon, titleKey })), EQUALIZER].sort((a, b) => a.order - b.order);
  const [pick, setPick] = createSignal<string | undefined>(undefined);
  const [query, setQuery] = createSignal("");
  const key = createMemo(() => pick() ?? props.params.page ?? cats[0]?.key);
  const cur = () => cats.find((c) => c.key === key());

  const hits = createMemo(() => {
    settingsSchema(); // visibility depends on the schema
    return filterRows(layout, query(), isDesktopKey);
  });
  /** hits grouped page -> group, in layout order */
  const results = createMemo(() => {
    const pages = new Map<PageId, Map<string, { group: GroupDef; rows: RowDef[] }>>();
    for (const h of hits()) {
      const g = pages.get(h.page) ?? new Map();
      pages.set(h.page, g);
      const e = g.get(h.group.id) ?? { group: h.group, rows: [] };
      g.set(h.group.id, e);
      e.rows.push(h.row);
    }
    return [...pages].map(([page, groups]) => ({ page, groups: [...groups.values()] }));
  });

  const open = (c: (typeof items)[number]) => {
    if (c.key === EQUALIZER.key) navigate("equalizer");
    else {
      setPick(c.key);
      setQuery("");
    }
  };

  return (
    <div class="sc settings" data-testid="settings">
      <div class="t28 w6" style={{ "margin-top": "16px", "margin-bottom": "24px" }}>{t("settings")}</div>
      <div class="set">
        <div class="set-side">
          <label class="search narrow set-search">
            <Icon n="search" s={20} />
            <input
              type="text"
              data-testid="set-search"
              placeholder={t("w2_set_search")}
              aria-label={t("w2_set_search")}
              value={query()}
              spellcheck={false}
              onInput={(e) => setQuery(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && query()) {
                  setQuery("");
                  e.preventDefault(); // Esc clears first, then leaves (frontend-spec section 7)
                }
              }}
            />
            <Show when={query()}>
              <button type="button" class="ib sr-clear" aria-label={t("w2_set_clear")} onClick={() => setQuery("")}>
                <Icon n="close" s={16} />
              </button>
            </Show>
          </label>
          <nav class="set-cats" aria-label={t("settings")}>
            <For each={items}>
              {(c) => (
                <button type="button" class="set-cat" classList={{ on: !query() && key() === c.key }} onClick={() => open(c)} data-testid={`set-cat-${c.key}`} aria-current={!query() && key() === c.key ? "page" : undefined}>
                  <Icon n={c.icon} s={20} />
                  <span>{title(c.titleKey)}</span>
                </button>
              )}
            </For>
          </nav>
        </div>
        <div class="set-detail" data-testid="set-detail">
          <Show
            when={query().trim()}
            fallback={
              <Show when={cur()} fallback={<div class="i3">{t("w2_settings_none")}</div>} keyed>
                {(c) => <Dynamic component={c.component} />}
              </Show>
            }
          >
            <div data-testid="set-results" class="sr-page">
              <For each={results()} fallback={<div class="i3" data-testid="set-no-match">{t("w2_set_search_none")}</div>}>
                {(r) => (
                  <section>
                    <h2 class="t20 w6 sr-ptitle">{title(categoryTitleKey(r.page))}</h2>
                    <For each={r.groups}>{(g) => <SettingGroup group={g.group} rows={g.rows} query={query()} />}</For>
                  </section>
                )}
              </For>
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}

const categoryTitleKey = (page: PageId) => `w2_set_cat_${page.toLowerCase()}`;
