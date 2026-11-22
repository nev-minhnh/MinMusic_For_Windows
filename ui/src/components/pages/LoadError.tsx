import { Show } from "solid-js";
import { t } from "../../i18n";
import "./pages.css";

/** Inline load failure of a page (core error or unknown id): message plus a retry button. Shown only while there is no data. */
export function LoadError(props: { error: unknown; hasData: boolean; retry: () => void }) {
  return (
    <Show when={props.error && !props.hasData}>
      <div class="pgx-err" role="alert" data-testid="load-error">
        {t("w2_error_generic")}{" "}
        <button type="button" class="btn txt" onClick={() => props.retry()}>
          {t("w2_pg_retry")}
        </button>
      </div>
    </Show>
  );
}
