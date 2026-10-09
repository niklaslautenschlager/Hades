import { exists, mkdir, readDir, readTextFile, remove, rename, writeTextFile } from "@tauri-apps/plugin-fs";
import { useStore } from "../store/useStore";
import type { CalendarEvent, FocusSession, NoteFile, Task } from "../store/useStore";
import { getActiveNote, getOpenNotes, getOpenPdfText } from "./openDocs";
import type { OpenPdfText } from "./openDocs";
import { needsCycleReset } from "./pomodoroCycle";

// Opt-in bridge to the external Hades MCP server (mcp/). Everything lives in
// <sync folder>/.hades-bridge/ — the dot prefix keeps the note-sync engine and
// the MCP notes store from treating it as notes:
//   state.json        snapshot written here, read by the MCP server
//   inbox/<id>.json   commands written by the MCP server, applied here
//   acks/<id>.json    results written here, read (and deleted) by the MCP server

export const BRIDGE_DIR = ".hades-bridge";
export const SNAPSHOT_SCHEMA = 1;

const DAY_MS = 86_400_000;
const WINDOW_PAST_MS = 7 * DAY_MS;
const WINDOW_FUTURE_MS = 60 * DAY_MS;
export const MAX_EVENTS = 300;
export const MAX_TASKS = 300;
export const MAX_NOTES = 20;
export const NOTE_CHARS = 20_000;
export const PDF_CHARS = 40_000;

const DEBOUNCE_MS = 2_000;
const MAX_WAIT_MS = 10_000;
const HEARTBEAT_MS = 15_000;
// An unchanged snapshot is rewritten at most this often: it only has to beat
// the MCP side's 2-minute staleness limit, and every rewrite is uploaded by
// the user's cloud provider.
const MIN_REFRESH_MS = 45_000;
const INBOX_POLL_MS = 5_000;
const ACK_PRUNE_MS = 60_000;
const ACK_TTL_MS = 10 * 60_000;
const PDF_WAIT_MS = 3_000;
const IO_TIMEOUT_MS = 15_000;

export const MAX_COMMAND_CHARS = 4_096;
const MAX_COMMANDS_PER_POLL = 10;
const MAX_ACKS_PER_PRUNE = 100;
const MAX_COMMAND_TTL_MS = 10 * 60_000;
const APPLIED_IDS_KEPT = 500;
const COMMAND_ID = /^[a-zA-Z0-9_-]{1,128}$/;
const COMMAND_FILE = /^([a-zA-Z0-9_-]{1,128})\.json$/;

// ── Snapshot ────────────────────────────────────────────────────────────────

export interface StudyStats {
  weeklyGoalHours: number;
  hoursThisWeek: number;
  todayFocusSeconds: number;
  pomodoroCycle: { completedInCycle: number; cycleLength: number; sessionsToday: number };
  goal: string;
}

export interface WorkspaceSnapshot {
  schema: typeof SNAPSHOT_SCHEMA;
  generatedAt: string;
  timezone: string;
  utcOffset: string;
  schedule: {
    window: { from: string; to: string };
    events: {
      id: string;
      title: string;
      start: string;
      end: string;
      startLocal: string;
      endLocal: string;
      isDeadline: boolean;
      source: "local" | "ical";
    }[];
    eventsTruncated: boolean;
    tasks: {
      id: string;
      text: string;
      completed: boolean;
      dueDate: string | null;
      dueLocal: string | null;
    }[];
    tasksTruncated: boolean;
  };
  notes: {
    items: {
      id: string;
      name: string;
      active: boolean;
      updatedAt: string;
      content: string;
      contentLength: number;
      truncated: boolean;
    }[];
    omitted: number;
  };
  pdf: OpenPdfText | null;
  stats: StudyStats;
}

export interface SnapshotInput {
  now: number;
  timeZone: string;
  events: CalendarEvent[];
  tasks: Task[];
  openNotes: NoteFile[];
  activeNoteId: string | null;
  pdf: OpenPdfText | null;
  focusSessions: FocusSession[];
  weeklyGoalHours: number;
  sessionsCompleted: number;
  lastSessionDate: string | null;
  sessionsUntilLongBreak: number;
  goal: string;
}

function validZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    return "UTC";
  }
}

