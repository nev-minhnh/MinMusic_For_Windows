import { Show } from "solid-js";
import { IconButton } from "../components/IconButton";
import { SearchBox } from "./search/SearchBox";
import { Caption } from "./Caption";
import { back, forward, canBack, canForward, navigate } from "../router/router";
import { AccountButton } from "./account";
import { wClass } from "../lib/layout";
import { t } from "../i18n";

export function TitleBar(props: { searchRef: (el: HTMLInputElement) => void }) {
  return (
    <div class="tbar" data-tauri-drag-region>
      <IconButton icon="back" label={t("w2_back")} disabled={!canBack()} onClick={back} testid="nav-back" />
      <IconButton icon="right" label={t("w2_forward")} disabled={!canForward()} onClick={forward} testid="nav-forward" />
      <Show when={wClass() !== "compact"}>
        <SearchBox inputRef={props.searchRef} />
      </Show>
      <div class="row gap8 mla" data-tauri-drag-region>
        <IconButton icon="dl" label={t("w2_downloads")} onClick={() => navigate("downloads")} testid="tb-downloads" />
        <AccountButton />
      </div>
      <Caption reportRect />
    </div>
  );
}
