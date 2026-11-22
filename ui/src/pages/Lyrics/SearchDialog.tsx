import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { Portal } from "solid-js/web";
import { lyricsApi } from "../../state/lyrics";
import { playerState } from "../../state/player";
import { trackDialog } from "../../state/ui";
import { pushEsc } from "../../lib/esc";
import { IconButton } from "../../components/IconButton";
import { t } from "../../i18n";
import "./lyrics.css";

type Cand = { provider: string; synced: "word" | "line" | "none"; preview: string; id: string };

/** "Tìm lời khác": 448 wide dialog (r28, scrim 60 %), focus trap, Enter searches, Esc closes. */
export function LyricsSearchDialog(props: { onClose: () => void }) {
  const [q, setQ] = createSignal(playerState()?.track?.title ?? "");
  const [cands, setCands] = createSignal<Cand[] | null>(null);
  const [busy, setBusy] = createSignal(false);
  let box!: HTMLDivElement;
  let input!: HTMLInputElement;
  let invoker: Element | null = null;

  const run = async () => {
    setBusy(true);
    try { setCands((await lyricsApi.search(q().trim() || undefined)).candidates); } catch { setCands([]); } finally { setBusy(false); }
  };
  const choose = async (c: Cand) => {
    await lyricsApi.choose(c.id);
    props.onClose();
  };
  onMount(() => {
    invoker = document.activeElement;
    trackDialog(true);
    const un = pushEsc(props.onClose);
    input.focus();
    input.select();
    run();
    onCleanup(() => {
      un();
      trackDialog(false);
      (invoker as HTMLElement | null)?.focus?.({ preventScroll: true });
    });
  });
  const trap = (e: KeyboardEvent) => {
    if (e.key !== "Tab") return;
    const f = [...box.querySelectorAll<HTMLElement>("button,input,[tabindex]:not([tabindex='-1'])")].filter((x) => !x.hasAttribute("disabled"));
    if (!f.length) return;
    const first = f[0]!, last = f[f.length - 1]!;
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  return (
    <Portal>
      <div class="dlg-scrim" onPointerDown={(e) => e.target === e.currentTarget && props.onClose()}>
        <div class="dlg" ref={box} role="dialog" aria-modal="true" aria-label={t("w2_m22_ly_find")} data-testid="lyrics-search" onKeyDown={trap}>
          <div class="row">
            <div class="t20 w6 f1">{t("w2_m22_ly_find")}</div>
            <IconButton icon="close" label={t("w2_close")} onClick={props.onClose} />
          </div>
          <div class="dlg-in">
            <input ref={input} value={q()} onInput={(e) => setQ(e.currentTarget.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), run())} placeholder={t("w2_m22_ly_query")} aria-label={t("w2_m22_ly_query")} />
          </div>
          <div class="dlg-list" role="listbox" aria-label={t("w2_m22_ly_results")}>
            <Show when={cands()} fallback={<div class="t14 i3 dlg-note">{busy() ? t("w2_m22_ly_loading") : ""}</div>}>
              <Show when={cands()!.length} fallback={<div class="t14 i3 dlg-note">{t("w2_m22_ly_no_results")}</div>}>
                <For each={cands()}>
                  {(c) => (
                    <button type="button" class="dlg-cand" role="option" data-testid="lyrics-cand" data-synced={c.synced} onClick={() => choose(c)}>
                      <div class="row gap8">
                        <span class="w6 f1 ell">{c.provider}</span>
                        <span class="badge-s">{c.synced === "word" ? t("w2_m22_ly_word") : c.synced === "line" ? t("w2_m22_ly_line") : t("w2_m22_ly_plain")}</span>
                      </div>
                      <div class="t12 i3 ell">{c.preview}</div>
                    </button>
                  )}
                </For>
              </Show>
            </Show>
          </div>
        </div>
      </div>
    </Portal>
  );
}