function wallClock(ms: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    weekday: get("weekday"),
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour") === "24" ? "00" : get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

export function formatLocal(ms: number, timeZone: string): string {
  const w = wallClock(ms, timeZone);
  return `${w.weekday} ${w.year}-${w.month}-${w.day} ${w.hour}:${w.minute}`;
}

export function utcOffsetLabel(ms: number, timeZone: string): string {
  const w = wallClock(ms, timeZone);
  const asUtc = Date.UTC(+w.year, +w.month - 1, +w.day, +w.hour, +w.minute, +w.second);
  const minutes = Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60_000);
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

function clip(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  let end = max;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return { text: text.slice(0, end), truncated: true };
}

function finite(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

// These day keys must match the store's recordFocusTime and the Statistics
// screen (UTC date string, Monday-based week) or the shared numbers disagree
// with what the user sees in Hades.
function focusDayKey(d: Date): string {
  return d.toISOString().split("T")[0];
}

function focusWeekStartKey(now: number): string {
  const d = new Date(now);
  const day = d.getDay();
  d.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
  return focusDayKey(d);
}

export function buildStudyStats(
  input: Pick<
    SnapshotInput,
    "focusSessions" | "weeklyGoalHours" | "sessionsCompleted" | "lastSessionDate" | "sessionsUntilLongBreak" | "goal"
  >,
  now: number
): StudyStats {
  const sessions = Array.isArray(input.focusSessions) ? input.focusSessions : [];
  const today = focusDayKey(new Date(now));
  const weekStart = focusWeekStartKey(now);
  let weekSeconds = 0;
  let todaySeconds = 0;
  for (const f of sessions) {
    if (!f || typeof f.date !== "string") continue;
    const duration = Math.max(0, finite(f.duration));
    if (f.date >= weekStart) weekSeconds += duration;
    if (f.date === today) todaySeconds += duration;
  }
  const length =
    Number.isInteger(input.sessionsUntilLongBreak) && input.sessionsUntilLongBreak > 0 ? input.sessionsUntilLongBreak : 4;
  const done = needsCycleReset(input.lastSessionDate ?? null, input.sessionsCompleted, new Date(now))
    ? 0
    : input.sessionsCompleted;
  return {
    weeklyGoalHours: Math.min(10_000, Math.max(0, finite(input.weeklyGoalHours))),
    hoursThisWeek: Math.round((weekSeconds / 3600) * 100) / 100,
    todayFocusSeconds: Math.round(todaySeconds),
    pomodoroCycle: { completedInCycle: done % length, cycleLength: length, sessionsToday: done },
    goal: clip(typeof input.goal === "string" ? input.goal : "", 1_000).text,
  };
}

export function buildWorkspaceSnapshot(input: SnapshotInput): WorkspaceSnapshot {
  const { now } = input;
  const timeZone = validZone(input.timeZone);
  const from = now - WINDOW_PAST_MS;
  const to = now + WINDOW_FUTURE_MS;

  const inWindow = (input.events ?? []).flatMap((e) => {
    if (!e || typeof e.start !== "string") return [];
    const start = Date.parse(e.start);
    if (Number.isNaN(start)) return [];
    const parsedEnd = Date.parse(e.end);
    const end = Number.isNaN(parsedEnd) ? start : parsedEnd;
    if (end < from || start > to) return [];
    return [{ e, start, end }];
  });
  inWindow.sort((a, b) => a.start - b.start);
  // When over the cap, drop the past before the future: upcoming events are what the agent asks about.
  const upcoming = inWindow.filter((x) => x.end >= now);
  const past = inWindow.filter((x) => x.end < now);
  const keptEvents = [...past.slice(Math.max(0, past.length - Math.max(0, MAX_EVENTS - upcoming.length))), ...upcoming.slice(0, MAX_EVENTS)];

  const dueFirst = (a: { due: number | null }, b: { due: number | null }) => {
    if (a.due === b.due) return 0;
    if (a.due === null) return 1;
    if (b.due === null) return -1;
    return a.due - b.due;
  };
  const allTasks = (input.tasks ?? [])
    .filter((t) => t && typeof t === "object")
    .map((t) => {
      const due = t.dueDate ? Date.parse(t.dueDate) : NaN;
      return { t, due: Number.isNaN(due) ? null : due, done: !!t.completed };
    });
  const openTasks = allTasks.filter((x) => !x.done).sort(dueFirst);
  // A completed task can only match a dated query window, so only those inside the shared window are worth sending.
  const doneTasks = allTasks.filter((x) => x.done && x.due !== null && x.due >= from && x.due <= to).sort(dueFirst);
  const keptTasks = [
    ...openTasks.slice(0, MAX_TASKS),
    ...doneTasks.slice(0, Math.max(0, MAX_TASKS - openTasks.length)),
  ].sort(dueFirst);

  const openNotes = (input.openNotes ?? []).filter((n) => n && !n.isFolder);
  let notes = openNotes;
  if (notes.length > MAX_NOTES) {
    const active = notes.find((n) => n.id === input.activeNoteId);
    const rest = notes.filter((n) => n !== active);
    const kept = new Set(active ? [active, ...rest.slice(0, MAX_NOTES - 1)] : rest.slice(0, MAX_NOTES));
    notes = notes.filter((n) => kept.has(n));
  }

  const pageNumber = (n: unknown) => (typeof n === "number" && Number.isInteger(n) && n >= 1 ? n : null);
  const pdfText = clip(input.pdf?.text ?? "", PDF_CHARS);
  const pdf = input.pdf
    ? {
        title: clip(String(input.pdf.title ?? ""), 500).text,
        docId: input.pdf.docId ? clip(String(input.pdf.docId), 200).text : null,
        currentPage: pageNumber(input.pdf.currentPage),
        pageCount: pageNumber(input.pdf.pageCount),
        text: pdfText.text,
        truncated: !!input.pdf.truncated || pdfText.truncated,
      }
    : null;

  return {
    schema: SNAPSHOT_SCHEMA,
    generatedAt: new Date(now).toISOString(),
    timezone: timeZone,
    utcOffset: utcOffsetLabel(now, timeZone),
    schedule: {
      window: { from: new Date(from).toISOString(), to: new Date(to).toISOString() },
      events: keptEvents.map(({ e, start, end }) => ({
        id: clip(String(e.id), 200).text,
        title: clip(String(e.title ?? ""), 300).text,
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
        startLocal: formatLocal(start, timeZone),
        endLocal: formatLocal(end, timeZone),
        isDeadline: !!e.isDeadline,
        source: e.source === "ical" ? "ical" : "local",
      })),
      eventsTruncated: inWindow.length > keptEvents.length,
      tasks: keptTasks.map(({ t, due, done }) => ({
        id: clip(String(t.id), 200).text,
        text: clip(String(t.text ?? ""), 500).text,
        completed: done,
        dueDate: due === null ? null : new Date(due).toISOString(),
        dueLocal: due === null ? null : formatLocal(due, timeZone),
      })),
      tasksTruncated: openTasks.length + doneTasks.length > keptTasks.length,
    },
    notes: {
      items: notes.map((n) => {
        const body = clip(String(n.content ?? ""), NOTE_CHARS);
        return {
          id: clip(String(n.id), 200).text,
          name: clip(String(n.name ?? ""), 200).text,
          active: n.id === input.activeNoteId,
          updatedAt: String(n.updatedAt ?? ""),
          content: body.text,
          contentLength: String(n.content ?? "").length,
          truncated: body.truncated,
        };
      }),
      omitted: openNotes.length - notes.length,
    },
    pdf,
    stats: buildStudyStats(input, now),
  };
}

// ── Commands (written by the MCP server) ────────────────────────────────────

export type CommandErrorCode = "INVALID_COMMAND" | "EXPIRED" | "NO_CHANGES" | "UNSUPPORTED_COMMAND" | "INTERNAL";

export interface StudyStatsUpdate {
  weeklyGoalHours?: number;
  logFocusMinutes?: number;
  goal?: string;
}

export type CommandVerdict = { ok: true; args: StudyStatsUpdate } | { ok: false; code: CommandErrorCode };

const COMMAND_KEYS = new Set(["v", "id", "type", "createdAt", "expiresAt", "args"]);
const ARG_KEYS = new Set(["weeklyGoalHours", "logFocusMinutes", "goal"]);

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The command file is untrusted input from a synced folder: only this whitelist and these clamps are applied. */
export function validateCommand(text: string, expectedId: string, now: number): CommandVerdict {
  if (text.length > MAX_COMMAND_CHARS) return { ok: false, code: "INVALID_COMMAND" };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, code: "INVALID_COMMAND" };
  }
  if (!isPlainObject(json)) return { ok: false, code: "INVALID_COMMAND" };
  if (Object.keys(json).some((k) => !COMMAND_KEYS.has(k))) return { ok: false, code: "INVALID_COMMAND" };
  if (json.v !== 1 || json.id !== expectedId || typeof json.type !== "string" || typeof json.expiresAt !== "string") {
    return { ok: false, code: "INVALID_COMMAND" };
  }
  const expires = Date.parse(json.expiresAt);
  if (Number.isNaN(expires) || expires - now > MAX_COMMAND_TTL_MS) return { ok: false, code: "INVALID_COMMAND" };
  if (json.type !== "update_study_stats") return { ok: false, code: "UNSUPPORTED_COMMAND" };
  if (expires < now) return { ok: false, code: "EXPIRED" };

  const raw = json.args;
  if (!isPlainObject(raw) || Object.keys(raw).some((k) => !ARG_KEYS.has(k))) return { ok: false, code: "INVALID_COMMAND" };

  const args: StudyStatsUpdate = {};
  if (raw.weeklyGoalHours !== undefined) {
    if (typeof raw.weeklyGoalHours !== "number" || !Number.isFinite(raw.weeklyGoalHours)) return { ok: false, code: "INVALID_COMMAND" };
    args.weeklyGoalHours = Math.round(clamp(raw.weeklyGoalHours, 1, 100) * 10) / 10;
  }
  if (raw.logFocusMinutes !== undefined) {
    if (typeof raw.logFocusMinutes !== "number" || !Number.isFinite(raw.logFocusMinutes)) return { ok: false, code: "INVALID_COMMAND" };
    args.logFocusMinutes = Math.round(clamp(raw.logFocusMinutes, 1, 480));
  }
  if (raw.goal !== undefined) {
    if (typeof raw.goal !== "string") return { ok: false, code: "INVALID_COMMAND" };
    const goal = clip(raw.goal.replace(/\s+/g, " ").trim(), 200).text;
    if (!goal) return { ok: false, code: "INVALID_COMMAND" };
    args.goal = goal;
  }
  if (Object.keys(args).length === 0) return { ok: false, code: "NO_CHANGES" };
  return { ok: true, args };
}

