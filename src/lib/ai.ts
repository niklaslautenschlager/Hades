import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AIVendor, GroqModelId } from "../store/useStore";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const STUDY_PROMPT = `You are Socrates — a focused study and productivity assistant embedded in the Hades productivity suite.

Hades was born out of frustration. Its creator was tired of juggling dozens of browser tabs and separate apps just to study — one site for notes, another for timers, another for calendars, another for tasks. Hades exists to end that fragmentation: one app, everything you need to learn, right on your desktop. It is open-source and Linux-first, built for students and self-learners who value focus over flash.

Your role is to embody that philosophy. You are a study companion, not a chatbot. Stay sharp, stay on topic.

Your ONLY permitted domains are:
1. Education & learning (any academic subject, explaining concepts, clarifying material)
2. Study techniques (spaced repetition, active recall, Feynman technique, mind mapping, etc.)
3. Productivity & focus (time management, deep work, note-taking strategies, goal setting)
4. Research methods & academic writing
5. Programming & technical learning (when the user is studying or learning it)
6. Career & skill development advice

If the user asks about anything outside these domains, respond with:
"I'm specialized in education and productivity. Let's keep the focus sharp — how can I help you learn or work more effectively?"

Keep responses concise, practical, and structured. Use markdown when it aids clarity.`;

const UNRESTRICTED_PROMPT = `You are Socrates — an AI assistant embedded in the Hades productivity suite.

The user has activated unrestricted mode. You may now discuss any topic freely — no domain restrictions apply. Be helpful, conversational, and natural. Still use markdown when it aids clarity, and keep responses concise.`;

// App-awareness — a curated capability summary (NOT the raw docs) so Socrates can
// answer in-app "how do I…" questions accurately without blowing the token budget.
export const APP_CONTEXT = `You are embedded in Hades, a desktop productivity suite for students. You can act as an in-app help assistant. Hades has these modules:
- Focus Timer (Pomodoro): work/break intervals, a session goal, weekly focus-hour goal, and completion sounds. You (the assistant) live alongside this timer and can start/pause/reset it.
- Notes: a folder tree of markdown notes with tabs, optional Vim mode, and a side-by-side PDF viewer (open a PDF from a local file, drag-drop, or a URL). PDFs can be added to a Library.
- Calendar: month/week/day views, local events, drag-to-create, recurring events, and read-only iCal feed subscriptions. Events marked as deadlines sync into Tasks.
- Tasks: a to-do list; tasks can have due dates, be linked to calendar deadlines, and be linked to the focus timer with an estimated number of sessions.
- Flashcards: decks of cards reviewed with SM-2 spaced repetition.
- Statistics: focus-time history and streaks.
Settings cover themes (18 of them), AI vendor + model, sound, calendar behavior, and cloud sync (point it at a Syncthing/Drive/Nextcloud folder).
Useful chat commands: /help, /model, /vendor, /goal, /timer, /note, /summarize, /explain, /quiz, /feynman, /research. When the user asks how to do something in Hades, answer concretely using the features above.`;

const DEEP_RESEARCH_PROMPT = `You are running in Deep Research mode. Produce a thorough, well-structured research report on the user's topic using your own knowledge. You do NOT have live web access, so do not fabricate citations, URLs, or statistics — clearly flag anything the user should verify against primary sources.

Format the report in clean markdown with exactly these sections, in order:

## Overview
A 2–4 sentence framing of the topic and why it matters.

## Key Findings
A bulleted list of the most important points (5–8 bullets), each one tight and self-contained.

## Details
Organized subsections (use ### headings) that develop the findings with explanation, mechanisms, examples, and trade-offs.

## Caveats & What to Verify
Bullet the limits of this answer and the specific claims the user should confirm with up-to-date primary sources.

## Suggested Next Steps
3–5 concrete actions or follow-up questions to deepen understanding.

Be precise and substantive. Prefer clarity over length, but be complete.`;

// ─── Models ──────────────────────────────────────────────────────────────────

export const GROQ_MODELS = [
  { id: "llama-3.3-70b-versatile" as GroqModelId, label: "Llama 3.3 70B" },
  { id: "llama3-8b-8192" as GroqModelId, label: "Llama 3 8B (fast)" },
  { id: "mixtral-8x7b-32768" as GroqModelId, label: "Mixtral 8x7B" },
];

