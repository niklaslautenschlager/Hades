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
| **Ollama** (local) | Free, runs on your machine | No key — see [Ollama](#using-ollama-fully-local-no-key) |

> **Recommended starting point:** **Groq** has a free tier and is fast. Create an account, generate a key, and paste it into Hades.

---

## Setup

1. Open **Settings** (gear icon, bottom-left).
2. Find the **AI Vendor** section.
3. Click the vendor you want (**Groq**, **OpenAI**, **Anthropic**, or **Ollama**).
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

By default the assistant **stays focused on learning and productivity**. Ask it something off-topic and it'll politely redirect you.

If you want it to answer anything:

- `/I-want-to-waste-my-time` — turn **off** the topic restriction (unrestricted mode).
- `/back-to-studying` — turn the restriction back **on**.

> Mode is per-conversation. `/clear` and restarting begin fresh.

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
