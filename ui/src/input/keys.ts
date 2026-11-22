import { back, forward, canBack } from "../router/router";
import { handleEsc } from "../lib/esc";
import { player } from "../state/player";
import { toggleFull } from "../state/ui";

const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
};

/** Global shortcuts (frontend-spec section 7). Plain keys are ignored while typing. Backspace never navigates. */
export function initKeys(focusSearch: () => void) {
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (!handleEsc() && !typing(e.target) && canBack()) back();
      return;
    }
    if (e.altKey && e.key === "ArrowLeft") {
      e.preventDefault();
      back();
      return;
    }
    if (e.altKey && e.key === "ArrowRight") {
      e.preventDefault();
      forward();
      return;
    }
    if ((e.ctrlKey && e.key.toLowerCase() === "k") || (e.key === "/" && !typing(e.target))) {
      e.preventDefault();
      focusSearch();
      return;
    }
    if (typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === " " || e.code === "Space") {
      e.preventDefault();
      if (!e.repeat) player.toggle();
    } else if (e.key === "t" || e.key === "T") {
      toggleFull();
    }
  });
  // Space on a focused button would click it on keyup; the global handler already took the key.
  window.addEventListener("keyup", (e) => {
    if ((e.key === " " || e.code === "Space") && !typing(e.target)) e.preventDefault();
  });
  // mouse XButton1 / XButton2
  const mouse = (e: MouseEvent) => {
    if (e.button === 3) {
      e.preventDefault();
      if (e.type === "mouseup") back();
    } else if (e.button === 4) {
      e.preventDefault();
      if (e.type === "mouseup") forward();
    }
  };
  window.addEventListener("mouseup", mouse);
  window.addEventListener("auxclick", (e) => (e.button === 3 || e.button === 4) && e.preventDefault());
}
