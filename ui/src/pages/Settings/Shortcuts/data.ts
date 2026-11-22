import { t } from "../../../i18n";

/** The key table of frontend-spec section 7 (read-only). Keys are display tokens; `d` is an i18n key. */
export type ShortcutGroup = { id: string; title: () => string; rows: { keys: string[][]; d: () => string }[] };

export const SHORTCUTS: ShortcutGroup[] = [
  {
    id: "play",
    title: () => t("w2_sc_g_play"),
    rows: [
      { keys: [["Space"]], d: () => t("w2_sc_space") },
      { keys: [["←"], ["→"]], d: () => t("w2_sc_seek") },
      { keys: [["↑"], ["↓"], ["+"], ["−"]], d: () => t("w2_sc_vol") },
      { keys: [["M"]], d: () => t("w2_sc_mute") },
      { keys: [["0"], ["1 – 9"]], d: () => t("w2_sc_pct") },
      { keys: [["Ctrl", "→"], ["N"], ["Ctrl", "←"], ["P"]], d: () => t("w2_sc_nextprev") },
      { keys: [["S"], ["R"]], d: () => t("w2_sc_shufrep") },
      { keys: [["Ctrl", "L"]], d: () => t("w2_sc_like") },
      { keys: [["Ctrl", "I"]], d: () => t("w2_sc_info") },
    ],
  },
  {
    id: "panes",
    title: () => t("w2_sc_g_panes"),
    rows: [
      { keys: [["T"]], d: () => t("w2_sc_full") },
      { keys: [["L"], ["Q"], ["D"]], d: () => t("w2_sc_lqd") },
      { keys: [["C"]], d: () => t("w2_sc_cap") },
      { keys: [["V"], ["F"]], d: () => t("w2_sc_vf") },
      { keys: [["F11"]], d: () => t("w2_sc_f11") },
      { keys: [["Ctrl", "M"]], d: () => t("w2_sc_mini") },
      { keys: [["Ctrl", "B"]], d: () => t("w2_sc_sidebar") },
      { keys: [["Ctrl", "E"]], d: () => t("w2_sc_eq") },
    ],
  },
  {
    id: "nav",
    title: () => t("w2_sc_g_nav"),
    rows: [
      { keys: [["Ctrl", "K"], ["Ctrl", "F"], ["/"]], d: () => t("w2_sc_search") },
      { keys: [["Ctrl", ","]], d: () => t("w2_sc_settings") },
      { keys: [["Ctrl", "`"], ["Ctrl", "/"]], d: () => t("w2_sc_sheet") },
      { keys: [["Alt", "←"], ["Alt", "→"]], d: () => t("w2_sc_alt") },
      { keys: [["Esc"]], d: () => t("w2_sc_esc") },
      { keys: [["F5"]], d: () => t("w2_sc_f5") },
    ],
  },
  {
    id: "list",
    title: () => t("w2_sc_g_list"),
    rows: [
      { keys: [["Enter"]], d: () => t("w2_sc_enter") },
      { keys: [["Ctrl", "A"]], d: () => t("w2_sc_all") },
      { keys: [["Ctrl", "C"]], d: () => t("w2_sc_copy") },
      { keys: [["Del"]], d: () => t("w2_sc_del") },
      { keys: [["F2"]], d: () => t("w2_sc_f2") },
    ],
  },
  {
    id: "app",
    title: () => t("w2_sc_g_app"),
    rows: [
      { keys: [["Ctrl", "Shift", "L"]], d: () => t("w2_sc_logs") },
      { keys: [["Ctrl", "Q"]], d: () => t("w2_sc_quit") },
    ],
  },
];
