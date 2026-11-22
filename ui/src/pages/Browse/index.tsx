import type { RouteName } from "../../router/routes";
import { For, Show, createSignal, onCleanup, onMount, type Accessor } from "solid-js";
import { client } from "../../lib/core";
import { navigate } from "../../router/router";
import { t } from "../../i18n";
import { RowsShelf, Shelf, ShelfSkeleton } from "../Home/Shelf";
import "./browse.css";
import type { Shelf as ShelfT } from "../../lib/types";

type BrowseResult = { title: string; header?: unknown; shelves: ShelfT[]; next: string | null };
type Mood = { key: string; title: string; color?: string };

/** The moods grid (`browseId: "moods"`), reachable from the Home chip "Tâm trạng". A tile opens `browse {browseId: key}`. */
function Moods() {
  const [items, setItems] = createSignal<Mood[]>([]);
  onMount(() => {
    client
      .call<{ items: Mood[] }>("moods.list")
      .then((r) => setItems(r.items))
      .catch(() => {});
  });
  return (
    <div class="brw-moods" data-testid="moods-grid">
      <For each={items()}>
        {(m) => (
          <button type="button" class="brw-mood" data-testid="mood-tile" style={{ background: m.color ?? "var(--s2)" }} onClick={() => navigate("browse", { browseId: m.key, params: m.key })}>
            <span>{m.title}</span>
          </button>
        )}
      </For>
    </div>
  );
}

/** Browse / mood page: `browse.page` header + shelves (the Home shelf component), more shelves through the `next` cursor. */
export function Browse(props: { params: Record<string, string>; active: Accessor<boolean> }) {
  const id = () => props.params.browseId ?? "";
  const moods = () => id() === "moods";
  const [title, setTitle] = createSignal("");
  const [shelves, setShelves] = createSignal<ShelfT[]>([]);
  const [loading, setLoading] = createSignal(true);
  let next: string | null = null;
  let busy = false;
  let sentinel!: HTMLDivElement;

  const fetchPage = (cursor?: string) =>
    client.call<BrowseResult>("browse.page", { browseId: id(), ...(props.params.params ? { params: props.params.params } : {}), ...(cursor ? { cursor } : {}) });

  onMount(() => {
    if (moods()) {
      setTitle(t("w2_dc_moods"));
      setLoading(false);
    } else
      fetchPage()
        .then((r) => {
          setTitle(r.title);
          setShelves(r.shelves);
          next = r.next;
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    const io = new IntersectionObserver(
      (es) => {
        if (!es.some((e) => e.isIntersecting) || !next || busy) return;
        busy = true;
        fetchPage(next)
          .then((r) => {
            next = r.next;
            setShelves((s) => [...s, ...r.shelves]);
          })
          .catch(() => {})
          .finally(() => (busy = false));
      },
      { rootMargin: "600px 0px" }
    );
    io.observe(sentinel);
    onCleanup(() => io.disconnect());
  });

  return (
    <div class="sc browse" data-testid="browse-page">
      <div class="t28 w6 brw-head" data-testid="browse-title">
        {title()}
      </div>
      <Show when={moods()}>
        <Moods />
      </Show>
      <Show when={loading() && !moods()}>
        <ShelfSkeleton />
      </Show>
      <For each={shelves().filter((s) => s.layout === "cards" || s.layout === "rows" || s.layout === "quickPicks")}>
        {(s, i) => (
          <Show when={s.layout === "cards"} fallback={<RowsShelf shelf={s} below={i() > 0} />}>
            <Shelf shelf={s} below={i() > 0} round={s.items[0]?.t === "artist"} />
          </Show>
        )}
      </For>
      <div ref={sentinel} class="brw-sentinel" aria-hidden="true" />
    </div>
  );
}

export const routes: RouteName[] = ["browse"];
export default Browse;
