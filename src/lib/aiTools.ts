import { getVersion } from "@tauri-apps/api/app";
import { useStore, type Module, type NoteFile } from "../store/useStore";
import { search } from "./ragIndex";
import { WHATS_NEW } from "./changelog";
import { getOpenNotes, getActiveNote, getOpenPdfContext } from "./openDocs";
import { fmtLocal, fmtLocalTime, fmtRangeLocal, TZ } from "./localTime";
import { needsCycleReset } from "./pomodoroCycle";

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

// ── Study stats ───────────────────────────────────────────────────────────────
// Dates are keyed exactly like the store's recordFocusTime and the Statistics
// screen (UTC date string, Monday-based week) so the numbers always agree.

function focusDateKey(d: Date): string {
  return d.toISOString().split("T")[0];
}

function weekFocusSeconds(sessions: { date: string; duration: number }[]): number {
  const d = new Date();
  const day = d.getDay();
  d.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
  const weekStart = focusDateKey(d);
  return sessions.filter((f) => f.date >= weekStart).reduce((acc, f) => acc + f.duration, 0);
}

function studyStatsText(): string {
  const s = useStore.getState();
  const weekSecs = weekFocusSeconds(s.focusSessions ?? []);
  const todaySecs = (s.focusSessions ?? [])
    .filter((f) => f.date === focusDateKey(new Date()))
    .reduce((acc, f) => acc + f.duration, 0);
  const cycleDone = needsCycleReset(s.lastSessionDate ?? null, s.sessionsCompleted) ? 0 : s.sessionsCompleted;
  const pct = s.weeklyGoalHours > 0 ? Math.round((weekSecs / 3600 / s.weeklyGoalHours) * 100) : 0;
  return [
    `Weekly focus goal: ${s.weeklyGoalHours}h — done so far this week: ${(weekSecs / 3600).toFixed(1)}h (${pct}%)`,
    `Today's focus time: ${Math.round(todaySecs / 60)} min (${todaySecs}s)`,
    `Pomodoro cycle today: ${cycleDone} of ${s.sessionsUntilLongBreak} focus sessions completed before the long break`,
    `Current session goal: ${s.goal.trim() ? `"${s.goal.trim()}"` : "(none set)"}`,
  ].join("\n");
}

// ── Argument validation ───────────────────────────────────────────────────────

