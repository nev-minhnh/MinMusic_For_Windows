# M4-1a: Core settings API (schema, get, set, reset, topic) + shell settings wiring

**Wave 4. Agent:** Sonnet. **Repo:** MinMusic, plus a small Windows-repo part. Conventions apply.
- **Kotlin worktree:** `D:\Coding_Project\MinMusic-wt-m4-1a`, branch `feat/desktop-core-m4-1a` (after INT-W3).
- **Windows worktree:** `…-wp\M4-1a`, branch `wp/M4-1a`, for the shell part.

Read first:
- `docs/api.md` §3.10, §4 `settings`, §5 (shell keys)
- `docs/architecture.md` §9 (secrets never returned)
- `shared/src/commonMain/kotlin/com/metrolist/shared/settings/Settings.kt` (the `preference(...)` provider at :1046, the typed overloads :995–1041, `settingTypes`/`preferenceDefaults`/`preferenceRefreshers` maps :235–237, `nonPortableKeys`/`backupExcludedKeys` :1374–1425, the shell keys :940–959, `themeMode` :342, `appLanguage` :306–311)
- `shared/src/desktopMain/kotlin/com/metrolist/shared/settings/PlatformSettings.desktop.kt:65` (`secretKeys`, private)

## No Gradle
INT-W4 builds. **This WP edits `shared/`** (commonMain). The change must keep Android compiling and behaving the same: additive public API only. INT-W4 runs `:androidApp:compileDebugKotlin`.

## Owned paths
- `shared/src/commonMain/kotlin/com/metrolist/shared/settings/Settings.kt`: the registry only (below)
- `shared/src/commonMain/kotlin/com/metrolist/shared/settings/SettingsRegistry.kt` (new)
- `desktopCore/.../core/api/settings/**` (`SettingsModule : ApiModule`, topic `"settings"`), `desktopCore/src/test/.../api/settings/**`
- **Windows:** `src-tauri/src/settings_link/**` and an `M4-1a` block in `main.rs` (create it at the end of each list); replace the `shell.json` stand-ins in M1-4 `tray`/close-to-tray and M2-4 `mini`/`taskbar` with reads through `settings_link` (one call site each)

## Shared change: a public registry (≈ 40 lines, additive)
In `SettingsRegistry.kt`:
```kotlin
package com.metrolist.shared.settings
data class SettingMeta(val key: String, val type: SettingType, val default: Any?, val enumValues: List<String>?)
```
- In the private `preference(...)` provider (`Settings.kt:1046`), also record `SettingMeta(key, type, defaultValue, enumNames)` into a new `private val registryMap = LinkedHashMap<String, SettingMeta>()`.
  - Enum names come from the reified enum overload: pass `enumEntries<E>().map { it.name }` through a new optional parameter, `null` for the others.
  - Expose `val registry: List<SettingMeta> get() = registryMap.values.toList()`.
- `fun getRaw(key: String): Any?`: the current value. For enums return `name`.
- `fun setRaw(key: String, value: Any?)`: type-check against the meta, write through the same `settings.putX(key, …)` path the delegate setter uses (enum → ordinal), then call `preferenceRefreshers[key]?.invoke()`. Throw `IllegalArgumentException` on a type mismatch.
- **Special cases:**
  - `appLanguage` (a computed property over `AppLanguageKey`): register it manually as `SettingMeta("appLanguage", STRING, "SYSTEM", null)` with get/set through the property.
  - Add `var w2FirstRunDone by preference(false)` (new key, desktop v2 first run).
  - Blob preferences are not registered.
- **Registration order:** delegates register when the `Settings` instance initialises its properties (provider `provideDelegate` runs at construction), so `registry` is complete after `Settings.shared` exists. Verify by reading the provider code; if `provideDelegate` is lazy, force it by reading the `registry` after construction in a unit test that asserts ≥ 300 keys.

## Core API
| Method | Implementation |
|---|---|
| `settings.schema` | `Settings.shared.registry` → `SettingEntry {key, type: "bool"\|"int"\|"float"\|"string"\|"enum"\|"secret"\|"json", default, enumValues}`. `LONG` → `"int"`; a STRING key ending in `Json` → `"json"`; `secret` for keys in `SECRET_KEYS` (copy the 25 names from `PlatformSettings.desktop.kt:65` into `api/settings/SecretKeys.kt`, with a comment naming the source; the default is never returned). `platform`: from the prefix table `android*`/`Automotive*` → `"android"`, `ios*` → `"ios"` (hidden), `desktop*` + `minimizeToTrayOnClose`/`enableSystemWindowFrame`/… → `"desktop"`, else `"all"`. `min/max/step` from a small static table `api/settings/Ranges.kt` for the slider keys M4-1b's layout uses (read `layout.ts` in the Windows repo for the list) |
| `settings.get {keys?}` | `getRaw` per key; secrets → `{set: value.isNotBlank()}` |
| `settings.set {values}` | Reject secrets (`bad_request`, "use dedicated method"), unknown keys (`bad_request`), and type or range violations. Otherwise `setRaw` |
| `settings.reset {keys}` | `setRaw(key, meta.default)` |
| topic `settings` | snapshot = all non-secret values (secrets as `{set}`). Deltas: `snapshotFlow { registry.associate { it.key to getRaw(it.key) } }` is too heavy, so instead `snapshotFlow` over the values of the ~60 keys the UI shows plus a 1 s poll diff for the rest, emitting `settings.changed {changed}`. Document the choice |
| `lyrics.ai.setKey {provider, key}` / `lyrics.ai.test` | Set `Settings.shared.lyricsAiApiKey` (or `lyricsDeepLApiKey` for provider "DeepL"). Test = a minimal translate call through the existing AI translator (find it: `rg "class .*Translat" shared/src/commonMain`); `unsupported` if none is public |

**Shell part (Windows):** `settings_link` subscribes to the `settings` topic via corelink and caches `minimizeToTrayOnClose`, `desktopMiniPlayerWindow`, `desktopMiniPlayerOnMinimize`, `desktopTaskbarButtons`, `desktopTrayToggleOnClick`. The close-to-tray flag, the tray toggle, mini-on-minimise and the taskbar buttons read from it. `shell.json` keeps only layout state.

**UI note for M4-1b at INT-W4:** the theme key is **`themeMode`** (`ThemeMode` = `LIGHT`, `DARK`, `PURE_BLACK`, `AUTO`), not `selectedThemeMode`. Map `PURE_BLACK` → `data-theme=black`, `AUTO` → system.

## Verify (no builds)
1. **JUnit:**
   - `SettingsRegistryTest` (shared desktopTest: ≥ 300 keys, enums have names, `setRaw` round-trip, a type mismatch throws)
   - `SchemaMapperTest`, `PlatformPrefixTest`, `SecretMaskTest`
2. `cargo check`/`cargo test` for `settings_link` (key cache update from a snapshot/delta JSON).
3. INT-W4 runs M4-1b's `m4-settings.mjs` on real; the schema keys must match the mock fixture (diff printed). STATUS line.
