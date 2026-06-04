import { useStore, type Module } from "../store/useStore";
import { search } from "./ragIndex";

// Vendor-agnostic agentic tools. The model requests actions by emitting fenced
// ```tool blocks containing JSON; we parse, execute against the Zustand store,
// and feed observations back. This works with every vendor (incl. local Ollama)
// because it's plain text — no native function-calling required.
//
// Tools are additive/read-only by design — no delete/destructive operations.

export interface ToolCall {
  tool: string;
  args: Record<string, unknown>;
}

export interface ToolOutcome {
  tool: string;
  ok: boolean;
  summary: string;     // short, user-facing (rendered as a chip)
  observation: string; // fed back to the model
}

interface ToolDef {
  name: string;
  description: string;
  args: string; // human-readable arg spec for the prompt
  run: (args: Record<string, unknown>) => Promise<{ summary: string; observation: string }>;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function isoOrNull(v: unknown): string | null {
  const s = str(v).trim();
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

export const AGENT_TOOLS: ToolDef[] = [
  {
    name: "search_notes",
    description: "Semantic search over the user's own notes and PDF library. Use this before answering questions about their material.",
    args: `{ "query": string }`,
    run: async (a) => {
      const hits = await search(str(a.query), 6);
      if (hits.length === 0) {
        return { summary: "Searched notes (no matches)", observation: "No relevant notes or PDFs found." };
      }
      const body = hits
        .map((h, i) => `[${i + 1}] ${h.sourceName} (${h.sourceType}):\n${h.text.trim()}`)
        .join("\n\n");
      return { summary: `Searched notes (${hits.length} hits)`, observation: body };
    },
  },
  {
    name: "create_task",
    description: "Add a to-do task. Optional ISO due date.",
    args: `{ "text": string, "dueDate"?: ISO-8601 string }`,
    run: async (a) => {
      const text = str(a.text).trim();
      if (!text) return { summary: "create_task failed", observation: "Error: 'text' is required." };
      const due = isoOrNull(a.dueDate) ?? undefined;
      useStore.getState().addTask(text, due ? { dueDate: due } : undefined);
      return { summary: `Created task "${text}"`, observation: `Task created: "${text}"${due ? ` (due ${due})` : ""}.` };
    },
  },
  {
    name: "add_calendar_event",
    description: "Add a local calendar event. End defaults to one hour after start if omitted.",
    args: `{ "title": string, "start": ISO-8601 string, "end"?: ISO-8601 string, "description"?: string }`,
    run: async (a) => {
      const title = str(a.title).trim();
      const start = isoOrNull(a.start);
      if (!title || !start) return { summary: "add_calendar_event failed", observation: "Error: 'title' and a valid ISO 'start' are required." };
      const end = isoOrNull(a.end) ?? new Date(new Date(start).getTime() + 3600_000).toISOString();
      useStore.getState().addCalendarEvent({
        title,
        start,
        end,
        source: "local",
        description: str(a.description) || undefined,
      });
      return { summary: `Added event "${title}"`, observation: `Calendar event "${title}" added (${start} → ${end}).` };
    },
  },
  {
    name: "create_note",
    description: "Create a new markdown note.",
    args: `{ "title": string, "content"?: markdown string }`,
    run: async (a) => {
      const title = str(a.title).trim() || "Untitled";
      const id = useStore.getState().addNote(null);
      useStore.getState().updateNote(id, { name: title, content: str(a.content) });
      return { summary: `Created note "${title}"`, observation: `Note "${title}" created.` };
    },
  },
  {
    name: "create_flashcards",
    description: "Create flashcards in a deck (deck is created if it doesn't exist). Great for turning study material into spaced-repetition cards.",
    args: `{ "deck": string, "cards": [ { "front": string, "back": string } ] }`,
    run: async (a) => {
      const deckName = str(a.deck).trim() || "Generated";
      const cards = Array.isArray(a.cards) ? (a.cards as Array<Record<string, unknown>>) : [];
      if (cards.length === 0) return { summary: "create_flashcards failed", observation: "Error: 'cards' must be a non-empty array." };
      const st = useStore.getState();
      let deck = st.flashcardDecks.find((d) => d.name.toLowerCase() === deckName.toLowerCase());
      if (!deck) {
        st.addDeck(deckName);
        deck = useStore.getState().flashcardDecks.find((d) => d.name.toLowerCase() === deckName.toLowerCase());
      }
      if (!deck) return { summary: "create_flashcards failed", observation: "Error: could not create deck." };
      let n = 0;
      for (const c of cards) {
        const front = str(c.front).trim();
        const back = str(c.back).trim();
        if (front && back) {
          useStore.getState().addFlashcard(deck.id, front, back);
          n++;
        }
      }
      return { summary: `Added ${n} card${n === 1 ? "" : "s"} to "${deckName}"`, observation: `${n} flashcard(s) added to deck "${deckName}".` };
    },
  },
  {
    name: "control_timer",
    description: "Control the focus (Pomodoro) timer.",
    args: `{ "action": "start" | "pause" | "reset" }`,
    run: async (a) => {
      const action = str(a.action).toLowerCase();
      const st = useStore.getState();
      if (action === "start") st.startTimer();
      else if (action === "pause") st.pauseTimer();
      else if (action === "reset") st.resetTimer();
      else return { summary: "control_timer failed", observation: "Error: action must be start, pause, or reset." };
      return { summary: `Timer ${action}`, observation: `Timer ${action} done.` };
    },
  },
  {
    name: "set_goal",
    description: "Set the current session goal shown next to the timer.",
    args: `{ "text": string }`,
    run: async (a) => {
      const text = str(a.text).trim();
      if (!text) return { summary: "set_goal failed", observation: "Error: 'text' is required." };
      useStore.getState().setGoal(text);
      return { summary: `Goal set: "${text}"`, observation: `Session goal set to "${text}".` };
    },
  },
  {
    name: "switch_module",
    description: "Switch the visible app module.",
    args: `{ "module": "calendar" | "pomodoro" | "notepad" | "tasks" | "flashcards" | "stats" }`,
    run: async (a) => {
      const valid: Module[] = ["calendar", "pomodoro", "notepad", "tasks", "flashcards", "stats"];
      const m = str(a.module) as Module;
      if (!valid.includes(m)) return { summary: "switch_module failed", observation: `Error: module must be one of ${valid.join(", ")}.` };
      useStore.getState().setActiveModule(m);
      return { summary: `Opened ${m}`, observation: `Switched to ${m}.` };
    },
  },
];

const TOOL_MAP: Record<string, ToolDef> = Object.fromEntries(AGENT_TOOLS.map((t) => [t.name, t]));

export function buildAgentSystemPrompt(): string {
  const today = new Date().toISOString();
  const tools = AGENT_TOOLS.map((t) => `- ${t.name}: ${t.description}\n  args: ${t.args}`).join("\n");
  return `You are an autonomous study assistant embedded in the Hades app, and you can take actions on the user's behalf.

Current date/time: ${today}

HOW TO ACT — this is the ONLY way to do anything in the app. When the user asks you to do something (create a task, make flashcards, add an event, search their notes, start the timer, …), you MUST respond with a tool call. A tool call is a fenced code block tagged \`tool\` containing one JSON object with "tool" and "args":

\`\`\`tool
{"tool": "create_task", "args": {"text": "Read chapter 5", "dueDate": "${today.slice(0, 10)}T18:00:00"}}
\`\`\`

Rules for tool calls — follow them exactly:
- Emit the tool call FIRST, before any explanation. You may emit several blocks (one JSON object each) to do several things.
- Output ONLY raw JSON inside the fence — no comments, no trailing text on the fence lines.
- Do NOT describe an action as if it's done unless you actually emitted a tool call for it. Saying "I've added the task" without a tool call does nothing.
- After your tool calls run, you'll get an "Observations" message with results. Then either emit more tool calls or, when finished, reply normally with NO tool block.

Worked example —
User: "make 3 flashcards on the water cycle and remind me to review them tomorrow"
You:
\`\`\`tool
{"tool": "create_flashcards", "args": {"deck": "Water Cycle", "cards": [{"front": "What is evaporation?", "back": "Liquid water turning into vapor."}, {"front": "What is condensation?", "back": "Vapor turning back into liquid."}, {"front": "What is precipitation?", "back": "Water falling as rain/snow."}]}}
\`\`\`
\`\`\`tool
{"tool": "create_task", "args": {"text": "Review Water Cycle flashcards", "dueDate": "${today.slice(0, 10)}T09:00:00"}}
\`\`\`

Guidelines:
- Use search_notes before answering questions about the user's own notes/PDFs.
- When asked to create study material (e.g. "make flashcards from X"), search first, then create_flashcards.
- Only act on what the user asked; there are no delete/destructive tools.
- Keep prose concise. Never paste raw tool JSON into your final answer.

Available tools:
${tools}`;
}

// Tolerant of however a given model wraps its tool call: a ```tool or ```json
// fence (Groq's Llama models lean toward ```json), or a bare JSON object/array.
const FENCE_RE = /```(?:tool|json)?[^\S\r\n]*\r?\n?([\s\S]*?)```/g;

function looksLikeToolJson(s: string): boolean {
  return /"tool"\s*:/.test(s);
}

// Scan for top-level {...} / [...] spans, respecting strings. Used to recover
// tool calls a model emitted without a fence.
function scanJsonSpans(text: string): string[] {
  const spans: string[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "{" && text[i] !== "[") continue;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let j = i; j < text.length; j++) {
      const c = text[j];
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === "{" || c === "[") depth++;
      else if (c === "}" || c === "]") {
        depth--;
        if (depth === 0) {
          spans.push(text.slice(i, j + 1));
          i = j;
          break;
        }
      }
    }
  }
  return spans;
}

