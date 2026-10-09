// Embedded "what's new" highlights so the AI agent (and an in-app view) can tell
// the user what's new without a network call. Keep this in sync with the docs/
// whats-new-*.md files on each release.

export const WHATS_NEW = `Recent highlights in Hades:

Latest patch
- Four new light themes (Monochrome, Blue & Paper, Honeyed Naturals, Pastel), 22 in total.
- The Pomodoro cycle now restarts each calendar day, so yesterday's progress never triggers a long break today.
- The AI stays on study topics with every provider, indexes your notes, PDFs, events and tasks without needing Ollama, and sees the note and PDF you have open. New agent tools: query_schedule, list_open_notes, read_open_note, read_open_pdf, get_study_stats, update_study_stats.
- Cloud Sync is now marked Beta and rebuilt: conflicting edits are kept as "(conflict copy)" notes instead of being overwritten, an unavailable sync folder is never mistaken for an empty one, and edits you make during a sync are never lost. Back up before enabling it.
- Flashcards never disappear after a review: "Drill all" is always available and "Easy" only changes the schedule.
- An opt-in MCP bridge lets an MCP client read your schedule, open notes, open PDF and stats (off by default).

AI
- Agent mode can act on the app: create tasks (incl. batch breakdowns), calendar events, notes and flashcards, plan your day/week, control the timer, and switch modules.
- Ask about your own material: search_notes / read_note, "chat with this PDF", and answers cite their sources as clickable [Note:]/[PDF:] chips.
- In notes: generate flashcards from a note, "tidy & format", inline writing assist (expand/condense/rephrase/continue), translate a selection, "ask AI" on a selection, and "check vs PDF" against the open document.
- Hybrid retrieval works with or without local Ollama; private retrieval stays on-device.

Notes & PDFs
- PDF viewer remembers your page per document; imported PDFs are auto-extracted (hidden) so AI answers are accurate and cheap.
- Footnotes, table/format insert helpers, Ctrl/Cmd+scroll to zoom, Ctrl/Cmd+Z to undo a note/folder deletion.
- Cloud sync rewritten to be id-stable: no more duplicated/scattered notes, and deletions propagate.

Calendar & focus
- Recurring iCal events expand correctly and feeds auto-refresh; the assistant reads your schedule in local time.
- In-app event reminders before things start; end-of-session reflections and an AI Weekly Review in Stats.

General
- ⌘K command palette, 22 themes, and a skippable first-launch tutorial (replay it in Settings → Advanced).`;
