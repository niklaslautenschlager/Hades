# Hades `v0.1.0-alpha`

> **Pre-alpha software.** Bugs, crashes, and missing features are expected. Use at your own risk and back up any important data.

A focused, distraction-free desktop productivity suite built for students and knowledge workers. Hades combines a Pomodoro timer with an AI study assistant, a markdown note editor, calendar, task manager, flashcards with spaced repetition, and detailed focus statistics — all in one unified interface.

Built with [Tauri 2](https://v2.tauri.app) for native performance on macOS, Linux, and Windows.

## Features

### Focus Timer (Pomodoro)
- Configurable work, break, and long break durations
- Session tracking with visual progress ring
- Session goal setting
- Integrated AI study assistant powered by Groq (Llama, Mixtral)
- Built-in commands: `/explain`, `/quiz`, `/motivate`, `/summarize`, and more
- Sound notifications with multiple sound options (bell, chime, gong, digital)

### Notes
- Full markdown editor with live preview
- Vim mode toggle (powered by CodeMirror 6)
- Folder-based organization with drag-and-drop
- Tag system with color-coded search
- Note linking via `[[Note Name]]` syntax
- PDF viewer panel (resizable, drag-and-drop PDF loading)
- Export to Markdown (.md) or HTML
- Import from Obsidian vaults (preserves folder structure)
- Collapsible file tree sidebar

### Calendar
- Month, week, and day views
- Local event creation and editing
- iCal feed subscription (subscribe to .ics URLs)
- Recurring events (daily, weekly, monthly) with flexible end conditions
- Current-time indicator line

### Tasks
- Quick task creation
- Checkbox completion with animated strike-through
- Separate pending and completed sections

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
- Dark and light theme (warm paper-white light mode)
- Persistent state via Zustand + Tauri Store
- Native window controls and system tray
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
| AI | Groq API (OpenAI-compatible, SSE streaming via Rust) |
| Calendar | ical.js for iCal parsing |
| Icons | Lucide React |

## Getting Started

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
    ai.ts           # AI command system and Groq streaming
    ical.ts         # iCal feed parsing
    noteExport.ts   # Markdown and HTML export via Tauri dialog
    noteImport.ts   # Obsidian vault import
    sound.ts        # Web Audio API notification sounds
  store/
    useStore.ts     # Global Zustand store
  styles/
    globals.css     # Theme system, utility classes
src-tauri/
  src/lib.rs        # Rust commands (Groq streaming, iCal fetch)
  capabilities/     # Tauri permission configuration
```

## License

This project is open source and available under the [BSD 3-Clause License](LICENSE).

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