export function applyStudyStatsUpdate(args: StudyStatsUpdate): void {
  const s = useStore.getState();
  if (args.weeklyGoalHours !== undefined) s.setWeeklyGoalHours(args.weeklyGoalHours);
  if (args.logFocusMinutes !== undefined) s.recordFocusTime(args.logFocusMinutes * 60);
  if (args.goal !== undefined) s.setGoal(args.goal);
}

// ── Status (observable, for the Settings screen) ────────────────────────────

export interface BridgeStatus {
  state: "off" | "no-folder" | "active" | "error";
  error: string | null;
  lastWriteAt: string | null;
}

const OFF: BridgeStatus = { state: "off", error: null, lastWriteAt: null };
let status: BridgeStatus = OFF;
const listeners = new Set<() => void>();

export function getBridgeStatus(): BridgeStatus {
  return status;
}

export function subscribeBridgeStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function setStatus(next: BridgeStatus) {
  if (next.state === status.state && next.error === status.error && next.lastWriteAt === status.lastWriteAt) return;
  status = next;
  listeners.forEach((l) => l());
}

function errorText(e: unknown): string {
  const raw = e instanceof Error ? e.message : typeof e === "string" ? e : "unknown error";
  return clip(raw.replace(/\s+/g, " ").trim(), 160).text || "unknown error";
}

