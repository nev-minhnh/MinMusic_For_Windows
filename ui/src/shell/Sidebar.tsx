import { For, Show, createResource } from "solid-js";
import { Icon } from "../components/Icon";
import { Art } from "../components/Art";
import { IconButton } from "../components/IconButton";
import { loadAlbums } from "../state/albums";
import { current, navigate } from "../router/router";
import { t } from "../i18n";

type NavItem = { key: string; icon: string; label: string; count?: string; go?: () => void };

function items(): { main: NavItem[]; yours: NavItem[] } {
  return {
    main: [
      { key: "home", icon: "home", label: t("home"), go: () => navigate("home") },
      { key: "search", icon: "search", label: t("search") },
      { key: "library", icon: "lib", label: t("library"), go: () => navigate("library") },
    ],
    yours: [
      { key: "liked", icon: "heart", label: t("w2_liked"), count: "342" },
      { key: "dl", icon: "dl", label: t("w2_downloaded"), count: "1 248" },
      { key: "hist", icon: "clock", label: t("w2_recent") },
      { key: "eq", icon: "tune", label: t("w2_equalizer") },
    ],
  };
}
const activeKey = () => {
  const r = current();
  return r.name === "album" ? "" : r.name;
};

function useAlbums() {
  const [res] = createResource(loadAlbums);
  return res;
}

function Nv(props: { it: NavItem }) {
  return (
    <button
      type="button"
      class="nv"
      classList={{ on: activeKey() === props.it.key }}
      aria-current={activeKey() === props.it.key ? "page" : undefined}
      onClick={() => props.it.go?.()}
      data-testid={`nav-${props.it.key}`}
    >
      <Icon n={props.it.icon} s={20} />
      <span>{props.it.label}</span>
      <Show when={props.it.count}>
        <span class="cnt">{props.it.count}</span>
      </Show>
    </button>
  );
}

/** Expanded sidebar, 256 wide. Only the "Album của tôi" list scrolls. */
export function Sidebar() {
  const albums = useAlbums();
  return (
    <aside class="side" data-testid="sidebar">
      <div class="brand" data-tauri-drag-region>
        <svg class="logo" width="28" height="28" aria-hidden="true">
          <use href="#logo" />
        </svg>
        <span class="t20 w6 f1">{"MinMusic"}</span>
        <IconButton icon="side" label={t("w2_collapse_sidebar")} size={32} />
      </div>
      <div class="col gap4" style={{ "margin-top": "4px" }}>
        <For each={items().main}>{(i) => <Nv it={i} />}</For>
      </div>
      <div class="slbl">{t("w2_yours")}</div>
      <div class="col gap4">
        <For each={items().yours}>{(i) => <Nv it={i} />}</For>
      </div>
      <div class="slbl">
        {t("w2_my_albums_caps")}
        <IconButton icon="plus" label={t("w2_create_album")} size={28} iconSize={16} />
      </div>
      <div class="sal-list">
        <For each={albums()}>
          {(a) => (
            <button type="button" class="sal" onClick={() => navigate("album", { id: a.id })}>
              <Art art={a.art} size={40} />
              <div class="f1">
                <div class="ell">{a.title}</div>
                <div class="t12 ell i3">{a.subtitle}</div>
              </div>
            </button>
          )}
        </For>
      </div>
      <div class="side-foot">
        <button type="button" class="nv">
          <Icon n="gear" s={20} />
          <span>{t("settings")}</span>
        </button>
      </div>
    </aside>
  );
}

/** Rail: 80 (medium, with labels) or 64 (compact, icons only). */
export function Rail(props: { compact: boolean }) {
  const albums = useAlbums();
  return (
    <aside class="side rail" classList={{ cmp: props.compact }} data-testid="rail">
      <div class="brand" data-tauri-drag-region>
        <svg class="logo" width={props.compact ? 24 : 28} height={props.compact ? 24 : 28} aria-hidden="true">
          <use href="#logo" />
        </svg>
      </div>
      <Show when={!props.compact}>
        <IconButton icon="menu" label={t("w2_menu")} />
      </Show>
      <For each={items().main}>
        {(i) =>
          props.compact ? (
            <button type="button" class="ri" classList={{ on: activeKey() === i.key }} aria-label={i.label} title={i.label} onClick={() => i.go?.()} data-testid={`nav-${i.key}`}>
              <Icon n={i.icon} s={20} />
            </button>
          ) : (
            <button type="button" class="rv" classList={{ on: activeKey() === i.key }} onClick={() => i.go?.()} data-testid={`nav-${i.key}`}>
              <span class="pill">
                <Icon n={i.icon} s={20} />
              </span>
              {i.label}
            </button>
          )
        }
      </For>
      <div class="rsep" />
      <For each={items().yours.filter((x) => x.key !== "hist")}>
        {(i) => (
          <button type="button" class="ri" aria-label={i.label} title={i.label}>
            <Icon n={i.icon} s={20} />
          </button>
        )}
      </For>
      <div class="rsep" />
      <div class="rail-albums">
        <For each={albums()?.slice(0, 5)}>
          {(a) => (
            <button type="button" class="ri art" aria-label={a.title} title={a.title} onClick={() => navigate("album", { id: a.id })}>
              <Art art={a.art} size={40} />
            </button>
          )}
        </For>
      </div>
      <button type="button" class="ri" style={{ "margin-top": "auto" }} aria-label={t("settings")} title={t("settings")}>
        <Icon n="gear" s={20} />
      </button>
    </aside>
  );
}
