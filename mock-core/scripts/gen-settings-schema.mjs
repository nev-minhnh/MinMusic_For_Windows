// Generates mock-core/fixtures/settings/schema.json from the v1 shared Settings.kt (`by preference(...)` delegates).
// Usage: node mock-core/scripts/gen-settings-schema.mjs [path/to/shared/src/commonMain/kotlin/com/metrolist/shared]
// The output is committed; M4-1a must produce the same keys on the real core (settings.schema).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(process.argv[2] ?? "D:/Coding_Project/MinMusic-wt-core/shared/src/commonMain/kotlin/com/metrolist/shared");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const kt = read("settings/Settings.kt");
const consts = new Map([...read("constants/PreferenceKeys.kt").matchAll(/val\s+(\w+)\s*=\s*"([^"]*)"/g)].map((m) => [m[1], m[2]]));
const enums = new Map();
for (const m of read("settings/SettingEnums.kt").matchAll(/enum class (\w+)\s*(?:\([^)]*\))?\s*\{([\s\S]*?)(?:;|\n\})/g)) {
  enums.set(m[1], [...m[2].matchAll(/^\s*([A-Z][A-Z0-9_]*)\b/gm)].map((x) => x[1]));
}

// ---- classification tables (the script is the only place that knows them)
/** Keys the desktop app never shows (Android-only features). */
const ANDROID = [
  /^android/i, /^keepScreenOn/, /^enableHaptic/, /^enableLandscape/, /^blockScreenshots$/, /^voiceSearch/, /^stopMusicOnTaskClear$/,
  /^(forceBottomNavBar|slimNavBar|floatingNavBar|floatingTopBar|showBottomNav\w+)$/, /^swipe/, /^appIcon$/, /^materialYou/, /^matugen/,
  /^densityScale/, /^disableAnimatedArtworkOnMobileData$/, /^enableSystemWindowFrame$/, /^disableWaylandScaleFix$/, /^castEnabled$/,
  /^dynamicTheme$/, /^autoPureBlack$/, /^miniplayerFocusMode$/, /^expressiveMiniPlayer/, /^showExpressiveMiniPlayer/, /^miniPlayerBackgroundStyle$/,
  /^showMiniPlayer(Like|Playlist|Subscribe)Button$/, /^showPlayerCastButton$/, /^useRoundedRectPlayButton$/,
];
const DESKTOP = [/^desktop/, /^minimizeToTrayOnClose$/];
const SECRET = /(ApiKey|ApiKeys|OAuthKey|Cookie|Token|Session|Password|Secret)$/i;
/** Numeric ranges (v1 slider/stepper bounds). Anything else numeric gets a generic non-negative range. */
const RANGE = {
  seekDurationSeconds: [1, 60, 1], crossfadeDuration: [1, 12, 1], minimumSongDurationSeconds: [0, 600, 5], historyDuration: [1, 365, 1],
  lyricsTextSize: [16, 72, 1], lyricsLineSpacing: [1, 2, 0.05], subtitleTextSize: [10, 32, 1], globalLyricsOffsetMs: [-2000, 2000, 50],
  playbackSpeed: [0.25, 2, 0.05], playbackPitch: [0.5, 2, 0.05], sleepTimerDefaultMinutes: [1, 180, 1], libraryGridColumns: [1, 8, 1],
  sliderTrackThicknessDp: [1, 12, 1], volume: [0, 1, 0.01], previousVolume: [0, 1, 0.01], maxSongCacheSize: [0, 65536, 128], maxImageCacheSize: [0, 8192, 64],
};

