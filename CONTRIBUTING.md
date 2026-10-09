# Contributing to Hades

Thanks for your interest in Hades. This is a small, maintainer-led project, and
bug reports, fixes, documentation improvements and well-scoped features are all
welcome.

By participating you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to contribute

- **Report bugs**: open an issue with enough detail to reproduce it (see below).
- **Suggest features**: open an issue describing the problem you want solved
  before writing a large change, so the approach can be agreed first.
- **Improve the docs**: the user guide lives in [`docs/`](docs/README.md), with
  release notes in `docs/updates/`. Typos, unclear steps and missing
  troubleshooting entries are easy, valuable first contributions.
- **Fix bugs or implement agreed features**: see the workflow below.

## Reporting bugs

Search existing issues first. A good bug report includes:

- **Operating system and version** (for example Ubuntu 24.04 on Wayland,
  macOS 15 on Apple Silicon, Windows 11) and how you installed Hades
  (AppImage, DMG, MSI/EXE, or built from source).
- **Hades version** (shown in Settings, or the release you downloaded).
- **Steps to reproduce**, what you expected, and what happened instead.
- **Logs or errors**: terminal output if you launched Hades from a terminal,
  the developer console if you ran a dev build, and screenshots for UI issues.
  Remove API keys, note contents and other personal data before posting.

Check [docs/troubleshooting.md](docs/troubleshooting.md) for known issues
(for example Linux Wayland display problems or the macOS Gatekeeper prompt).

## Reporting security issues

