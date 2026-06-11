import { useStore, type Module, type NoteFile } from "../store/useStore";
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

// ── Local-time formatting ─────────────────────────────────────────────────────
// Calendar events are stored as UTC ISO. The model is unreliable at timezone
// math, so we always hand it human-readable LOCAL times (and tell it the zone),
// and we never make it convert UTC itself.

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || "local time";

function fmtLocal(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    weekday: "short", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

function fmtLocalTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
}

// ── Direct note access (works without the RAG index / Ollama) ─────────────────

function allNotes(): NoteFile[] {
  return useStore.getState().notes.filter((n) => !n.isFolder);
}

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "about",
  "my", "me", "i", "you", "it", "is", "are", "was", "what", "which", "that", "this",
  "note", "notes", "summarize", "summarise", "summary", "tell", "give", "show",
  "find", "read", "from", "do", "does", "say", "says", "please", "can",
]);

/** Meaningful query terms: length ≥ 3 and not a stopword. */
function meaningfulTerms(q: string): string[] {
  return q.split(/\s+/).filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let i = 0;
  while ((i = haystack.indexOf(needle, i)) !== -1) {
    count++;
    i += needle.length;
  }
  return count;
}

/**
 * Keyword/title scoring over the live note store. Always available (no RAG).
 * Tuned for PRECISION — weak single-common-word hits are filtered out so the
 * agent isn't fed unrelated notes it would then confabulate about.
 */
function keywordSearchNotes(query: string, limit = 6): NoteFile[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  const terms = meaningfulTerms(q);
  const MIN_SCORE = 8;

  return allNotes()
    .map((n) => {
      const name = n.name.toLowerCase();
      const content = n.content.toLowerCase();
      let score = 0;
      if (name === q) score += 100;
      else if (name.includes(q)) score += 40;
      if (content.includes(q) && q.length >= 4) score += 15;
      for (const t of terms) {
        if (name.includes(t)) score += 10;
        score += Math.min(countOccurrences(content, t), 5) * 2;
      }
      return { n, score };
    })
    .filter((x) => x.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.n);
}

/**
 * Best single-note match for a title reference. Conservative: returns null
 * rather than a weak guess, so read_note never summarizes the wrong note.
 */
function findNoteByTitle(title: string): NoteFile | null {
  const q = title.toLowerCase().trim();
  if (!q) return null;
  const notes = allNotes();

  // 1) Exact title.
  let m = notes.find((n) => n.name.toLowerCase() === q);
  if (m) return m;

  // 2) The requested title is contained in a note's name (or vice-versa for
  //    non-trivial names). Require length ≥ 3 to avoid matching tiny names.
  if (q.length >= 3) {
    m = notes.find((n) => n.name.toLowerCase().includes(q));
    if (m) return m;
  }
  m = notes.find((n) => {
    const name = n.name.toLowerCase();
    return name.length >= 4 && q.includes(name);
  });
  if (m) return m;

  // 3) Term overlap — require a majority of the (meaningful) title terms to be
  //    present in the note name, so we don't latch onto an unrelated note.
  const terms = meaningfulTerms(q);
  if (terms.length === 0) return null;
  let best: NoteFile | null = null;
  let bestHits = 0;
  for (const n of notes) {
    const name = n.name.toLowerCase();
    const hits = terms.filter((t) => name.includes(t)).length;
    if (hits > bestHits) { bestHits = hits; best = n; }
  }
  return bestHits >= Math.ceil(terms.length / 2) ? best : null;
}

