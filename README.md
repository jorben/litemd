<p align="center">
  <img src="resources/icon.png" width="96" height="96" alt="LiteMd icon">
</p>

<h1 align="center">LiteMd</h1>

<p align="center">
  One file, one window. Edit what you see, keep the source intact.<br>
  A lightweight desktop Markdown editor for macOS, Windows and Linux.
</p>

<p align="center">
  <a href="https://github.com/jorben/litemd/actions/workflows/ci.yml"><img src="https://github.com/jorben/litemd/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/jorben/litemd/releases"><img src="https://img.shields.io/github/v/release/jorben/litemd?include_prereleases" alt="Release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="Apache-2.0"></a>
</p>

<p align="center"><b>English</b> · <a href="README.zh-CN.md">简体中文</a></p>

<p align="center">
  <img src="docs/images/screenshot.png" width="760" alt="LiteMd in preview mode with the English interface, showing a Markdown document with headings and a highlighted Go code block">
</p>

LiteMd treats `.md` files the way an image viewer treats pictures: double-click one and it opens in its own window. There is no file tree, no notes library and no tabs.

> [!NOTE]
> LiteMd is in pre-release (`0.1.0-rc`). Builds on [Releases](https://github.com/jorben/litemd/releases) are marked as pre-releases.

## Why LiteMd

- **Opens on double-click.** Double-click a `.md` file in Finder or Explorer and it gets its own window. Median cold start to rendered content is about 0.65 s ([performance report](docs/perf-report.md), in Chinese). Files open in preview. Press `⌘E` or double-click the text to start editing.
- **Leaves what you didn't touch alone.** If you open a file and don't edit it, not a single byte changes. If you edit one block, saving rewrites only that block. Blank lines, list markers, table alignment and line endings elsewhere stay as they were. Every build runs a fidelity regression suite over 260+ real-world documents (`testdata/fidelity/`).
- **Four views.** Preview, WYSIWYG, source (CodeMirror) and split view. Switch with `⌘1`–`⌘4` and keep your reading position.
- **No save anxiety.** Existing files autosave. After a crash, unsaved changes come back when you reopen the file. If another program changes the file, LiteMd asks which version to keep.
- **Renders the extensions you use.** GFM tables and task lists, syntax highlighting, KaTeX math, Mermaid diagrams, footnotes, GitHub alerts, `<details>` and frontmatter. Export to HTML or PDF, or print.
- **Light.** LiteMd uses the system WebView through [mygo](https://github.com/egoist/mygo) instead of bundling a browser. The macOS DMG is about 6.5 MB. No account and no telemetry. The interface is available in English and Simplified Chinese.

## Install

Download the package for your platform from [Releases](https://github.com/jorben/litemd/releases):

| Platform | Package | Notes |
|---|---|---|
| macOS 13+ | `litemd-<version>-arm64.dmg` (Apple silicon)<br>`litemd-<version>-amd64.dmg` (Intel) | Signed and notarized. Drag it into Applications |
| Windows 10+ (x64) | `litemd-setup-<version>-amd64.exe` | Per-user install, no admin rights needed |
| Linux (x64 / arm64) | `.deb` / `.rpm` / `.tar.gz` | Best-effort support |

> [!WARNING]
> The Windows installer is **not code-signed**. On first run SmartScreen will block it. Choose **More info → Run anyway**. Auto-updates still verify the update signature.

LiteMd checks for updates in the background. You can turn this off in **Settings → Privacy**. No personal data is sent when checking.

### Command line

```sh
litemd notes.md report.md   # one window per file; missing files are created
```

On macOS, choose **LiteMd → Install Command Line Tool…** to put `litemd` in `/usr/local/bin`. On Windows and Linux, run the executable in the install directory or add that directory to your `PATH`.

## Usage

| Action | macOS | Windows / Linux |
|---|---|---|
| Preview / WYSIWYG / Source / Split | `⌘1` `⌘2` `⌘3` `⌘4` | `Ctrl+1`–`Ctrl+4` |
| Toggle between preview and editing | `⌘E` | `Ctrl+E` |
| Find / Replace | `⌘F` / `⌥⌘F` | `Ctrl+F` / `Ctrl+Alt+F` |
| Outline | `⇧⌘O` | `Ctrl+Shift+O` |
| Heading 1–6 / Body text | `⌥⌘1`–`⌥⌘6` / `⌥⌘0` | `Ctrl+Alt+1`–`6` / `Ctrl+Alt+0` |

The full list is in [docs/keybindings.md](docs/keybindings.md) (in Chinese). Pasted or dropped images go into an `assets/` folder next to the document by default, and you can change this in Settings. To change the interface language, go to **Settings → General → Language**. The change takes effect after a restart.

## Build from source

You need Go (`go.mod` fetches the required 1.27.4 toolchain automatically), Node.js 24 (see `.nvmrc`) and pnpm 11.

```sh
make dev       # install frontend deps, start Vite and the LiteMd Dev app with hot reload
make build     # package into build/: .app and DMG (ad-hoc signed for local builds)
make check     # same checks as CI: lint, Go tests, bindings check, typecheck, frontend tests
```

`make help` lists every target. Without Make, the equivalent commands are:

```sh
pnpm -C frontend install
go tool mygo dev
go tool mygo build
go test -race ./...
pnpm -C frontend typecheck && pnpm -C frontend lint
pnpm -C frontend test       # unit tests + fidelity regression (testdata/fidelity/)
```

After changing a Go service, run `make generate` to regenerate `frontend/src/mygo.ts`. After changing menu shortcuts, run `make golden` to update the shortcut table and docs.

## Project layout

```text
main.go                 App entry: windows, menus, service bindings
internal/               Go: document sessions and sync, CLI, image protocol, links,
                        settings, menus, export, updates, localization
frontend/src/shell/     Page shell: status bar, banners, find, outline, settings, export
frontend/src/editor/    WYSIWYG (Tiptap) and source (CodeMirror) editors
frontend/src/fidelity/  Fidelity write-back: rewrites only the top-level blocks you changed
frontend/src/vmark/     Markdown pipeline and editor extensions ported from vmark
testdata/fidelity/      Fidelity regression corpus
```

Design and acceptance docs (in Chinese): [Product requirements](docs/product-requirements.md) · [Technical design](docs/technical-design.md) ·
[Interactive prototype](docs/prototype.html) · [M0 validation](docs/m0-report.md) · [Performance report](docs/perf-report.md) ·
[v1 acceptance checklist](docs/v1-acceptance.md)

## License

[Apache-2.0](LICENSE). The Markdown pipeline and editor extensions are ported from [vmark](https://github.com/xiaolai/vmark) (ISC). See [THIRD_PARTY.md](THIRD_PARTY.md) for third-party code.