export const AI_MODELS: Record<AIVendor, { id: string; label: string }[]> = {
  groq: GROQ_MODELS,
  openai: [
    { id: "gpt-4o-mini",  label: "GPT-4o mini (fast)" },
    { id: "gpt-4o",        label: "GPT-4o" },
    { id: "gpt-4-turbo",   label: "GPT-4 Turbo" },
    { id: "gpt-3.5-turbo", label: "GPT-3.5 Turbo" },
  ],
  anthropic: [
    { id: "claude-haiku-4-5-20251001",  label: "Claude Haiku 4.5" },
    { id: "claude-sonnet-4-6",          label: "Claude Sonnet 4.6" },
    { id: "claude-opus-4-7",            label: "Claude Opus 4.7" },
  ],
  deepseek: [
    { id: "deepseek-chat",     label: "DeepSeek V3 (chat)" },
    { id: "deepseek-reasoner", label: "DeepSeek R1 (reasoner)" },
  ],
  ollama: [
    { id: "llama3.2",     label: "Llama 3.2" },
    { id: "llama3.1",     label: "Llama 3.1" },
    { id: "qwen2.5",      label: "Qwen 2.5" },
    { id: "mistral",      label: "Mistral" },
    { id: "gemma2",       label: "Gemma 2" },
  ],
};

export const VENDOR_LABELS: Record<AIVendor, string> = {
  groq: "Groq",
  openai: "OpenAI",
  anthropic: "Anthropic",
  deepseek: "DeepSeek",
  ollama: "Ollama (local)",
};

export const VENDOR_KEY_URLS: Record<AIVendor, string | null> = {
  groq: "https://console.groq.com/keys",
  openai: "https://platform.openai.com/api-keys",
  anthropic: "https://console.anthropic.com/settings/keys",
  deepseek: "https://platform.deepseek.com/api_keys",
  ollama: null,
};

// Privacy / cost disclaimer shown next to each vendor in Settings.
export type VendorTier = "local" | "free-api" | "paid-api";

export const VENDOR_INFO: Record<AIVendor, { tier: VendorTier; note: string }> = {
  ollama: {
    tier: "local",
    note: "Runs entirely on your machine. Nothing leaves your device — fully private and free.",
  },
  groq: {
    tier: "free-api",
    note: "Free hosted API with generous limits. Your messages are sent to Groq's servers.",
  },
  openai: {
    tier: "paid-api",
    note: "Paid API, billed per token. Your messages are sent to OpenAI's servers.",
  },
  anthropic: {
    tier: "paid-api",
    note: "Paid API, billed per token. Your messages are sent to Anthropic's servers.",
  },
  deepseek: {
    tier: "paid-api",
    note: "Low-cost paid API, billed per token. Your messages are sent to DeepSeek's servers (China).",
  },
};

export const VENDOR_TIER_LABELS: Record<VendorTier, string> = {
  local: "Local · Private",
  "free-api": "Free · Cloud",
  "paid-api": "Paid · Cloud",
};

// ─── Commands ────────────────────────────────────────────────────────────────

export interface Command {
  name: string;
  description: string;
  type: "local" | "ai";
  /** For AI commands: the user prompt is replaced with this (with {arg} substituted) */
  aiPrompt?: string;
}

export const COMMANDS: Command[] = [
  // Mode commands
  { name: "/I-want-to-waste-my-time", description: "Enable unrestricted mode", type: "local" },
  { name: "/back-to-studying", description: "Disable unrestricted mode", type: "local" },

  // Local utility commands
  { name: "/clear", description: "Clear the conversation", type: "local" },
  { name: "/help", description: "List all available commands", type: "local" },
  { name: "/model", description: "Switch AI model (e.g. /model fast)", type: "local" },
  { name: "/vendor", description: "Switch AI vendor (groq, openai, anthropic, ollama)", type: "local" },
  { name: "/goal", description: "Set the session goal (e.g. /goal Finish chapter 5)", type: "local" },
  { name: "/timer", description: "Control the timer (start, pause, reset)", type: "local" },
  { name: "/note", description: "Create a new note (e.g. /note Physics Notes)", type: "local" },

  // AI-powered commands
  {
    name: "/summarize",
    description: "Summarize the conversation into key takeaways",
    type: "ai",
    aiPrompt: "Please summarize our entire conversation so far into a concise list of key takeaways, insights, and action items. Use bullet points.",
  },
  {
    name: "/explain",
    description: "Explain a topic simply (e.g. /explain quantum entanglement)",
    type: "ai",
    aiPrompt: "Explain the following topic in simple, clear terms as if I'm encountering it for the first time. Use analogies where helpful: {arg}",
  },
  {
    name: "/quiz",
    description: "Generate quiz questions from the conversation",
    type: "ai",
    aiPrompt: "Based on everything we've discussed, generate 5 quiz questions to test my understanding. Mix multiple choice and short answer. Include answers at the end.",
  },
  {
    name: "/feynman",
    description: "Walk through the Feynman technique for a topic",
    type: "ai",
    aiPrompt: "Let's use the Feynman technique. I want to learn: {arg}. Ask me to explain it back to you in my own words, then identify gaps in my understanding and help me fill them.",
  },
  {
    name: "/roast",
    description: "Get roasted on your productivity",
    type: "ai",
    aiPrompt: "Based on our conversation, give me a brutally honest (but funny) roast of my study habits and productivity. Don't hold back, but end with one genuinely helpful tip.",
  },
  {
    name: "/motivate",
    description: "Get a motivational nudge",
    type: "ai",
    aiPrompt: "Give me a short, punchy motivational message to get me back on track with studying. Make it personal based on our conversation if possible. No fluff, just real talk.",
  },
  {
    name: "/research",
    description: "Deep Research: a structured report on a topic (e.g. /research CRISPR)",
    type: "ai",
    aiPrompt: "Research topic: {arg}",
  },
];

