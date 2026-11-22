import { Icon } from "../../components/Icon";
import { navigate } from "../../router/router";
import { wClass } from "../../lib/layout";
import { t } from "../../i18n";

/** Stage-1 stub: a plain input that navigates to `search {q}` on Enter. M1-3b replaces this folder. */
export function SearchBox(props: { inputRef?: (el: HTMLInputElement) => void }) {
  return (
    <label class="search" classList={{ narrow: wClass() === "medium" }} data-testid="search-box">
      <Icon n="search" s={20} />
      <input
        ref={props.inputRef}
        type="search"
        placeholder={t("w2_search_ph")}
        aria-label={t("search")}
        onKeyDown={(e) => {
          const q = e.currentTarget.value.trim();
          if (e.key === "Enter" && q) navigate("search", { q });
        }}
      />
      <span class="kbd">{"Ctrl K"}</span>
    </label>
  );
}