function guard<T>(promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("file operation timed out")), IO_TIMEOUT_MS);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

// ── Engine ──────────────────────────────────────────────────────────────────

type OpKind = "snapshot" | "inbox" | "prune";

interface Run {
  markDirty: () => void;
  stop: (removeSnapshot: boolean) => void;
}

function currentZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function normalizeFolder(folder: unknown): string | null {
  if (typeof folder !== "string") return null;
  const trimmed = folder.trim().replace(/[\\/]+$/, "");
  return trimmed || null;
}

type StoreState = ReturnType<typeof useStore.getState>;

function relevantSlices(s: StoreState): unknown[] {
  return [
    s.calendarEvents, s.tasks, s.notes, s.openNoteIds, s.activeNoteId, s.focusSessions,
    s.weeklyGoalHours, s.sessionsCompleted, s.lastSessionDate, s.sessionsUntilLongBreak, s.goal,
    s.notePdfUrl, s.notePdfDocId, s.notePdfFileName, s.pdfPages, s.libraryDocs,
  ];
}

// Operations run one at a time per lane, shared by every run so that deleting an
// old run's snapshot is always ordered before the next run's first write. Commands
// get their own lane so a slow PDF extraction cannot delay an acknowledgement.
let snapshotTail: Promise<void> = Promise.resolve();
let commandTail: Promise<void> = Promise.resolve();

