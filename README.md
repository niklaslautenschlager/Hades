# Hades `v0.6.0`

> **Early software.** Bugs and missing features are expected. Use at your own risk and back up any important data.
>
> 🆕 **New in 0.6.0:** a real AI **study agent** that can act on the app (create tasks, events, flashcards & notes), **local RAG** over your notes & PDFs via Ollama embeddings, multi-vendor AI (Groq/OpenAI/Anthropic/DeepSeek/Ollama) with a privacy opt-in, multi-conversation memory, a fixed PDF **Library**, calculator results as live **KaTeX** math in notes, and a cleaner tabbed Settings. See **[docs/whats-new-0.6.0.md](docs/whats-new-0.6.0.md)**.

A focused, distraction-free desktop productivity suite built for students and knowledge workers. Hades combines a Pomodoro timer with an AI study assistant, a markdown note editor, calendar, task manager, flashcards with spaced repetition, and detailed focus statistics — all in one unified interface.

Built with [Tauri 2](https://v2.tauri.app) for native performance on macOS, Linux, and Windows.

## Features

### Focus Timer (Pomodoro)
- Configurable work, break, and long break durations
- Session tracking with visual progress ring
- Session goal setting
- Integrated AI study assistant — multi-vendor (Groq, OpenAI, Anthropic, or a local Ollama model)
- Built-in commands: `/explain`, `/quiz`, `/motivate`, `/summarize`, and more
- Sound notifications with multiple sound options (bell, chime, gong, digital)
- **Task linking** — send a task to the timer, estimate how many focus sessions it needs, and get a "Is this task finished?" prompt that crosses it off when you hit your estimate

### Notes
- Full markdown editor with live preview
- Vim mode toggle (powered by CodeMirror 6)
- Folder-based organization with drag-and-drop
- Tag system with color-coded search
- Note linking via `[[Note Name]]` syntax
- PDF viewer panel (resizable, drag-and-drop **or load-from-URL** PDF loading)
- Export to Markdown (.md) or HTML
- Import from Obsidian vaults (preserves folder structure)
- Collapsible file tree sidebar with **persistent expand/collapse state** — folders stay open across restarts
- **Smart creation** — new notes and folders nest inside the folder you're working in, not the root
- **Cloud sync** — auto-saves notes as `.md` files to any local folder synced by Google Drive, iCloud Drive, Nextcloud, Syncthing, Dropbox, or OneDrive. Bidirectional merge on startup, 5-minute auto-save, quit guard. See [Cloud Sync Setup](docs/cloud-sync.md).

### Calendar
- Month, week, and day views
- Opens on **today** each launch, with the current day highlighted/glowing
- Local event creation and editing
- **Expandable event color palette** — base colors by default, with a "more colors" toggle that reveals the full set
- iCal feed subscription (subscribe to .ics URLs)
- Recurring events (daily, weekly, monthly) with flexible end conditions — now via theme-aware dropdowns
- Current-time indicator line

### Tasks
- Quick task creation
- Inline editing (double-click a task to rename)
- Checkbox completion with animated strike-through
- Separate pending and completed sections
- **Clear completed** and **Clear all** (calendar deadline tasks are preserved)
- Link a task to the Pomodoro timer with a focus-session estimate (see Focus Timer above)

### Flashcards
- Deck-based organization with custom colors
- SM-2 spaced repetition algorithm (inspired by Anki)
- Review scheduling based on performance ratings
- Cards due today are surfaced automatically

### Statistics
- Daily, weekly, monthly, and yearly focus time tracking
- 7-day bar chart visualization
- Weekly hour goal with motivational progress quotes
- Day streak counter
- All-time totals

### General
- **18 themes** across four packs, with a collapsible theme picker and a bold per-theme accent system (gradients + glow):
  - *Core* — Zinc Dark, Paper, Catppuccin Mocha, Gruvbox, Nord
  - *Popular* — Tokyo Night, Dracula, One Dark, Monokai Pro, Rosé Pine
  - *Light & Classic* — Solarized Dark/Light, Everforest, Rosé Pine Dawn
  - *Hades Originals* — Ember, Abyss, Synthwave, Matrix
- In-app updater via GitHub Releases (Linux/macOS/Windows aware)
- Persistent state via Zustand + Tauri Store
- Resizable panels throughout

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Tauri 2 (Rust + WebView) |
| Frontend | React 18, TypeScript, Vite |
| State | Zustand with persist middleware |
| Editor | CodeMirror 6 with vim bindings |
| Styling | Tailwind CSS with CSS custom properties |
| Animation | Framer Motion |
| AI | Groq / OpenAI / Anthropic / Ollama (SSE streaming via Rust) |
| Calendar | ical.js for iCal parsing |
| Icons | Lucide React |

## Getting Started

### Download (recommended)

The easiest way to run Hades is to grab a prebuilt release from the
**[Releases page](https://github.com/niklaslautenschlager/Hades/releases)** — no
toolchain or build step required:

| Platform | Download |
|----------|----------|
| **macOS** | the **`.dmg`** — open it and drag Hades to Applications. The DMG is a universal binary that runs natively on both Apple Silicon and Intel Macs. |
| Linux | the `.AppImage` — mark it executable and run it |
| Windows | the `*-setup.exe` installer |

> **macOS users:** just download the `.dmg`. It's the supported path — cloud
> sync (iCloud Drive, Google Drive, etc.) and the in-app updater are wired for
> the packaged app, so there's no need to build from source. If first launch is
> blocked by Gatekeeper, see [Troubleshooting](#macos-hades-cannot-be-opened--is-damaged) below.

Building from source (below) is only needed if you want to develop Hades or run
an unreleased build.

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Rust](https://rustup.rs/) (stable)
- Platform-specific Tauri dependencies — see the [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/)

### Development

```bash
# Install dependencies
npm install

# Start development server
npm run tauri dev
```

### Build

```bash
# Production build
npm run tauri build
```

The built application will be in `src-tauri/target/release/bundle/`.

### AI Assistant Setup

The AI study assistant requires a free [Groq API key](https://console.groq.com/):

1. Create an account at console.groq.com
2. Generate an API key
3. Open Hades Settings and paste your key

### Cloud Sync Setup

Hades can sync your notes to any cloud storage provider by writing them as plain `.md` files to a local folder managed by your cloud client (Google Drive for Desktop, iCloud Drive, Nextcloud, Syncthing, Dropbox, etc.).

Enable it in **Settings → Cloud Sync**, pick your sync folder, and Hades handles the rest — auto-saving every 5 minutes and merging changes from other devices on startup.

For detailed per-provider setup instructions on Linux, macOS, and Windows see **[docs/cloud-sync.md](docs/cloud-sync.md)**.

## Project Structure

```
src/
  components/
    calendar/       # Calendar views, event modals, iCal management
    flashcards/     # Deck list, card review, SM-2 algorithm
    layout/         # Shell sidebar, navigation
    notepad/        # Editor, file tree, PDF viewer, markdown preview
    pomodoro/       # Timer, AI assistant
    settings/       # Settings modal
    stats/          # Focus statistics, charts, weekly goal
    tasks/          # Task list
  lib/
    ai.ts           # AI command system and multi-vendor streaming
    ical.ts         # iCal feed parsing
    noteExport.ts   # Markdown and HTML export via Tauri dialog
    noteImport.ts   # Obsidian vault import (native folder picker)
    noteSync.ts     # Cloud sync engine (read/write .md files with frontmatter)
    sound.ts        # Web Audio API notification sounds
  hooks/
    useSyncTimer.ts    # 5-minute auto-save timer
    useStartupSync.ts  # Bidirectional merge on app open
    useQuitGuard.ts    # Intercepts window close if unsaved changes exist
  store/
    useStore.ts     # Global Zustand store
  styles/
    globals.css     # Theme system, utility classes
src-tauri/
  src/lib.rs        # Rust commands (Groq streaming, iCal fetch)
  capabilities/     # Tauri permission configuration
```

## Updating

Hades checks GitHub Releases for new versions and updates in place, with a
platform-specific install path:

| Platform | Asset | How it installs |
|----------|-------|-----------------|
| Linux | `.AppImage` | Downloads and atomically replaces the running AppImage (uses the `APPIMAGE` path) — restart to apply |
| macOS | `.dmg` | Downloads and opens the DMG; drag Hades to Applications |
| Windows | `*-setup.exe` | Downloads and launches the installer |

The updater only ever offers the asset matching your OS; if no matching asset
exists for a release, it reports "up to date" rather than offering the wrong one.

## Troubleshooting

### macOS: "Hades cannot be opened" / "is damaged"

Hades ships **ad-hoc signed** but is **not notarized by Apple** (it's a free,
non-commercial project). On first launch, macOS Gatekeeper may block it. Clear
the download quarantine once:

```bash
xattr -dr com.apple.quarantine /Applications/Hades.app
```

Then open it normally. This applies to both Apple Silicon and Intel Macs — the
release is a universal binary that runs natively on both.

### Linux: blank window or crash on Wayland

Hades forces the X11 backend and disables WebKit DMA-BUF rendering at startup to
work around incomplete Wayland support in WebKit2GTK. If you launch it from a
custom script, make sure these are set:

```bash
GDK_BACKEND=x11 WEBKIT_DISABLE_COMPOSITING_MODE=1 WEBKIT_DISABLE_DMABUF_RENDERER=1 hades
```

## License

This project's source code is available under the [BSD 3-Clause License](LICENSE).

### Usage & attribution notice

> **Intended for personal, non-commercial, and educational use.** Hades is a
> free passion project for students and knowledge workers. While the BSD-3
> license governs the code, the author kindly asks that you **not sell Hades or
> commercial derivatives of it** without permission.
>
> **Design inspiration.** Hades' interface draws inspiration from the wider
> ecosystem of focus, note-taking, and productivity tools (Pomodoro timers,
> Obsidian-style note vaults, Anki-style spaced repetition, and modern terminal
> color themes such as Catppuccin, Gruvbox, Nord, Dracula, Tokyo Night, and
> friends). All trademarks and theme palettes belong to their respective
> creators; Hades reimplements the *ideas*, not their assets, and is not
> affiliated with or endorsed by any of them.

```
BSD 3-Clause License

Copyright (c) 2025, Hades Contributors

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```
