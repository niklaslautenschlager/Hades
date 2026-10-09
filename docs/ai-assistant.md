# AI Study Assistant

**What it does:** Hades includes a chat assistant, *Socrates*, built for studying. Ask it to explain a concept, quiz you, summarize your conversation, run the Feynman technique, or just give you a motivational kick. It lives in the **Focus** module, alongside the Pomodoro timer.

**Why it's different from a generic chatbot:** By default it stays on-topic — education, study techniques, productivity, research, and technical learning. That keeps your study sessions from drifting into random rabbit holes (there's an off-switch if you want one — see [Study mode vs. unrestricted mode](#study-mode-vs-unrestricted-mode)).

---

## Prerequisites — you need an API key (it's free to start)

Hades doesn't ship with its own AI. You connect it to a provider ("vendor") of your choice. **You need an account and an API key from one of these:**

| Vendor | Cost to start | Get a key |
|--------|---------------|-----------|
| **Groq** (recommended) | Free tier | [console.groq.com/keys](https://console.groq.com/keys) |
| **OpenAI** | Paid | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| **Anthropic** | Paid | [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys) |
| **DeepSeek** | Paid (low cost) | [platform.deepseek.com/api_keys](https://platform.deepseek.com/api_keys) |
| **Ollama** (local) | Free, runs on your machine | No key — see [Ollama](#using-ollama-fully-local-no-key) |

> **Recommended starting point:** **Groq** has a free tier and is fast. Create an account, generate a key, and paste it into Hades.

---

## Setup

1. Open **Settings** (gear icon, bottom-left).
2. Find the **AI Vendor** section.
3. Click the vendor you want (**Groq**, **OpenAI**, **Anthropic**, **DeepSeek**, or **Ollama**).
4. Paste your **API key** into the key field. (Use the eye icon to reveal what you typed; the **"get a key →"** link opens the provider's key page.)
5. Pick a **model** from the list.
6. Click **Save**.

Now open the **Focus** module and start typing in the assistant's chat box.

### Choosing a model

Each vendor offers several models. As a rule of thumb:

- **Fast / cheap** models (e.g. Groq *Llama 3 8B*, OpenAI *GPT-4o mini*, Anthropic *Claude Haiku*) are great for quick explanations and quizzes.
- **Larger** models (e.g. Groq *Llama 3.3 70B*, OpenAI *GPT-4o*, Anthropic *Claude Sonnet/Opus*) give deeper answers but cost more / run slower.

You can switch models anytime in Settings, or on the fly with the `/model` and `/vendor` commands.

### Using Ollama (fully local, no key)

[Ollama](https://ollama.com) runs models **on your own computer** — private and free, no API key.

1. Install Ollama and start it: `ollama serve` (it listens on `http://localhost:11434`).
2. Pull a model, e.g. `ollama pull llama3.2`.
3. In Hades, select **Ollama (local)** as the vendor. Leave the **Base URL** as `http://localhost:11434` unless you changed it.
4. Pick a model (Llama 3.2, Llama 3.1, Qwen 2.5, Mistral, Gemma 2…). The model name must match one you've pulled.

---

## Chatting

Type a message and press **Enter** to send. Use **Shift + Enter** for a newline within a message. Responses **stream in** word by word.

### Keyboard shortcuts (in the chat box)

| Key | Action |
|-----|--------|
| **Enter** | Send the message |
| **Shift + Enter** | New line (don't send) |
| **Tab** | Autocomplete the highlighted slash command |
| **↑ / ↓** | When typing a command, move through the command suggestions |

---

## Slash commands

Type **`/`** to see a menu of commands. Some run instantly inside Hades ("local"); others send a crafted prompt to the AI.

### Control commands (run instantly)

| Command | What it does | Example |
|---------|--------------|---------|
| `/help` | List every command | `/help` |
| `/clear` | Clear the conversation | `/clear` |
| `/model` | Switch the AI model | `/model fast` |
| `/vendor` | Switch the AI vendor | `/vendor anthropic` |
| `/goal` | Set your Focus session goal | `/goal Finish chapter 5` |
| `/timer` | Control the Pomodoro timer | `/timer start` · `/timer pause` · `/timer reset` |
| `/note` | Create a new note | `/note Physics Notes` |

### AI-powered commands

| Command | What it does | Example |
|---------|--------------|---------|
| `/explain` | Explain a topic simply, with analogies | `/explain quantum entanglement` |
| `/summarize` | Summarize the chat into key takeaways | `/summarize` |
| `/quiz` | Generate 5 quiz questions from the chat | `/quiz` |
| `/feynman` | Walk through the Feynman technique on a topic | `/feynman recursion` |
| `/motivate` | A short motivational nudge | `/motivate` |
| `/roast` | A funny, honest roast of your study habits | `/roast` |

**Example session:**

```
You:  /explain the bias-variance tradeoff
AI:   (a clear, beginner-friendly explanation with an analogy)

You:  /quiz
AI:   1. ...  2. ...  (5 questions, answers at the end)

You:  /summarize
AI:   • Key takeaway 1  • Key takeaway 2  • Action items...
```

---

## Study mode vs. unrestricted mode

By default the assistant **stays focused on learning and productivity** — and this works the same with every vendor (Groq, OpenAI, Anthropic, DeepSeek, Ollama) and in every mode: normal chat, [agent mode](#agent-mode-let-socrates-act-on-the-app), and `/research`.

How it behaves:

- **On-topic requests** (any academic subject, study techniques, productivity and planning, research and academic writing, programming you're learning, career skills, using Hades itself) are answered normally.
- **Plausibly academic questions** that are a bit ambiguous are still answered — it won't refuse on a technicality.
- **Clear tangents** (entertainment chit-chat, gossip, unrelated coding-for-hire, and the like) are not answered. Instead of a bare refusal, Socrates steers you back with something concrete to do. If **Use my notes as context** is on (Settings → AI), those suggestions name what you're actually working on: the note or PDF you have open, your next due task, your upcoming events. With it off, you get generic study suggestions, and no titles leave your machine.

Under the hood the rule is stated at the start and again at the end of the instructions sent to the model, and a short reminder is attached to your latest message in the request. That reminder is never saved in the conversation and never shown in the chat. Background features that run their own prompt (flashcard generation, tidy note, translate, weekly review) are not chat and are not affected.

If you want it to answer anything:

- `/I-want-to-waste-my-time` — turn **off** the topic restriction (unrestricted mode). The focus rule and the reminder are both removed.
- `/back-to-studying` — turn the restriction back **on**.

> Mode is per-conversation. `/clear` and restarting begin fresh.

---

## Your notes, PDFs, calendar and tasks as context

Turn on **Use my notes as context** in **Settings → AI** and Socrates can draw on your own material. Everything it receives is labelled, and it cites what it used as `[Note: …]`, `[PDF: …]`, `[Event: …]` or `[Task: …]`.

Each message can include:

1. **What's open right now.** The note in your active tab (title and text, up to about 6,000 characters) and the PDF open in the Notes PDF pane: its title, the page you're on, the text of that page and its neighbours, then as much of the rest as fits in about 6,000 characters (flagged as truncated when cut). This is how "summarise this note" or "what does this page mean?" works without you pasting anything. It applies in agent mode too.
2. **The most relevant passages** from the study index (below).

PDFs you opened from a file or URL are read the first time you ask about them and remembered for the rest of the session. If a large PDF's text isn't ready within a few seconds, your message is sent without it and Socrates is told it's still being extracted; it's ready on your next message. Scanned PDFs without a text layer are not OCR'd on the send path.

Cloud vendors receive the text that is shared. Only Ollama keeps everything on your machine.

### The study index works without Ollama

The index is a file on your device covering your **notes, library PDFs, calendar events and tasks**. It no longer needs Ollama or any particular AI vendor:

- **Built-in index (default).** A small on-device embedder needs no setup, no network and no model download. It finds passages by shared wording, so it's great for "where did I write about X" and for dates and task names, but it doesn't understand synonyms.
- **Semantic index (optional).** If Ollama is running with the embedding model (`ollama pull nomic-embed-text`), a rebuild uses it for meaning-based search. Settings → AI shows which one is active and offers **Upgrade to semantic index (Ollama)** when Ollama is reachable. If Ollama later goes away, search falls back to keywords until it's back; **Rebuild** switches to the built-in index.

A single index only ever holds vectors from one of the two, and Hades records which. Index files from earlier versions still load.

**It keeps itself up to date.** With AI enabled, Hades watches your notes, library, calendar and tasks and re-indexes only what changed: notes after you pause typing (about 4 seconds), events and tasks within about 1.5 seconds, new PDFs when they're added, and removals when you delete something. This covers every way something can appear: typing it yourself, an iCal feed sync, or Socrates creating events and tasks. The first index is built quietly in the background a few seconds after launch.

Calendar events are indexed from 7 days ago to 120 days ahead, capped at 500 items, so a large timetable feed can't bloat the index. Dates and times in the index are in your local time zone.

---

## Agent mode: let Socrates act on the app

Switch on **Agent mode** in **Settings → AI** and Socrates can act on your behalf: it replies with tool calls, Hades runs them and reports what happened. Tools are **additive only — nothing can be deleted**, and Socrates must tell you what it did. The same focus rule applies as in normal chat.

| Tool | What it's for |
|------|---------------|
| `search_notes`, `read_note`, `list_notes`, `search_pdf` | Find and read your notes and library PDFs (`search_notes` also covers events and tasks) |
| `read_open_note`, `list_open_notes` | The note in your active tab ("this note"), or every note open as a tab |
| `read_open_pdf` | The PDF open in the Notes pane: the current page first, or a specific `page` |
| `read_schedule` | Quick overview: open tasks and the next 14 days, plus weekly progress |
| `query_schedule` | Events and tasks in a specific range (`from`, `to`, `include`, `limit`), e.g. "what's due before Friday" |
| `create_task`, `create_tasks`, `add_calendar_event`, `create_note`, `create_flashcards` | Create things |
| `control_timer`, `set_goal`, `switch_module`, `whats_new` | Run the timer, set the session goal, move around, explain what's new |
| `get_study_stats` | Weekly goal and progress, today's focus time, Pomodoro cycle, session goal |
| `update_study_stats` | On request only: set the weekly goal (1–100 hours), log focus time you already did (1–480 minutes), or set the session goal. Out-of-range numbers are clamped; invalid input changes nothing |

All times Socrates reads or writes are in your local time zone.

---

## Troubleshooting

The assistant turns common API failures into plain-language hints. Here's what they mean:

| What you see | Likely cause & fix |
|--------------|--------------------|
| **"No API key configured…"** | You haven't added a key for this vendor. Open **Settings** and add it. |
| **"Invalid API key" (401)** | The key is wrong or expired. Re-copy it from the provider and re-paste in Settings. |
| **"Connection failed (403)"** | Often a **VPN** blocking the provider, or an invalid key. Disable your VPN and re-check the key. |
| **"Rate limit reached" (429)** | You've hit the provider's usage limit. Wait a moment, or switch to a different model/vendor. |
| **"Cannot reach Ollama"** | Ollama isn't running. Start it with `ollama serve` and confirm it's on port `11434`. |

**Still failing?**
- Confirm you have an internet connection (not needed for Ollama).
- Try a smaller/faster model to rule out timeouts.
- Switch vendors temporarily to isolate whether it's provider-side.
- If none of that helps, [open an issue](https://github.com/niklaslautenschlager/Hades/issues).
