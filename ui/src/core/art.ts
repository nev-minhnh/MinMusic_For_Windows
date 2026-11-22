// Artwork URL resolution (api.md §1.10). The host rules are fixed here and covered by art.test.ts.
import type { Art, CoreConfig } from "@minmusic/protocol";

export const PX_BUCKETS = [64, 128, 256, 384, 512, 768, 1080] as const;

export interface ArtEnv {
  /** device pixel ratio, default `globalThis.devicePixelRatio ?? 1` */
  dpr?: number;
  /** core port/artToken for `core:` sources, default `globalThis.__MM_CORE__` */
  core?: Pick<CoreConfig, "port" | "artToken">;
}

/** px = ceil(cssPx * dpr), rounded up to the next bucket (capped at the largest). */
export function pxBucket(cssPx: number, dpr = 1): number {
  const px = Math.ceil(cssPx * dpr);
  for (const b of PX_BUCKETS) if (px <= b) return b;
  return PX_BUCKETS[PX_BUCKETS.length - 1]!;
}

const GOOGLE_HOSTS = new Set(["lh3.googleusercontent.com", "yt3.ggpht.com", "yt3.googleusercontent.com"]);

function ytimgName(px: number): string {
  if (px <= 120) return "default";
  if (px <= 320) return "mqdefault";
  if (px <= 480) return "hqdefault";
  return "maxresdefault";
}

function sndcdnSuffix(px: number): string {
  if (px <= 100) return "-large";
  if (px <= 300) return "-t300x300";
  return "-t500x500";
}

export interface ResolvedArt {
  src: string;
  /** For i.ytimg.com: use on `<img onerror>` (maxresdefault does not exist for every video). */
  fallback?: string;
}

function envCore(env: ArtEnv): Pick<CoreConfig, "port" | "artToken"> | undefined {
  return env.core ?? (globalThis as { __MM_CORE__?: CoreConfig }).__MM_CORE__;
}

/** Resolve an Art to a URL plus an optional onerror fallback. */
export function resolveArt(art: Art | undefined | null, cssPx: number, env: ArtEnv = {}): ResolvedArt | null {
  if (!art || !art.src) return null;
  const dpr = env.dpr ?? (globalThis as { devicePixelRatio?: number }).devicePixelRatio ?? 1;
  const px = pxBucket(cssPx, dpr);
  const src = art.src;

  if (src.startsWith("core:")) {
    const rest = src.slice("core:".length);
    const slash = rest.indexOf("/");
    const kind = slash < 0 ? rest : rest.slice(0, slash);
    const id = slash < 0 ? "" : rest.slice(slash + 1);
    const core = envCore(env);
    if (!core) return null;
    return { src: `http://127.0.0.1:${core.port}/art/${encodeURIComponent(kind)}/${encodeURIComponent(id)}?w=${px}&k=${core.artToken}` };
  }

  let u: URL;
  try { u = new URL(src); } catch { return { src }; }
  if (u.protocol !== "https:") return { src };
  const host = u.hostname.toLowerCase();

  if (GOOGLE_HOSTS.has(host)) {
    const size = `=w${px}-h${px}-l90-rj`;
    // trailing "=w..-h..[...]" or "=s.." (also "=s..-c" style flags)
    const re = /=(?:w\d+-h\d+|s\d+)[^/=]*$/;
    const href = u.href;
    return { src: re.test(href) ? href.replace(re, size) : href + size };
  }

  if (host === "i.ytimg.com") {
    const m = /^\/vi(_webp)?\/([^/]+)\/([^/.]+)\.(jpg|webp)$/.exec(u.pathname);
    // URLs carrying a signature query (sqp/rs) are tied to their exact path: leave them alone.
    if (m && !u.search) {
      const base = `${u.origin}/vi${m[1] ?? ""}/${m[2]}/`;
      return { src: `${base}${ytimgName(px)}.${m[4]}`, fallback: `${base}hqdefault.${m[4]}` };
    }
    return { src };
  }

  if (host === "sndcdn.com" || host.endsWith(".sndcdn.com")) {
    const re = /-(?:large|t500x500|original)(\.[A-Za-z0-9]+)$/;
    if (re.test(u.pathname)) {
      u.pathname = u.pathname.replace(re, (_m, ext) => sndcdnSuffix(px) + ext);
      return { src: u.href };
    }
    return { src };
  }

  if (host === "photo-resize-zmp3.zmdcdn.me") {
    const re = /^\/w\d+_/;
    if (re.test(u.pathname)) {
      u.pathname = u.pathname.replace(re, `/w${Math.min(px, 600)}_`);
      return { src: u.href };
    }
    return { src };
  }

  return { src };
}

/** `artUrl(art, cssPx)`: the URL to put in `<img src>` (api.md §1.10). Returns "" when there is no art. */
export function artUrl(art: Art | undefined | null, cssPx: number, env: ArtEnv = {}): string {
  return resolveArt(art, cssPx, env)?.src ?? "";
}
