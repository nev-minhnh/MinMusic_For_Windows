# MinMusic for Windows (v2)

MinMusic for Windows rebuilt with two processes:
- A **Tauri 2 / WebView2** UI shell, which aims to scroll and animate as smoothly as Microsoft Edge.
- The existing **Kotlin core** from [MinMusic](https://github.com/nev-minhnh/MinMusic), running as a headless sidecar for playback, EQ, sources, library, downloads, lyrics, Device Connect and the other services.

It has no ads and no telemetry. VIP, DRM and SoundCloud Go+ restrictions are never bypassed.

## Status
Design is complete and M0 (the performance spike) is next. Start with these documents:

| Document | Contents |
|---|---|
| [docs/architecture.md](docs/architecture.md) | decisions, process model, packaging, and open questions |
| [docs/api.md](docs/api.md) | the UI ↔ core protocol |
| [docs/frontend-spec.md](docs/frontend-spec.md) | screens, motion, shortcuts, and strings |
| [docs/milestones.md](docs/milestones.md) | milestones, work packages, and the performance targets |
| [docs/test-guide.md](docs/test-guide.md) | unit, contract, e2e, process, and performance tests |
| [docs/work-packages/](docs/work-packages/) | ready-to-run M0 briefs |

## Layout
```
core/MinMusic   submodule (Kotlin core, :desktopCore module)
sidecar/        prebuilt core runtime (dist/ is not committed)
src-tauri/      Rust shell
ui/             SolidJS + Vite UI
protocol/       protocol types and schema
mock-core/      mock core for UI development and tests
tools/, scripts/, tests/
```

## Development (after M0)
UI work needs no Gradle build.

| Command | What it runs |
|---|---|
| `npm run dev` | Vite and the mock core in a browser |
| `scripts/dev.ps1` | the Tauri shell and the mock core |
| `scripts/dev.ps1 -Real` | the Tauri shell and the prebuilt core from `sidecar/dist` |

Rebuild the core only after a submodule bump, with `sidecar/build-sidecar.sh`.

## License
GPL-3.0, the same as MinMusic.