function startRun(folder: string): Run {
  const dir = `${folder}/${BRIDGE_DIR}`;
  const stateFile = `${dir}/state.json`;
  const inboxDir = `${dir}/inbox`;
  const acksDir = `${dir}/acks`;
  const timeZone = currentZone();

  let stopped = false;
  let dirsReady = false;
  let lastSignature = "";
  let lastWriteAt = 0;
  let dirtySince = 0;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  const errors = new Map<OpKind, string>();
  const pending = new Set<OpKind>();
  const handled: string[] = [];

  const publish = (writtenAt?: string) => {
    if (stopped) return;
    const first = errors.values().next();
    setStatus({
      state: first.done ? "active" : "error",
      error: first.done ? null : first.value,
      lastWriteAt: writtenAt ?? status.lastWriteAt,
    });
  };

  const remember = (id: string) => {
    handled.push(id);
    if (handled.length > APPLIED_IDS_KEPT) handled.shift();
  };

  const ensureDirs = async () => {
    if (dirsReady) return;
    await guard(mkdir(inboxDir, { recursive: true }));
    await guard(mkdir(acksDir, { recursive: true }));
    dirsReady = true;
  };

  // The temp file sits next to the target so rename stays on one volume; a
  // failed write or rename therefore leaves the previous file untouched. Its name
  // must not start with a dot: on macOS/Linux the fs scope never matches hidden
  // path components with a wildcard.
  const writeAtomic = async (target: string, tempName: string, data: string) => {
    const temp = `${dir}/${tempName}`;
    try {
      await guard(writeTextFile(temp, data));
      await guard(rename(temp, target));
    } catch (e) {
      await guard(remove(temp)).catch(() => undefined);
      throw e;
    }
  };

  const snapshotOp = async () => {
    if (stopped) return;
    const now = Date.now();
    let pdf: OpenPdfText | null = null;
    try {
      pdf = await getOpenPdfText({ maxChars: PDF_CHARS, timeoutMs: PDF_WAIT_MS });
    } catch {
      pdf = null;
    }
    if (stopped) return;
    const s = useStore.getState();
    const snapshot = buildWorkspaceSnapshot({
      now,
      timeZone,
      events: s.calendarEvents,
      tasks: s.tasks,
      openNotes: getOpenNotes(),
      activeNoteId: getActiveNote()?.id ?? null,
      pdf,
      focusSessions: s.focusSessions,
      weeklyGoalHours: s.weeklyGoalHours,
      sessionsCompleted: s.sessionsCompleted,
      lastSessionDate: s.lastSessionDate,
      sessionsUntilLongBreak: s.sessionsUntilLongBreak,
      goal: s.goal,
    });
    // The window slides with the clock; ignoring it keeps an idle workspace from rewriting every heartbeat.
    const signature = JSON.stringify({ ...snapshot, generatedAt: "", schedule: { ...snapshot.schedule, window: null } });
    if (signature === lastSignature && now - lastWriteAt < MIN_REFRESH_MS) return;
    await ensureDirs();
    await writeAtomic(stateFile, "state.json.tmp", JSON.stringify(snapshot));
    lastSignature = signature;
    lastWriteAt = now;
    errors.delete("snapshot");
    publish(snapshot.generatedAt);
  };

  const ackText = (id: string, body: Record<string, unknown>) =>
    JSON.stringify({ v: 1, id, at: new Date().toISOString(), ...body });

  const handleCommand = async (id: string) => {
    const file = `${inboxDir}/${id}.json`;
    const drop = () => guard(remove(file)).catch(() => undefined);
    if (handled.includes(id) || (await guard(exists(`${acksDir}/${id}.json`)))) {
      remember(id);
      await drop();
      return;
    }
    let text: string;
    try {
      text = await guard(readTextFile(file));
    } catch {
      return;
    }
    const verdict = validateCommand(text, id, Date.now());
    let body: Record<string, unknown>;
    if (verdict.ok) {
      try {
        applyStudyStatsUpdate(verdict.args);
        const s = useStore.getState();
        body = { ok: true, applied: verdict.args, stats: buildStudyStats(s, Date.now()) };
      } catch {
        body = { ok: false, error: { code: "INTERNAL" } };
      }
    } else {
      body = { ok: false, error: { code: verdict.code } };
    }
    remember(id);
    try {
      await writeAtomic(`${acksDir}/${id}.json`, `ack-${id}.tmp`, ackText(id, body));
    } finally {
      await drop();
    }
  };

  const inboxOp = async () => {
    if (stopped) return;
    await ensureDirs();
    const entries = await guard(readDir(inboxDir));
    const ids = entries
      .filter((e) => e.isFile)
      .map((e) => COMMAND_FILE.exec(e.name)?.[1])
      .filter((id): id is string => !!id && COMMAND_ID.test(id))
      .slice(0, MAX_COMMANDS_PER_POLL);
    for (const id of ids) {
      if (stopped) return;
      await handleCommand(id);
    }
    errors.delete("inbox");
    publish();
  };

  const pruneOp = async () => {
    if (stopped) return;
    await ensureDirs();
    const entries = await guard(readDir(acksDir));
    const names = entries.filter((e) => e.isFile && COMMAND_FILE.test(e.name)).slice(0, MAX_ACKS_PER_PRUNE);
    for (const entry of names) {
      const file = `${acksDir}/${entry.name}`;
      let expired = true;
      try {
        const at = Date.parse((JSON.parse(await guard(readTextFile(file))) as { at?: unknown }).at as string);
        expired = Number.isNaN(at) || Date.now() - at > ACK_TTL_MS;
      } catch {
        expired = true;
      }
      if (expired) await guard(remove(file)).catch(() => undefined);
    }
    errors.delete("prune");
    publish();
  };

  let snapshotRerun = false;

  const schedule = (kind: OpKind, op: () => Promise<void>) => {
    if (stopped) return;
    if (pending.has(kind)) {
      // A change that lands while a snapshot is being built must not wait for the next heartbeat.
      if (kind === "snapshot") snapshotRerun = true;
      return;
    }
    pending.add(kind);
    const lane = (kind === "snapshot" ? snapshotTail : commandTail)
      .then(op)
      .catch((e) => {
        dirsReady = false;
        errors.set(kind, errorText(e));
        publish();
      })
      .finally(() => {
        pending.delete(kind);
        if (kind === "snapshot" && snapshotRerun) {
          snapshotRerun = false;
          schedule("snapshot", op);
        }
      });
    if (kind === "snapshot") snapshotTail = lane;
    else commandTail = lane;
  };

  const flushDirty = () => {
    debounce = null;
    dirtySince = 0;
    schedule("snapshot", snapshotOp);
  };

  const timers = [
    setInterval(() => schedule("snapshot", snapshotOp), HEARTBEAT_MS),
    setInterval(() => schedule("inbox", inboxOp), INBOX_POLL_MS),
    setInterval(() => schedule("prune", pruneOp), ACK_PRUNE_MS),
  ];
  schedule("snapshot", snapshotOp);
  schedule("inbox", inboxOp);
  schedule("prune", pruneOp);

  return {
    markDirty() {
      if (stopped) return;
      const now = Date.now();
      if (!dirtySince) dirtySince = now;
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(flushDirty, Math.min(DEBOUNCE_MS, Math.max(0, dirtySince + MAX_WAIT_MS - now)));
    },
    stop(removeSnapshot) {
      stopped = true;
      timers.forEach((timer) => clearInterval(timer));
      if (debounce) clearTimeout(debounce);
      if (removeSnapshot) {
        // Queued behind any write in flight so a late rename cannot resurrect the file.
        snapshotTail = snapshotTail.then(() => guard(remove(stateFile))).catch(() => undefined);
      }
    },
  };
}

let started: (() => void) | null = null;

export function startWorkspaceBridge(): () => void {
  if (started) return started;

  let run: Run | null = null;
  let runFolder: string | null = null;

  const reconcile = (state: StoreState) => {
    const wanted = state.mcpBridgeEnabled === true;
    const folder = wanted ? normalizeFolder(state.syncFolder) : null;
    if (folder !== runFolder) {
      run?.stop(true);
      run = null;
      runFolder = folder;
      if (folder) {
        setStatus({ state: "active", error: null, lastWriteAt: null });
        run = startRun(folder);
      }
    }
    if (!run) setStatus(wanted ? { state: "no-folder", error: null, lastWriteAt: null } : OFF);
  };

  let previous = relevantSlices(useStore.getState());
  const unsubscribe = useStore.subscribe((state) => {
    reconcile(state);
    const next = relevantSlices(state);
    const changed = next.some((value, i) => value !== previous[i]);
    previous = next;
    if (changed) run?.markDirty();
  });
  reconcile(useStore.getState());

  const stop = () => {
    unsubscribe();
    run?.stop(false);
    run = null;
    runFolder = null;
    setStatus(OFF);
    started = null;
  };
  started = stop;
  return stop;
}
