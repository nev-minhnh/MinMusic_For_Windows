import { Show, createResource, createSignal } from "solid-js";
import { render } from "solid-js/web";
import type { Track, TrackDetails } from "@minmusic/protocol";
import { Dialog } from "./Dialog";
import { Icon } from "../components/Icon";
import { client } from "../lib/core";
import { setSongInfoOpener } from "../lib/songInfo";
import { artistsText, fmtTime } from "../lib/format";
import { fmtBytes } from "../pages/Library/util";
import { toast } from "../toast";
import { t } from "../i18n";

type Info = { track: Track; details: TrackDetails };
const [target, setTarget] = createSignal<string | null>(null);

const dash = "—";
const num = (n: number, digits = 1) => n.toFixed(digits).replace(".", ",");
/** bitrate in bit/s -> "256 kbps" */
export const bitrateText = (bps?: number) => (bps ? `${Math.round(bps / 1000)} kbps` : dash);
/** sample rate in Hz -> "44,1 kHz" */
export const sampleRateText = (hz?: number) => (hz ? `${num(hz / 1000)} kHz` : dash);
export const loudnessText = (db?: number) => (db == null ? dash : `${num(db)} dB`);
export const sizeText = (bytes?: number) => (bytes ? fmtBytes(bytes) : dash);

/** Song info (Ctrl I, "Thông tin bài hát"): `track.info` as a 448 dialog; the path has a copy button. */
export function SongInfoDialog() {
  const [info] = createResource(target, (id) => client.call<Info>("track.info", { id }));
  const close = () => setTarget(null);
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ i18n: "w2_si_copied" });
    } catch {
      toast({ i18n: "w2_error_generic", level: "error" });
    }
  };
  return (
    <Dialog
      open={!!target()}
      title={t("w2_song_info")}
      onClose={close}
      onSubmit={close}
      testid="songinfo-dialog"
      actions={
        <button type="button" class="btn pri" data-autofocus data-testid="songinfo-close" onClick={close}>
          {t("w2_close")}
        </button>
      }
    >
      <Show when={info()} fallback={<div class="i3">{info.error ? t("w2_error_generic") : t("w2_loading")}</div>}>
        {(i) => (
          <dl class="si-grid" data-testid="songinfo">
            <dt>{t("w2_si_title")}</dt>
            <dd class="w6" data-testid="si-title">{i().track.title}</dd>
            <dt>{t("w2_si_artists")}</dt>
            <dd>{artistsText(i().track.artists) || dash}</dd>
            <dt>{t("w2_si_album")}</dt>
            <dd>{i().track.album?.title ?? dash}</dd>
            <dt>{t("w2_si_duration")}</dt>
            <dd class="num">{i().track.durationMs ? fmtTime(i().track.durationMs!) : dash}</dd>
            <dt>{t("w2_si_codec")}</dt>
            <dd data-testid="si-codec">{i().details.codec ?? dash}</dd>
            <dt>{t("w2_si_bitrate")}</dt>
            <dd class="num">{bitrateText(i().details.bitrate)}</dd>
            <dt>{t("w2_si_samplerate")}</dt>
            <dd class="num">{sampleRateText(i().details.sampleRate)}</dd>
            <dt>{t("w2_si_loudness")}</dt>
            <dd class="num">{loudnessText(i().details.loudnessDb)}</dd>
            <dt>{t("w2_si_size")}</dt>
            <dd class="num">{sizeText(i().details.fileSize)}</dd>
            <dt>{t("w2_si_path")}</dt>
            <dd class="si-path">
              <span data-testid="si-path">{i().details.path ?? dash}</span>
              <Show when={i().details.path}>
                <button type="button" class="ib" style={{ width: "28px", height: "28px" }} aria-label={t("w2_si_copy_path")} title={t("w2_si_copy_path")} data-testid="si-copy" onClick={() => void copy(i().details.path!)}>
                  <Icon n="lib_copy" s={16} />
                </button>
              </Show>
            </dd>
          </dl>
        )}
      </Show>
    </Dialog>
  );
}

let host: HTMLElement | null = null;
/** Mounts the dialog host once (its own Solid root on `document.body`) and opens it for a track id. */
export function openSongInfoDialog(id: string) {
  if (!host) {
    host = document.createElement("div");
    host.dataset.songinfoHost = "";
    document.body.appendChild(host);
    render(() => <SongInfoDialog />, host);
  }
  setTarget(id);
}

/** Ctrl I and the song menu's "Thông tin bài hát" reach the dialog through lib/songInfo.ts. */
export function registerSongInfo() {
  setSongInfoOpener(openSongInfoDialog);
}
registerSongInfo();
