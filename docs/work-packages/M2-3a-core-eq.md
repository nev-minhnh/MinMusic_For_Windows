# M2-3a: Core Equalizer API

**Wave 3. Agent:** Sonnet. **Repo:** MinMusic. Conventions apply.
- **Worktree:** `D:\Coding_Project\MinMusic-wt-m2-3a`, branch `feat/desktop-core-m2-3a` (after INT-W2).
- **Test checkout:** `…-wp\M2-3a-test`.

Read first:
- `docs/api.md` §3.8, §4 `eq`, §1.9 (spectrum ≤ 30 Hz, opt-in)
- `M1-2a-core-browse.md` ("No Gradle" rules, `ApiModule`)

## No Gradle
INT-W3 builds. All EQ APIs are in package `com.metrolist.shared.equalizer` (`shared/src/commonMain/kotlin/com/metrolist/shared/equalizer/`). They are plain objects and settings, so they are safe from any thread, **except** `EqualizerProfiles.outputDevice` / `onOutputDeviceChanged` (Main). Copy each signature into a comment above its call.

## Owned paths
- `desktopCore/.../core/api/eq/**` (`EqModule : ApiModule`, topic `"eq"`)
- `desktopCore/src/test/.../api/eq/**`

## Backing (exact)
- **`object EqualizerProfiles`:** `profiles: List<EqualizerProfile>`, `selectedConfiguration`, `activeProfile: EqualizerProfile?`, `activeProfileId: String?`, `var limiterEnabled: Boolean`, `isEnabled: Boolean`, `hasUnsavedChanges`.
  - Functions:
    - `setEnabled(enabled: Boolean)` (:260), `setActive(profileId: String?)` (:289)
    - `updateBand(index: Int, transform: (ParametricEqBand) -> ParametricEqBand)` (:396), `setBandType(index: Int, type: FilterType)` (:406)
    - `addBand(minFrequency: Double, maxFrequency: Double)` (:357), `removeBand(index: Int)` (:376; it `require`s a valid index, so check first), `resetBand(index: Int)` (:453), `resetAllBands()` (:462)
    - `setPreamp(db: Double)` (:382; this is the **output gain**, −12..12 step 0.5), `setProfilePreamp(db: Double)` (:424; this is the API `preampDb`, −24..24), `applyAutoPreamp()` (:431, one-shot)
    - `editTone(transform: (EqualizerProfile) -> EqualizerProfile)` (:411), `editCurrent(profile: EqualizerProfile)` (:352; requires `profile.id == activeProfileId`)
    - `saveCurrent(name: String, saveAs: Boolean = false): EqualizerProfile` (:435; throws on a blank name), `delete(profileId: String)` (:299), `add(profile: EqualizerProfile, enabled: Boolean = true)` (:308)
    - `importText(fileName: String, content: String): EqualizerProfile` (:519; throws `InvalidEqualizerProfileException`)
    - `setDeviceProfile(deviceKey: String, profileId: String?)` (:231), `deviceProfileId(deviceKey: String): String?` (:233)
- **`data class EqualizerProfile`:** `(id, name, bands: List<ParametricEqBand>, preamp: Double = 0.0, source, rig, addedTimestamp, outputGainDb: Double? = null, bassDb: Double = 0.0, trebleDb: Double = 0.0, crossfeedEnabled: Boolean = false, crossfeedPreset: CrossfeedPreset = DEFAULT, stereoWidth: Double = 1.0)`.
  - `ParametricEqBand(frequency: Double, gain: Double, q: Double = 1.41, filterType: FilterType = PK, enabled: Boolean = true)`.
  - `FilterType { PK, LSC, HSC, LPQ, HPQ, BP, NO }`, `CrossfeedPreset { DEFAULT, CHU_MOY, JAN_MEIER }`, `MAX_EQUALIZER_BANDS = 32`.
  - Export: `fun EqualizerProfile.toParametricEqText(): String` (EqualizerProfiles.kt:673). Auto preamp: `fun EqualizerProfile.autoPreampDb(sampleRate: Int = 48000): Double` (ParametricEqualizer.kt:446).
- **`ParametricEqualizer(sampleRate: Int, channelCount: Int)`:** `update(profile: EqualizerProfile?): Boolean` (:78), `responseDb(frequency: Double): Double` (:135; requires `0..sampleRate/2`).
- **AutoEq:** `suspend fun AutoEqCatalog.models(): List<AutoEqModel>`, `fun searchAutoEqModels(models: List<AutoEqModel>, query: String): List<AutoEqModel>` (AutoEqCatalog.kt:112), `suspend fun load(entry: AutoEqEntry): EqualizerProfile` (:72). `AutoEqModel(name, entries: List<AutoEqEntry(name, source, rig?, form, path)>)`. Check whether `AutoEqCatalog` is an object or a Koin instance before calling.
- **`object AudioSpectrumMeter`:** `addConsumer()`, `removeConsumer()`, `levels(): FloatArray` (it runs the analysis), `bandCount: Int`, `@Volatile gainReductionDb: Float` (only updated while a consumer exists).
- **Settings:** `Settings.shared.equalizerDeviceProfilesJson` (`Map<String,String>` JSON; decode it yourself, the getter is private).

