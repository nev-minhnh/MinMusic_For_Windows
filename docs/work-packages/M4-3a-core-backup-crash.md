# M4-3a: Core backup/restore, foreign import, crash, onboarding, logs, portable mode

**Wave 5. Agent:** Sonnet. **Repo:** MinMusic. Conventions apply.
- **Worktree:** `D:\Coding_Project\MinMusic-wt-m4-3a`, branch `feat/desktop-core-m4-3a` (after INT-W4).
- **Test checkout:** `…-wp\M4-3a-test`.

Read first:
- `docs/api.md` §3.1 `app.logs.tail`, §3.15
- `docs/architecture.md` §3.4, §7 (portable: `MINMUSIC_PORTABLE=1` → `<exe dir>\data` as the XDG base)
- `M1-2a-core-browse.md` ("No Gradle" rules)

## No Gradle
INT-W5 builds. Copy each signature into a comment above its call.

## Owned paths
- `desktopCore/.../core/api/{backup,crash,onboarding,logs}/**` (`BackupModule`, `CrashModule`, `OnboardingModule`, `LogsModule`) + tests
- `desktopCore/.../core/CoreRuntime.kt`: **only** the pending-restore apply and the portable XDG base (below)

## Methods
| Method | Backing |
|---|---|
| `backup.create {path}` | `DesktopBackupRestoreManager.backup(destination: File): Result<Unit>` (package `com.metrolist.desktop.backup`, :70) → `{bytes = File(path).length()}`. Failure → `internal` with the message |
| `backup.inspect {path}` | **Replicate** the private `preflightManifest` (:404): open the zip, read the `backup.json` entry capped at 64 KiB (`BackupArchiveLimits.MANIFEST_BYTES`, if public; else 64 KiB), decode `BackupManifest` (`com.metrolist.shared.backup`, `@Serializable`; check its fields: `formatVersion`, `platform`, `databaseVersion?`) with `Json { ignoreUnknownKeys = true }`. `createdAt` = the entry time. Errors → `{ok:false, error}` |
| `backup.restore {path}` | `DesktopBackupRestoreManager.stageRestore(source: File): Result<Unit>` (:121) → `{staged:true}`. **Never** call `stageRestoreAndRestart`/`restart` (they `exitProcess`); the UI calls the shell `app_restart`, which runs the normal quit and relaunch |
| Pending restore at boot | In `CoreRuntime` init, before the DB opens: `DesktopBackupRestoreManager.applyPendingRestore(settings: Settings): Boolean` (:223). Find where v1 `Main.kt` calls it and mirror the order |
| `import.foreignBackup {path}` | `suspend fun MusicDatabase.importForeignBackup(input: InputStream, stagingDirectory: File, driver: SQLiteDriver): ForeignImportSummary` (`shared/src/jvmSharedMain/.../backup/ForeignBackupArchive.kt:20`), with `File(XdgUtils.getXdgCacheHome(), "metrolist/foreign-import")` and `JdbcSQLiteDriver()` as v1 does (`BackupRestoreSettings.kt:649`). Result `{imported = songs + playlists}`. `UnsupportedForeignLibraryException` → `bad_request` |
| `crash.pending` | `DesktopCrashRecovery.store.pendingReportId()` → `store.list().first { it.id == id }` → `{when: timestamp, summary: stackTrace.lineSequence().first(), path: File(XdgUtils.getXdgDataHome(), "metrolist/crashes/$id.json")}` |
| `crash.dismiss` | `store.acknowledge(id)` |
| `onboarding.state` | `{firstRun: !Settings.shared.desktopOnboardingComplete && !dbExistedAtStart}`. Capture `dbExistedAtStart = File(XdgUtils.getXdgDataHome(), "metrolist/metrolist.db").isFile` in `CoreRuntime` **before** the DB opens, as v1 `Main.kt:895-898` does |
| `onboarding.complete` | `Settings.shared.desktopOnboardingComplete = true` |
| `app.logs.tail {file, lines≤2000}` | `app` → the newest `AppLogger.getLogFiles()` entry; `shell`/`ui` → `shell.log`/`ui.log` in `AppLogger.getLogDirectory()`. **Replicate** the internal `readLogTail`: a pure `TailReader.tail(file, maxLines)` reading backwards in 64 KiB blocks, UTF-8 safe. Call `AppLogger.flush()` first |
| Portable mode | If env `MINMUSIC_PORTABLE=1` and `--data-root` is absent, set the data root to `<dir of the runtime image>\..\..\data` (resolve from `ProcessHandle.current().info().command()`), using the same mechanism `--data-root` already uses in `CoreOptions`/`SidecarMain`. Unit-test the path resolution |

## Verify (no builds)
1. JUnit (pure): `ManifestInspectTest` (zip fixtures built in the test: valid, missing manifest, oversized), `TailReaderTest` (CRLF, multibyte at a block boundary, fewer lines than asked), `PortablePathTest`, `CrashSummaryTest`.
2. INT-W5 runs `m4-backup.mjs` on real plus backup → restore on a test root (the restart via the shell). Self-review checklist and STATUS line.
