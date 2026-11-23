import { Match, Switch } from "solid-js";
import { ProgressBar, WaveProgress } from "../../components/Progress";
import { barVariant, fpVariant, type ProgressVariant } from "../../state/playerExtra";
import { t } from "../../i18n";

/** Progress bar variants: line (4 px), wavy, thick (8 px). All three run on compositor animations (frontend-spec 6.4). */
export function ProgressControl(props: { where: "bar" | "fp"; testid?: string; width?: number }) {
  const v = (): ProgressVariant => (props.where === "bar" ? barVariant() : fpVariant());
  return (
    <div class="prog" classList={{ thick: v() === "thick" }} data-variant={v()} data-testid={props.testid}>
      <Switch>
        <Match when={v() === "wavy"}>
          <WaveProgress width={props.width ?? 640} label={t("w2_seek")} />
        </Match>
        <Match when={v() !== "wavy"}>
          <ProgressBar label={t("w2_seek")} />
        </Match>
      </Switch>
    </div>
  );
}
