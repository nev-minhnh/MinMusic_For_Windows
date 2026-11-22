export function Icon(props: { n: string; s?: 16 | 20 | 24 | 32; class?: string }) {
  return (
    <svg class={`ic s${props.s ?? 20} ${props.class ?? ""}`} aria-hidden="true">
      <use href={`#i-${props.n}`} />
    </svg>
  );
}
