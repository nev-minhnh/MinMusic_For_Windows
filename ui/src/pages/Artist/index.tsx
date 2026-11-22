import { For, Show, createSignal, onCleanup } from "solid-js";
import type { RouteName } from "../../router/routes";
import type { PageProps } from "../../router/registry";
import { PageShelf } from "../../components/pages/Shelf";
import { CursorTable } from "../../components/pages/CursorTable";
import { artistData } from "../../components/pages/data";
import { createCursorList } from "../../components/pages/cursorList";
import { artistContext, playExtra, radioContext } from "../../components/pages/playContext";
import { Table } from "../../components/Table";
import { Icon } from "../../components/Icon";
import { IconButton } from "../../components/IconButton";
import { openMenu } from "../../components/Menu";
import { cardMenu } from "../../menus/card";
import { client, artUrl } from "../../lib/core";
import { pushEsc } from "../../lib/esc";
import { navigate } from "../../router/router";
import { player, playerState } from "../../state/player";
import { toast } from "../../toast";
import { t } from "../../i18n";
import type { Track } from "../../lib/types";
import type { TrackPage } from "@minmusic/protocol";
import "./artist.css";

const TOP = 5;

/** Artist (LS 4): feathered banner 232, name 28, Theo dõi / Phát / Radio, then top songs (5 rows + "Xem tất cả"), albums, singles, videos, related, About card. */
export function Artist(props: PageProps) {
  const id = () => props.params.id;
  const { data, mutate } = artistData(id);
  const [view, setView] = createSignal<"main" | "all">("main");
  const all = createCursorList<Track>((cursor) => client.call<TrackPage>("artist.tracks", { id: id(), cursor }), `artistTracks:${props.params.id}`);
  let popEsc: (() => void) | null = null;
  function closeAll() {
    popEsc?.();
    popEsc = null;
    setView("main");
  }
  const openAll = () => {
    setView("all");
    popEsc?.();
    popEsc = pushEsc(closeAll);
  };
  onCleanup(() => popEsc?.());

  const shelf = (key: string) => data()?.shelves.find((s) => s.key === key);
  const top = () => (shelf("topSongs")?.items ?? []).filter((x) => x.t === "track") as unknown as Track[];
  const others = () => data()?.shelves.filter((s) => s.key !== "topSongs") ?? [];
  const play = (extra?: { shuffle?: boolean; startId?: string }) => void player.play(artistContext(id()), playExtra(extra));
  const radio = () => void player.play(radioContext(id()));

  const subscribe = async () => {
    const d = data();
    if (!d) return;
    const on = !d.artist.subscribed;
    mutate((v) => ({ ...v, artist: { ...v.artist, subscribed: on } }));
    try {
      await client.call("artist.subscribe", { id: id(), on });
    } catch {
      mutate((v) => ({ ...v, artist: { ...v.artist, subscribed: !on } }));
      toast({ i18n: "w2_error_generic", level: "error" });
    }
  };
  const banner = () => {
    const a = data()?.artist;
    return artUrl(a?.banner ?? a?.art, 960);
  };
  const bannerGrad = () => (banner().startsWith("grad:") ? banner().slice(5) : "");

  return (
    <div class="sc artist" data-testid="artist">
      <Show
        when={view() === "main"}
        fallback={
          <div data-testid="artist-all">
            <div class="art-allhead">
              <IconButton icon="arrow_back" label={t("w2_back")} tonal onClick={closeAll} testid="artist-all-back" />
              <h2 class="t20 w6 f1 ell">{t("w2_pg_all_songs", data()?.artist.name ?? "")}</h2>
            </div>
            <CursorTable list={all} label={t("w2_pg_all_songs", data()?.artist.name ?? "")} testid="artist-all-table" onPlay={(_i, tr) => play({ startId: tr.id })} />
          </div>
        }
      >
        <div class="art-banner" data-testid="artist-banner">
          <Show when={data() && banner()}>
            {bannerGrad() ? (
              <div class={`art-bimg g ${bannerGrad()}`} />
            ) : (
              <img class="art-bimg" src={banner()} width={960} height={232} alt="" decoding="async" draggable={false} />
            )}
          </Show>
          <div class="art-feather" />
          <div class="art-bin">
            <Show when={data()} fallback={<div class="skel" style={{ width: "240px", height: "28px" }} />}>
              {(d) => (
                <>
                  <h1 class="t28 w6 ell" data-testid="artist-name">
                    {d().artist.name}
                  </h1>
                  <div class="t14 i2 ell">{[d().artist.subscribers, d().artist.monthly].filter(Boolean).join(" · ")}</div>
                  <div class="row gap8 art-act">
                    <button type="button" class="btn" classList={{ pri: !d().artist.subscribed, ton: d().artist.subscribed }} data-testid="artist-subscribe" aria-pressed={d().artist.subscribed} onClick={subscribe}>
                      {d().artist.subscribed ? t("w2_pg_subscribed") : t("w2_pg_subscribe")}
                    </button>
                    <button type="button" class="btn ton" data-testid="artist-play" onClick={() => play()}>
                      <Icon n="play" s={20} />
                      {t("w2_play")}
                    </button>
                    <button type="button" class="btn ton" data-testid="artist-radio" onClick={radio}>
                      <Icon n="radio" s={20} />
                      {t("w2_pg_radio")}
                    </button>
                    <IconButton
                      icon="more"
                      label={t("w2_more")}
                      tonal
                      size={40}
                      onClick={(e) => {
                        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        openMenu(cardMenu({ t: "artist", ...d().artist }), { x: r.left, y: r.bottom + 4 });
                      }}
                    />
                  </div>
                </>
              )}
            </Show>
          </div>
        </div>

        <Show when={top().length}>
          <section class="sec" data-testid="artist-top">
            <div class="sh">
              <h3>{shelf("topSongs")?.title ?? t("w2_pg_top_songs")}</h3>
              <button type="button" class="more btn txt" data-testid="artist-see-all" onClick={openAll}>
                {t("w2_see_all")}
              </button>
            </div>
            <Table
              label={t("w2_pg_top_songs")}
              testid="artist-top-table"
              cols={["index", "title", "album", "like", "dur", "more"]}
              header={false}
              total={() => Math.min(TOP, top().length)}
              trackAt={(i) => top()[i]}
              playingId={() => playerState()?.track?.id}
              onPlay={(i) => play({ startId: top()[i]?.id })}
            />
          </section>
        </Show>
        <For each={others()}>{(s, i) => <PageShelf title={s.title} items={s.items} more={s.more} below={i() > 0} testid={`shelf-${s.key}`} />}</For>

        <Show when={data()?.artist.description}>
          <section class="sec below" data-testid="artist-about-card">
            <div class="sh">
              <h3>{t("w2_pg_about")}</h3>
            </div>
            <div class="art-about box" role="link" tabindex="0" onClick={() => navigate("artistAbout", { id: id() })} onKeyDown={(e) => e.key === "Enter" && navigate("artistAbout", { id: id() })}>
              <p class="art-bio">{data()!.artist.description}</p>
              <div class="t12 i3">{[data()!.artist.monthly, data()!.artist.subscribers].filter(Boolean).join(" · ")}</div>
              <span class="more">{t("w2_see_all")}</span>
            </div>
          </section>
        </Show>
      </Show>
    </div>
  );
}

export const routes: RouteName[] = ["artist"];
export default Artist;