/** String-typed v1 settings that are really closed sets (the Kotlin side validates the same values). */
const ENUM = {
  appLanguage: ["SYSTEM", "en", "vi"],
  audioQuality: ["LOW", "AUTO", "HIGH"],
  lyricsTextPosition: ["LEFT", "CENTER", "RIGHT"],
  lyricsAiTranslationMode: ["Literal", "Transcreation"],
  lyricsAiActivationMode: ["Automatic", "Manual"],
  lyricsDeepLFormality: ["default", "more", "less"],
  lyricsAnimationStyle: ["None", "Fade", "Glow", "Slide", "Karaoke", "Apple"],
  audioCacheLocation: ["INTERNAL", "EXTERNAL"],
  downloadLocation: ["INTERNAL", "EXTERNAL", "CUSTOM"],
};
/** Default expressions the parser cannot evaluate. */
const FORCE = { minimizeToTrayOnClose: { type: "bool", default: true }, enableAppleMusicArtistVideos: { type: "bool", default: false } };

function matchParen(s, i) {
  let d = 0;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (c === '"') { j++; while (s[j] !== '"') j += s[j] === "\\" ? 2 : 1; }
    else if (c === "(") d++;
    else if (c === ")" && --d === 0) return j;
  }
  return -1;
}
function splitTop(s) {
  const out = []; let d = 0, cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') { let j = i + 1; while (s[j] !== '"') j += s[j] === "\\" ? 2 : 1; cur += s.slice(i, j + 1); i = j; continue; }
    if (c === "(" || c === "{") d++; else if (c === ")" || c === "}") d--;
    if (c === "," && d === 0) { out.push(cur.trim()); cur = ""; } else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const entries = [];
const seen = new Set();
const re = /\b(?:var|val)\s+(\w+)\s+by\s+preference\(/g;
let m;
while ((m = re.exec(kt))) {
  const prop = m[1];
  const open = m.index + m[0].length - 1;
  const close = matchParen(kt, open);
  const args = splitTop(kt.slice(open + 1, close));
  let key = prop, def = args[args.length - 1];
  if (args.length >= 2) {
    const a = args[0];
    if (/^"/.test(a)) key = a.slice(1, -1);
    else if (consts.has(a)) key = consts.get(a);
  }
  if (seen.has(key)) continue;
  seen.add(key);
  const e = { key, type: "string", default: "" };
  let d;
  if (/^(true|false)$/.test(def)) { e.type = "bool"; e.default = def === "true"; }
  else if (/^-?\d+L?$/.test(def)) { e.type = "int"; e.default = Number(def.replace("L", "")); }
  else if (/^-?[\d.]+f$/.test(def)) { e.type = "float"; e.default = Number(def.slice(0, -1)); }
  else if (/^"[^"]*"$/.test(def)) { e.type = "string"; e.default = def.slice(1, -1); }
  else if ((d = /^(\w+)\.([A-Z][A-Z0-9_]*)$/.exec(def)) && enums.has(d[1])) { e.type = "enum"; e.default = d[2]; e.enumValues = enums.get(d[1]); }
  else { e.type = "string"; e.default = ""; }
  if (ENUM[key]) { e.type = "enum"; e.enumValues = ENUM[key]; if (!ENUM[key].includes(e.default)) e.default = ENUM[key][0]; }
  if (FORCE[key]) Object.assign(e, FORCE[key]);
  if (SECRET.test(key) && e.type === "string") { e.type = "secret"; e.default = { set: false }; }
  if ((e.type === "int" || e.type === "float") && RANGE[key]) [e.min, e.max, e.step] = RANGE[key];
  e.platform = ANDROID.some((r) => r.test(key)) ? "android" : DESKTOP.some((r) => r.test(key)) ? "desktop" : "all";
  entries.push(e);
}
entries.sort((a, b) => a.key.localeCompare(b.key));
const out = join(HERE, "..", "fixtures", "settings", "schema.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ entries }, null, 1) + "\n");
const by = (f) => entries.filter(f).length;
console.log(`gen-settings-schema: ${entries.length} keys (android ${by((e) => e.platform === "android")}, desktop ${by((e) => e.platform === "desktop")}, secret ${by((e) => e.type === "secret")}, enum ${by((e) => e.type === "enum")}) -> ${out}`);