**Do not open a public issue for security vulnerabilities.** Report them
privately, either through GitHub's private vulnerability reporting
(the repository's **Security** tab, then **Report a vulnerability**) if it is
available, or by contacting the maintainer,
[@niklaslautenschlager](https://github.com/niklaslautenschlager), privately
through GitHub. Please include the affected version, platform and steps to
reproduce, and give the maintainer reasonable time to fix the issue before
disclosing it.

## Development setup

Hades is a [Tauri 2](https://v2.tauri.app/) desktop app: a React + TypeScript
frontend (Vite, Tailwind, Zustand) in `src/` and a Rust backend in
`src-tauri/`. The optional MCP server in `mcp/` is a separate Node package.

### Prerequisites

- [Node.js](https://nodejs.org/) 20 or later (CI uses Node 20; the MCP server
  requires it).
- [Rust](https://rustup.rs/), stable toolchain.
- Tauri 2 system dependencies for your OS: see the
  [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/).
  - **Linux**: WebKit2GTK 4.1 and GTK 3 development packages. On
    Debian/Ubuntu, CI installs `libgtk-3-dev libwebkit2gtk-4.1-dev
    libappindicator3-dev librsvg2-dev patchelf libsoup-3.0-dev`.
  - **macOS**: Xcode Command Line Tools.
  - **Windows**: Microsoft C++ Build Tools and WebView2 (preinstalled on
    Windows 10/11).

### Running the app

```bash
npm install
npm run dev:app      # Tauri dev build with the Linux display env vars set
```

`dev:app` prefixes `tauri dev` with `GDK_BACKEND=x11
WEBKIT_DISABLE_COMPOSITING_MODE=1 WEBKIT_DISABLE_DMABUF_RENDERER=1`, which
avoids blank windows on Linux Wayland. That inline env-var syntax needs a POSIX
shell, so on Windows (or if you prefer) run `npm run tauri dev` instead.

`npm run dev` starts only the Vite frontend in a browser; anything that calls
into Rust via `invoke()` will not work there.

Other scripts:

| Command | What it does |
|---|---|
| `npm run build` | TypeScript type-check (`tsc`) and Vite production build |
| `npm test` | Frontend unit tests (`vitest run`, tests live next to code as `*.test.ts`) |
| `npm run tauri build` | Full packaged build for your platform (`src-tauri/target/release/bundle/`) |
| `npm run build:appimage` | Linux AppImage build without FUSE (see AGENTS.md section 5) |

### MCP server

The MCP server in `mcp/` has its own dependencies and tests. If you change it:

```bash
cd mcp
npm install
npm test             # builds with tsc, then runs node --test
```

See [mcp/README.md](mcp/README.md) for how it works and how to configure a
client against it.

## Before opening a pull request

Run these locally and make sure they pass:

```bash
npm run build                 # TypeScript + Vite
npm test                      # vitest
cd src-tauri && cargo check   # Rust compile check
```

Also run `npm test` in `mcp/` if you touched the MCP server, and for UI changes
start the app with `npm run dev:app` (or `npm run tauri dev`) and confirm the
feature works.

CI (`.github/workflows/build.yml`) runs `npm run build` and `cargo check` on
Linux, macOS and Windows for pull requests into `main`. It does not run the
test suites and does not run on pull requests into `dev`, so running the checks
above yourself is what catches problems before review.

## Branching and pull requests

- `main` holds released code. `dev` is the integration branch; releases are cut
  by merging `dev` into `main` and tagging `vX.Y.Z`, which triggers the release
  builds.
- Fork the repository and create your branch from `dev`, for example
  `fix/calendar-ical-timezone` or `feat/flashcard-export`.
- Open your pull request **against `dev`**, not `main`.
- Keep pull requests focused: one bug fix or feature per PR, with no unrelated
  refactors or formatting changes.

### Commit messages

The history uses [Conventional Commits](https://www.conventionalcommits.org/)
style prefixes with a short, lower-case summary:

```
feat: add Hades notes MCP server
fix: resolve React #185 infinite re-render from unstable Zustand selector
docs: add cloud sync setup guide and update README
chore: release v0.8.1
```

Use `feat:` for new functionality, `fix:` for bug fixes, `docs:` for
documentation only and `chore:` for maintenance. Version bumps and
`chore: release vX.Y.Z` commits are done by the maintainer, so do not bump the
version in your PR.

### Pull request checklist

Copy this into your PR description and fill it in:

```markdown
- [ ] Branched from `dev`; PR targets `dev`
- [ ] `npm run build`, `npm test` and `cargo check` (in `src-tauri/`) pass
- [ ] `npm test` in `mcp/` passes (if the MCP server changed)
- [ ] Platforms **tested**: Linux / macOS / Windows (list which)
- [ ] Platforms only **code-reviewed**: (list which)
- [ ] If this touches the updater, window/display setup or any `#[cfg]` block:
      all three platform branches (Linux, macOS, Windows) are verified intact
- [ ] User-facing behaviour changes are documented in `docs/`
- [ ] No `console.log` or `eprintln!` left in production paths
```

## Coding guidelines

The full rules are in [AGENTS.md](AGENTS.md). The short version:

### Multi-platform is non-negotiable

Hades ships on Linux (AppImage), macOS (DMG) and Windows (MSI/EXE). A change
that only works on one platform is a bug.

- **Rust**: put platform-specific code behind `#[cfg(target_os = "linux")]`,
  `#[cfg(target_os = "macos")]` or `#[cfg(target_os = "windows")]`. Check that
  any new crate supports all three platforms.
- **TypeScript**: use `hostPlatform()` from `src/lib/updater.ts` for runtime
  platform detection. Never hardcode paths such as `/home/`, `~/Library/` or
  `%APPDATA%`, or assume a file extension.
- **Updater**: `src/lib/updater.ts` and `src-tauri/src/lib.rs` each have three
  code paths (Linux `.AppImage`, macOS `.dmg`, Windows installer). All three
  must keep working; `checkForUpdate()` must return `null` rather than an
  asset for the wrong platform.
- **Linux display env vars**: `GDK_BACKEND=x11`,
  `WEBKIT_DISABLE_COMPOSITING_MODE=1` and `WEBKIT_DISABLE_DMABUF_RENDERER=1`
  are set in both `src-tauri/src/main.rs` and `src-tauri/src/lib.rs`. Do not
  remove either; they prevent blank windows and crashes on Wayland.
- Do not remove any platform from the CI matrix.

### Stability

- Every `#[tauri::command]` returns `Result<_, String>` and maps its errors;
  never panic inside a command.
- Wrap every `invoke()` call in React in try/catch and surface the error in
  the UI.
- Network calls (AI APIs, iCal feeds, GitHub releases) must fail gracefully and
  never hang the UI.
- Persisted state may be missing or corrupt; fall back to defaults at startup.
- Keep the `ErrorBoundary` in `src/main.tsx`.

### Code quality

- Comments explain *why* (non-obvious constraints, workarounds), not *what*.
- No features, refactors or abstractions beyond what the change needs.
- Prefer editing existing files over adding new ones.
- No backwards-compatibility shims for removed code.
- No `console.log` or `eprintln!` in production paths.

## AI-assisted contributions

Using AI coding tools is fine. You are responsible for what you submit: review
every line, run the checks above, and test the change yourself. State in the PR
which platforms you actually tested. AI agents working in this repository must
follow [AGENTS.md](AGENTS.md).

## License

Hades is released under the [BSD 3-Clause License](LICENSE). By submitting a
contribution you agree that it is licensed under the same terms.

Separately from the license, the README asks that Hades be used for personal,
non-commercial and educational purposes, and that nobody sell Hades or
commercial derivatives of it without the author's permission. This is a
request, not an additional license condition; see the
[Usage & attribution notice](README.md#usage--attribution-notice) in the
README.
