import type { Accessor, Component } from "solid-js";
import type { RouteName } from "./routes";

export type PageProps = { params: Record<string, string>; active: Accessor<boolean> };
export type PageModule = { routes?: RouteName[]; default?: Component<PageProps> };

/** Builds the route -> component table from the page modules. Two pages claiming one route is a programming error. */
export function buildPages(mods: Record<string, PageModule>): Record<string, Component<PageProps>> {
  const out: Record<string, Component<PageProps>> = {};
  const owner: Record<string, string> = {};
  for (const [file, m] of Object.entries(mods)) {
    if (!m.default || !m.routes) continue;
    for (const r of m.routes) {
      if (out[r]) throw new Error(`route "${r}" is claimed by both ${owner[r]} and ${file}`);
      out[r] = m.default;
      owner[r] = file;
    }
  }
  return out;
}

/** The page for a route, or the "missing page" component when no page module registered it. */
export function pageFor(pages: Record<string, Component<PageProps>>, name: string, missing: Component<PageProps>): Component<PageProps> {
  return pages[name] ?? missing;
}
