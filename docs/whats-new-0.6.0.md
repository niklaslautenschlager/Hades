# What's New in Hades 0.6.0

This release turns the AI assistant from a chatbot into a **study agent** that knows
your material and can act on the app, adds **local retrieval (RAG)** over your notes
and PDFs, and fixes/polishes several Notes and Settings rough edges. Below is a
task-oriented guide — what each feature is for, how to use it, and the gotchas.

> **Prerequisites:** AI features are **off by default** (privacy-first). Turn them on
> in **Settings → AI**. The local RAG and fully-private modes need
> [Ollama](https://ollama.com) running locally.

---

## AI is opt-in

**Why:** Nothing leaves your device unless you choose it.

**How:** Open **Settings → AI** and toggle **Enable AI features**. While off, the
assistant and every AI option stay hidden. Pick a vendor (Groq, OpenAI, Anthropic,
DeepSeek, or local Ollama) and add a key; each vendor shows a clear
**Local · Private / Free · Cloud / Paid · Cloud** disclaimer.

---

## Agent mode — let Socrates do things

**Why:** Instead of telling you the steps, the assistant performs them.

**How:**
1. **Settings → AI → Agent mode.**
2. Ask in plain language, e.g. *"Make 5 flashcards on the Krebs cycle and add a task to
   review them tomorrow."*
3. Socrates creates the deck, the cards, and the task, and shows a ✓ summary of each
   action it took.

It can create tasks, calendar events, notes, and flashcards, control the focus timer,
set your goal, switch modules, and search your notes. It's **additive only** — there
are no delete/destructive actions. Works with every vendor, including local Ollama.

**Pitfall:** Smaller models follow instructions less reliably; `llama-3.3-70b-versatile`
(Groq) or a capable Ollama model give the best results.

---

## Study context (local RAG) over your notes & PDFs

**Why:** Ask questions about *your* lecture notes and PDFs, not just the model's
general knowledge.

**How:**
1. Run Ollama and pull an embedding model once: `ollama pull nomic-embed-text`.
2. **Settings → AI → Use my notes as context**, then click **Rebuild** under *Study
   index*.
3. Chat normally — relevant passages from your notes/PDFs are retrieved and given to
   the assistant automatically. Notes re-index in the background as you edit; imported
   PDFs are indexed too.

Everything is embedded and stored **on your device**. If Ollama isn't running, the
assistant quietly falls back to a lightweight notes snapshot.

**Pitfall:** With a **cloud** vendor, the retrieved text is sent to that provider. Use
**Ollama** for fully private retrieval.

---

## Conversation memory

**Why:** Pick up where you left off.

**How:** The assistant header has a conversation switcher — create, rename, switch, and
delete named threads. They persist across restarts. Clear everything anytime via
**Settings → Advanced → Wipe all AI data** (also clears the study index).

---

## Deep Research & app-aware help

- **`/research <topic>`** produces a clean, structured report (overview, findings,
  details, caveats, next steps).
- Ask *"how do I…"* questions about Hades itself — the assistant knows the app's
  features and can walk you through them.

---

## Notes: PDF Library fix + calculator math

- **PDF Library import** no longer fails with a "forbidden path" error — importing,
  opening, and removing PDFs all work, and library files survive moving the original.
- **Calculator → note:** compute something in the Notes calculator, then click
  **Insert into note** (on the result or any history row). It's inserted as live
  **KaTeX** math (`$…$`) that renders right in the editor; click into it to edit the
  source.

---

## Cleaner Settings

Settings is now organized into tabs — **AI**, **Appearance**, **Productivity**,
**Sync**, and **Advanced** — instead of one long scroll. Everything from before is
still there.

---

Looking for the previous round of fixes? See
[what's new in 0.5.2](whats-new-0.5.2.md).
