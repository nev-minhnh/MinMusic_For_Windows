import { For, Show, createSignal } from "solid-js";
import type { RouteName } from "../../router/routes";
import type { PageProps } from "../../router/registry";
import { CollectionHeader } from "../../components/pages/CollectionHeader";
import { LoadError } from "../../components/pages/LoadError";
import { PageShelf } from "../../components/pages/Shelf";
import { albumData, durationText } from "../../components/pages/data";
import { albumContext, playExtra } from "../../components/pages/playContext";
import { Table } from "../../components/Table";
import { SourceBadge } from "../../components/Badge";
import { openMenu } from "../../components/Menu";
import { cardMenu } from "../../menus/card";
import { client } from "../../lib/core";
import { navigate } from "../../router/router";
import { player, playerState } from "../../state/player";
import { toast } from "../../toast";
import { t } from "../../i18n";
import type { Item, SourceId } from "../../lib/types";
import "./album.css";

const KICKER = { album: "w2_pg_album", single: "w2_pg_single", ep: "w2_pg_ep" } as const;

/** Album: CollectionHeader + track Table (no virtualisation up to 60 rows) + "Phiên bản khác" and "Thêm từ <artist>" shelves. */
export function Album(props: PageProps) {
  const id = () => props.params.id;
  const { data, mutate, error, reload } = albumData(id);
  const [busy, setBusy] = createSignal(false);
  const play = (extra?: { shuffle?: boolean; startId?: string }) => void player.play(albumContext(id()), playExtra(extra));

  const save = async () => {
    const d = data();
    if (!d || busy()) return;
    const on = !d.album.saved;
    setBusy(true);
    mutate((v) => ({ ...v, album: { ...v.album, saved: on } }));
    try {
      await client.call("album.save", { id: id(), on });
    } catch {
      mutate((v) => ({ ...v, album: { ...v.album, saved: !on } }));
      toast({ i18n: "w2_error_generic", level: "error" });
    } finally {
      setBusy(false);
    }
  };
  const counts = () => {
    const m = new Map<string, number>();
    data()?.tracks.forEach((x) => m.set(x.source, (m.get(x.source) ?? 0) + 1));
    return [...m.entries()];
  };
  const tracks = () => data()?.tracks ?? [];
  const items = (xs: Item[] | undefined) => xs ?? [];

  return (
    <div class="sc album" data-testid="album">
      <CollectionHeader
        loading={!data()}
        art={data()?.album.art}
        kicker={t(KICKER[data()?.album.kind ?? "album"])}
        title={data()?.album.title}
        meta={
          <Show when={data()}>
            {(d) => (
              <>
                <For each={d().album.artists}>
                  {(a, i) => (
                    <>
                      {i() > 0 && ", "}
                      <span class="lnk" classList={{ w6: true }} role="link" tabindex="0" onClick={() => a.id && navigate("artist", { id: a.id })} onKeyDown={(e) => e.key === "Enter" && a.id && navigate("artist", { id: a.id })}>
                        {a.name}
                      </span>
                    </>
                  )}
                </For>
                {" · "}
                {d().album.year} · <span class="num">{d().album.trackCount}</span> {t("w2_songs_unit")} · {durationText(d().album.durationMs, t)}
              </>
            )}
          </Show>
        }
        badges={<For each={counts()}>{([s, n]) => <SourceBadge source={s as SourceId} count={n} />}</For>}
        onPlay={() => play()}
        onShuffle={() => play({ shuffle: true })}
        saved={data()?.album.saved}
        onSave={save}
        onMore={(at) => data() && openMenu(cardMenu({ t: "album", ...data()!.album }), at)}
      />
      <LoadError error={error()} hasData={!!data()} retry={reload} />
      <div class="alb-tbl">
        <Table
          label={data()?.album.title ?? t("w2_pg_album")}
          testid="album-table"
          cols={["index", "title", "like", "dur", "more"]}
          total={() => tracks().length}
          trackAt={(i) => tracks()[i]}
          playingId={() => playerState()?.track?.id}
          onPlay={(i) => play({ startId: tracks()[i]?.id })}
          showSource={false}
        />
      </div>
      <Show when={data()}>
        <PageShelf title={t("w2_pg_other_versions")} items={items(data()!.otherVersions.map((a) => ({ t: "album" as const, ...a })))} below testid="shelf-versions" />
        <Show when={data()!.moreBy}>
          {(s) => <PageShelf title={t("w2_pg_more_from", data()!.album.artists[0]?.name ?? "")} items={s().items} more={s().more} below testid="shelf-more-by" />}
        </Show>
      </Show>
    </div>
  );
}

export const routes: RouteName[] = ["album"];
export default Album;
