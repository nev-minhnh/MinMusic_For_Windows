import { Show, createEffect, createMemo, createSignal, on, onCleanup, onMount } from "solid-js";
import { Art } from "../../components/Art";
import { Icon } from "../../components/Icon";
import { IconButton } from "../../components/IconButton";
import { VirtualList } from "../../components/VirtualList";
import { Meta } from "../../components/Meta";
import { Switch } from "./Switch";
import { playerState } from "../../state/player";
import { autoplay, queue, queueApi, selectedQid, setAutoplay, setSelectedQid } from "../../state/queue";
import { fmtTime } from "../../lib/format";
import { t } from "../../i18n";
import { QUEUE_MIME, attachTrackDrop } from "./drop";

const ROW = 56;

/** Pane / full-player "Tiếp theo": the playing row, then the upcoming rows on a VirtualList of 56 px rows. */
export function QueuePanel(props: { variant: "pane" | "fp" }) {
  let wrap!: HTMLDivElement;
  let list!: HTMLDivElement;
  let drop!: HTMLDivElement;
  const [over, setOver] = createSignal(false);
  const [dropAt, setDropAt] = createSignal<number | null>(null); // insertion position in the upcoming list
  const cur = () => queue.currentIndex();
  const upcoming = () => Math.max(0, queue.total() - cur() - 1);
  const track = () => playerState()?.track;
  const context = createMemo(() => playerState()?.context?.title ?? "");

  onMount(() => {
    const un = attachTrackDrop(wrap, (ids) => queueApi.addEnd(ids), setOver);
    onCleanup(un);
  });

  let range: [number, number] = [0, 0];
  const onRange = (a: number, b: number) => {
    range = [a, b];
    queue.setVisible(cur() + 1 + a, cur() + 1 + b);
  };
  // the playing item moved: the same list rows now map to other queue indexes
  createEffect(on(cur, () => queue.setVisible(cur() + 1 + range[0], cur() + 1 + range[1]), { defer: true }));

  // ---- drag reorder (native HTML5 DnD; the 2 px accent line is placed by transform)
  const posFromY = (y: number) => {
    const r = list.getBoundingClientRect();
    return Math.max(0, Math.min(upcoming(), Math.round((y - r.top) / ROW)));
  };
  const scrollerOf = () => wrap.querySelector<HTMLElement>(".qp-scroll");
  const dragOver = (e: DragEvent) => {
    if (!e.dataTransfer || ![...e.dataTransfer.types].includes(QUEUE_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropAt(posFromY(e.clientY));
    const sc = scrollerOf();
    if (sc) {
      const r = sc.getBoundingClientRect();
      if (e.clientY < r.top + 40) sc.scrollTop -= 14;
      else if (e.clientY > r.bottom - 40) sc.scrollTop += 14;
    }
  };
  const drag = (e: DragEvent) => {
    const from = Number(e.dataTransfer?.getData(QUEUE_MIME));
    const p = dropAt();
    setDropAt(null);
    if (!e.dataTransfer || !Number.isInteger(from) || p === null) return;
    e.preventDefault();
    const ins = cur() + 1 + p;
    const to = from < ins ? ins - 1 : ins;
    if (to !== from) queueApi.move(from, to);
  };

  const onKey = (e: KeyboardEvent) => {
    const q = selectedQid();
    if (!q) return;
    if (e.key === "Delete") { e.preventDefault(); e.stopPropagation(); queueApi.remove([q]); setSelectedQid(null); }
    else if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); queueApi.select(q); }
  };

  return (
    <div class="qp" classList={{ over: over(), "in-fp": props.variant === "fp" }} ref={wrap} data-testid="queue-panel">
      <div class="qp-scroll pg" tabindex="0" role="group" aria-label={t("queue")} onKeyDown={onKey}>
        <Show when={track()} fallback={<div class="qp-empty">{t("w2_m22_queue_empty")}</div>}>
          {(tr) => (
            <>
              <div class="ovl qp-h">{t("w2_m22_now_playing")}</div>
              <div class="qr cur" data-testid="queue-current">
                <Art art={tr().art} size={40} />
                <div class="f1">
                  <div class="w6 ell">{tr().title}</div>
                  <Meta t={tr()} />
                </div>
                <Icon n="vol" s={16} class="acc" />
              </div>
              <div class="qp-h2">
                <span class="ovl ell f1">{t("w2_m22_next_from", context())}</span>
                <Show when={queue.locked()}>
                  <button type="button" class="chip qp-clear" data-testid="queue-unlock" title={t("w2_queue_locked")} onClick={() => void queueApi.unlock()}>
                    {t("w2_queue_unlock")}
                  </button>
                </Show>
                <button type="button" class="chip qp-clear" data-testid="queue-clear" disabled={upcoming() === 0} onClick={() => queueApi.clear()}>
                  {t("w2_m22_clear")}
                </button>
              </div>
            </>
          )}
        </Show>
        <div class="qp-list" ref={list} onDragOver={dragOver} onDrop={drag} onDragLeave={(e) => e.currentTarget === e.target && setDropAt(null)}>
          <VirtualList
            total={upcoming()}
            rowHeight={ROW}
            testid="queue-list"
            label={t("queue")}
            onRange={onRange}
            render={(i) => <QueueRow index={i} />}
          />
          <div ref={drop} class="qp-drop" classList={{ on: dropAt() !== null }} style={{ transform: `translateY(${(dropAt() ?? 0) * ROW}px)` }} data-testid="queue-drop" />
        </div>
      </div>
      <div class="qp-foot">
        <div class="f1">
          <div class="w6">{t("w2_m22_autoplay")}</div>
          <div class="t12 i3">{t("w2_m22_autoplay_sub")}</div>
        </div>
        <Switch on={autoplay()} onChange={(on) => setAutoplay(on)} label={t("w2_m22_autoplay")} testid="autoplay-switch" />
      </div>
    </div>
  );
}

function QueueRow(props: { index: () => number }) {
  const qi = () => queue.currentIndex() + 1 + props.index();
  const it = () => queue.item(qi());
  return (
    <Show when={it()} fallback={<div class="qr skel" aria-hidden="true"><div class="art skel-art" style={{ width: "40px", height: "40px" }} /><div class="f1"><div class="skel" style={{ width: "50%" }} /></div></div>}>
      {(x) => (
        <div
          class="qr"
          classList={{ sel: selectedQid() === x().qid }}
          role="row"
          aria-rowindex={qi() + 1}
          draggable={true}
          data-testid="queue-row"
          data-qid={x().qid}
          data-qi={qi()}
          onDragStart={(e) => {
            e.dataTransfer!.setData(QUEUE_MIME, String(qi()));
            e.dataTransfer!.effectAllowed = "move";
          }}
          onClick={() => setSelectedQid(x().qid)}
          onDblClick={() => queueApi.select(x().qid)}
        >
          <Icon n="drag" s={16} class="qr-grip" />
          <Art art={x().art} size={40} />
          <div class="f1">
            <div class="w6 ell">{x().title}</div>
            <Meta t={x()} />
          </div>
          <span class="t12 i3 num qr-dur">{fmtTime(x().durationMs ?? 0)}</span>
          <IconButton icon="close" label={t("w2_m22_remove")} size={32} class="qr-rm" testid="queue-remove" onClick={(e) => { e.stopPropagation(); queueApi.remove([x().qid]); }} />
        </div>
      )}
    </Show>
  );
}
