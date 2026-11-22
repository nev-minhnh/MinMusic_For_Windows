// Ctrl I / "Thông tin bài hát". The dialog itself is M1-3c's; it registers itself through setSongInfoOpener.
let opener: ((id: string) => void) | null = null;
export function setSongInfoOpener(fn: ((id: string) => void) | null) {
  opener = fn;
}
/** Opens the song info dialog for a track id. Returns false when no implementation is registered yet. */
export function openSongInfo(id: string): boolean {
  if (!opener) return false;
  opener(id);
  return true;
}
