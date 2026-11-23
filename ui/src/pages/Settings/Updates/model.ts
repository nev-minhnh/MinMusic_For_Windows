// Pure helpers of the Updates page (M5-2): the update.status shape (api.md 3.15), what to show, notes as plain text.

export type UpdState = "idle" | "checking" | "downloading" | "ready" | "error";
export type UpdateStatus = {
  channel: string;
  lastCheck?: number | null;
  available?: { version: string; notes: string; size?: number | null } | null;
  state: UpdState;
  progress?: number | null;
  currentVersion: string;
  portable: boolean;
  error?: string | null;
};

/** The settings keys the page edits (core settings; mirrored to shell.json for the shell before the core is up). */
export const CHANNELS = ["stable", "prerelease"] as const;
export type Channel = (typeof CHANNELS)[number];
export const channelOf = (v: unknown): Channel => (v === "" || v === "stable" || v === "release" || v === undefined || v === null ? "stable" : "prerelease");

export type View = {
  busy: boolean;
  canCheck: boolean;
  canInstall: boolean;
  showReleasePage: boolean;
  /** 0..100, only while downloading or ready */
  percent: number | null;
  headline: "uptodate" | "available" | "checking" | "downloading" | "ready" | "error" | "never";
};

export function viewOf(s: UpdateStatus | undefined): View {
  if (!s) return { busy: false, canCheck: false, canInstall: false, showReleasePage: false, percent: null, headline: "never" };
  const busy = s.state === "checking" || s.state === "downloading" || s.state === "ready";
  const has = !!s.available;
  let headline: View["headline"];
  if (s.state === "error") headline = "error";
  else if (s.state === "checking") headline = "checking";
  else if (s.state === "downloading") headline = "downloading";
  else if (s.state === "ready") headline = "ready";
  else if (has) headline = "available";
  else if (s.lastCheck) headline = "uptodate";
  else headline = "never";
  const pct = s.state === "downloading" || s.state === "ready" ? Math.round(Math.min(1, Math.max(0, s.progress ?? 0)) * 100) : null;
  return {
    busy,
    canCheck: !busy,
    canInstall: !busy && has && !s.portable,
    showReleasePage: s.portable && has,
    percent: pct,
    headline,
  };
}

/**
 * Release notes arrive as Markdown. They are shown as plain paragraphs: no HTML is ever
 * interpreted (the result is rendered as text nodes) and the common Markdown markers are dropped.
 */
export function noteParagraphs(md: string): string[] {
  return md
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((block) =>
      block
        .split("\n")
        .map((l) =>
          l
            .replace(/^\s{0,3}#{1,6}\s+/, "")
            .replace(/^\s*>\s?/, "")
            .replace(/^\s*[-*+]\s+/, "• ")
            .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
            .replace(/(\*\*|__|`)/g, "")
            .trimEnd(),
        )
        .filter((l) => l.trim() !== "")
        .join("\n"),
    )
    .filter((p) => p !== "");
}

export function formatSize(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "";
  const mb = bytes / (1024 * 1024);
  return mb >= 10 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`;
}

/** `window.__TAURI__.event.listen` (withGlobalTauri). */
export type Listen = (name: string, cb: (e: { payload: unknown }) => void) => Promise<() => void>;