/** A finite number (or numeric string); null when it isn't one. */
function numArg(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/**
 * A local-time boundary. Date-only strings mean the start (or end) of that
 * LOCAL day; datetimes without an offset are local, as JS parses them.
 */
function parseWhen(v: unknown, edge: "start" | "end"): { ms: number | null } | { error: string } {
  const raw = str(v).trim();
  if (!raw) return { ms: null };
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  let d: Date;
  if (m) {
    const [y, mo, da] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
    d = edge === "start" ? new Date(y, mo, da, 0, 0, 0, 0) : new Date(y, mo, da, 23, 59, 59, 999);
    if (d.getMonth() !== mo || d.getDate() !== da) return { error: `'${raw}' is not a valid date.` };
  } else {
    d = new Date(raw);
  }
  return isNaN(d.getTime()) ? { error: `'${raw}' is not a valid ISO-8601 date or datetime.` } : { ms: d.getTime() };
}

export const AGENT_TOOLS: ToolDef[] = [
  {
    name: "search_notes",
    description: "Search the user's own notes, PDF library, calendar events and tasks for material relevant to a query. Use this before answering questions about their material.",
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

      const weekSecs = weekFocusSeconds(s.focusSessions);

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
    name: "query_schedule",
    description: "Look up calendar events and tasks in a specific time range (default: now to 14 days ahead; tasks default to all open tasks). Use for 'what do I have next week / before Friday / on the 20th'. All times are local. Date-only values mean that whole local day.",
    args: `{ "from"?: ISO-8601 date or local datetime, "to"?: ISO-8601 date or local datetime, "include"?: ["events" | "tasks"], "limit"?: integer 1-200 }`,
    run: async (a) => {
      const fail = (msg: string) => ({ summary: "query_schedule failed", observation: `Error: ${msg}` });
      const from = parseWhen(a.from, "start");
      if ("error" in from) return fail(`'from': ${from.error}`);
      const to = parseWhen(a.to, "end");
      if ("error" in to) return fail(`'to': ${to.error}`);

      let include: string[] = ["events", "tasks"];
      if (a.include != null) {
        const arr = Array.isArray(a.include) ? a.include : typeof a.include === "string" ? [a.include] : [];
        if (arr.length === 0 || arr.some((x) => x !== "events" && x !== "tasks")) {
          return fail(`'include' must be a non-empty array containing only "events" and/or "tasks".`);
        }
        include = arr as string[];
      }

      let limit = 50;
      if (a.limit != null) {
        const n = numArg(a.limit);
        if (n === null) return fail("'limit' must be an integer between 1 and 200.");
        limit = clamp(Math.floor(n), 1, 200);
      }

      const now = new Date();
      const fromMs = from.ms ?? now.getTime();
      const toMs = to.ms ?? fromMs + 14 * 24 * 3600_000;
      if (toMs < fromMs) return fail("'to' is before 'from'.");
      const explicitWindow = from.ms !== null || to.ms !== null;
      const s = useStore.getState();
      const out: string[] = [
        `Now: ${fmtLocal(now.toISOString())} (timezone: ${TZ}). All times below are in this local timezone.`,
        `Window: ${fmtLocal(new Date(fromMs).toISOString())} → ${fmtLocal(new Date(toMs).toISOString())}`,
      ];

      if (include.includes("events")) {
        const events = s.calendarEvents
          .filter((e) => {
            const start = new Date(e.start).getTime();
            if (isNaN(start)) return false;
            const end = new Date(e.end).getTime();
            return start <= toMs && (isNaN(end) ? start : end) >= fromMs;
          })
          .sort((x, y) => x.start.localeCompare(y.start));
        const shown = events.slice(0, limit);
        out.push(`Events & deadlines (${shown.length}${events.length > shown.length ? ` of ${events.length}, raise 'limit' or narrow the range for more` : ""}):`);
        out.push(
          shown.length
            ? shown.map((e) => `- ${fmtRangeLocal(e.start, e.end || e.start)}: ${e.title}${e.isDeadline ? " [DEADLINE]" : ""} (id: ${e.id}, source: ${e.source})`).join("\n")
            : "(none)"
        );
      }

      if (include.includes("tasks")) {
        const inWindow = (t: { dueDate?: string }) => {
          const due = t.dueDate ? new Date(t.dueDate).getTime() : NaN;
          return !isNaN(due) && due >= fromMs && due <= toMs;
        };
        const tasks = s.tasks
          .filter((t) => (explicitWindow ? inWindow(t) : !t.completed))
          .sort((x, y) => (x.dueDate ?? "9999").localeCompare(y.dueDate ?? "9999"));
        const shown = tasks.slice(0, limit);
        out.push(`Tasks (${shown.length}${tasks.length > shown.length ? ` of ${tasks.length}` : ""})${explicitWindow ? " due in the window" : ", open"}:`);
        out.push(
          shown.length
            ? shown.map((t) => `- ${t.text}${t.dueDate ? ` (due ${fmtLocal(t.dueDate)})` : ""}${t.completed ? " [done]" : ""} (id: ${t.id})`).join("\n")
            : "(none)"
        );
      }

      return { summary: "Queried schedule", observation: out.join("\n") };
    },
  },
  {
    name: "list_open_notes",
    description: "List the notes currently open as editor tabs (which one is active). Use to find out what the user is working on.",
    args: `{}`,
    run: async () => {
      const open = getOpenNotes();
      if (open.length === 0) return { summary: "No open notes", observation: "No notes are open as tabs." };
      const activeId = getActiveNote()?.id;
      const lines = open.map(
        (n) => `- ${n.name || "Untitled"} (id: ${n.id})${n.id === activeId ? " [ACTIVE]" : ""} — last edited ${fmtLocal(n.updatedAt)}`
      );
      return { summary: `Listed ${open.length} open note${open.length === 1 ? "" : "s"}`, observation: `Open notes (tab order):\n${lines.join("\n")}` };
    },
  },
  {
    name: "read_open_note",
    description: "Read the full text of a note that is open as a tab. With no id it reads the ACTIVE note — use for 'this note', 'the note I'm on'.",
    args: `{ "id"?: string (from list_open_notes) }`,
    run: async (a) => {
      const id = str(a.id).trim();
      let note: NoteFile | null;
      if (id) {
        note = getOpenNotes().find((n) => n.id === id) ?? null;
        if (!note) {
          const open = getOpenNotes().map((n) => `${n.name} (id: ${n.id})`);
          return {
            summary: "read_open_note failed",
            observation: `Error: no open note has id "${id}". ${open.length ? `Open notes: ${open.join(", ")}.` : "No notes are open."}`,
          };
        }
      } else {
        note = getActiveNote();
        if (!note) return { summary: "No active note", observation: "No note is currently open." };
      }
      const content = note.content.trim();
      const capped = content.length > 8000 ? content.slice(0, 8000) + "\n…(truncated)" : content;
      return { summary: `Read open note "${note.name}"`, observation: `Note: ${note.name}\n\n${capped || "(this note is empty)"}` };
    },
  },
  {
    name: "read_open_pdf",
    description: "Read the text of the PDF currently open in the Notes PDF pane: the page the user is on (or the page you ask for) plus its neighbours, then as much of the rest as fits. Use for 'this PDF', 'this page', 'this slide'.",
    args: `{ "page"?: integer >= 1, "maxChars"?: integer 200-20000 (default 6000) }`,
    run: async (a) => {
      const fail = (msg: string) => ({ summary: "read_open_pdf failed", observation: `Error: ${msg}` });
      let page: number | undefined;
      if (a.page != null) {
        const n = numArg(a.page);
        if (n === null || !Number.isInteger(n) || n < 1) return fail("'page' must be an integer >= 1.");
        page = n;
      }
      let maxChars: number | undefined;
      if (a.maxChars != null) {
        const n = numArg(a.maxChars);
        if (n === null) return fail("'maxChars' must be an integer between 200 and 20000.");
        maxChars = clamp(Math.floor(n), 200, 20000);
      }

      const ctx = await getOpenPdfContext({ page, maxChars, timeoutMs: 8000 });
      if (!ctx) {
        return { summary: "No PDF open", observation: "No PDF is open in the Notes PDF pane. Ask the user to open one, or use search_pdf for a PDF in their library." };
      }
      const { pdf } = ctx;
      if (page && pdf.pageCount && page > pdf.pageCount) return fail(`page ${page} is out of range — "${pdf.title}" has ${pdf.pageCount} pages.`);
      const meta = [
        `Title: ${pdf.title}`,
        `Library doc id: ${pdf.docId ?? "(not a library PDF)"}`,
        `Current page: ${pdf.currentPage ?? "unknown"} of ${pdf.pageCount ?? "unknown"}`,
        `Truncated: ${pdf.truncated}`,
      ].join("\n");
      if (ctx.pending) {
        return { summary: "PDF text still loading", observation: `${meta}\n\nThe PDF's text is still being extracted. Tell the user, and call read_open_pdf again in a moment.` };
      }
      return {
        summary: `Read open PDF "${pdf.title}"`,
        observation: `${meta}\n\n${pdf.text || "(no selectable text found — the PDF may be a scan)"}`,
      };
    },
  },
  {
    name: "get_study_stats",
    description: "Read the user's study stats: weekly focus-hour goal and progress, today's focus time, the Pomodoro cycle counter, and the current session goal.",
    args: `{}`,
    run: async () => ({ summary: "Read study stats", observation: studyStatsText() }),
  },
  {
    name: "update_study_stats",
    description: "Change study settings/stats. Only when the user asks: set the weekly focus-hour goal, log focus minutes they already did, or set the session goal. Nothing is ever deleted.",
    args: `{ "weeklyGoalHours"?: number 1-100, "logFocusMinutes"?: integer 1-480, "goal"?: string (max 200 chars) }`,
    run: async (a) => {
      const fail = (msg: string) => ({ summary: "update_study_stats failed", observation: `Error: ${msg} Nothing was changed.` });
      const notes: string[] = [];
      let hours: number | undefined;
      let minutes: number | undefined;
      let goal: string | undefined;

      if (a.weeklyGoalHours != null) {
        const n = numArg(a.weeklyGoalHours);
        if (n === null) return fail("'weeklyGoalHours' must be a number between 1 and 100.");
        const bounded = clamp(n, 1, 100);
        hours = Math.round(bounded * 10) / 10;
        if (bounded !== n) notes.push(`weeklyGoalHours clamped to ${hours}`);
      }
      if (a.logFocusMinutes != null) {
        const n = numArg(a.logFocusMinutes);
        if (n === null) return fail("'logFocusMinutes' must be an integer between 1 and 480.");
        const bounded = clamp(n, 1, 480);
        minutes = Math.round(bounded);
        if (bounded !== n) notes.push(`logFocusMinutes clamped to ${minutes}`);
      }
      if (a.goal != null) {
        if (typeof a.goal !== "string") return fail("'goal' must be a string.");
        goal = a.goal.trim();
        if (!goal) return fail("'goal' must not be empty.");
        if (goal.length > 200) return fail("'goal' must be at most 200 characters.");
      }
      if (hours === undefined && minutes === undefined && goal === undefined) {
        return fail("provide at least one of 'weeklyGoalHours', 'logFocusMinutes' or 'goal'.");
      }

      const st = useStore.getState();
      const applied: string[] = [];
      if (hours !== undefined) { st.setWeeklyGoalHours(hours); applied.push(`weekly goal set to ${hours}h`); }
      if (minutes !== undefined) { st.recordFocusTime(minutes * 60); applied.push(`logged ${minutes} min of focus time`); }
      if (goal !== undefined) { st.setGoal(goal); applied.push("session goal updated"); }
      return {
        summary: `Updated study stats (${applied.length} change${applied.length === 1 ? "" : "s"})`,
        observation: `Applied: ${applied.join("; ")}.${notes.length ? ` Note: ${notes.join("; ")}.` : ""}\nNew stats:\n${studyStatsText()}`,
      };
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
    name: "whats_new",
    description: "Get the app version and a summary of what's new / recent features in Hades. Use when the user asks 'what's new', 'what can you do', or about recent updates.",
    args: `{}`,
    run: async () => {
      let version = "";
      try { version = await getVersion(); } catch { /* not in Tauri */ }
      const s = useStore.getState();
      const updateLine = s.updateAvailable && s.updateVersion
        ? `\n\nAn update to v${s.updateVersion} is available — the user can install it from Settings.`
        : "";
      return {
        summary: "Read what's new",
        observation: `${version ? `Current version: v${version}.\n\n` : ""}${WHATS_NEW}${updateLine}`,
      };
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
- Only state facts that literally appear in a tool Observation (or in the "Currently open in Hades" material). Do NOT invent note titles, note content, quotes, or details.
- You have NO information about folders or where a note is stored. NEVER say a note is "in" a folder or describe any folder structure — that data is not available to you.
- To describe or summarize a note's content you MUST first obtain it via read_note (or see it in a search_notes Observation). Summarize ONLY that returned text — do not add anything that isn't there.
- If read_note / search_notes / list_notes show the note isn't there (or return no match), tell the user plainly that you couldn't find it and, if helpful, list the real titles that exist. Do NOT fabricate its contents.
- If you haven't called a tool yet, you do not know what notes exist — call list_notes or read_note before making any claim about them. The one exception is the "Currently open in Hades" material that may be shared further down this prompt: that text is real and may be used.

Guidelines:
- To summarize or answer questions about a SPECIFIC note the user names (e.g. "summarise my note X"), call read_note with that title — it returns the full note text. If unsure of the exact title, call list_notes first, then read_note.
- For broader "what do my notes say about …" questions, use search_notes. For questions about one particular PDF, use search_pdf with its title.
- When asked to create study material (e.g. "make flashcards from X"), read/search the source first, then create_flashcards.
- When the user gives a big goal ("prepare for the bio midterm"), break it into concrete steps and create them in ONE create_tasks call, with realistic due dates.
- When asked to plan their day or week, call read_schedule FIRST, then propose time blocks via add_calendar_event around existing events, respecting due dates and the weekly focus goal. Don't double-book.
- To see what is scheduled or due in a specific range ("next week", "before Friday", "on the 20th"), call query_schedule with from/to. read_schedule is the quick 14-day overview to call before planning.
- When the user says "this note", "my open note" or "the note I'm on", call read_open_note with no args (it reads the active note); list_open_notes shows every open tab. Never guess which note is open.
- When the user says "this PDF", "this page" or "this slide", call read_open_pdf (add {"page": N} for a specific page). It returns the page they are on first. For other library PDFs, use search_pdf.
- For questions about progress or goals, call get_study_stats. Call update_study_stats ONLY when the user asks to change their weekly goal, log focus time they already did, or set the session goal.
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
