# Settings & Themes

This page is the complete reference for everything in the **Settings** panel, plus the theme picker and how Hades updates itself.

**Open Settings:** click the **gear icon** at the bottom-left of the sidebar. Change what you need, then click **Save**. (The Theme and AI Vendor selections apply as you click; the numeric fields and sound options apply on **Save**.)

---

## Theme

Hades ships **18 themes** in four packs. Pick one in **Settings → Theme**, or use the quick **palette icon** in the sidebar.

| Pack | Themes |
|------|--------|
| **Core** | Zinc Dark *(default)*, Paper, Catppuccin Mocha, Gruvbox, Nord |
| **Popular** | Tokyo Night, Dracula, One Dark, Monokai Pro, Rosé Pine |
| **Light & Classic** | Solarized Dark, Solarized Light, Everforest, Rosé Pine Dawn |
| **Hades Originals** | Ember, Abyss, Synthwave, Matrix |

Each theme sets the whole app's colors plus an accent (used for highlights, the active-module pill, and subtle glows). **Paper**, **Solarized Light**, and **Rosé Pine Dawn** are light themes; the rest are dark.

> **Quick switch:** The sidebar palette popover groups themes into the same four packs and remembers which pack you last opened.

---

## AI Vendor

Connect the [AI Study Assistant](ai-assistant.md) to a provider.

- **Vendor:** Groq, OpenAI, Anthropic, or Ollama (local).
- **API key:** required for everything except Ollama. The **"get a key →"** link opens the provider's key page; the eye icon reveals the key.
- **Base URL:** Ollama only — defaults to `http://localhost:11434`.
- **Model:** the available models change per vendor.

Full walkthrough: **[AI Study Assistant](ai-assistant.md)**.

---

## Calendar & Tasks

| Setting | Default | What it does |
|---------|---------|--------------|
| **Auto-sync deadlines to Tasks** | On | Calendar events marked as deadlines appear in your [Tasks](tasks.md) list and stay in sync. |
| **Week starts on Monday** | On | Turn off to start weeks on Sunday. |
| **Show week numbers** | Off | Shows ISO week numbers in calendar views. |

---

## Timer Intervals

Lengths for the [Focus Timer](focus-timer.md), in minutes.

| Setting | Default | Allowed range |
|---------|---------|---------------|
| **Work** | 25 | 1–90 |
| **Short break** | 5 | 1–30 |
| **Long break** | 15 | 1–60 |
| **Sessions until long break** | 4 | 2–8 |

> Values outside the allowed range are clamped to the nearest valid number when you Save.

---

## Weekly Focus Goal

Your target focused hours per week, shown on the [Statistics](statistics.md) screen.

- **Default:** 20 hours. **Range:** 1–168.

---

## Sound

The alert played when a timer interval ends (and a softer version when you complete a task).

| Option | Description |
|--------|-------------|
| **Chime** *(default)* | Pleasant bell arpeggio |
| **Bell** | Classic rich bell tone |
| **Gong** | Deep resonant gong |
| **Digital** | Short electronic beeps |
| **None** | Silent |

- Click the **▶** next to any option to preview it.
- **Volume** slider sets loudness (default **45%**).

---

## Cloud Sync

Mirror your notes to a local folder that a cloud client (Dropbox, iCloud, Google Drive, Syncthing, Nextcloud, OneDrive…) syncs for you.

- **Enable cloud sync** — turns syncing on.
- **Sync folder** — pick the folder your cloud client watches.
- **Sync now** — force an immediate save; also shows the last sync time.

> **How often does it sync?** Once enabled, Hades syncs **automatically about every 30 seconds** while open — pulling in changes from other devices *and* pushing your local edits. It also syncs on startup and guards against quitting with unsaved changes.

Full per-provider setup (Linux/macOS/Windows): **[Cloud Sync Setup](cloud-sync.md)**.

---

## Updates

Hades checks **GitHub Releases** for new versions and can update itself in place. When an update is available, a small dot appears on the **gear icon**, and an **update card** shows at the top of Settings with the changelog and an **Install update** button.

How it installs depends on your platform:

| Platform | What happens | Your action |
|----------|--------------|-------------|
| **Linux** | Downloads and atomically replaces the running AppImage | Click **Restart to apply** |
| **macOS** | Downloads and opens the `.dmg` | Drag Hades to Applications, then relaunch |
| **Windows** | Downloads and launches the `*-setup.exe` installer | Follow the installer prompts |

> Hades only ever offers the download that matches **your** operating system. If a release has no matching file for your platform, Hades reports you're up to date rather than offering the wrong one.

**Update troubleshooting:**

- **"Install update" fails on Linux** — make sure you're running the **AppImage** (in-place update targets it specifically). If you installed via a package manager, update through that instead.
- **macOS won't open the updated app** — you may need to clear quarantine again; see [Troubleshooting](troubleshooting.md#macos-hades-cannot-be-opened--is-damaged).

---

## Where settings are stored

All settings (and your notes, tasks, events, decks, and stats) are saved **locally** on your machine and reloaded on next launch. There's no cloud account — the only thing that leaves your computer is what you explicitly enable: AI requests, iCal fetches, and cloud-folder syncing.
