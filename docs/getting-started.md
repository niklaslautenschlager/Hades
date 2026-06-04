# Getting Started with Hades

This guide gets you from zero to a running Hades window, then gives you a quick tour of the interface. It takes about five minutes.

---

## Before you begin (prerequisites)

**To just use Hades, you need almost nothing:**

- A computer running **macOS** (Apple Silicon or Intel), **Linux** (x86-64), or **Windows 10/11**.
- About 100 MB of free disk space.
- An internet connection **only** for: downloading the app, the optional AI assistant, optional calendar subscriptions, and checking for updates. Everything else works fully offline.

**You do NOT need:**

- A Hades account (there isn't one).
- A credit card.
- Any programming tools — unless you want to build from source (see the [README](../README.md)).

> **Optional, set up later:** The [AI Study Assistant](ai-assistant.md) needs a free API key, and [Cloud Sync](cloud-sync.md) needs a cloud storage client. Neither is required to start using Hades.

---

## Step 1 — Download Hades

Grab the prebuilt release for your platform from the **[Releases page](https://github.com/niklaslautenschlager/Hades/releases)**.

| Platform | File to download | How to install |
|----------|------------------|----------------|
| **macOS** | the **`.dmg`** | Open it, then drag **Hades** into your **Applications** folder. The DMG is a universal binary — it runs natively on both Apple Silicon and Intel. |
| **Linux** | the **`.AppImage`** | Mark it executable, then run it (see below). |
| **Windows** | the **`*-setup.exe`** | Run the installer and follow the prompts. |

**Linux — make the AppImage runnable:**

```bash
chmod +x Hades_*.AppImage
./Hades_*.AppImage
```

---

## Step 2 — First launch

### macOS: "Hades cannot be opened" / "is damaged"

Hades is **ad-hoc signed but not notarized by Apple** (it's a free project). macOS Gatekeeper may block the first launch. Clear the download quarantine **once**:

```bash
xattr -dr com.apple.quarantine /Applications/Hades.app
```

Then open Hades normally. See [Troubleshooting](troubleshooting.md#macos-hades-cannot-be-opened--is-damaged) for more detail.

### Linux: blank window or instant crash

This almost always means a **Wayland** display issue in the underlying web engine. If you launch Hades from your own script, set these environment variables first:

```bash
GDK_BACKEND=x11 WEBKIT_DISABLE_COMPOSITING_MODE=1 WEBKIT_DISABLE_DMABUF_RENDERER=1 ./Hades_*.AppImage
```

The packaged app and its desktop entry already do this for you.

---

## Step 3 — Meet the interface

When Hades opens, you'll see a **narrow sidebar on the left** and the active module filling the rest of the window.

```
┌───┬──────────────────────────────────────────────┐
│ 🜂 │                                                │   🜂  Hades logo
│   │                                                │
│ ⏱ │                                                │   ⏱  Focus (Pomodoro timer)
│ 📅 │                                                │   📅  Calendar
│ 📄 │          Active module shows here              │   📄  Notes
│ ☑ │                                                │   ☑  Tasks
│ ▦ │                                                │   ▦  Flashcards
│ 📊 │                                                │   📊  Statistics
│   │                                                │
│ 🎨 │                                                │   🎨  Theme picker
│ ⚙ │                                                │   ⚙  Settings
└───┴──────────────────────────────────────────────┘
```

**To switch modules:** Click any sidebar icon. Hover over an icon to see its name.

**The six modules, top to bottom:**

- **Focus** — a Pomodoro timer with a built-in AI study assistant.
- **Calendar** — month/week/day calendar with events and subscriptions.
- **Notes** — a Markdown editor with folders, tags, and a PDF viewer.
- **Tasks** — a simple, fast to-do list.
- **Flashcards** — spaced-repetition study decks.
- **Statistics** — your focus-time history and goals.

**Bottom of the sidebar:**

- **Palette icon** — quick theme switcher (18 themes).
- **Gear icon** — Settings. A small colored dot appears here when an app update is available.

> **Tip:** While the Focus timer is running and you've navigated to another module, a small **time pill** appears in the sidebar. Click it to jump straight back to the timer.

---

## Step 4 — Where to go next

- **Want to focus right now?** → [Focus Timer](focus-timer.md)
- **Want an AI study buddy?** → [AI Study Assistant](ai-assistant.md)
- **Taking notes?** → [Notes](notes.md)
- **Syncing across two computers?** → [Cloud Sync](cloud-sync.md)

---

## Common first-launch questions

**Do I need to save my work?**
No. Hades saves everything automatically and reloads it next time you open the app.

**Where is my data stored?**
Locally, in your operating system's standard app-data location. Your notes can *also* be mirrored to a cloud folder if you turn on [Cloud Sync](cloud-sync.md) — but that's opt-in.

**Nothing happens when I click the AI assistant.**
You need to add an API key first. See [AI Study Assistant](ai-assistant.md).

Still stuck? See **[Troubleshooting](troubleshooting.md)**.
