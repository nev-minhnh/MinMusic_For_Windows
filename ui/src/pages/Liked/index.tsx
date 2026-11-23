import type { RouteName } from "../../router/routes";
import type { Accessor } from "solid-js";
import { SongList } from "../Library/SongList";
import { t } from "../../i18n";
import "../Library/library.css";

/** Liked songs: the shared song list over `library.window liked` with a header (count, Phát tất cả, Trộn bài). */
export function Liked(props: { params: Record<string, string>; active: Accessor<boolean> }) {
  return (
    <div class="sc library" data-testid="liked">
      <SongList list="liked" label={t("w2_liked")} testid="liked-table" title={t("w2_liked")} emptyKey="w2_lib_empty_liked" active={props.active} />
    </div>
  );
}

export const routes: RouteName[] = ["liked"];
export default Liked;
