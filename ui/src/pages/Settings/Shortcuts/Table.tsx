import { For } from "solid-js";
import { t } from "../../../i18n";
import { SHORTCUTS } from "./data";

/** Read-only shortcut table (frontend-spec section 7), shared by the Settings page and the Ctrl ` dialog. */
export function ShortcutTable() {
  return (
    <div class="sc-tbl" data-testid="shortcut-table">
      <For each={SHORTCUTS}>
        {(g) => (
          <section class="sr-group" data-group={g.id}>
            <h2 class="ovl sr-title">{g.title()}</h2>
            <div class="box sr-box">
              <For each={g.rows}>
                {(r) => (
                  <div class="sr-row sc-row" data-testid="shortcut-row">
                    <div class="sr-lbl"><span class="sr-name">{r.d()}</span></div>
                    <div class="sc-keys">
                      <For each={r.keys}>
                        {(combo) => (
                          <span class="sc-combo">
                            <For each={combo}>{(k) => <kbd class="kbd">{k}</kbd>}</For>
                          </span>
                        )}
                      </For>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </section>
        )}
      </For>
    </div>
  );
}
