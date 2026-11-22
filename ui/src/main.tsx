import { render } from "solid-js/web";
import "./styles/fonts.css";
import "./styles/tokens.css";
import "./styles/motion.css";
import "./styles/base.css";
import { injectSprite } from "./icons/host";
import { App } from "./shell/App";

injectSprite();
render(() => <App />, document.getElementById("root")!);
