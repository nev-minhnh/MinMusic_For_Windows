// Things commands need from the shell without importing it (avoids import cycles with keys.ts).
export type KeyCtx = { focusSearch: () => void };
export const keyCtx: KeyCtx = { focusSearch: () => {} };
export type CmdCtx = { arg?: string; event?: KeyboardEvent };
export type Command = { id?: string; key?: string; run: (c: CmdCtx) => void };
