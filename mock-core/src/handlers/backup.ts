// Mock of api.md 3.15 (M4-3b): backup.create/inspect/restore, import.foreignBackup, crash.pending/dismiss,
// onboarding.state/complete and app.logs.tail. Nothing touches the disk: the path only decides the answer.
//   inspect: a path containing "corrupt" -> {ok:false}; "android" -> platform android; "v1" -> platform desktop-v1; else desktop.
//   foreignBackup: a path containing "corrupt" -> bad_request, else {imported: 42}.
// Test seams (not in api.md, mock only): mock.onboarding.reset {firstRun}, mock.crash.raise {summary?}.
import type { HandlerModule, MockState } from "../state.ts";
import { bad, reqStr } from "../util.ts";

type Crash = { when: number; summary: string; path: string };
type Local = { completed: boolean; crash: Crash | null; restored: string[] };
const locals = new WeakMap<MockState, Local>();
const local = (st: MockState): Local => {
  let l = locals.get(st);
  if (!l) locals.set(st, (l = { completed: true, crash: null, restored: [] }));
  return l;
};

const CREATED_AT = Date.UTC(2026, 10, 20, 8, 30, 0);
const DB_VERSION = 47;

function inspect(path: string) {
  const p = path.toLowerCase();
  if (p.includes("corrupt")) return { ok: false, platform: "unknown", dbVersion: 0, error: "Not a MinMusic backup (backup.json is missing)" };
  const platform = p.includes("android") ? "android" : p.includes("v1") ? "desktop-v1" : "desktop";
  return { ok: true, platform, dbVersion: DB_VERSION, createdAt: CREATED_AT };
}

/** Deterministic log text: `lines` lines, level mix about 70 % INFO / 20 % WARN / 10 % ERROR, a stack line after each ERROR. */
function logText(file: string, lines: number): string {
  const out: string[] = [];
  const base = Date.UTC(2026, 10, 23, 9, 0, 0);
  const lv = ["INFO", "INFO", "INFO", "INFO", "INFO", "INFO", "INFO", "WARN", "WARN", "ERROR"];
  for (let i = 0; out.length < lines; i++) {
    const level = lv[(i * 7) % lv.length]!;
    const ts = new Date(base + i * 1500).toISOString().replace("T", " ").replace("Z", "");
    out.push(`${ts} ${level} [${file}] event ${i}: ${level === "ERROR" ? "request failed (timeout)" : level === "WARN" ? "slow response 1840 ms" : "ok"}`);
    if (level === "ERROR" && out.length < lines) out.push(`    at com.minmusic.${file}.Handler.run(Handler.kt:${40 + (i % 50)})`);
  }
  return out.slice(0, lines).join("\n") + "\n";
}

export const handlers: HandlerModule["handlers"] = {
  "backup.create": (p) => ({ bytes: 1_048_576 + reqStr(p, "path").length * 1024 }),
  "backup.inspect": (p) => inspect(reqStr(p, "path")),
  "backup.restore": (p, { st }) => {
    const path = reqStr(p, "path");
    const i = inspect(path);
    if (!i.ok) throw bad(i.error!);
    local(st).restored.push(path);
    return { staged: true };
  },
  "import.foreignBackup": (p) => {
    const path = reqStr(p, "path");
    if (path.toLowerCase().includes("corrupt")) throw bad("Not a supported library backup");
    return { imported: 42 };
  },
  "crash.pending": (_p, { st }) => {
    const c = local(st).crash;
    return c ? { report: c } : {};
  },
  "crash.dismiss": (_p, { st }) => {
    local(st).crash = null;
    return {};
  },
  "onboarding.state": (_p, { st }) => ({ completed: local(st).completed }),
  "onboarding.complete": (_p, { st }) => {
    local(st).completed = true;
    return {};
  },
  "app.logs.tail": (p) => {
    if (!["app", "shell", "ui"].includes(p?.file)) throw bad("file: app|shell|ui");
    if (!Number.isInteger(p?.lines) || p.lines < 1 || p.lines > 2000) throw bad("lines: 1..2000");
    return { text: logText(p.file, p.lines) };
  },
  "mock.onboarding.reset": (p, { st }) => {
    local(st).completed = p?.firstRun !== true;
    return {};
  },
  "mock.crash.raise": (p, { st }) => {
    local(st).crash = {
      when: Date.UTC(2026, 10, 22, 21, 5, 0),
      summary: String(p?.summary ?? "java.lang.IllegalStateException: player released twice"),
      path: "C:\\mock\\crashes\\2026-11-22T21-05-00.json",
    };
    return {};
  },
};
