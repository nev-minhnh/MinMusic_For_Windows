// Dev/e2e harness for M3-3 (not part of the app build): /src/shell/account/dev.html#/dev/settings/<sources|integrations>.
// It mounts the title-bar AccountButton and one Settings category through pages/Settings/_dev.tsx, until M4-1b's shell lands.
// Query: ?theme=dark|black|light  ?lang=vi|en
import { createSignal, onCleanup } from "solid-js";
import { render } from "solid-js/web";
import "../../styles/fonts.css";
import "../../styles/tokens.css";
import "../../styles/motion.css";
import "../../styles/base.css";
import { injectSprite } from "../../icons/host";
import { initLayout, wClass, hClass } from "../../lib/layout";
import { setAppLanguage } from "../../i18n";
import { handleEsc } from "../../lib/esc";
import DevSettings from "../../pages/Settings/_dev";
import { AccountButton } from "./AccountButton";

injectSprite();
const q = new URLSearchParams(location.search);
if (q.get("theme")) document.documentElement.dataset.theme = q.get("theme")!;
setAppLanguage(q.get("lang") ?? "SYSTEM");
initLayout();
// the app wires Esc to the stack in input/keys.ts; the harness does it directly
window.addEventListener("keydown", (e) => e.key === "Escape" && handleEsc());

const keyOf = () => /#\/dev\/settings\/([\w-]+)/.exec(location.hash)?.[1] ?? "sources";

function Harness() {
  const [key, setKey] = createSignal(keyOf());
  const onHash = () => setKey(keyOf());
  window.addEventListener("hashchange", onHash);
  onCleanup(() => window.removeEventListener("hashchange", onHash));
  return (
    <div class="win" data-w={wClass()} data-h={hClass()} data-testid="app" style={{ display: "block", position: "fixed", inset: "0" }}>
      <div class="tbar" style={{ position: "absolute", left: "0", right: "0", top: "0", display: "flex", "justify-content": "flex-end", "align-items": "center", padding: "0 16px" }}>
        <AccountButton />
      </div>
      <main style={{ position: "absolute", inset: "48px 0 0 0" }}>
        <DevSettings k={key()} />
      </main>
    </div>
  );
}
render(() => <Harness />, document.getElementById("root")!);