export const AGENT_TOOLS: ToolDef[] = [
  {
    name: "search_notes",
    description: "Search the user's own notes and PDF library for material relevant to a query. Use this before answering questions about their material.",
    args: `{ "query": string }`,
    run: async (a) => {
      const query = str(a.query);

      // 1) Prefer semantic RAG retrieval when the on-device index is available.
      const hits = await search(query, 6);
      if (hits.length > 0) {
        const body = hits
          .map((h, i) => `[${i + 1}] ${h.sourceName} (${h.sourceType}):\n${h.text.trim()}`)
          .join("\n\n");
        return { summary: `Searched notes (${hits.length} hits)`, observation: body };
      }

      // 2) Fallback: keyword/title search over the live note store. This always
      //    works — no Ollama or pre-built index required — so the agent can find
      //    notes that plainly exist even when semantic search is unavailable.
      const matches = keywordSearchNotes(query, 6);
      if (matches.length > 0) {
        const body = matches
          .map((n, i) => {
            const content = n.content.trim();
            const snippet = content.slice(0, 1200);
            const more = content.length > 1200 ? "\n…(truncated — use read_note for the full text)" : "";
            return `[${i + 1}] ${n.name} (note):\n${snippet || "(empty note)"}${more}`;
          })
          .join("\n\n");
        return { summary: `Searched notes (${matches.length} hits)`, observation: body };
      }

      // 3) Nothing matched — tell the model what notes DO exist so it can retry.
      const names = allNotes().map((n) => n.name);
      const observation = names.length
        ? `No note matched "${query}". The user's notes are: ${names.join(", ")}. Try read_note with one of these titles.`
        : "The user has no notes yet.";
      return { summary: "Searched notes (no matches)", observation };
    },
  },
  {
    name: "read_note",
    description: "Read the FULL content of one of the user's notes by its title (fuzzy, case-insensitive). Use this to summarize or answer questions about a specific existing note.",
    args: `{ "title": string }`,
    run: async (a) => {
      const title = str(a.title).trim();
      if (!title) return { summary: "read_note failed", observation: "Error: 'title' is required." };
      const note = findNoteByTitle(title);
      if (!note) {
        const names = allNotes().map((n) => n.name);
        return {
          summary: `Note "${title}" not found`,
          observation: names.length
            ? `No note matches "${title}". Available notes: ${names.join(", ")}.`
            : "The user has no notes yet.",
        };
      }
      const content = note.content.trim();
      const capped = content.length > 8000 ? content.slice(0, 8000) + "\n…(truncated)" : content;
      return {
        summary: `Read note "${note.name}"`,
        observation: `Note: ${note.name}\n\n${capped || "(this note is empty)"}`,
      };
    },
  },
  {
    name: "list_notes",
    description: "List the titles of all the user's notes. Use when you're unsure of the exact title to read or search.",
    args: `{}`,
    run: async () => {
      const names = allNotes().map((n) => n.name);
      if (names.length === 0) return { summary: "No notes", observation: "The user has no notes yet." };
      return { summary: `Listed ${names.length} notes`, observation: `User's notes:\n- ${names.join("\n- ")}` };
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
    name: "create_tasks",
    description: "Add SEVERAL to-do tasks at once — ideal when breaking a big goal down into steps. Each task may have an ISO due date.",
    args: `{ "tasks": [ { "text": string, "dueDate"?: ISO-8601 string } ] }`,
    run: async (a) => {
      const items = Array.isArray(a.tasks) ? (a.tasks as Array<Record<string, unknown>>) : [];
      if (items.length === 0) return { summary: "create_tasks failed", observation: "Error: 'tasks' must be a non-empty array." };
      let n = 0;
      const lines: string[] = [];
      for (const it of items) {
        const text = str(it.text).trim();
        if (!text) continue;
        const due = isoOrNull(it.dueDate) ?? undefined;
        useStore.getState().addTask(text, due ? { dueDate: due } : undefined);
        lines.push(`- ${text}${due ? ` (due ${due})` : ""}`);
        n++;
      }
      if (n === 0) return { summary: "create_tasks failed", observation: "Error: no task had a non-empty 'text'." };
      return { summary: `Created ${n} task${n === 1 ? "" : "s"}`, observation: `Created ${n} task(s):\n${lines.join("\n")}` };
    },
  },
  {
    name: "read_schedule",
    description: "Read the user's current workload: open tasks (with due dates), calendar events & deadlines for the next 14 days, the weekly focus-hours goal and progress. Call this BEFORE planning their day or week.",
    args: `{}`,
    run: async () => {
      const s = useStore.getState();
      const now = new Date();
      const horizon = new Date(now.getTime() + 14 * 24 * 3600_000);

      const tasks = s.tasks.filter((t) => !t.completed);
      const taskLines = tasks.map((t) => `- ${t.text}${t.dueDate ? ` (due ${fmtLocal(t.dueDate)})` : ""}`);

      const events = s.calendarEvents
        .filter((e) => {
          const start = new Date(e.start);
          return start >= now && start <= horizon;
        })
        .sort((a, b) => a.start.localeCompare(b.start))
        .slice(0, 40);
      // Hand the model LOCAL times (start day + start/end clock), never UTC ISO.
      const eventLines = events.map(
        (e) => `- ${fmtLocal(e.start)}–${fmtLocalTime(e.end)}: ${e.title}${e.isDeadline ? " [DEADLINE]" : ""}`
      );

      // This week's focus progress (Monday-based week).
      const d = new Date(now);
      const day = d.getDay();
      d.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
      const weekStart = d.toISOString().split("T")[0];
      const weekSecs = s.focusSessions
        .filter((f) => f.date >= weekStart)
        .reduce((acc, f) => acc + f.duration, 0);

      const observation = [
        `Now: ${fmtLocal(now.toISOString())} (timezone: ${TZ}). All times below are in this local timezone.`,
        `Weekly focus goal: ${s.weeklyGoalHours}h — done so far this week: ${(weekSecs / 3600).toFixed(1)}h`,
        `Open tasks (${tasks.length}):`,
        taskLines.length ? taskLines.join("\n") : "(none)",
        `Events & deadlines, next 14 days (${events.length}):`,
        eventLines.length ? eventLines.join("\n") : "(none)",
      ].join("\n");

      return { summary: "Read schedule", observation };
    },
  },
  {
    name: "add_calendar_event",
    description: "Add a local calendar event. Times are in the user's LOCAL timezone — give a local ISO datetime WITHOUT a 'Z' suffix (e.g. \"2025-06-12T15:00:00\" means 3 PM local). End defaults to one hour after start if omitted.",
    args: `{ "title": string, "start": local ISO-8601 (no Z), "end"?: local ISO-8601 (no Z), "description"?: string }`,
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
      // Echo back LOCAL time so the model confirms correctly to the user.
      return { summary: `Added event "${title}"`, observation: `Calendar event "${title}" added: ${fmtLocal(start)}–${fmtLocalTime(end)} (${TZ}).` };
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
  {
    name: "search_pdf",
    description: "Search INSIDE one specific PDF from the user's library (scoped Q&A). Use when the user asks about a particular PDF/document by name.",
    args: `{ "title": string, "query": string }`,
    run: async (a) => {
      const title = str(a.title).trim().toLowerCase();
      const query = str(a.query).trim();
      if (!title || !query) return { summary: "search_pdf failed", observation: "Error: 'title' and 'query' are required." };
      const docs = useStore.getState().libraryDocs;
      const doc =
        docs.find((d) => d.title.toLowerCase() === title || d.fileName.toLowerCase() === title) ??
        docs.find((d) => d.title.toLowerCase().includes(title) || d.fileName.toLowerCase().includes(title));
      if (!doc) {
        const names = docs.map((d) => d.title || d.fileName);
        return {
          summary: `PDF "${str(a.title)}" not found`,
          observation: names.length
            ? `No library PDF matches "${str(a.title)}". Available PDFs: ${names.join(", ")}.`
            : "The user's PDF library is empty.",
        };
      }
      const hits = await search(query, 6, { sourceId: doc.id });
      if (hits.length === 0) {
        return {
          summary: `Searched "${doc.title}" (no matches)`,
          observation: `No passage in "${doc.title}" matched "${query}". The PDF may not be indexed yet — ask the user to rebuild the study index in Settings → AI.`,
        };
      }
      const body = hits.map((h, i) => `[${i + 1}] ${h.sourceName}:\n${h.text.trim()}`).join("\n\n");
      return { summary: `Searched "${doc.title}" (${hits.length} hits)`, observation: body };
    },
  },
];

const TOOL_MAP: Record<string, ToolDef> = Object.fromEntries(AGENT_TOOLS.map((t) => [t.name, t]));

export function buildAgentSystemPrompt(): string {
  const now = new Date();
  const todayLocal = `${fmtLocal(now.toISOString())} (timezone: ${TZ})`;
  const todayDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const tomorrow = new Date(now.getTime() + 24 * 3600_000);
  const tomorrowDate = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
  const tools = AGENT_TOOLS.map((t) => `- ${t.name}: ${t.description}\n  args: ${t.args}`).join("\n");
  return `You are an autonomous study assistant embedded in the Hades app, and you can take actions on the user's behalf.

Current date/time: ${todayLocal}. Tomorrow's date is ${tomorrowDate}.
TIMEZONE: all times you read from tools and all times you write are in the user's LOCAL timezone (${TZ}). Calendar times in observations are already local — report them to the user exactly as given, do NOT shift them. When creating events, write a local ISO datetime with NO 'Z' suffix.

HOW TO ACT — this is the ONLY way to do anything in the app. When the user asks you to do something (create a task, make flashcards, add an event, search their notes, start the timer, …), you MUST respond with a tool call. A tool call is a fenced code block tagged \`tool\` containing one JSON object with "tool" and "args":

\`\`\`tool
{"tool": "create_task", "args": {"text": "Read chapter 5", "dueDate": "${todayDate}T18:00:00"}}
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
{"tool": "create_task", "args": {"text": "Review Water Cycle flashcards", "dueDate": "${todayDate}T09:00:00"}}
\`\`\`

GROUNDING — never hallucinate (this overrides everything else):
- Only state facts that literally appear in a tool Observation. Do NOT invent note titles, note content, quotes, or details.
- You have NO information about folders or where a note is stored. NEVER say a note is "in" a folder or describe any folder structure — that data is not available to you.
- To describe or summarize a note's content you MUST first obtain it via read_note (or see it in a search_notes Observation). Summarize ONLY that returned text — do not add anything that isn't there.
- If read_note / search_notes / list_notes show the note isn't there (or return no match), tell the user plainly that you couldn't find it and, if helpful, list the real titles that exist. Do NOT fabricate its contents.
- If you haven't called a tool yet, you do not know what notes exist — call list_notes or read_note before making any claim about them.

Guidelines:
- To summarize or answer questions about a SPECIFIC note the user names (e.g. "summarise my note X"), call read_note with that title — it returns the full note text. If unsure of the exact title, call list_notes first, then read_note.
- For broader "what do my notes say about …" questions, use search_notes. For questions about one particular PDF, use search_pdf with its title.
- When asked to create study material (e.g. "make flashcards from X"), read/search the source first, then create_flashcards.
- When the user gives a big goal ("prepare for the bio midterm"), break it into concrete steps and create them in ONE create_tasks call, with realistic due dates.
- When asked to plan their day or week, call read_schedule FIRST, then propose time blocks via add_calendar_event around existing events, respecting due dates and the weekly focus goal. Don't double-book.
- Only act on what the user asked; there are no delete/destructive tools.
- When your answer draws on material from search_notes / read_note / search_pdf, cite the source inline as [Note: <name>] or [PDF: <name>] with the exact name from the Observation.
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
