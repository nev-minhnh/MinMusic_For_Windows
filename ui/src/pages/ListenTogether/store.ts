// Listen Together state: the `lt` topic (snapshot, then lt.state / lt.joinRequest / lt.suggestion). Suggestions are event-only, so they live here.
import { createSignal } from "solid-js";
import type { LtState } from "@minmusic/protocol";
import { client } from "../../lib/core";
import { toast } from "../../toast";
import { t } from "../../i18n";
import { applyLtEvent, dropSuggestion, ltInitial, type LtModel, type LtSuggestion } from "../../shell/DeviceConnectPanel/model";

const [model, setModel] = createSignal<LtModel>(ltInitial());
export const ltState = (): LtState | undefined => model().state;
export const ltSuggestions = (): LtSuggestion[] => model().suggestions;

const call = (m: string, p?: unknown) => client.call(m, p);
const quiet = (m: string, p?: unknown) => void call(m, p).catch(() => toast({ i18n: "w2_error_generic", level: "error" }));

let off: (() => void) | null = null;
export function startLt() {
  if (off) return;
  off = client.sub("lt", {}, (name, d) => {
    setModel((m) => applyLtEvent(m, name, d));
    // only the host decides on requests and suggestions
    if (ltState()?.status !== "host") return;
    if (name === "lt.joinRequest") {
      const { userId, name: who } = d as { userId: string; name: string };
      toast({ text: t("w2_lt_toast_join", who), action: { label: "w2_lt_approve", run: () => quiet("lt.approve", { userId }) } });
    } else if (name === "lt.suggestion") {
      const s = d as LtSuggestion;
      toast({ text: t("w2_lt_toast_suggest", s.by, s.track?.title ?? s.trackId), action: { label: "w2_lt_approve", run: () => approveSuggestion(s.id) } });
    }
  });
}
export function stopLt() {
  off?.();
  off = null;
  setModel(ltInitial());
}

export const approveSuggestion = (id: string) => {
  setModel((m) => dropSuggestion(m, id));
  quiet("lt.suggestion.approve", { id });
};
export const rejectSuggestion = (id: string) => {
  setModel((m) => dropSuggestion(m, id));
  quiet("lt.suggestion.reject", { id });
};

export const ltActions = {
  /** Returns an error key for the form, or null. */
  async create(name: string): Promise<string | null> {
    try {
      await call("lt.create", { name });
      return null;
    } catch {
      return "failed";
    }
  },
  async join(code: string, name: string): Promise<string | null> {
    try {
      await call("lt.join", { code, name });
      return null;
    } catch (e) {
      const c = (e as { code?: string }).code;
      return c === "not_found" ? "not_found" : c === "bad_request" ? "bad_request" : "failed";
    }
  },
  leave: () => quiet("lt.leave"),
  approve: (userId: string) => quiet("lt.approve", { userId }),
  reject: (userId: string) => quiet("lt.reject", { userId }),
  kick: (userId: string) => quiet("lt.kick", { userId }),
  transferHost: (userId: string) => quiet("lt.transferHost", { userId }),
  suggest: (trackId: string) => quiet("lt.suggest", { trackId }),
  setServer: (url: string) => quiet("lt.setServer", { url }),
  unblock: (id: string) => quiet("lt.unblock", { id }),
};
