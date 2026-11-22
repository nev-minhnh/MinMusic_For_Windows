import { For, Match, Show, Switch } from "solid-js";
import { t } from "../../i18n";
import { entryOf, isDesktopKey, setSecret, setSetting, settingBool, settingFailure, settingValue, settingsReady } from "../../state/settings";
import { SecretCtl, SegCtl, SelectCtl, SliderCtl, StepperCtl, SwitchCtl, TextCtl, kindOf } from "./RowControls";
import { layout, type GroupDef, type PageId, type RowDef } from "./layout";
import { highlight } from "./search";

/** One setting row: label left, control right. Generated from the schema entry + the layout row. */
export function SettingRow(props: { row: RowDef; query?: string }) {
  const entry = () => entryOf(props.row.key)!;
  const label = () => props.row.label();
  const value = () => settingValue(props.row.key);
  const disabled = () => !!props.row.dep && !settingBool(props.row.dep);
  const kind = () => kindOf(entry(), props.row);
  const hl = () => (props.query ? highlight(label(), props.query) : null);
  const provider = () => {
    const p = props.row.provider ?? "";
    return entryOf(p) ? String(settingValue(p) ?? "") : p;
  };
  const set = (v: unknown) => void setSetting(props.row.key, v);
  const common = () => ({ entry: entry(), value: value(), label: label(), disabled: disabled(), onChange: set });
  return (
    <div class="sr-row" classList={{ dis: disabled() }} data-testid="set-row" data-setting={props.row.key} data-kind={kind()}>
      <div class="sr-lbl">
        <span class="sr-name">
          <Show when={hl()} fallback={label()}>
            {(h) => (
              <>
                {h().before}
                <mark class="sr-mark">{h().hit}</mark>
                {h().after}
              </>
            )}
          </Show>
        </span>
        <Show when={settingFailure()?.key === props.row.key}>
          <span class="sr-err t12" role="alert">{t("w2_set_error")}</span>
        </Show>
      </div>
      <div class="sr-ctl">
        <Switch>
          <Match when={kind() === "switch"}><SwitchCtl {...common()} /></Match>
          <Match when={kind() === "seg"}><SegCtl {...common()} order={props.row.order} /></Match>
          <Match when={kind() === "select"}><SelectCtl {...common()} order={props.row.order} /></Match>
          <Match when={kind() === "slider"}><SliderCtl {...common()} /></Match>
          <Match when={kind() === "stepper"}><StepperCtl {...common()} /></Match>
          <Match when={kind() === "secret"}>
            <SecretCtl label={label()} value={value()} disabled={disabled()} onSave={(s) => void setSecret(props.row.key, provider(), s)} />
          </Match>
          <Match when={true}><TextCtl {...common()} /></Match>
        </Switch>
      </div>
    </div>
  );
}

/** Rows of a group the desktop shows (known to the core, not Android-only). */
const visibleRows = (g: GroupDef) => g.rows.filter((r) => isDesktopKey(r.key));

export function SettingGroup(props: { group: GroupDef; query?: string; rows?: RowDef[] }) {
  const rows = () => props.rows ?? visibleRows(props.group);
  return (
    <Show when={rows().length}>
      <section class="sr-group" data-testid="set-group" data-group={props.group.id}>
        <h2 class="ovl sr-title">{props.group.title()}</h2>
        <div class="box sr-box">
          <For each={rows()}>{(r) => <SettingRow row={r} query={props.query} />}</For>
        </div>
      </section>
    </Show>
  );
}

/** The body of a layout-driven category (Appearance, Playback, Lyrics, Content, Privacy). */
export function SettingsPage(props: { page: PageId }) {
  return (
    <div class="sr-page" data-testid="set-page" data-page={props.page}>
      <Show when={settingsReady()} fallback={<div class="i3">{t("w2_set_loading")}</div>}>
        <For each={layout[props.page]}>{(g) => <SettingGroup group={g} />}</For>
      </Show>
    </div>
  );
}
