/** Every route of frontend-spec section 3. A new name is a checkpoint edit, page WPs never touch this file. */
export const ROUTE_NAMES = [
  "home", "search", "library", "liked", "downloads", "history", "stats",
  "album", "userAlbum", "artist", "artistAbout", "playlist", "podcast",
  "charts", "browse", "equalizer", "settings", "listenTogether", "onboarding",
] as const;
export type RouteName = (typeof ROUTE_NAMES)[number];
export const isRouteName = (s: string): s is RouteName => (ROUTE_NAMES as readonly string[]).includes(s);
