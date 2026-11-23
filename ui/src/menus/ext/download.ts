import { tidy, type MenuItem } from "../types";
import { t, plural } from "../../i18n";
import { client } from "../../lib/core";
import { downloadQuality, estimateBytes, fmtBytes, initDownloads, setDownloadQuality } from "../../state/downloads";
import { toast } from "../../toast";
import type { PlayContext, SourceOption, Track } from "../../lib/types";

/** What a "Tải xuống ›" submenu downloads: tracks (a selection) or a whole context (album, playlist, user album). */
export type DownloadTarget = { tracks: Track[] } | { context: PlayContext; title?: string };

const done = (n: number) => toast({ text: plural("w2_dlx_queued_n", n) });
const failed = () => toast({ i18n: "w2_error_generic", level: "error" });

async function queueTracks(ids: string[], source?: SourceOption) {
  initDownloads();
  try {
    // a non-automatic quality pick means "this source": the core downloads whatever the track is set to
    if (source && !source.auto) await client.call("track.setSource", { id: ids[0], source: source.source });
    await client.call("download.tracks", { ids });
    done(ids.length);
  } catch {
    failed();
  }
}

/** Quality items of one track from `track.sources`: best first (recommended, original format kept), then each source with its size. */
export function qualityItems(track: Track, options: SourceOption[]): MenuItem[] {
  const usable = options.filter((o) => o.available);
  const want = downloadQuality();
  const matches = (o: SourceOption) => o.quality?.label === want;
  const hasWanted = want !== "best" && usable.some(matches);
  const best = usable.find((o) => o.auto) ?? usable[0];
  const items: MenuItem[] = [
    {
      id: "dl-best",
      label: t("w2_dlx_best"),
      badge: best?.quality?.label,
      hint: best ? `~${fmtBytes(estimateBytes(best.quality, track.durationMs))}` : undefined,
      checked: want === "best" || !hasWanted,
      run: () => {
        setDownloadQuality("best");
        return queueTracks([track.id]);
      },
    },
  ];
  for (const o of usable) {
    if (o === best) continue;
    items.push({
      id: `dl-${o.source}-${o.quality?.label}`,
      label: o.quality?.label ?? o.source,
      badge: o.source.toUpperCase(),
      hint: `~${fmtBytes(estimateBytes(o.quality, track.durationMs))}`,
      checked: hasWanted && matches(o),
      run: () => {
        if (o.quality) setDownloadQuality(o.quality.label);
        return queueTracks([track.id], o);
      },
    });
  }
  return items;
}

/**
 * The children of the "Tải xuống ›" entry. Song menu: pass `{tracks}`; one track lists its qualities with sizes, a selection offers one
 * entry. Album / playlist / user album card: pass `{context}`. Returned as the async form of `MenuAction.children`, so the song and
 * card menus (M1-3a) use it as `children: downloadMenu(target)` once `caps.downloads` is "ready".
 */
export function downloadMenu(target: DownloadTarget): () => Promise<MenuItem[]> {
  return async () => {
    if ("context" in target) {
      const ctx = target.context;
      return [
        {
          id: "dl-all",
          label: t("w2_dlx_all"),
          icon: "download",
          run: async () => {
            initDownloads();
            try {
              await client.call("download.context", { context: ctx });
              toast({ text: t("w2_dlx_context_queued", target.title ?? "") });
            } catch {
              failed();
            }
          },
        },
      ];
    }
    const tracks = target.tracks;
    if (!tracks.length) return [];
    if (tracks.length === 1) {
      const one = tracks[0]!;
      try {
        const { options } = await client.call<{ options: SourceOption[] }>("track.sources", { id: one.id });
        const items = qualityItems(one, options);
        if (items.length) return tidy(items);
      } catch {
        /* fall through to the plain entry */
      }
    }
    return [{ id: "dl-n", label: tracks.length === 1 ? t("w2_dlx_best") : plural("w2_dlx_n_songs", tracks.length), icon: "download", run: () => queueTracks(tracks.map((x) => x.id)) }];
  };
}
