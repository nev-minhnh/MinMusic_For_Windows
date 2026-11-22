import { For } from "solid-js";
import { Icon } from "../components/Icon";
import { Art } from "../components/Art";
import { IconButton } from "../components/IconButton";
import { albumContext, albumDrop, activeKey, navItems } from "./Sidebar";
import { toggleSidebar } from "../state/shell";
import { userAlbums } from "../state/userAlbums";
import { navigate } from "../router/router";
import { plural, t } from "../i18n";

/** Rail: 80 (medium and undocked expanded, with labels) or 64 (compact, icons only). LS 3.2. */
export function Rail(props: { compact: boolean }) {
  return (
    <aside class="side rail" classList={{ cmp: props.compact }} data-testid="rail">
      <div class="brand" data-tauri-drag-region>
        <svg class="logo" width={props.compact ? 24 : 28} height={props.compact ? 24 : 28} aria-hidden="true">
          <use href="#logo" />
        </svg>
      </div>
      <IconButton icon="menu" label={`${t("w2_menu")} · Ctrl B`} onClick={toggleSidebar} testid="rail-menu" />
      <For each={navItems().main}>
        {(i) =>
          props.compact ? (
            <button type="button" class="ri" classList={{ on: activeKey() === i.key }} aria-label={i.label} title={i.label} onClick={() => navigate(i.route)} data-testid={`nav-${i.key}`}>
              <Icon n={i.icon} s={20} />
            </button>
          ) : (
            <button type="button" class="rv" classList={{ on: activeKey() === i.key }} onClick={() => navigate(i.route)} data-testid={`nav-${i.key}`}>
              <span class="pill">
                <Icon n={i.icon} s={20} />
              </span>
              {i.label}
            </button>
          )
        }
      </For>
      <div class="rsep" />
      <For each={navItems().yours.filter((x) => x.key === "liked" || x.key === "downloads" || x.key === "equalizer")}>
        {(i) => (
          <button type="button" class="ri" classList={{ on: activeKey() === i.key }} aria-label={i.label} title={i.label} onClick={() => navigate(i.route)} data-testid={`nav-${i.key}`}>
            <Icon n={i.icon} s={20} />
          </button>
        )}
      </For>
      <div class="rsep" />
      <div class="rail-albums">
        <For each={userAlbums.all().slice(0, props.compact ? 4 : 5)}>
          {(a) => (
            <button
              type="button"
              ref={albumDrop(() => a.id)}
              class="ri art dnd-tgt"
              classList={{ on: activeKey() === `ua:${a.id}` }}
              aria-label={a.title}
              title={a.count != null ? `${a.title} · ${plural("w2_n_songs", a.count)}` : a.title}
              data-testid="rail-album"
              data-id={a.id}
              onClick={() => navigate("userAlbum", { id: a.id })}
              onContextMenu={albumContext(a)}
            >
              <Art art={a.art} size={40} />
              <span class="sal-ring" aria-hidden="true" />
            </button>
          )}
        </For>
      </div>
      <button type="button" class="ri" classList={{ on: activeKey() === "settings" }} style={{ "margin-top": "auto" }} aria-label={t("settings")} title={t("settings")} onClick={() => navigate("settings")} data-testid="nav-settings">
        <Icon n="gear" s={20} />
      </button>
    </aside>
  );
}
