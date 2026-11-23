import { render } from "solid-js/web";
import "./styles/fonts.css";
import "./styles/tokens.css";
import "./styles/motion.css";
import "./styles/base.css";
import { injectSprite } from "./icons/host";
import { App } from "./shell/App";

injectSprite();
const root = document.getElementById("root")!;
if (location.hash.startsWith("#/mini")) {
  // the mini-player window (M2-4) shares this bundle; its own entry keeps the main app unmounted
  void import("./mini/entry").then((m) => m.mountMini(root));
} else {
  render(() => <App />, root);
}