function collectCalls(raw: string, into: ToolCall[]): void {
  try {
    const obj = JSON.parse(raw);
    const arr = Array.isArray(obj) ? obj : [obj];
    for (const o of arr) {
      if (o && typeof o.tool === "string") {
        into.push({ tool: o.tool, args: o.args && typeof o.args === "object" ? o.args : {} });
      }
    }
  } catch {
    /* not valid JSON — ignore */
  }
}

export function parseToolCalls(text: string): ToolCall[] {
  const calls: ToolCall[] = [];

  // 1) Fenced blocks (```tool / ```json / bare ```).
  let m: RegExpExecArray | null;
  FENCE_RE.lastIndex = 0;
  while ((m = FENCE_RE.exec(text)) !== null) {
    if (looksLikeToolJson(m[1])) collectCalls(m[1].trim(), calls);
  }
  if (calls.length > 0) return calls;

  // 2) No usable fence — recover bare JSON tool objects/arrays.
  for (const span of scanJsonSpans(text)) {
    if (looksLikeToolJson(span)) collectCalls(span, calls);
  }
  return calls;
}

/** Remove tool calls (fenced or bare) from text shown to the user. */
export function stripToolBlocks(text: string): string {
  let out = text.replace(FENCE_RE, (full, inner) => (looksLikeToolJson(inner) ? "" : full));
  for (const span of scanJsonSpans(out)) {
    if (looksLikeToolJson(span)) out = out.split(span).join("");
  }
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

export async function executeToolCalls(calls: ToolCall[]): Promise<ToolOutcome[]> {
  const out: ToolOutcome[] = [];
  for (const call of calls) {
    const def = TOOL_MAP[call.tool];
    if (!def) {
      out.push({ tool: call.tool, ok: false, summary: `Unknown tool: ${call.tool}`, observation: `Error: unknown tool "${call.tool}".` });
      continue;
    }
    try {
      const { summary, observation } = await def.run(call.args);
      const ok = !summary.toLowerCase().includes("failed");
      out.push({ tool: call.tool, ok, summary, observation });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      out.push({ tool: call.tool, ok: false, summary: `${call.tool} error`, observation: `Error running ${call.tool}: ${msg}` });
    }
  }
  return out;
}
