// Thin wrapper over the Tauri commands from api.md section 6. In a plain browser (dev, Playwright web) calls are no-ops.
type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

export const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown> {
  const inv = (window as any).__TAURI_INTERNALS__?.invoke as Invoke | undefined;
  if (!inv) return Promise.resolve(undefined);
  return inv(cmd, args).catch(() => undefined);
}

export const win = {
  minimize: () => invoke("window_minimize"),
  toggleMaximize: () => invoke("window_toggle_maximize"),
  close: () => invoke("window_close"),
  uiReady: () => invoke("ui_ready"),
  captionRects: (max: [number, number, number, number]) => invoke("caption_rects", { max }),
};
