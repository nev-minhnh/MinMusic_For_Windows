// M4-3b startup hooks, run once after the first paint (App runs `startup/*.ts`; until it does, input/commands/logs.ts calls run()).
//   1. onboarding.state -> first run: go to the onboarding route
//   2. crash.pending    -> crash prompt
//   3. w2FirstRunDone   -> one-off toast "Đã chuyển sang giao diện mới" (skipped on a true first run: nothing was switched)
import { client } from "../lib/core";
import { navigate } from "../router/router";
import { toast } from "../toast";
import { isFirstRun } from "../pages/Onboarding/machine";

let started = false;

/** Marks the v2 first run as seen. Best effort: an older core without the key refuses, which is fine. */
export async function markFirstRunDone(): Promise<void> {
  try {
    await client.call("settings.set", { values: { w2FirstRunDone: true } });
  } catch {
    /* key unknown (mock, old core) */
  }
}

export async function run(): Promise<void> {
  if (started) return;
  started = true;

  let firstRun = false;
  try {
    firstRun = isFirstRun(await client.call<{ completed?: boolean; firstRun?: boolean }>("onboarding.state"));
  } catch {
    /* no core yet */
  }
  if (firstRun) navigate("onboarding");

  try {
    const { report } = await client.call<{ report?: { when: number; summary: string; path: string } }>("crash.pending");
    if (report) (await import("../dialogs/CrashPrompt")).showCrashPrompt(report);
  } catch {
    /* no core yet */
  }

  try {
    const v = (await client.call<{ values: Record<string, unknown> }>("settings.get", { keys: ["w2FirstRunDone"] })).values.w2FirstRunDone;
    if (v === false) {
      if (!firstRun) toast({ i18n: "w2_firstrun_toast" });
      await markFirstRunDone();
    }
  } catch {
    /* key unknown: nothing to show */
  }
}

/** Test seam: lets a spec run the hooks again. */
export const __resetStartup = () => {
  started = false;
};
