/** Import job state (api.md 3.12 + `import.progress` on the `app` topic). Pure reducer, the page keeps one signal of it. */
export type ProgressEvent = { jobId: string; done: number; total: number; failed: number; failedTracks?: string[]; albumId?: string };
export type JobState =
  | { phase: "idle" }
  | { phase: "running"; jobId: string | null; done: number; total: number; failed: number }
  | { phase: "done"; jobId: string; done: number; total: number; failed: number; failedTracks: string[]; albumId?: string };

export const IDLE: JobState = { phase: "idle" };

/** `import.run` was accepted: events of this job may already have been buffered (jobId arrives with the reply). */
export function started(total: number): JobState {
  return { phase: "running", jobId: null, done: 0, total, failed: 0 };
}

export function bind(s: JobState, jobId: string): JobState {
  return s.phase === "running" ? { ...s, jobId } : s;
}

/** Applies one progress event. Events of another job, stale (done going backwards) or after the end are ignored. */
export function reduce(s: JobState, e: ProgressEvent): JobState {
  if (s.phase !== "running") return s;
  if (s.jobId && s.jobId !== e.jobId) return s;
  if (e.done < s.done) return s;
  const total = e.total > 0 ? e.total : s.total;
  const done = Math.min(e.done, total);
  const failed = Math.min(e.failed, done);
  if (done >= total) return { phase: "done", jobId: e.jobId, done, total, failed, failedTracks: e.failedTracks ?? [], albumId: e.albumId };
  return { phase: "running", jobId: e.jobId, done, total, failed };
}

/** Bar fill 0..1 (drawn as scaleX, never as width). */
export function fraction(s: JobState): number {
  if (s.phase === "idle") return 0;
  return s.total > 0 ? Math.min(1, s.done / s.total) : 0;
}
