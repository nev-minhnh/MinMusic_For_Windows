import { artUrl } from "../lib/core";
import type { Art as ArtT } from "../lib/types";

/**
 * Artwork with an explicit size. `size` is the display size in CSS px (also written as width/height attributes).
 * `reqPx` overrides the px used to pick the image bucket, so the bar and the full player share one URL (frontend-spec 6.3).
 * "grad:gN" sources are mock placeholders drawn as gradients (no network, no decode).
 */
export function Art(props: { art?: ArtT; size: number; reqPx?: number; class?: string; fill?: boolean; round?: boolean; children?: any; alt?: string }) {
  const src = () => artUrl(props.art, props.reqPx ?? props.size);
  const style = () => (props.fill ? { width: "100%", "aspect-ratio": "1/1" } : { width: props.size + "px", height: props.size + "px" });
  return (
    <>
      {src().startsWith("grad:") || !src() ? (
        <div class={`art g ${src().slice(5)} ${props.class ?? ""}`} style={{ ...style(), ...(props.round ? { "border-radius": "50%" } : {}) }} data-size={props.size}>
          {props.children}
        </div>
      ) : (
        <div class={`art ${props.class ?? ""}`} style={style()} data-size={props.size}>
          <img src={src()} width={props.size} height={props.size} decoding="async" loading="lazy" alt={props.alt ?? ""} draggable={false} />
          {props.children}
        </div>
      )}
    </>
  );
}
