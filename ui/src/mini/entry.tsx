import { render } from "solid-js/web";
import { core } from "../core/index";
import { initPlayer } from "../state/player";
import { inTauri } from "../lib/tauri";
import { MiniApp } from "./MiniApp";
import "./mini.css";

/** `#/mini` entry: the same bundle as the main window, its own ws client (role `mini`, `player` topic only). */
export function mountMini(root: HTMLElement) {
  // lib/core creates the shared client lazily with role "ui"; creating it here first fixes the role.
  if (inTauri || import.meta.env.VITE_MM_CORE) core({ role: "mini", client: "mini/2.0.0" });
  initPlayer();
  document.documentElement.classList.add("mini-root");
  render(() => <MiniApp />, root);
}
