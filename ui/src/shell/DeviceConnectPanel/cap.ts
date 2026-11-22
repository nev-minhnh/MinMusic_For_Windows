import { createSignal, type Accessor } from "solid-js";
import { core } from "../../core/index";

const real = !!(import.meta.env.VITE_MM_CORE || (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);

/** Reactive "does the core advertise this capability" (sys.hello). Always false without a core (offline stub). */
export function capability(name: string): Accessor<boolean> {
  if (!real) return () => false;
  const c = core();
  const [has, setHas] = createSignal(c.hasCapability(name));
  // a microtask later: the client re-sends its subscriptions right after it announces "ready", and a sub opened inside the status callback would be opened twice
  c.onStatus(() => queueMicrotask(() => setHas(c.hasCapability(name))));
  return has;
}
