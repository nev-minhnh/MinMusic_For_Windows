// Onboarding state machine (pure). Steps run in order; every step after "welcome" is skippable and nothing blocks finishing.
//   welcome (language + theme) -> sources -> youtube -> import -> done
export const STEPS = ["welcome", "sources", "youtube", "import"] as const;
export type Step = (typeof STEPS)[number];
export type State = { step: Step; finished: boolean };
export type Event = { type: "next" } | { type: "back" } | { type: "skip" } | { type: "finish" } | { type: "goto"; step: Step };

export const initial = (): State => ({ step: "welcome", finished: false });
export const isLast = (s: State) => s.step === STEPS[STEPS.length - 1];
export const indexOf = (s: State) => STEPS.indexOf(s.step);

/** `finish` always ends the flow (the start button on the last step and the skip-all link). A finished flow ignores every event. */
export function reduce(s: State, e: Event): State {
  if (s.finished) return s;
  const i = indexOf(s);
  switch (e.type) {
    case "next":
    case "skip":
      return isLast(s) ? { ...s, finished: true } : { ...s, step: STEPS[i + 1]! };
    case "back":
      return i > 0 ? { ...s, step: STEPS[i - 1]! } : s;
    case "goto":
      return { ...s, step: e.step };
    case "finish":
      return { ...s, finished: true };
  }
}

/** `onboarding.state` answers {completed} (api.md) or {firstRun} (M4-3a brief): show the flow only on a first run. */
export function isFirstRun(r: { completed?: boolean; firstRun?: boolean } | undefined): boolean {
  if (!r) return false;
  if (typeof r.firstRun === "boolean") return r.firstRun;
  return r.completed === false;
}
