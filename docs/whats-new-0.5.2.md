# What's New in Hades 0.5.2

This release focuses on **stability fixes** and **focus-workflow quality-of-life
features**. Below is a task-oriented guide to everything new — what each feature
is for, how to use it, and the gotchas to watch for.

> **Prerequisites:** None beyond running Hades 0.5.2 or later. Features that
> touch cloud sync assume you've already set up a sync folder
> (see [cloud-sync.md](cloud-sync.md)).

---

## Focus timer keeps running during cloud sync

**Why:** Previously, a background cloud sync could appear to reset or jump the
Pomodoro countdown. The timer is now driven by an absolute wall-clock deadline,
so it stays accurate through syncs, window re-renders, and even app restarts.

**How:** Nothing to do — just start the timer. If you quit mid-session and
reopen, the remaining time is recalculated from the real elapsed time.

**Pitfall:** If your system clock changes dramatically while a session runs
(e.g. timezone travel, NTP correction), the remaining time recalculates against
the new clock. This is expected.

---

## Link tasks to the Pomodoro timer

**Why:** Estimate the effort a task takes in focus sessions, then let Hades tell
you when you've hit that estimate.

**How:**
1. In the **Tasks** module, hover a task and click the **🍅 +/−** stepper to set
   how many focus sessions you think it will take.
2. Click the **timer icon** on the task to make it your active focus task — the
   row glows and the task appears in the Pomodoro panel.
3. Run focus sessions as normal. Each completed Focus session counts toward the
   task (you'll see `🍅 done/estimate`).
4. When you reach your estimate, Hades asks **"Is this task finished?"**
   - **Yes, mark done** — crosses the task off and unlinks it.
   - **Keep going** — dismisses the prompt; you won't be nagged again for that task.

**Pitfall:** Only **naturally completed** Focus sessions count. Skipping a
session with the skip button advances the global session counter but does not
tick the linked task.

---

## Notes: smart creation & persistent folders

**Why:** Creating a note used to drop it at the root, and folders re-collapsed
every time you reopened a note. Both are fixed.

**How:**
- **Smart creation** — select a folder (or any note inside it), then click
  **New note** / **New folder**. The new item is created *inside* that folder
  and the folder expands so you can see it.
- **Persistent folders** — expand/collapse state is now saved. Folders stay
  exactly as you left them across note switches and app restarts.

**Pitfall:** AI-generated notes (from the assistant) still land at the root by
design, so they're easy to find and file later.

---

## Load a PDF from a URL

**Why:** Read a paper or textbook without downloading it first.

**How:**
1. Open the **PDF viewer** in Notes.
2. Click the **link icon** (or **From URL**) and paste a direct PDF link, e.g.
   `https://arxiv.org/pdf/2301.00001.pdf`.
3. Press **Load**.

This now uses Hades' native HTTP client, which fetches the file in Rust and
**bypasses the browser CORS restrictions** that previously blocked most
cross-origin PDFs.

**Pitfall:** The URL must point directly at a PDF file. Links to a viewer *page*
(an HTML page that embeds a PDF) won't load — copy the underlying `.pdf` link.

---

## Theme-aware dropdowns & date pickers

**Why:** Dropdown menus and date pickers used to render with the OS's colors,
clashing with light themes and the bolder Hades themes.

**How:** Nothing to do. Recurrence and other dropdowns are now drawn from your
active theme, and date pickers follow the theme's light/dark scheme
automatically. Try switching to **Paper** or **Solarized Light** to see it.

---

## Calendar: more colors & today-at-a-glance

- The calendar now **opens on the current month/week/day** each launch, with
  **today highlighted and glowing**.
- The event color picker shows the base colors by default with a **"more colors"
  toggle** that expands downward to reveal the full vivid palette.

---

## Tasks: Clear all

Alongside **Clear completed**, there's now a **Clear all** action.

**Pitfall:** "Clear all" intentionally **keeps tasks that came from calendar
deadlines** — those are owned by the calendar and would just re-sync. Remove the
underlying calendar event to drop them. You'll be asked to confirm before
anything is cleared.

---

## Updating & platform notes

See the **Updating** and **Troubleshooting** sections of the main
[README](../README.md) — including the one-time macOS quarantine fix
(`xattr -dr com.apple.quarantine /Applications/Hades.app`) for Apple Silicon and
Intel Macs.
