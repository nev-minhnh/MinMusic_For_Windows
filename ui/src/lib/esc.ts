// Esc stack (frontend-spec section 7): each layer registers a closer; Esc peels the most recent one.
const layers: (() => void)[] = [];

export function pushEsc(close: () => void): () => void {
  layers.push(close);
  return () => {
    const i = layers.lastIndexOf(close);
    if (i >= 0) layers.splice(i, 1);
  };
}
/** Returns true when a layer consumed the Esc. */
export function handleEsc(): boolean {
  const fn = layers.pop();
  if (!fn) return false;
  fn();
  return true;
}
export function escDepth() {
  return layers.length;
}
