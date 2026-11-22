import { render } from "solid-js/web";
import "./styles/fonts.css";
import "./styles/tokens.css";
import "./styles/motion.css";
import "./styles/base.css";
import sprite from "./icons/sprite.svg?raw";
import { App } from "./shell/App";

document.body.insertAdjacentHTML("afterbegin", sprite);
render(() => <App />, document.getElementById("root")!);
