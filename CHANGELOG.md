# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [v0.1.0] - 2026-11-14
### :sparkles: New Features
- [`88557e0`](https://github.com/jorben/litemd/commit/88557e050e9cc4fda8eeec0bced026411014d0d0) - **fidelity**: ✨ migrate vmark pipeline and add fidelity write-back prototype *(commit by [@jorben](https://github.com/jorben))*
- [`2a63739`](https://github.com/jorben/litemd/commit/2a63739b90ed48203b2a52cb22e56aae69c82aad) - **shell**: ✨ add document windows, sync protocol, start window and M0 report *(commit by [@jorben](https://github.com/jorben))*
- [`67b31ca`](https://github.com/jorben/litemd/commit/67b31ca5dd4bdf450bac5d075fce77803fd911d7) - **shell**: ✨ add custom menus, lmasset protocol, links and page hardening *(commit by [@jorben](https://github.com/jorben))*
- [`f6c23f0`](https://github.com/jorben/litemd/commit/f6c23f09b019be815fb0ad7f047af323c6143390) - **shell**: ✨ add settings, per-file state and drop registry tests *(commit by [@jorben](https://github.com/jorben))*
- [`38343a7`](https://github.com/jorben/litemd/commit/38343a7d4cc84d589fafd66ef69a8f46213502d5) - **editor**: ✨ migrate vmark editor extensions with host adapter layer *(commit by [@jorben](https://github.com/jorben))*
- [`9bb1434`](https://github.com/jorben/litemd/commit/9bb1434a2ce3fd58aea7d2c87420af26fae4397a) - **editor**: ✨ assemble LiteMd editor extensions and derive production schema from them *(commit by [@jorben](https://github.com/jorben))*
- [`948ea90`](https://github.com/jorben/litemd/commit/948ea9072db507733cde3c521d6a168a3ce778c4) - **editor**: ✨ wire Tiptap editor to fidelity write-back and verify load/edit/undo on corpus *(commit by [@jorben](https://github.com/jorben))*
- [`6202e9f`](https://github.com/jorben/litemd/commit/6202e9f0d2eaed920d1a934fe8dcd5810526df18) - **shell**: ✨ add document window shell with modes, sync, find, outline and banners *(commit by [@jorben](https://github.com/jorben))*
- [`c21e870`](https://github.com/jorben/litemd/commit/c21e870eec0d6470b8deee5f7a829493ebb63b84) - **security**: 🔒 add production CSP, HTML sanitize tests, lint and CI/release workflows *(commit by [@jorben](https://github.com/jorben))*
- [`b158c30`](https://github.com/jorben/litemd/commit/b158c306a092dabb7ba5f9667a6caf2ab276a1b3) - ✨ add export HTML/PDF/print, settings window, auto-update and CLI tool install *(commit by [@jorben](https://github.com/jorben))*
- [`c4bf2d3`](https://github.com/jorben/litemd/commit/c4bf2d3c3b6c1f1bbdd66629fe6e144999529ff5) - **shell**: ✨ add floating format toolbar and click-to-load network images *(commit by [@jorben](https://github.com/jorben))*
- [`31fa218`](https://github.com/jorben/litemd/commit/31fa21885d82a12690f96e8392a84f8d0d370d17) - **i18n**: ✨ add english ui for pages, menus and dialogs *(commit by [@jorben](https://github.com/jorben))*
- [`21d1d78`](https://github.com/jorben/litemd/commit/21d1d78fd896a81f3d7acb51dd8aae448aa47cc6) - **icon**: ✨ use feather artwork as app icon with dev badge variant *(commit by [@jorben](https://github.com/jorben))*
- [`c6fa77a`](https://github.com/jorben/litemd/commit/c6fa77afa011e08ddf49ec04a5c16d16b70780d3) - **settings**: ✨ sync native appearance with app theme *(commit by [@jorben](https://github.com/jorben))*
- [`1514532`](https://github.com/jorben/litemd/commit/1514532b651be99986cd9f7825297dbda6fbd2e5) - **settings**: ✨ redesign settings window with grouped cards *(commit by [@jorben](https://github.com/jorben))*
- [`b0c2002`](https://github.com/jorben/litemd/commit/b0c200217709353e635dd34d664856a6e41080da) - **start**: ✨ Show recent files on start window *(commit by [@jorben](https://github.com/jorben))*
- [`1922421`](https://github.com/jorben/litemd/commit/1922421ba27058e8b58d56fcb7c8e8bc9330fa0b) - **ui**: ✨ Use icon-only status bar with outline toggle *(commit by [@jorben](https://github.com/jorben))*

### :bug: Bug Fixes
- [`fd937f8`](https://github.com/jorben/litemd/commit/fd937f8d75fd1d9ea5b1aca5a1ce4b59c9b711eb) - **shell**: 🐛 declare shell state before editor callbacks and skip menu refresh without focus *(commit by [@jorben](https://github.com/jorben))*
- [`de33091`](https://github.com/jorben/litemd/commit/de33091ca6e2fd80ac8ad1807e40f66cd0d92cc6) - **fidelity**: 🐛 serialize new empty documents without trailing blank lines *(commit by [@jorben](https://github.com/jorben))*
- [`893ecdb`](https://github.com/jorben/litemd/commit/893ecdba1bbd80070de22dcf09eaab33e45185d8) - **doc**: 🐛 keep per-line eol of mixed line-ending files; add source-mode fidelity tests, keybindings doc and readme *(commit by [@jorben](https://github.com/jorben))*
- [`39e0450`](https://github.com/jorben/litemd/commit/39e0450039b887f89ba682b119add6f4c0766bf6) - **shell**: 🐛 apply spell check setting to both editors; perf script needs debug build *(commit by [@jorben](https://github.com/jorben))*
- [`3b2d373`](https://github.com/jorben/litemd/commit/3b2d373eca8ae3c591698d4a9abe70f87feaf89a) - **i18n**: 🐛 load mygo's own zh-Hans strings *(commit by [@jorben](https://github.com/jorben))*
- [`f5e15d6`](https://github.com/jorben/litemd/commit/f5e15d62a84469e8a160dafa1b89a6687e32e997) - **shell**: 🐛 fit tables to text width, show path of missing images, add open timing marks *(commit by [@jorben](https://github.com/jorben))*
- [`44df5c5`](https://github.com/jorben/litemd/commit/44df5c55110d3d023744983650c3f3195caa5beb) - **start**: 🐛 Apply settings changes to start window live *(commit by [@jorben](https://github.com/jorben))*
- [`e8da7d6`](https://github.com/jorben/litemd/commit/e8da7d620592f8267af6e64a598c67c1437c0b97) - **paths**: 🐛 Resolve Windows drive and root paths *(commit by [@jorben](https://github.com/jorben))*
- [`465109d`](https://github.com/jorben/litemd/commit/465109deb77e8b17c4619edda4a1fa014b07d0b6) - **start**: 🐛 Defer closing start window until drop finishes *(commit by [@jorben](https://github.com/jorben))*
- [`c536b54`](https://github.com/jorben/litemd/commit/c536b5466b86150e6476d3e324db647e8240741f) - **ui**: 🐛 Remove placeholder flash on window load *(commit by [@jorben](https://github.com/jorben))*
- [`8c293bf`](https://github.com/jorben/litemd/commit/8c293bfbfe72a95788d4e5e322154e95f752bc11) - **fidelity**: 🐛 Keep details toggles in preview out of saves *(commit by [@jorben](https://github.com/jorben))*
- [`a5c666a`](https://github.com/jorben/litemd/commit/a5c666ac67ea35ea4bd0afbc87ec4042681a83ac) - **ui**: 🐛 Disable overscroll bounce at scroll edges *(commit by [@jorben](https://github.com/jorben))*

### :zap: Performance Improvements
- [`dd6da47`](https://github.com/jorben/litemd/commit/dd6da47120188cd434d80c39a3dd0d6f7303180f) - **fidelity**: ⚡ shift baseline units on push instead of reparsing; size-only debounce on keystroke *(commit by [@jorben](https://github.com/jorben))*

### :white_check_mark: Tests
- [`44051e0`](https://github.com/jorben/litemd/commit/44051e06dc744f3524090dde5d9a50b8ac45ad5e) - ✅ run timing-sensitive pipeline tests serially with retries *(commit by [@jorben](https://github.com/jorben))*
- [`f3fa33c`](https://github.com/jorben/litemd/commit/f3fa33c5af9f775d3d070f339bfde7048f472edc) - 🐛 stub jsdom layout apis so async prosemirror scroll does not fail the run *(commit by [@jorben](https://github.com/jorben))*
- [`7cd9793`](https://github.com/jorben/litemd/commit/7cd97935198c1ff58236a7f1b6d33ade92bf4459) - **doc**: ✅ Compare file mode portably on Windows *(commit by [@jorben](https://github.com/jorben))*
- [`9f5e1b8`](https://github.com/jorben/litemd/commit/9f5e1b89c1fb4590c3fce45f5f0c9beefefbbbbf) - **fidelity**: 🐛 Use POSIX corpus names for cross-platform seeds *(commit by [@jorben](https://github.com/jorben))*
- [`83baa01`](https://github.com/jorben/litemd/commit/83baa01528c344470f102e2e48f47dacfacb296e) - **fidelity**: ✅ Ignore derived attrs in writeback semantic check *(commit by [@jorben](https://github.com/jorben))*

### :wrench: Chores
- [`e546ca3`](https://github.com/jorben/litemd/commit/e546ca30aa87278d85a706da0bd87d7a0543b061) - 🔧 add gitignore for Go, mygo and pnpm toolchain
- [`7f42923`](https://github.com/jorben/litemd/commit/7f4292391d5de16b0e31ceec53facd2bad7077ce) - 🔧 scaffold mygo app with pnpm frontend *(commit by [@jorben](https://github.com/jorben))*
- [`3a5e28c`](https://github.com/jorben/litemd/commit/3a5e28cbdeef67e30a8f2464af101ed08fcad5b8) - **git**: 🔧 Check out text files with LF everywhere *(commit by [@jorben](https://github.com/jorben))*

[v0.1.0]: https://github.com/jorben/litemd/compare/0.0.1...v0.1.0
