import { For, Show, createSignal } from "solid-js";
import { Icon } from "../../components/Icon";
import { Seg } from "../../components/Seg";
import { client } from "../../lib/core";
import { plural, t } from "../../i18n";
import type { PageProps } from "../../router/registry";
import { navigate, type RouteName } from "../../router/router";
import { setSetting, settingValue } from "../../state/settings";
import { toast } from "../../toast";
import { markFirstRunDone } from "../../startup/m4-3b";
import { BACKUP_FILTERS, pickFile } from "../Settings/Backup/native";
import { STEPS, indexOf, initial, isLast, reduce, type Event, type Step } from "./machine";
import "./onboarding.css";

export const routes: RouteName[] = ["onboarding"];

const errText = (e: unknown) => (e as { msg?: string; message?: string })?.msg ?? (e as Error)?.message ?? t("w2_error_generic");

/** First-run flow: language and theme, music sources, optional YouTube sign-in, optional v1/Android backup import. Every step is skippable. */
export default function Onboarding(_props: PageProps) {
  const [st, setSt] = createSignal(initial());
  const [note, setNote] = createSignal<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = createSignal(false);
  const send = (e: Event) => {
    setNote(null);
    const next = reduce(st(), e);
    setSt(next);
    if (next.finished) void complete();
  };

  const complete = async () => {
    try {
      await client.call("onboarding.complete");
    } catch {
      /* the flow still ends: it is shown again next start at worst */
    }
    void markFirstRunDone();
    navigate("home");
  };

  const lang = () => String(settingValue("appLanguage") ?? "SYSTEM");
  const theme = () => String(settingValue("themeMode") ?? "DARK");

  const login = async () => {
    setBusy(true);
    setNote(null);
    try {
      const r = await client.call<{ ok: boolean }>("account.youtube.login");
      setNote(r.ok ? { kind: "ok", text: t("w2_ob_yt_ok") } : { kind: "err", text: t("w2_ob_yt_cancelled") });
    } catch (e) {
      setNote({ kind: "err", text: errText(e) });
    } finally {
      setBusy(false);
    }
  };

  const importBackup = async () => {
    const path = await pickFile(BACKUP_FILTERS);
    if (!path) return;
    setBusy(true);
    setNote(null);
    try {
      const r = await client.call<{ imported: number }>("import.foreignBackup", { path });
      setNote({ kind: "ok", text: plural("w2_bk_imported", r.imported) });
      toast({ text: plural("w2_bk_imported", r.imported) });
    } catch (e) {
      setNote({ kind: "err", text: t("w2_bk_failed", errText(e)) });
    } finally {
      setBusy(false);
    }
  };

  const heading: Record<Step, () => string> = {
    welcome: () => t("w2_ob_welcome_title"),
    sources: () => t("w2_ob_sources_title"),
    youtube: () => t("w2_ob_yt_title"),
    import: () => t("w2_ob_import_title"),
  };

  return (
    <div class="pg" data-testid="onboarding-page">
      <div class="sc ob" data-testid="onboarding" data-step={st().step}>
        <div class="ob-card box">
          <div class="ob-dots" role="progressbar" aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={indexOf(st()) + 1} aria-label={t("w2_ob_progress", indexOf(st()) + 1, STEPS.length)}>
            <For each={STEPS}>{(_, i) => <span class="ob-dot" classList={{ on: i() <= indexOf(st()) }} />}</For>
          </div>
          <h1 class="t28 w6 ob-h" data-testid="ob-title">{heading[st().step]()}</h1>

          <Show when={st().step === "welcome"}>
            <p class="i2">{t("w2_ob_welcome_body")}</p>
            <div class="ob-field">
              <span class="ovl">{t("w2_ob_language")}</span>
              <Seg
                label={t("w2_ob_language")}
                value={lang()}
                onChange={(v) => void setSetting("appLanguage", v)}
                items={[
                  { key: "SYSTEM", label: t("w2_ob_lang_system") },
                  { key: "vi", label: "Tiếng Việt" },
                  { key: "en", label: "English" },
                ]}
              />
            </div>
            <div class="ob-field">
              <span class="ovl">{t("w2_ob_theme")}</span>
              <Seg
                label={t("w2_ob_theme")}
                value={theme()}
                onChange={(v) => void setSetting("themeMode", v)}
                items={[
                  { key: "DARK", label: t("w2_ob_theme_dark") },
                  { key: "LIGHT", label: t("w2_ob_theme_light") },
                  { key: "PURE_BLACK", label: t("w2_ob_theme_black") },
                  { key: "AUTO", label: t("w2_ob_theme_auto") },
                ]}
              />
            </div>
          </Show>

          <Show when={st().step === "sources"}>
            <p class="i2">{t("w2_ob_sources_body")}</p>
            <div class="ob-actions-inline">
              <button type="button" class="btn ton" data-testid="ob-open-sources" onClick={() => navigate("settings", { page: "Sources" })}>
                <Icon n="link" s={20} />
                {t("w2_ob_sources_open")}
              </button>
            </div>
          </Show>

          <Show when={st().step === "youtube"}>
            <p class="i2">{t("w2_ob_yt_body")}</p>
            <div class="ob-actions-inline">
              <button type="button" class="btn ton" disabled={busy()} data-testid="ob-yt-login" onClick={() => void login()}>
                <Icon n="person" s={20} />
                {t("w2_ob_yt_login")}
              </button>
            </div>
          </Show>

          <Show when={st().step === "import"}>
            <p class="i2">{t("w2_ob_import_body")}</p>
            <div class="ob-actions-inline">
              <button type="button" class="btn ton" disabled={busy()} data-testid="ob-import" onClick={() => void importBackup()}>
                <Icon n="download" s={20} />
                {t("w2_ob_import_btn")}
              </button>
            </div>
          </Show>

          <Show when={note()}>
            {(n) => (
              <div class="t12 ob-note" classList={{ err: n().kind === "err" }} role="status" data-testid="ob-note">
                {n().text}
              </div>
            )}
          </Show>

          <div class="ob-nav">
            <Show when={indexOf(st()) > 0} fallback={<span />}>
              <button type="button" class="btn txt" data-testid="ob-back" onClick={() => send({ type: "back" })}>{t("w2_ob_back")}</button>
            </Show>
            <div class="ob-nav-r">
              <Show when={!isLast(st())}>
                <button type="button" class="btn txt" data-testid="ob-skip-all" onClick={() => send({ type: "finish" })}>{t("w2_ob_skip_all")}</button>
              </Show>
              <Show when={st().step !== "welcome" && !isLast(st())}>
                <button type="button" class="btn txt" data-testid="ob-skip" onClick={() => send({ type: "skip" })}>{t("w2_ob_skip")}</button>
              </Show>
              <button type="button" class="btn pri" data-testid="ob-next" onClick={() => send({ type: "next" })}>
                {isLast(st()) ? t("w2_ob_start") : t("w2_ob_next")}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
