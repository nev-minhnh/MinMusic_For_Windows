import { createSignal } from "solid-js";
import type { AccountGetResult, SourcesListResult } from "@minmusic/protocol";
import { client } from "../../lib/core";

// One shared view of `account` + `sources` (topic `account`: snapshot, then account.changed / sources.changed).
export const [account, setAccount] = createSignal<AccountGetResult>({ signedIn: false });
export const [sources, setSources] = createSignal<SourcesListResult | undefined>(undefined);
/** In-flight web logins and channel switches ("yt", "zing", "ytswitch", "discord"): the row shows "Đang chờ đăng nhập…". */
export const [waiting, setWaiting] = createSignal<Record<string, boolean>>({});
export const isWaiting = (k: string) => !!waiting()[k];

let off: (() => void) | null = null;
let users = 0;

export function applyEvent(name: string, d: any): void {
  if (name === "account.snapshot") {
    setAccount(d.account);
    setSources(d.sources);
  } else if (name === "account.changed") setAccount(d);
  else if (name === "sources.changed") setSources(d);
}

export async function refreshAccount(): Promise<void> {
  try {
    const [a, s] = await Promise.all([client.call<AccountGetResult>("account.get", {}), client.call<SourcesListResult>("sources.list", {})]);
    setAccount(a);
    setSources(s);
  } catch {
    /* the topic keeps trying through reconnects */
  }
}

/** Reference-counted subscription: the first user opens it, the last closes it. Returns the release function. */
export function useAccount(): () => void {
  if (users++ === 0) {
    off = client.sub("account", {}, applyEvent);
    void refreshAccount();
  }
  let done = false;
  return () => {
    if (done) return;
    done = true;
    if (--users === 0) {
      off?.();
      off = null;
    }
  };
}

/** Runs a login-like call with the waiting flag set; always clears the flag. */
export async function withWaiting<T>(key: string, fn: () => Promise<T>): Promise<T> {
  setWaiting((w) => ({ ...w, [key]: true }));
  try {
    return await fn();
  } finally {
    setWaiting((w) => ({ ...w, [key]: false }));
  }
}
