// The M1 no-op list in m1.ts also registers "logs.open" and sorts after logs.ts, so it would win the glob-order registry.
// Re-exporting from a file that sorts after m1.ts makes the real command win. Harmless to keep once m1.ts drops its no-op.
export { commands } from "./logs";
