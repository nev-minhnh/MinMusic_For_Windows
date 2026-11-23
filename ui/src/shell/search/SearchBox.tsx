import { For, Show, createEffect, createSignal, on, onCleanup } from "solid-js";
import { Art } from "../../components/Art";
import { Icon } from "../../components/Icon";
import { client } from "../../lib/core";
import { isCancelled } from "../../core/errors";
import { openItem } from "../../lib/nav";
import { artistsText } from "../../lib/format";
import { wClass } from "../../lib/layout";
import { current, navigate } from "../../router/router";
import { t } from "../../i18n";
import { MAX_ROWS, buildRows, createSuggester, escStep, historyRows, type SuggestRow } from "./suggest";
import { registerSearchInput } from "./box";
import "./search.css";

const itemOf = (r: SuggestRow) => (r.kind === "item" ? r.item : undefined);
const rowText = (r: SuggestRow) => {
  const it = itemOf(r);
  return it ? (it.t === "artist" ? it.name : it.title) : (r as { q: string }).q;
};
const rowSub = (r: SuggestRow) => {
  const it = itemOf(r);
  if (!it) return "";
  return it.t === "track" ? artistsText(it.artists) : it.t === "artist" ? t("w2_srch_artist") : it.t === "album" ? t("w2_srch_album") : t("w2_srch_playlist");
};

/**
 * Title-bar search field. Typing debounces 120 ms into `search.suggest` (at most 8 rows, up/down and Enter); an empty field lists
 * `search.history.list` with a remove button per row. Enter navigates to `search {q}`. Esc: clear the text, then blur
 * (the third step, back from the results, is the global Esc handler). The popover animates opacity and translate only.
 */
export function SearchBox(props: { inputRef?: (el: HTMLInputElement) => void }) {
  let input!: HTMLInputElement;
  const [value, setValue] = createSignal("");
  const [open, setOpen] = createSignal(false);
  const [rows, setRows] = createSignal<SuggestRow[]>([]);
  const [active, setActive] = createSignal(-1);
  let focused = false;

  const sug = createSuggester({
    call: (q) => client.call("search.suggest", { q }),
    onResult: (q, r) => {
      if (q !== value().trim()) return;
      setRows(buildRows(r));
      setActive(-1);
    },
    isCancelled,
  });
  onCleanup(sug.cancel);

  const loadHistory = () => {
    sug.cancel();
    client
      .call<{ items: string[] }>("search.history.list")
      .then((r) => {
        if (!value().trim()) setRows(historyRows(r.items));
      })
      .catch(() => {});
  };
  const showFor = (v: string) => {
    setActive(-1);
    if (v.trim()) sug.input(v.trim());
    else {
      setRows([]);
      loadHistory();
    }
  };
  const close = () => {
    sug.cancel();
    setOpen(false);
    setActive(-1);
  };
  const submit = (q: string) => {
    const s = q.trim();
    if (!s) return;
    setValue(s);
    close();
    navigate("search", { q: s });
  };
  const pick = (r: SuggestRow) => {
    const it = itemOf(r);
    if (it) {
      close();
      openItem(it);
    } else submit((r as { q: string }).q);
  };
  const removeHist = (q: string) => {
    void client.call("search.history.remove", { q }).catch(() => {});
    setRows((l) => l.filter((x) => !(x.kind === "hist" && x.q === q)));
  };

  // the field mirrors the query of the page on screen (back / forward included)
  createEffect(
    on(
      () => current().key,
      () => {
        const c = current();
        if (c.name === "search") setValue(c.params.q ?? "");
      }
    )
  );

  const onKeyDown = (e: KeyboardEvent) => {
    const n = rows().length;
    if (e.key === "Escape") {
      e.preventDefault();
      if (escStep(value()) === "clear") {
        setValue("");
        close();
      } else {
        close();
        input.blur();
      }
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open()) {
        setOpen(true);
        showFor(value());
        return;
      }
      if (n) setActive((a) => (e.key === "ArrowDown" ? (a + 1) % n : (a - 1 + n) % n));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const r = rows()[active()];
      if (r) pick(r);
      else submit(value());
    }
  };

  return (
    <label class="search" classList={{ narrow: wClass() === "medium" }} data-testid="search-box">
      <Icon n="search" s={20} />
      <input
        ref={(el) => {
          input = el;
          registerSearchInput(el);
          props.inputRef?.(el);
          onCleanup(() => registerSearchInput(undefined));
        }}
        type="text"
        role="combobox"
        aria-expanded={open()}
        aria-controls="sg-list"
        aria-autocomplete="list"
        aria-activedescendant={active() >= 0 ? `sg-${active()}` : undefined}
        autocomplete="off"
        spellcheck={false}
        placeholder={t("w2_search_ph")}
        aria-label={t("search")}
        data-testid="search-input"
        value={value()}
        onInput={(e) => {
          setValue(e.currentTarget.value);
          setOpen(true);
          showFor(e.currentTarget.value);
        }}
        onFocus={() => {
          focused = true;
          setOpen(true);
          showFor(value());
        }}
        onBlur={() => {
          focused = false;
          // popover rows keep focus in the field (pointerdown is cancelled), so a real blur closes it
          setTimeout(() => !focused && close(), 0);
        }}
        onKeyDown={onKeyDown}
      />
      <span class="kbd">{"Ctrl K"}</span>
      <Show when={open() && rows().length > 0}>
        <div class="sg" id="sg-list" role="listbox" data-testid="suggest" onPointerDown={(e) => e.preventDefault()}>
          <For each={rows().slice(0, MAX_ROWS)}>
            {(r, i) => (
              <div
                id={`sg-${i()}`}
                class="sg-row"
                classList={{ on: active() === i() }}
                role="option"
                aria-selected={active() === i()}
                data-testid="suggest-row"
                onMouseMove={() => active() !== i() && setActive(i())}
                onClick={() => pick(r)}
              >
                <Show when={itemOf(r)} fallback={<Icon n={r.kind === "hist" ? "history" : "search"} s={20} class="sg-ic" />}>
                  {(it) => <Art art={it().art} size={32} round={it().t === "artist"} />}
                </Show>
                <div class="sg-t">
                  <div class="ell">{rowText(r)}</div>
                  <Show when={rowSub(r)}>
                    <div class="t12 i3 ell">{rowSub(r)}</div>
                  </Show>
                </div>
                <Show when={r.kind === "hist"}>
                  <button
                    type="button"
                    class="ib sg-x"
                    tabindex="-1"
                    aria-label={t("w2_srch_remove")}
                    data-testid="suggest-remove"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeHist((r as { q: string }).q);
                    }}
                  >
                    <Icon n="close" s={16} />
                  </button>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>
    </label>
  );
}