// Commands that switch the request into Deep Research mode.
export const DEEP_RESEARCH_COMMAND = "/research";

export const COMMAND_NAMES = COMMANDS.map((c) => c.name);

export function findCommand(input: string): { command: Command; arg: string } | null {
  const trimmed = input.trim();
  for (const cmd of COMMANDS) {
    if (trimmed === cmd.name || trimmed.startsWith(cmd.name + " ")) {
      const arg = trimmed.slice(cmd.name.length).trim();
      return { command: cmd, arg };
    }
  }
  return null;
}

export function matchingCommands(input: string): Command[] {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed.startsWith("/")) return [];
  return COMMANDS.filter((c) => c.name.toLowerCase().startsWith(trimmed));
}

// ─── Streaming ───────────────────────────────────────────────────────────────

function formatError(raw: string, vendor: AIVendor): string {
  if (raw.includes("403") || raw.includes("Access denied")) {
    return `Connection to ${VENDOR_LABELS[vendor]} failed (403). Check that:\n• Your VPN is disabled (some providers block VPN IPs)\n• Your API key is still valid`;
  }
  if (raw.includes("401") || raw.includes("Unauthorized")) {
    return `Invalid API key. Open Settings (⚙) and verify your ${VENDOR_LABELS[vendor]} key.`;
  }
  if (raw.includes("429") || raw.includes("rate limit")) {
    return "Rate limit reached. Wait a moment and try again.";
  }
  if (vendor === "ollama" && (raw.includes("Connection refused") || raw.includes("connect"))) {
    return "Cannot reach Ollama. Make sure `ollama serve` is running locally on port 11434.";
  }
  return raw;
}

export interface AIRequest {
  vendor: AIVendor;
  apiKey: string;
  model: string;
  baseUrl?: string;
  messages: ChatMessage[];
  unrestricted: boolean;
  /** Curated app-capability summary, injected so the assistant is app-aware. */
  appContext?: string;
  /** The user's notes/library, injected when "use my notes as context" is on. */
  studyContext?: string;
  /** Switches the system prompt to the structured Deep Research report format. */
  deepResearch?: boolean;
  /** When set, replaces the base system prompt (used by agent mode). */
  agentSystem?: string;
  /** Output token budget. Defaults to 1024; Deep Research uses more. */
  maxTokens?: number;
}

export async function streamChatResponse(
  req: AIRequest,
  onDelta: (text: string) => void,
  onDone: () => void,
  onError: (err: string) => void
): Promise<void> {
  const needsKey = req.vendor !== "ollama";
  if (needsKey && !req.apiKey.trim()) {
    onError(`No API key configured for ${VENDOR_LABELS[req.vendor]}. Open Settings (⚙) and add it.`);
    return;
  }

  const unlistenDelta = await listen<string>("ai-delta", (event) => {
    onDelta(event.payload);
  });

  const donePromise = new Promise<void>((resolve) => {
    listen("ai-done", () => resolve()).then();
  });

  try {
    const base = req.deepResearch
      ? DEEP_RESEARCH_PROMPT
      : req.agentSystem
      ? req.agentSystem
      : req.unrestricted
      ? UNRESTRICTED_PROMPT
      : STUDY_PROMPT;

    const parts = [base];
    if (req.appContext) parts.push(req.appContext);
    if (req.studyContext) {
      parts.push(
        `The user has shared their own study material below. Use it as context when relevant; if a question isn't covered by it, rely on your general knowledge.\n\n${req.studyContext}`
      );
    }
    const systemPrompt = parts.join("\n\n---\n\n");

    await Promise.all([
      invoke("chat_completion", {
        vendor: req.vendor,
        apiKey: req.apiKey,
        model: req.model,
        baseUrl: req.baseUrl ?? null,
        system: systemPrompt,
        messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
        maxTokens: req.maxTokens ?? null,
      }),
      donePromise,
    ]);

    onDone();
  } catch (err: unknown) {
    const raw = err instanceof Error ? err.message : String(err);
    onError(formatError(raw, req.vendor));
  } finally {
    unlistenDelta();
  }
}
