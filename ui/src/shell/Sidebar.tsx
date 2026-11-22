import { For, Show, onCleanup } from "solid-js";
import { Icon } from "../components/Icon";
import { Art } from "../components/Art";
import { IconButton } from "../components/IconButton";
import { openMenu } from "../components/Menu";
import { userAlbumMenu } from "../menus/userAlbum";
import { createAlbumWith } from "../menus/song";
import { dropTarget, dragCount } from "../lib/dnd";
import { libraryCounts } from "../state/library";
import { addDropped, userAlbums, type UserAlbum } from "../state/userAlbums";
import { persistSidebarWidth, setSidebarWidthLive, clampSidebar, sidebarWidth, toggleSidebar, setOverlay } from "../state/shell";
import { current, navigate } from "../router/router";
import type { RouteName } from "../router/routes";
import { locale, plural, t } from "../i18n";

export type NavItem = { key: string; icon: string; label: string; route: RouteName; count?: number };

/** Nav groups of LS 3.1: Trang chủ / Tìm kiếm / Thư viện, then "Của bạn". */
export function navItems(): { main: NavItem[]; yours: NavItem[] } {
  const c = libraryCounts();
  return {
    main: [
      { key: "home", icon: "home", label: t("home"), route: "home" },
      { key: "search", icon: "search", label: t("search"), route: "search" },
      { key: "library", icon: "lib", label: t("library"), route: "library" },
    ],
    yours: [
      { key: "liked", icon: "heart", label: t("w2_liked"), route: "liked", count: c?.liked },
      { key: "downloads", icon: "dl", label: t("w2_downloaded"), route: "downloads", count: c?.downloaded },
      { key: "history", icon: "clock", label: t("w2_recent"), route: "history" },
      { key: "stats", icon: "bar_chart", label: t("w2_stats"), route: "stats" },
      { key: "equalizer", icon: "tune", label: t("w2_equalizer"), route: "equalizer" },
    ],
  };
}

/** Which nav entry the current route lights up: the route name, or `ua:<id>` for a user album. */
export const activeKey = (): string => {
  const r = current();
  return r.name === "userAlbum" ? `ua:${r.params.id}` : r.name;
};
export const num = (n: number) => n.toLocaleString(locale());

/** Registers an element as a drop target that adds the dragged tracks to a user album (userAlbum.add, dedupe). */
export const albumDrop = (id: () => string) => (el: HTMLElement) => {
  const off = dropTarget(el, (p) => void addDropped(id(), p.ids));
  onCleanup(off);
};
export const albumContext = (a: UserAlbum) => (e: MouseEvent) => {
  e.preventDefault();
  openMenu(userAlbumMenu(a), { x: e.clientX, y: e.clientY });
};

export async function newAlbum() {
  const id = await createAlbumWith();
  if (id) navigate("userAlbum", { id });
}

function Nv(props: { it: NavItem; onGo?: () => void }) {
  const on = () => activeKey() === props.it.key;
  return (
    <button
      type="button"
      class="nv"
      classList={{ on: on() }}
      aria-current={on() ? "page" : undefined}
      onClick={() => {
        navigate(props.it.route);
        props.onGo?.();
      }}
      data-testid={`nav-${props.it.key}`}
    >
      <Icon n={props.it.icon} s={20} />
      <span>{props.it.label}</span>
      <Show when={props.it.count != null}>
        <span class="cnt">{num(props.it.count!)}</span>
      </Show>
    </button>
  );
}

function AlbumRow(props: { a: UserAlbum; onGo?: () => void }) {
  const on = () => activeKey() === `ua:${props.a.id}`;
  return (
    <button
      type="button"
      ref={albumDrop(() => props.a.id)}
      class="sal dnd-tgt"
      classList={{ on: on() }}
      data-testid="sidebar-album"
      data-id={props.a.id}
      onClick={() => {
        navigate("userAlbum", { id: props.a.id });
        props.onGo?.();
      }}
      onContextMenu={albumContext(props.a)}
    >
      <Art art={props.a.art} size={40} />
      <div class="f1">
        <div class="ell sal-n">{props.a.title}</div>
        <div class="t12 ell i3 sal-sub">{props.a.count != null ? plural("w2_n_songs", props.a.count) : props.a.subtitle}</div>
        <div class="t12 ell sal-drop">{plural("w2_drop_n", dragCount() || 1)}</div>
      </div>
      <span class="sal-ring" aria-hidden="true" />
    </button>
  );
}

/** Drag handle on the right edge: 216-320, persisted when released. */
function Resizer() {
  let raf = 0;
  const move = (e: PointerEvent) => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => setSidebarWidthLive(e.clientX));
  };
  return (
    <div
      class="side-rs"
      role="separator"
      aria-orientation="vertical"
      aria-label={t("w2_resize_sidebar")}
      aria-valuenow={sidebarWidth()}
      aria-valuemin={216}
      aria-valuemax={320}
      tabindex="0"
      data-testid="sidebar-resizer"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        e.currentTarget.addEventListener("pointermove", move);
      }}
      onPointerUp={(e) => {
        e.currentTarget.removeEventListener("pointermove", move);
        cancelAnimationFrame(raf);
        setSidebarWidthLive(e.clientX);
        persistSidebarWidth();
      }}
      onKeyDown={(e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        e.stopPropagation();
        setSidebarWidthLive(clampSidebar(sidebarWidth() + (e.key === "ArrowRight" ? 8 : -8)));
        persistSidebarWidth();
      }}
    />
  );
}

/** Expanded sidebar (216-320, default 256), or the overlay copy on medium and compact. Only the "Album của tôi" list scrolls. */
export function Sidebar(props: { overlay?: boolean }) {
  const close = () => props.overlay && setOverlay(false);
  return (
    <aside class="side" classList={{ ovl: props.overlay }} data-testid={props.overlay ? "sidebar-overlay" : "sidebar"}>
      <div class="brand" data-tauri-drag-region>
        <svg class="logo" width="28" height="28" aria-hidden="true">
          <use href="#logo" />
        </svg>
        <span class="t20 w6 f1">{"MinMusic"}</span>
        <IconButton icon="side" label={`${t("w2_collapse_sidebar")} · Ctrl B`} size={32} onClick={toggleSidebar} testid="sidebar-toggle" />
      </div>
      <div class="col gap4" style={{ "margin-top": "4px" }}>
        <For each={navItems().main}>{(i) => <Nv it={i} onGo={close} />}</For>
      </div>
      <div class="slbl">{t("w2_yours")}</div>
      <div class="col gap4">
        <For each={navItems().yours}>{(i) => <Nv it={i} onGo={close} />}</For>
      </div>
      <div class="slbl">
        {t("w2_my_albums_caps")}
        <IconButton icon="plus" label={t("w2_create_album")} size={28} iconSize={16} onClick={() => void newAlbum()} testid="sidebar-new-album" />
      </div>
      <div class="sal-list" data-testid="sidebar-albums">
        <For each={userAlbums.all()}>{(a) => <AlbumRow a={a} onGo={close} />}</For>
      </div>
      <div class="side-foot">
        <button
          type="button"
          class="nv"
          classList={{ on: activeKey() === "settings" }}
          data-testid="nav-settings"
          onClick={() => {
            navigate("settings");
            close();
          }}
        >
          <Icon n="gear" s={20} />
          <span>{t("settings")}</span>
        </button>
      </div>
      <Show when={!props.overlay}>
        <Resizer />
      </Show>
    </aside>
  );
}
