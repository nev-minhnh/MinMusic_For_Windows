/** Switch (role=switch). The knob moves by transform only. */
export function Switch(props: { on: boolean; onChange: (on: boolean) => void; label: string; testid?: string }) {
  return (
    <button type="button" class="sw" classList={{ on: props.on }} role="switch" aria-checked={props.on} aria-label={props.label} data-testid={props.testid} onClick={() => props.onChange(!props.on)}>
      <i />
    </button>
  );
}
