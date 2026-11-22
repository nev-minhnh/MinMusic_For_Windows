import { Show, createSignal } from "solid-js";
import { Dialog } from "./Dialog";
import { mountOnce } from "./m4-3b-host";
import { client } from "../lib/core";
import { locale, t } from "../i18n";
import { fmtWhen } from "../pages/Settings/Backup/logic";
import { openLogFolder } from "../pages/Settings/Backup/native";
import "./m4-3b.css";

export type CrashReport = { when: number; summary: string; path: string };
const [report, setReport] = createSignal<CrashReport | null>(null);

/** Shown at startup when `crash.pending` has a report from the previous run. "Bỏ qua" (and Esc) acknowledge it with `crash.dismiss`. */
export function showCrashPrompt(r: CrashReport): void {
  mountOnce("crash-prompt", () => <CrashPromptHost />);
  setReport(r);
}

function CrashPromptHost() {
  const dismiss = () => {
    setReport(null);
    void client.call("crash.dismiss").catch(() => {});
  };
  return (
    <Dialog
      open={!!report()}
      title={t("w2_crash_title")}
      onClose={dismiss}
      testid="crash-prompt"
      actions={
        <>
          <button type="button" class="btn txt" data-testid="crash-open" onClick={() => void openLogFolder()}>
            {t("w2_crash_open")}
          </button>
          <button type="button" class="btn pri" data-autofocus data-testid="crash-dismiss" onClick={dismiss}>
            {t("w2_crash_dismiss")}
          </button>
        </>
      }
    >
      <Show when={report()}>
        {(r) => (
          <>
            <div class="i2">{t("w2_crash_body")}</div>
            <div class="m3-facts-1 i3 t12">{fmtWhen(r().when, locale())}</div>
            <pre class="m3-summary" data-testid="crash-summary">{r().summary}</pre>
          </>
        )}
      </Show>
    </Dialog>
  );
}
