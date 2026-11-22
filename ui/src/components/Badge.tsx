import type { Quality, SourceId } from "../lib/types";

const SRC: Record<string, string> = { yt: "YT", sc: "SC", zing: "Zing", nct: "NCT" };

export function SourceBadge(props: { source: SourceId; count?: number }) {
  return (
    <span class={`b src src-${props.source}`}>
      <i />
      {SRC[props.source] ?? props.source}
      {props.count != null ? ` ${props.count}` : ""}
    </span>
  );
}
export function QualityBadge(props: { q?: Quality }) {
  return props.q ? <span class={`b q ${props.q.lossless ? "ll" : ""}`}>{props.q.label}</span> : null;
}
export function AltBadge(props: { n?: number }) {
  return props.n ? <span class="b alt">{`+${props.n}`}</span> : null;
}
export function NewBadge(props: { label: string }) {
  return <span class="b exp">{props.label}</span>;
}
