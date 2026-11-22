import { For, createSignal, onCleanup, onMount, createResource, type Accessor } from "solid-js";
import { Chip } from "../components/Chip";
import { Card } from "../components/Card";
import { Icon } from "../components/Icon";
import { IconButton } from "../components/IconButton";
import { Row } from "../components/Row";
import { VirtualList } from "../components/VirtualList";
import { QualityBadge } from "../components/Badge";
import { createWindowStore } from "../state/library";
import { client } from "../lib/core";
import { loadAlbums } from "../state/albums";
import { navigate } from "../router/router";
import { player, playerState } from "../state/player";
import { t } from "../i18n";
import type { Track } from "../lib/types";

const SORT = { by: "added", desc: true } as const;

/** Library: header, chips, "Album của tôi" shelf, downloads box and the 5,000-row songs table (VirtualList + library.window chunks of 100). */
export function Library(_props: { params: Record<string, string>; active: Accessor<boolean> }) {
  const store = createWindowStore("songs", SORT);
  const [selected, setSelected] = createSignal(-1);
  const [chip, setChip] = createSignal(0);
  const [albums] = createResource(loadAlbums);
  let range: [number, number] = [0, 40];

  onMount(() => {
    store.ensure(0, 100);
    // library.changed {revision}: drop older chunks and refetch the visible ones
    const off = client.sub("library", {}, (name, d) => {
      if (name === "library.changed") store.invalidate(d.revision, range);
    });
    onCleanup(off);
  });

  const labels = () => ({ like: t("w2_like"), more: t("w2_more"), play: t("w2_play") });
  const chips = () => [t("w2_chip_all"), t("w2_chip_songs"), t("w2_chip_albums"), t("w2_chip_artists"), t("w2_chip_playlists"), t("w2_my_albums"), t("w2_downloaded")];
  const playTrack = (tr: Track) => player.play({ kind: "library", list: "songs", sort: SORT }, { startId: tr.id });
  const openAlbum = (tr: Track) => navigate("album", { id: tr.album?.id ?? tr.id });

  return (
    <div class="sc library" data-testid="library">
      <div class="row gap8 lib-head">
        <div class="t28 w6 f1">{t("library")}</div>
        <span class="btn ton sm">
          <Icon n="plus" s={16} />
          {t("w2_create_album")}
        </span>
        <IconButton icon="sort" label={t("w2_sort")} />
        <div class="seg alt2 s1">
          <button type="button" class="on" style={{ padding: "0 10px" }} aria-label={t("w2_view_grid")}>
            <Icon n="grid" s={16} />
          </button>
          <button type="button" style={{ padding: "0 10px" }} aria-label={t("w2_view_list")}>
            <Icon n="listv" s={16} />
          </button>
        </div>
      </div>
      <div class="chips" style={{ "margin-top": "16px" }}>
        <For each={chips()}>{(c, i) => <Chip on={chip() === i()} onClick={() => setChip(i())}>{c}</Chip>}</For>
      </div>
      <div class="sh">
        <h3>{t("w2_my_albums")}</h3>
        <span class="more">{t("w2_view_all_n", 6)}</span>
      </div>
      <div class="shelf lib-shelf">
        <Card dashed title={t("w2_new_album")} subtitle={t("w2_drag_here")} onOpen={() => {}} playLabel={t("w2_play")}>
          <Icon n="plus" s={32} />
        </Card>
        <For each={albums()?.slice(0, 5)}>
          {(a) => <Card title={a.title} subtitle={a.subtitle} art={a.art} onOpen={() => navigate("album", { id: a.id })} onPlay={() => player.play({ kind: "userAlbum", id: a.id, title: a.title })} playLabel={t("w2_play")} />}
        </For>
      </div>
      <div class="box dl-box">
        <div class="row gap12">
          <IconButton icon="dl" label={t("w2_downloads")} tonal />
          <div class="f1">
            <div class="w6">{t("w2_dl_summary", "1 248", "6,2 GB")}</div>
            <div class="t12 i3 row" style={{ gap: "6px", "margin-top": "4px" }}>
              <QualityBadge q={{ label: "FLAC", lossless: true }} />
              <span class="num">{"214"}</span>
              <QualityBadge q={{ label: "320", lossless: false }} />
              <span class="num">{"806"}</span>
              <QualityBadge q={{ label: "Opus 160", lossless: false }} />
              <span class="num">{"228"}</span>
            </div>
            <div class="t12 i3 row" style={{ gap: "8px", "margin-top": "4px" }}>
              <span>{"D:\\Nhạc\\MinMusic"}</span>
              <span class="acc w6">{t("w2_change_folder")}</span>
            </div>
          </div>
        </div>
        <div class="dl-sep" />
        <div>
          <div class="row">
            <div class="f1 w6">{t("w2_dl_progress", 3, 12, "Chill cuối tuần")}</div>
            <span class="btn txt sm">{t("w2_pause")}</span>
          </div>
          <div class="bar" style={{ "margin-top": "8px" }}>
            <div class="bar-fill" style={{ transform: "scaleX(.28)" }} />
          </div>
          <div class="t12 i3 num" style={{ "margin-top": "6px" }}>{t("w2_dl_file", "Nơi Này Có Anh", "4,1 / 10,2 MB")}</div>
        </div>
      </div>
      <div class="sh" style={{ "margin-bottom": "4px" }}>
        <h3>{t("w2_chip_songs")}</h3>
      </div>
      <div class="tbl">
        <div class="th">
          <div style={{ "text-align": "center" }}>{"#"}</div>
          <div>{t("w2_col_title")}</div>
          <div class="c-album">{t("w2_col_album")}</div>
          <div class="c-added">{t("w2_col_added")}</div>
          <div />
          <div style={{ "text-align": "right" }}>{"⏱"}</div>
          <div />
        </div>
        <VirtualList
          total={store.total()}
          rowHeight={56}
          testid="songs-list"
          label={t("w2_chip_songs")}
          onRange={(s, e) => {
            range = [s, e];
            store.ensure(s, e);
          }}
          render={(i) => (
            <Row
              index={i()}
              track={store.track(i())}
              selected={selected() === i()}
              playing={!!store.track(i()) && playerState()?.track?.id === store.track(i())!.id}
              labels={labels()}
              onSelect={() => setSelected(i())}
              onPlay={playTrack}
              onOpenAlbum={openAlbum}
            />
          )}
        />
      </div>
    </div>
  );
}
