import { For, Show } from "solid-js";
import type { RouteName } from "../../router/routes";
import type { PageProps } from "../../router/registry";
import { LoadError } from "../../components/pages/LoadError";
import { IconButton } from "../../components/IconButton";
import { Art } from "../../components/Art";
import { artistAboutData, artistData } from "../../components/pages/data";
import { back } from "../../router/router";
import { t } from "../../i18n";
import "./about.css";

const nf = (n: number) => new Intl.NumberFormat().format(n);

/** artistAbout {id}: bio, listeners, playcount, tags (artist.about). */
export function ArtistAbout(props: PageProps) {
  const id = () => props.params.id;
  const about = artistAboutData(id);
  const artist = artistData(id);
  const stats = () => Object.entries(about.data()?.stats ?? {}).filter(([, v]) => typeof v === "number" || typeof v === "string");
  return (
    <div class="sc about" data-testid="artist-about">
      <div class="abt-head">
        <IconButton icon="arrow_back" label={t("w2_back")} tonal onClick={() => back()} testid="about-back" />
        <Show when={artist.data()}>{(a) => <Art art={a().artist.art} size={64} round />}</Show>
        <div class="f1">
          <div class="ovl">{t("w2_pg_about")}</div>
          <h1 class="t28 w6 ell">{artist.data()?.artist.name ?? ""}</h1>
        </div>
      </div>
      <LoadError error={about.error()} hasData={!!about.data()} retry={about.reload} />
      <Show when={about.data() || !about.error()} fallback={null}>
        <Show when={about.data()} fallback={<div class="skel" style={{ width: "50%", "margin-top": "24px" }} />}>
        {(a) => (
          <>
            <Show when={a().bio}>
              <p class="abt-bio" data-testid="about-bio">
                {a().bio}
              </p>
            </Show>
            <div class="abt-stats box">
              <Show when={a().lastfm}>
                {(l) => (
                  <>
                    <div class="abt-stat">
                      <div class="t20 w6 num">{nf(l().listeners)}</div>
                      <div class="t12 i3">{t("w2_pg_listeners")}</div>
                    </div>
                    <div class="abt-stat">
                      <div class="t20 w6 num">{nf(l().playcount)}</div>
                      <div class="t12 i3">{t("w2_pg_playcount")}</div>
                    </div>
                  </>
                )}
              </Show>
              <For each={stats()}>
                {([k, v]) => (
                  <div class="abt-stat">
                    <div class="t20 w6 num">{typeof v === "number" ? nf(v) : String(v)}</div>
                    <div class="t12 i3">{k}</div>
                  </div>
                )}
              </For>
            </div>
            <Show when={a().lastfm?.tags.length}>
              <div class="chips abt-tags" data-testid="about-tags">
                <For each={a().lastfm!.tags}>{(g) => <span class="chip">{g}</span>}</For>
              </div>
            </Show>
          </>
        )}
        </Show>
      </Show>
    </div>
  );
}

export const routes: RouteName[] = ["artistAbout"];
export default ArtistAbout;
