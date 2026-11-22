# Dev setup (this PC)

## Toolchain
- Rust (GNU host) and TDM-GCC are portable: `source scripts/gnu-env.sh` in Git Bash before any `cargo` command.
- Node 26, `npm install` at the repo root (workspaces: ui, protocol, mock-core, tests/contract).

## Real core sidecar (`:desktopCore`)
The shell looks for the sidecar image in `<repo>\sidecar\dist` (dev and e2e builds) or `<exe dir>\core` (installed).
`sidecar/dist` is gitignored. For local work it is a directory junction to the image built in the MinMusic worktree:

```powershell
New-Item -ItemType Junction -Path sidecar\dist -Target D:\Coding_Project\MinMusic-wt-core\build\sidecar\dist
```

Rebuild the image (global lock script, never run gradle directly):

```bash
MM_HEAP=6g bash D:/Coding_Project/MinMusic-notes/tools/mm-build.sh D:/Coding_Project/MinMusic-wt-core :desktopCore:sidecarImage --no-configuration-cache
```

The submodule `core/MinMusic` is pinned to the commit of `feat/desktop-core` that produced that image. To build the image from the submodule instead,
run the same command with `D:/Coding_Project/MinMusic_4_Windows/core/MinMusic` as the worktree.

Overrides (dev and e2e builds only, compiled out of release):
- `MINMUSIC_SIDECAR_CMD="<program> <leading args>"` replaces the sidecar, e.g. `node mock-core\bin\sidecar.mjs`
  (`scripts\dev.ps1` sets it unless `-Real`). To keep image-name checks working with the mock copy `node.exe` to `.testdata\fake-core\minmusic-core.exe`.
- `MINMUSIC_DATA_ROOT=<dir>` redirects all data; the shell then also passes `--data-root <dir>\Local\MinMusic` to the core (keeps the v1 `state\metrolist` layout).
- `MINMUSIC_CORE_EXTRA_ARGS`, `MINMUSIC_DEVTOOLS_PORT`, `MINMUSIC_TEST_PIDFILE`, `MINMUSIC_TEST_NO_JOB`.

The shell appends `-XX:ErrorFile=<logdir>\hs_err_core_%p.log` to the JVM arguments, so JVM crash logs land next to the core logs.
`SidecarMain` sets the system property `minmusic.sidecar=true`; with it the v1 GitHub update check is skipped, the Tauri updater owns updates.

## Builds
```bash
source scripts/gnu-env.sh
npm -w ui run build
cargo tauri build --target x86_64-pc-windows-gnu --features e2e --no-bundle   # e2e build, test hooks on
cargo tauri build --target x86_64-pc-windows-gnu --no-bundle                  # release build, hooks off
```

## Tests
- `npm -w ui test` (vitest, 77 tests), `node tests/contract/run.mjs --target mock|real --suite m0`
- `powershell -File scripts\e2e.ps1 -Suite process|contract|web|smoke`
