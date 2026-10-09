# Hades Documentation

**Hades is a distraction-free desktop productivity suite for students and knowledge workers.** It bundles a focus timer, an AI study assistant, a Markdown note editor, a calendar, a task list, spaced-repetition flashcards, and focus statistics into one app — so you stop juggling a dozen browser tabs.

Hades runs on **macOS, Linux, and Windows**, and stores everything **locally on your machine**. There is no Hades account or Hades-hosted backend.

---

## New here? Start with these

1. **[Getting Started](getting-started.md)** — Install Hades, launch it the first time, and learn your way around the interface.
2. Pick the feature you came for from the list below.

## Feature guides

| Guide | What it covers |
|-------|----------------|
| **[Focus Timer](focus-timer.md)** | Pomodoro timer, session goals, sound alerts, linking a task to the timer |
| **[AI Study Assistant](ai-assistant.md)** | Setting up Groq / OpenAI / Anthropic / Ollama, slash commands, study modes |
| **[Notes](notes.md)** | Markdown editor, Vim mode, folders, tags, `[[links]]`, PDF viewer, the calculator, import/export |
| **[Calendar](calendar.md)** | Month/week/day views, events, colors, recurring events, iCal subscriptions, deadlines |
| **[Tasks](tasks.md)** | Adding and editing tasks, completion, deadlines from the calendar, timer linking |
| **[Flashcards](flashcards.md)** | Decks, spaced repetition, reviewing cards, keyboard shortcuts |
| **[Statistics](statistics.md)** | Focus-time tracking, weekly goal, streaks, charts |
| **[Settings & Themes](settings-and-themes.md)** | Every setting explained, the 22 themes, and how updates work |
| **[Cloud Sync Setup](cloud-sync.md)** | Sync your notes across devices via Dropbox, iCloud, Google Drive, Syncthing, and more |
| **[Troubleshooting](troubleshooting.md)** | Fixes for common problems on every platform |

---

## Quick reference

**Switch modules:** Click the icons in the left sidebar — Focus, Calendar, Notes, Tasks, Flashcards, Statistics (top to bottom).

**Change theme:** Click the **palette icon** (bottom-left), or open **Settings → Theme**.

**Open settings:** Click the **gear icon** at the bottom-left corner.

**Where is my data?** Everything is saved automatically on your computer. Notes can additionally be mirrored to a cloud folder — see [Cloud Sync](cloud-sync.md).

---

## Important: this is early software

Hades is a free, non-commercial passion project under active development. **Bugs and missing features are expected.** Back up anything important, and don't rely on it as your only copy of critical data.

---

## Escape hatch — when these docs aren't enough

- **Found a bug or something out of date?** Open an issue on the [GitHub issue tracker](https://github.com/niklaslautenschlager/Hades/issues). Documentation lives in the same repo as the code — corrections are welcome as pull requests.
- **Stuck on setup?** Check **[Troubleshooting](troubleshooting.md)** first; it covers the most common platform-specific problems.
- **Want the developer-facing overview?** See the project [README](../README.md).

## MCP integration

See [MCP Server setup](../mcp/README.md) to connect an MCP client to Hades' Markdown notes in its configured cloud-sync folder.

The same server can also read your schedule, the notes open in the editor, the PDF open in the Notes pane and your study stats, and can log focus time. This is **off by default**: turn on **Settings → Advanced → Share live workspace with MCP server** (it needs a sync folder, and writes a snapshot into a hidden `.hades-bridge` folder inside it, which your cloud provider may upload). See the MCP README for the tools and the privacy details.
