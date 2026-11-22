// Handle on the title-bar input, so the command file (Ctrl K, Ctrl F and the slash key) can focus it without importing the component.
let input: HTMLInputElement | undefined;
export const registerSearchInput = (el: HTMLInputElement | undefined) => void (input = el);
export function focusSearchBox() {
  if (!input) return;
  input.focus();
  input.select();
}
