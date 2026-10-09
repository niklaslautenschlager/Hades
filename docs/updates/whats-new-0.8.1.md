# What's New in Hades 0.8.1

A patch release with four new themes, a daily-resetting focus timer, a study-focused
AI that works with every provider, a rebuilt **Cloud Sync (Beta)**, and flashcards that
never disappear.

## Four new light themes
**Monochrome**, **Blue & Paper**, **Honeyed Naturals** and **Pastel** — 22 themes in
total, in a new **Daylight** group (Settings → Appearance). Status colours (red errors,
green successes, …) are now readable on every light theme, including Paper, and the
chosen theme is applied before the window first paints on later launches.

## Focus timer: a fresh cycle every day
The Pomodoro cycle now restarts each calendar day. If you stopped yesterday one session
short of a long break, today's first session starts a new cycle instead of triggering a
long break. A session that crosses midnight counts as session 1 of the new day, and the
counter reads "N today".

## AI
- **Stays on topic with every provider** (Groq, OpenAI, Anthropic, DeepSeek, Ollama) —
  in chat, agent mode and Deep Research. Off-topic questions are steered back to your
  open note, PDF or schedule.
- **No Ollama needed for search.** Notes, PDFs, calendar events and tasks are indexed
  on your device and re-indexed automatically when they change. Ollama still gives
  semantic search when it's running.
- **Sees what you have open.** With "use my notes as context" on, the note and PDF in
  front of you are part of the conversation, in chat and agent mode.
- **New agent tools:** `query_schedule`, `list_open_notes`, `read_open_note`,
  `read_open_pdf`, `get_study_stats`, `update_study_stats`. Text inside your notes and
  PDFs is treated as data, never as instructions.

## Cloud Sync is now Beta — and rebuilt
- A **BETA** badge, a warning, and a confirmation with a **Back up now** button before
  you enable sync or switch folders. **Please back up first.**
- Conflicting edits are kept as **"(conflict copy …)"** notes instead of one silently
  overwriting the other, and an edit you haven't synced yet survives a deletion made on
  another device.
- An unplugged drive or stopped cloud client is treated as **offline** (with automatic
  retry), never as "the folder was emptied". Edits you make during a sync are never lost.
- Pulled changes now appear in a note you have open instead of being overwritten by the
  next keystroke.
- Works with case-sensitive and case-insensitive folders, and with emoji in note titles.
- See [Cloud Sync](../cloud-sync.md) for how it behaves.

## Flashcards never disappear
Reviewing no longer hides cards. **Drill all** is always available alongside **Review
due**, every card stays in the deck list, and rating a card you weren't due to see
doesn't change its schedule. A bug that skipped a card after each rating is fixed.

## MCP bridge (opt-in)
A local MCP client can read your schedule, open notes, open PDF text and study stats, and
log study time. It's **off by default** (Settings → Advanced) and works through a hidden
`.hades-bridge` folder inside your sync folder. See [`mcp/README.md`](../../mcp/README.md).
