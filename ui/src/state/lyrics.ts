import { createEffect, createMemo, createRoot, createSignal, on } from "solid-js";
import { client } from "../lib/core";
import { locale } from "../i18n";
import type { Lyrics } from "@minmusic/protocol";
import { playerState } from "./player";
import { fullOpen } from "./ui";
import { fpTab, lyricsFs, paneOpen, paneTab, pref } from "./playerExtra";

const [lyrics, setLyrics] = createSignal<Lyrics | null>(null);
export type LyState = "idle" | "loading" | "ready" | "none";
const [lyState, setLyState] = createSignal<LyState>("idle");
export { lyrics, lyState };

/** Karaoke chip: word wipe on, or line highlight only. */
const [karaoke, setKaraokeSig] = createSignal(pref.get("mm.karaoke", "1") !== "0");
export { karaoke };
export const setKaraoke = (on: boolean) => { setKaraokeSig(on); pref.set("mm.karaoke", on ? "1" : "0"); };

// translate / romanize intent: the chip state follows what the core sent last, and the click sets it right away
const [trOn, setTrOn] = createSignal(false);
const [roOn, setRoOn] = createSignal(false);
export { trOn, roOn };

const curId = () => playerState()?.track?.id;
/** Lyrics are only fetched while something shows them (pane tab, full-player tab, fullscreen). */
export const lyricsWanted = createRoot(() =>
  createMemo(() => (paneOpen() && paneTab() === "lyrics") || (fullOpen() && fpTab() === "lyrics") || lyricsFs())
);

function apply(d: Lyrics | null | undefined) {
  if (!d || d.trackId !== curId()) return;
  setLyrics(d);
  setLyState(d.lines.length ? "ready" : "none");
  setTrOn(d.lines.some((l) => !!l.tr));
  setRoOn(d.lines.some((l) => !!l.ro));
}

let subscribed = false;
function fetchFor(id: string) {
  setLyState("loading");
  client
    .call<Lyrics>("lyrics.get", { trackId: id })
    .then((r) => { if (curId() === id) apply(r); })
    .catch(() => { if (curId() === id) setLyState("none"); });
}

createRoot(() => {
  // wanted + track id: (re)fetch for the current track
  createEffect(
    on([lyricsWanted, curId], ([wanted, id]) => {
      if (!wanted || !id) return;
      if (!subscribed) {
        subscribed = true;
        client.sub("lyrics", {}, (name, d) => {
          if (name === "lyrics.snapshot" || name === "lyrics.updated") apply(d);
          else if (name === "lyrics.cleared") { setLyrics(null); setLyState("none"); }
        });
      }
      if (lyrics()?.trackId !== id) { setLyrics(null); fetchFor(id); }
    })
  );
  // a new track invalidates what is shown even while nothing is displayed
  createEffect(on(curId, (id) => { if (lyrics() && lyrics()!.trackId !== id) { setLyrics(null); setLyState("idle"); } }, { defer: true }));
});

const tid = () => curId();
export const lyricsApi = {
  setOffset(ms: number) { const id = tid(); if (id) return client.call("lyrics.setOffset", { trackId: id, ms: Math.max(-30_000, Math.min(30_000, Math.round(ms))) }); },
  translate(on: boolean) { const id = tid(); if (!id) return; setTrOn(on); return client.call("lyrics.translate", { trackId: id, on, target: locale() }); },
  romanize(on: boolean) { const id = tid(); if (!id) return; setRoOn(on); return client.call("lyrics.romanize", { trackId: id, on }); },
  search(query?: string) {
    const id = tid();
    return id ? client.call<{ candidates: { provider: string; synced: "word" | "line" | "none"; preview: string; id: string }[] }>("lyrics.search", { trackId: id, query }) : Promise.resolve({ candidates: [] });
  },
  choose(candidateId: string) { const id = tid(); if (id) return client.call("lyrics.choose", { trackId: id, candidateId }); },
};
