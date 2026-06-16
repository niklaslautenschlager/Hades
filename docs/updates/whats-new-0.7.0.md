# What's New in Hades 0.7.0

This release fixes a serious cloud-sync bug, makes the AI assistant genuinely
useful across your whole workspace, and adds a batch of editor/agent features.

> AI features are **off by default** (privacy-first). Turn them on in
> **Settings → AI**. Local retrieval and fully-private modes need
> [Ollama](https://ollama.com).

---

## 🛠 Cloud sync — no more duplicates

Notes/folders used to duplicate and scatter into new folders on every sync, and
two devices never converged. Sync was rebuilt around **stable IDs**:

- A note's identity (`id`, `name`, `parentId`) lives in its frontmatter; merges
  key strictly on `id`, never on the (mutable) filename.
- Folders live in a **versioned, id-keyed manifest** — no more folder-id
  "ping-pong" between devices.
- Each sync **reconciles and prunes**: orphaned files from renames/moves are
  removed, and **deletions propagate** via tombstones (deleted notes stay
  deleted instead of resurrecting).
- Your existing folder is migrated automatically.

> ⚠️ Update **all** your devices to 0.7.0 together — an older client writing to
> the same folder can still churn until everything is on the new format.

## 🗓 Calendar the AI can actually read

- **Recurring iCal events are now expanded.** A weekly class (one `VEVENT` with
  an `RRULE`) previously showed only its first occurrence; now every occurrence
  appears in the calendar — and the assistant.
- **iCal feeds auto-refresh** on launch and every 30 minutes (no more manual
  "sync" only).
- The assistant reads your schedule in **local time** (the old version reported
  raw UTC, so a 15:00–19:00 class looked like 13:00–17:00).

## 🤖 AI that works across the app

- **Agent tools:** break a goal into a batch of tasks, and plan your day/week —
  the agent reads your real tasks, deadlines and focus goal, then blocks time on
  the calendar.
- **Citations:** answers grounded in your material cite their sources as
  clickable `[Note: …]` / `[PDF: …]` chips that jump to the source.
- **Chat with a PDF:** ask questions scoped to one document in your library.
- **Hybrid retrieval:** search blends keyword + semantic, so it works **with or
  without** Ollama. A freshness badge shows how many notes aren't indexed yet.

## ✍️ Notes & editor

- **Generate flashcards** from any note in one click.
- **Tidy & format** a note with AI (undoable).
- **Inline writing assist:** select text → Expand / Condense / Rephrase /
  Continue.
- **Related notes:** a strip suggests semantically related notes as you write —
  click to insert a `[[wikilink]]`.

## 🎯 Focus & reflection

- **Session reflection:** after a focus session, a quick "what did you get done?"
  prompt logs your progress (toggle in Settings → Productivity).
- **Weekly Review:** an AI narrative of your week's focus, accomplishments and a
  suggestion for next week, on the Statistics page.

## ⌘ Command palette

Press **⌘K / Ctrl-K** anywhere to jump between modules, run quick actions, or
hand a request straight to the AI.