## Methods
| Method | Implementation |
|---|---|
| `eq.get` / topic `eq` | `EqState` mapper (pure). `builtin = id.startsWith("preset_") \|\| id.startsWith("autoeq:")`. `preampDb = activeProfile.preamp`. `effects.outputDb = activeProfile.outputGainDb ?: 0`. `widthPct = stereoWidth*100`. `crossfeed = if (!crossfeedEnabled) "off" else DEFAULT→"default", CHU_MOY→"chuMoy", JAN_MEIER→"janMeier"`. `limiterReductionDb = AudioSpectrumMeter.gainReductionDb`. `canUndo/canRedo` from the handler stack. Topic: emit `eq.state` after every mutating handler (single `MutableSharedFlow` in `EqBus`) |
| `eq.setEnabled/setProfile` | direct |
| `eq.updateBand {index, type?, freq?, gain?, q?}` | Push undo, then `updateBand(index) { it.copy(frequency = freq ?: it.frequency, gain = …, q = …) }`, then `setBandType` if `type` is given. The UI sends ≤ 1/frame; no server debounce needed |
| `eq.addBand {freq}` | `editCurrent(p.copy(bands = (p.bands + ParametricEqBand(freq, 0.0)).sortedBy { it.frequency }))`; `conflict`/`bad_request` at 32 bands |
| `eq.removeBand/resetBand` | Range-check, then direct |
| `eq.setPreamp {db}` | `setProfilePreamp(db)` |
| `eq.setAutoPreamp {on}` | Handler flag `autoPreamp` (persisted in `CorePrefs` key `eqAutoPreamp`). When on, call `applyAutoPreamp()` after every band edit |
| `eq.setEffects {...}` | `editTone { it.copy(bassDb=…, trebleDb=…, stereoWidth=widthPct/100.0, crossfeedEnabled=…, crossfeedPreset=…) }`. `limiter` → `EqualizerProfiles.limiterEnabled`. `outputDb` → `setPreamp(outputDb)` |
| `eq.profile.save {name, asNew}` | `saveCurrent(name, saveAs = asNew).id` |
| `eq.profile.rename {id, name}` | `setActive(id)` then `saveCurrent(name, false)` (the private writer is unavailable) |
| `eq.profile.delete` | `delete(id)` |
| `eq.undo/redo/reset` | `EqHistory`: `ArrayDeque<EqualizerProfile>` undo/redo, cap 50. Push `activeProfile` before each edit; restore with `editCurrent`. Reset = `resetAllBands()` + `editTone` to neutral effects |
| `eq.importFile {path}` | `importText(File(path).name, File(path).readText())` → `add(profile)` → `{id}`. Parse errors → `bad_request` |
| `eq.exportFile {id, path}` | `File(path).writeText(profile.toParametricEqText())` |
| `eq.autoeq.search {q}` | `searchAutoEqModels(models(), q).take(50)` → `{name, source (first entry), variants: entries.map { "${it.source}/${it.rig ?: it.form}" }}` |
| `eq.autoeq.apply {name, variant?}` | Find the entry, then `load(entry)` → `add(p)` → `{id}` |
| `eq.device.bind {deviceId, profileId}` | `setDeviceProfile(deviceId, profileId)`. `deviceProfiles` decoded from settings; `deviceName` = the id |
| `eq.response {points}` | Pure `EqResponse.compute(profile, points, rate = 48000)`: log grid `hz_i = 20 * exp(i/(n-1) * ln(maxF/20))`, `maxF = min(20000.0, rate*0.475)`; `db = ParametricEqualizer(rate, 1).apply { update(profile) }.responseDb(hz) + (outputGainDb ?: 0)` |
| `eq.spectrum` | A topic param `{spectrum:true}`: `addConsumer()` on open, `removeConsumer()` on close (`try/finally`). Poll `levels()` every 33 ms → 32 bands quantised to `Uint8` (map dB −90..0 → 0..255; pure function) → base64 → `eq.spectrum {b64}` |

## Verify (no builds)
1. JUnit (pure): `EqStateMapperTest`, `EqResponseTest` (a flat profile = 0 dB ± 0.01; a +6 dB PK at 1 kHz peaks at ≈ 6 dB), `SpectrumQuantiseTest`, `EqHistoryTest`, `CrossfeedMapTest`.
2. M2-3b's `m2-eq.mjs` is run on real at INT-W3. Self-review checklist and STATUS line.
