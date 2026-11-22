import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, onMount } from "solid-js";
import { Dialog } from "./Dialog";
import { mountOnce } from "./m4-3b-host";
import { Seg } from "../components/Seg";
import { client } from "../lib/core";
import { t } from "../i18n";
import { toast } from "../toast";
import { openLogFolder } from "../pages/Settings/Backup/native";
import { ROW_H, filterLevel, parseLog, windowOf, type Level } from "./logParse";
import "./m4-3b.css";

type File = "app" | "shell" | "ui";
const [open, setOpen] = createSignal(false);
export const logViewerOpen = open;
export const closeLogViewer = () => setOpen(false);

/** Ctrl Shift L. The host is created on first use. */
export function openLogViewer(): void {
  mountOnce("log-viewer", () => <LogViewerHost />);
  setOpen(true);
}

function LogViewerHost() {
  return (
    <Dialog open={open()} title={t("w2_lv_title")} onClose={closeLogViewer} testid="log-viewer" width={880}>
      <Body />
    </Dialog>
  );
}

function Body() {
  const [file, setFile] = createSignal<File>("app");
  const [min, setMin] = createSignal<"all" | Level>("all");
  const [raw, setRaw] = createSignal<{ text: string; level: Level }[]>([]);
  const [state, setState] = createSignal<"loading" | "ready" | "error">("loading");
  const rows = createMemo(() => filterLevel(raw(), min() === "all" ? null : (min() as Level)));
  const [win, setWin] = createSignal({ start: 0, end: 0 });
  let box!: HTMLDivElement;
  let raf = 0;

  // Windowing: a passive scroll listener only schedules a rAF; the rows are absolutely positioned (fixed 18 px), so no layout reads on scroll.
  const update = () => {
    raf = 0;
    const w = windowOf(box.scrollTop, box.clientHeight || 360, rows().length);
    const c = win();
    const v = Math.ceil((box.clientHeight || 360) / ROW_H);
    // hysteresis: the window moves only after drifting a third of a viewport, or when it reaches either end of the log
    const third = Math.max(1, Math.floor(v / 3));
    const atEdge = (w.start === 0 && c.start !== 0) || (w.end === rows().length && c.end !== w.end);
    if (Math.abs(w.start - c.start) >= third || Math.abs(w.end - c.end) >= third || atEdge) setWin(w);
  };
  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(update);
  };
  onMount(() => box.addEventListener("scroll", schedule, { passive: true }));
  onCleanup(() => {
    box?.removeEventListener("scroll", schedule);
    if (raf) cancelAnimationFrame(raf);
  });

  const toBottom = () =>
    queueMicrotask(() => {
      box.scrollTop = box.scrollHeight;
      setWin(windowOf(box.scrollTop, box.clientHeight || 360, rows().length));
    });

  let seq = 0;
  const load = async () => {
    const my = ++seq;
    setState("loading");
    try {
      const r = await client.call<{ text: string }>("app.logs.tail", { file: file(), lines: 2000 });
      if (my !== seq) return;
      setRaw(parseLog(r.text));
      setState("ready");
      toBottom();
    } catch {
      if (my !== seq) return;
      setRaw([]);
      setState("error");
    }
  };
  createEffect(on(file, () => void load()));
  // a new filter shows the newest matching lines
  createEffect(on(min, () => state() === "ready" && toBottom(), { defer: true }));

  const slice = createMemo(() => {
    const { start, end } = win();
    const n = rows().length;
    const out: number[] = [];
    for (let i = Math.min(start, n); i < Math.min(end, n); i++) out.push(i);
    return out;
  });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(rows().map((r) => r.text).join("\n"));
      toast({ i18n: "w2_lv_copied" });
    } catch {
      toast({ i18n: "w2_error_generic", level: "error" });
    }
  };

  return (
    <div class="lv">
      <div class="lv-bar">
        <Seg
          label={t("w2_lv_file")}
          value={file()}
          onChange={(k) => setFile(k as File)}
          items={[
            { key: "app", label: t("w2_lv_app") },
            { key: "shell", label: t("w2_lv_shell") },
            { key: "ui", label: t("w2_lv_ui") },
          ]}
        />
        <Seg
          label={t("w2_lv_level")}
          value={min()}
          onChange={(k) => setMin(k as "all" | Level)}
          items={[
            { key: "all", label: t("w2_lv_all") },
            { key: "info", label: "INFO" },
            { key: "warn", label: "WARN" },
            { key: "error", label: "ERROR" },
          ]}
        />
      </div>
      <div class="lv-box" ref={box} data-testid="log-box" data-rows={rows().length} tabindex="0" role="log" aria-label={t("w2_lv_title")}>
        <div class="lv-spacer" style={{ height: rows().length * ROW_H + "px" }}>
          <For each={slice()}>
            {(i) => (
              <div class="lv-row" classList={{ warn: rows()[i]?.level === "warn", error: rows()[i]?.level === "error", debug: rows()[i]?.level === "debug" }} style={{ top: i * ROW_H + "px" }} data-testid="log-row">
                {rows()[i]?.text}
              </div>
            )}
          </For>
        </div>
        <Show when={state() !== "ready" || rows().length === 0}>
          <div class="lv-empty i3" data-testid="log-state">
            {state() === "loading" ? t("w2_loading") : state() === "error" ? t("w2_lv_error") : t("w2_lv_empty")}
          </div>
        </Show>
      </div>
      <div class="dlg-actions lv-actions">
        <span class="i3 t12 f1" data-testid="log-count">{t("w2_lv_count", rows().length)}</span>
        <button type="button" class="btn txt" data-testid="log-reload" onClick={() => void load()}>
          {t("w2_lv_reload")}
        </button>
        <button type="button" class="btn txt" data-testid="log-copy" onClick={() => void copy()}>
          {t("w2_lv_copy")}
        </button>
        <button type="button" class="btn txt" data-testid="log-open-folder" onClick={() => void openLogFolder()}>
          {t("w2_lv_open_folder")}
        </button>
        <button type="button" class="btn pri" data-autofocus data-testid="log-close" onClick={closeLogViewer}>
          {t("w2_lv_close")}
        </button>
      </div>
    </div>
  );
}
