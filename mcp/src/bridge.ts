import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, mkdir, open, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import * as z from "zod/v4";

export const BRIDGE_DIR_NAME = ".hades-bridge";
export const STALE_AFTER_MS = 2 * 60_000;
export const COMMAND_TTL_MS = 2 * 60_000;
export const DEFAULT_ACK_TIMEOUT_MS = 10_000;
export const DEFAULT_PDF_MAX_CHARS = 6_000;

const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;
const MAX_ACK_BYTES = 64 * 1024;
const ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;
// O_NOFOLLOW is undefined on Windows, where the lstat checks alone guard against links.
const NOFOLLOW = fsConstants.O_NOFOLLOW ?? 0;

export type BridgeErrorCode =
  | "BRIDGE_NOT_RUNNING"
  | "BRIDGE_UNSAFE_PATH"
  | "BRIDGE_SNAPSHOT_INVALID"
  | "BRIDGE_TIMEOUT"
  | "BRIDGE_REJECTED"
  | "INVALID_ARGUMENT"
  | "NOTE_NOT_FOUND"
  | "NO_ACTIVE_NOTE"
  | "NO_OPEN_PDF"
  | "PAGE_NOT_AVAILABLE";

/** Errors whose message is safe to show to the model: never contains a filesystem path. */
export class BridgeError extends Error {
  constructor(readonly code: BridgeErrorCode, message: string) {
    super(message);
    this.name = "BridgeError";
  }
}

// ── Snapshot schema (written by the Hades app, validated here) ───────────────

const str = (max: number) => z.string().max(max);
const isoDate = z.string().max(40).refine((value) => !Number.isNaN(Date.parse(value)), "Invalid date.");
const count = z.number().int().min(0).max(1_000_000_000);

const eventSchema = z.object({
  id: str(200),
  title: str(1_000),
  start: isoDate,
  end: isoDate,
  startLocal: str(64),
  endLocal: str(64),
  isDeadline: z.boolean(),
  source: z.enum(["local", "ical"]),
});

const taskSchema = z.object({
  id: str(200),
  text: str(2_000),
  completed: z.boolean(),
  dueDate: isoDate.nullable(),
  dueLocal: str(64).nullable(),
});

const noteSchema = z.object({
  id: str(200),
  name: str(500),
  active: z.boolean(),
  updatedAt: str(64),
  content: str(200_000),
  contentLength: count,
  truncated: z.boolean(),
});

const pdfSchema = z.object({
  title: str(500),
  docId: str(200).nullable(),
  currentPage: z.number().int().min(1).max(1_000_000).nullable(),
  pageCount: z.number().int().min(1).max(1_000_000).nullable(),
  text: str(400_000),
  truncated: z.boolean(),
});

const statsSchema = z.object({
  weeklyGoalHours: z.number().min(0).max(10_000),
  hoursThisWeek: z.number().min(0).max(1_000_000),
  todayFocusSeconds: z.number().min(0).max(1_000_000_000),
  pomodoroCycle: z.object({
    completedInCycle: count,
    cycleLength: count,
    sessionsToday: count,
  }),
  goal: str(1_000),
});

export const snapshotSchema = z.object({
  schema: z.literal(1),
  generatedAt: isoDate,
  timezone: str(100),
  utcOffset: str(16),
  schedule: z.object({
    window: z.object({ from: isoDate, to: isoDate }),
    events: z.array(eventSchema).max(2_000),
    eventsTruncated: z.boolean(),
    tasks: z.array(taskSchema).max(2_000),
    tasksTruncated: z.boolean(),
  }),
  notes: z.object({ items: z.array(noteSchema).max(200), omitted: count }),
  pdf: pdfSchema.nullable(),
  stats: statsSchema,
});

export type BridgeSnapshot = z.infer<typeof snapshotSchema>;
export type BridgeStats = z.infer<typeof statsSchema>;
type BridgeEvent = z.infer<typeof eventSchema>;
type BridgeTask = z.infer<typeof taskSchema>;

export interface SnapshotView {
  snapshot: BridgeSnapshot;
  ageSeconds: number;
  stale: boolean;
}

const ackSchema = z.discriminatedUnion("ok", [
  z.object({
    v: z.literal(1),
    id: z.string().regex(ID_PATTERN),
    ok: z.literal(true),
    at: isoDate,
    applied: z.object({
      weeklyGoalHours: z.number().optional(),
      logFocusMinutes: z.number().optional(),
      goal: str(200).optional(),
    }),
    stats: statsSchema,
  }),
  z.object({
    v: z.literal(1),
    id: z.string().regex(ID_PATTERN),
    ok: z.literal(false),
    at: isoDate,
    error: z.object({ code: str(40), message: str(500).optional() }),
  }),
]);

export interface StudyStatsUpdate {
  weeklyGoalHours?: number;
  logFocusMinutes?: number;
  goal?: string;
}

export interface StudyStatsUpdateResult {
  applied: { weeklyGoalHours?: number; logFocusMinutes?: number; goal?: string };
  stats: BridgeStats;
}

// ── Safe filesystem helpers ──────────────────────────────────────────────────

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : undefined;
}

async function lstatOrNull(target: string) {
  try { return await lstat(target); }
  catch (error) {
    if (errorCode(error) === "ENOENT" || errorCode(error) === "ENOTDIR") return null;
    throw error;
  }
}

const unsafePath = () => new BridgeError("BRIDGE_UNSAFE_PATH", "The Hades bridge folder is not a plain directory (symbolic links are not followed).");

/** Returns false when the directory does not exist; throws when it is a link or a file. */
async function requireDirectory(target: string): Promise<boolean> {
  const stats = await lstatOrNull(target);
  if (!stats) return false;
  if (stats.isSymbolicLink() || !stats.isDirectory()) throw unsafePath();
  return true;
}

async function readRegularFile(target: string, maxBytes: number): Promise<string | null> {
  const stats = await lstatOrNull(target);
  if (!stats) return null;
  if (!stats.isFile()) throw unsafePath();
  if (stats.size > maxBytes) throw new BridgeError("BRIDGE_SNAPSHOT_INVALID", "A Hades bridge file is larger than allowed.");
  let handle;
  try { handle = await open(target, fsConstants.O_RDONLY | NOFOLLOW); }
  catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    if (errorCode(error) === "ELOOP") throw unsafePath();
    throw error;
  }
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size > maxBytes) throw unsafePath();
    const buffer = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    return buffer.subarray(0, offset).toString("utf8");
  } finally { await handle.close(); }
}

async function writeFileAtomic(directory: string, name: string, data: string): Promise<void> {
  const temp = path.join(directory, `.${name}.${randomUUID()}.tmp`);
  try {
    await writeFile(temp, data, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await rename(temp, path.join(directory, name));
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
}

export function bridgeFilePath(directory: string, id: string): string {
  if (!ID_PATTERN.test(id)) throw new BridgeError("INVALID_ARGUMENT", "Invalid Hades bridge id.");
  const target = path.join(directory, `${id}.json`);
  if (path.dirname(target) !== path.normalize(directory).replace(/[\\/]+$/, "")) throw unsafePath();
  return target;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Time handling (arguments are interpreted in the Hades user's timezone) ───

function safeTimeZone(timeZone: string): string {
  try { new Intl.DateTimeFormat("en-US", { timeZone }); return timeZone; }
  catch { return "UTC"; }
}

function timeZoneOffsetMs(timeZone: string, atMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(atMs));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return asUtc - Math.floor(atMs / 1000) * 1000;
}

function zonedWallClockToMs(timeZone: string, y: number, mo: number, d: number, h: number, mi: number, s: number): number {
  const wall = Date.UTC(y, mo - 1, d, h, mi, s);
  const first = wall - timeZoneOffsetMs(timeZone, wall);
  return wall - timeZoneOffsetMs(timeZone, first);
}

const WHEN_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?)?(Z|[+-]\d{2}:?\d{2})?$/i;

export function isValidWhen(input: string): boolean {
  const match = WHEN_PATTERN.exec(input.trim());
  if (!match) return false;
  const [, y, mo, d, h = "0", mi = "0", s = "0"] = match;
  if (Number(h) > 23 || Number(mi) > 59 || Number(s) > 59) return false;
  const day = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  return day.getUTCMonth() === Number(mo) - 1 && day.getUTCDate() === Number(d);
}

/** Date-only `to` values cover the whole day; values without an offset use `timeZone`. */
export function parseWhen(input: string, timeZone: string, edge: "start" | "end"): number {
  const text = input.trim();
  const match = WHEN_PATTERN.exec(text);
  if (!match || !isValidWhen(text)) throw new BridgeError("INVALID_ARGUMENT", `'${text.slice(0, 40)}' is not an ISO-8601 date or datetime.`);
  const [, y, mo, d, h, mi, s, offset] = match;
  const dateOnly = h === undefined;
  if (offset) {
    const normalised = offset.toUpperCase() === "Z" || offset.includes(":") ? offset.toUpperCase() : `${offset.slice(0, 3)}:${offset.slice(3)}`;
    const ms = Date.parse(`${y}-${mo}-${d}T${h ?? "00"}:${mi ?? "00"}:${s ?? "00"}${normalised}`);
    if (Number.isNaN(ms)) throw new BridgeError("INVALID_ARGUMENT", `'${text.slice(0, 40)}' is not a valid date.`);
    return dateOnly && edge === "end" ? ms + 86_400_000 - 1 : ms;
  }
  const zone = safeTimeZone(timeZone);
  const dayStart = (day: number) => zonedWallClockToMs(zone, Number(y), Number(mo), day, 0, 0, 0);
  if (dateOnly) return edge === "start" ? dayStart(Number(d)) : dayStart(Number(d) + 1) - 1;
  return zonedWallClockToMs(zone, Number(y), Number(mo), Number(d), Number(h), Number(mi), Number(s ?? 0));
}

// ── Pure query builders ──────────────────────────────────────────────────────

export function bridgeMeta(view: SnapshotView) {
  const meta: { generatedAt: string; ageSeconds: number; stale: boolean; warning?: string } = {
    generatedAt: view.snapshot.generatedAt,
    ageSeconds: view.ageSeconds,
    stale: view.stale,
  };
  if (view.stale) meta.warning = "This data is more than 2 minutes old. Hades may be closed or the bridge paused; treat it as possibly outdated.";
  return meta;
}

export interface ScheduleQuery {
  from?: string;
  to?: string;
  include?: ("events" | "tasks")[];
  limit: number;
}

export function buildSchedule(view: SnapshotView, query: ScheduleQuery, nowMs: number) {
  const { snapshot } = view;
  const include = new Set(query.include ?? ["events", "tasks"]);
  const explicitWindow = query.from !== undefined || query.to !== undefined;
  const from = query.from !== undefined ? parseWhen(query.from, snapshot.timezone, "start") : nowMs;
  const to = query.to !== undefined ? parseWhen(query.to, snapshot.timezone, "end") : from + 14 * 86_400_000;
  if (to < from) throw new BridgeError("INVALID_ARGUMENT", "'to' must not be earlier than 'from'.");

  const result: Record<string, unknown> = {
    bridge: bridgeMeta(view),
    timezone: snapshot.timezone,
    window: { from: new Date(from).toISOString(), to: new Date(to).toISOString() },
  };

  const coverageFrom = Date.parse(snapshot.schedule.window.from);
  const coverageTo = Date.parse(snapshot.schedule.window.to);
  if (from < coverageFrom || to > coverageTo) {
    const notes: string[] = [];
    if (include.has("events")) notes.push(`Hades only shares events between ${snapshot.schedule.window.from} and ${snapshot.schedule.window.to}; events outside that range are not included.`);
    if (include.has("tasks") && explicitWindow) notes.push(`Completed tasks are only shared when due between ${snapshot.schedule.window.from} and ${snapshot.schedule.window.to}.`);
    if (notes.length > 0) result.note = notes.join(" ");
  }

  if (include.has("events")) {
    const events: BridgeEvent[] = snapshot.schedule.events
      .filter((event) => Date.parse(event.end) >= from && Date.parse(event.start) <= to)
      .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
    result.events = events.slice(0, query.limit);
    result.eventsTotal = events.length;
    if (snapshot.schedule.eventsTruncated) result.eventsMayBeIncomplete = true;
  }

  if (include.has("tasks")) {
    // Same rule as the in-app tool: no window means open tasks; an explicit window means everything due inside it, done or not.
    const tasks: BridgeTask[] = snapshot.schedule.tasks
      .filter((task) => {
        if (!explicitWindow) return !task.completed;
        if (task.dueDate === null) return false;
        const due = Date.parse(task.dueDate);
        return due >= from && due <= to;
      })
      .sort((a, b) => (a.dueDate === null ? Infinity : Date.parse(a.dueDate)) - (b.dueDate === null ? Infinity : Date.parse(b.dueDate)) || 0);
    result.tasks = tasks.slice(0, query.limit);
    result.tasksTotal = tasks.length;
    if (snapshot.schedule.tasksTruncated) result.tasksMayBeIncomplete = true;
  }
  return result;
}

export function buildOpenNotesList(view: SnapshotView) {
  return {
    bridge: bridgeMeta(view),
    notes: view.snapshot.notes.items.map(({ id, name, active, updatedAt, contentLength }) => ({ id, name, active, updatedAt, contentLength })),
    omittedNotes: view.snapshot.notes.omitted,
  };
}

export function buildOpenNote(view: SnapshotView, id: string | undefined) {
  const { items } = view.snapshot.notes;
  const note = id === undefined ? items.find((item) => item.active) : items.find((item) => item.id === id);
  if (!note) {
    if (id === undefined) throw new BridgeError("NO_ACTIVE_NOTE", "No note is active in Hades right now. Use list_open_notes and pass an id.");
    throw new BridgeError("NOTE_NOT_FOUND", "No open Hades note has that id. Only notes open as editor tabs are shared; use list_open_notes.");
  }
  return {
    bridge: bridgeMeta(view),
    id: note.id,
    name: note.name,
    active: note.active,
    updatedAt: note.updatedAt,
    content: note.content,
    contentLength: note.contentLength,
    truncated: note.truncated,
  };
}

const PAGE_MARKER = /(?:^|\n\n)\[Page (\d+)\]\n/g;

function parsePdfPages(text: string): Map<number, string> | null {
  if (!text.startsWith("[Page ")) return null;
  const markers = [...text.matchAll(PAGE_MARKER)];
  if (markers.length === 0 || markers[0].index !== 0) return null;
  const pages = new Map<number, string>();
  markers.forEach((marker, index) => {
    const bodyStart = marker.index + marker[0].length;
    const bodyEnd = index + 1 < markers.length ? markers[index + 1].index : text.length;
    pages.set(Number(marker[1]), text.slice(bodyStart, bodyEnd));
  });
  return pages;
}

function pageSpans(pages: number[]): string {
  const sorted = [...pages].sort((a, b) => a - b);
  const spans: string[] = [];
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    spans.push(sorted[i] === sorted[j] ? `${sorted[i]}` : `${sorted[i]}-${sorted[j]}`);
    i = j + 1;
  }
  return spans.join(", ");
}

export function buildOpenPdf(view: SnapshotView, query: { page?: number; maxChars?: number }) {
  const pdf = view.snapshot.pdf;
  if (!pdf) throw new BridgeError("NO_OPEN_PDF", "No PDF is open in the Hades Notes PDF pane.");
  const maxChars = query.maxChars ?? DEFAULT_PDF_MAX_CHARS;
  const base = {
    bridge: bridgeMeta(view),
    title: pdf.title,
    docId: pdf.docId,
    currentPage: pdf.currentPage,
    pageCount: pdf.pageCount,
  };
  if (pdf.text.trim() === "") {
    return { ...base, text: "", truncated: false, note: "Hades has no extracted text for this PDF yet (it may still be loading, or it may be a scanned document)." };
  }

  const pages = parsePdfPages(pdf.text);
  if (!pages) {
    const text = pdf.text.slice(0, maxChars);
    const note = query.page !== undefined ? "Per-page text is not available for this PDF, so the page argument was ignored." : undefined;
    return { ...base, text, truncated: pdf.truncated || text.length < pdf.text.length, ...(note ? { note } : {}) };
  }

  const available = [...pages.keys()].sort((a, b) => a - b);
  const target = query.page ?? pdf.currentPage ?? available[0];
  if (query.page !== undefined && !pages.has(query.page)) {
    throw new BridgeError("PAGE_NOT_AVAILABLE", `Page ${query.page} is not part of the text Hades shared. Shared pages: ${pageSpans(available)}.`);
  }

  const order = [target, target - 1, target + 1, ...available.filter((p) => p >= target + 2), ...available.filter((p) => p < target - 1)]
    .filter((p, index, all) => pages.has(p) && all.indexOf(p) === index);
  const picked = new Map<number, string>();
  let used = 0;
  let cut = false;
  for (const p of order) {
    const body = (pages.get(p) ?? "").trim();
    if (!body) continue;
    const room = maxChars - used - 12;
    if (room <= 0) { cut = true; continue; }
    const piece = body.length > room ? body.slice(0, room) : body;
    if (piece.length < body.length) cut = true;
    picked.set(p, piece);
    used += piece.length + 12;
  }
  const text = [...picked.entries()].sort((a, b) => a[0] - b[0]).map(([p, body]) => `[Page ${p}]\n${body}`).join("\n\n");
  return { ...base, text, truncated: cut || pdf.truncated };
}

export function buildStats(view: SnapshotView) {
  return { bridge: bridgeMeta(view), ...view.snapshot.stats };
}

// ── Bridge (filesystem) ──────────────────────────────────────────────────────

export interface BridgeOptions {
  /** Overrides `<sync folder>/.hades-bridge` (HADES_BRIDGE_DIR). */
  bridgeDir?: string;
  ackTimeoutMs?: number;
  pollIntervalMs?: number;
  now?: () => number;
}

const NOT_RUNNING = "Hades bridge is not enabled or not running. In Hades open Settings > Advanced, turn on 'Share live workspace with MCP server', and keep the app open.";

const ACK_ERROR_MESSAGES: Record<string, string> = {
  EXPIRED: "Hades received the update too late and ignored it.",
  INVALID_COMMAND: "Hades rejected the update as invalid.",
  NO_CHANGES: "The update did not contain any change Hades can apply.",
  UNSUPPORTED_COMMAND: "This version of Hades does not support that update.",
};

export class HadesBridge {
  readonly dir: string;
  private readonly ackTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly now: () => number;

  private constructor(dir: string, options: BridgeOptions) {
    this.dir = dir;
    this.ackTimeoutMs = options.ackTimeoutMs ?? DEFAULT_ACK_TIMEOUT_MS;
    this.pollIntervalMs = options.pollIntervalMs ?? 250;
    this.now = options.now ?? Date.now;
  }

  /** `syncFolder` must already be the resolved sync root. */
  static create(syncFolder: string, options: BridgeOptions = {}): HadesBridge {
    const dir = options.bridgeDir ? path.resolve(options.bridgeDir) : path.join(syncFolder, BRIDGE_DIR_NAME);
    return new HadesBridge(dir, options);
  }

  async readSnapshot(): Promise<SnapshotView> {
    if (!(await requireDirectory(this.dir))) throw new BridgeError("BRIDGE_NOT_RUNNING", NOT_RUNNING);
    const raw = await readRegularFile(path.join(this.dir, "state.json"), MAX_SNAPSHOT_BYTES);
    if (raw === null) throw new BridgeError("BRIDGE_NOT_RUNNING", NOT_RUNNING);
    let json: unknown;
    try { json = JSON.parse(raw); }
    catch { throw new BridgeError("BRIDGE_SNAPSHOT_INVALID", "The Hades bridge snapshot is unreadable. Hades may be mid-update; try again in a few seconds."); }
    const parsed = snapshotSchema.safeParse(json);
    if (!parsed.success) {
      const unsupported = typeof json === "object" && json !== null && (json as { schema?: unknown }).schema !== 1;
      throw new BridgeError("BRIDGE_SNAPSHOT_INVALID", unsupported
        ? "The Hades bridge snapshot uses a different format version. Update the Hades MCP server and the Hades app to matching versions."
        : "The Hades bridge snapshot has an unexpected shape. Update the Hades MCP server and the Hades app to matching versions.");
    }
    const ageMs = Math.max(0, this.now() - Date.parse(parsed.data.generatedAt));
    return { snapshot: parsed.data, ageSeconds: Math.round(ageMs / 1000), stale: ageMs > STALE_AFTER_MS };
  }

  async querySchedule(query: ScheduleQuery) {
    return buildSchedule(await this.readSnapshot(), query, this.now());
  }

  async listOpenNotes() { return buildOpenNotesList(await this.readSnapshot()); }
  async readOpenNote(id?: string) { return buildOpenNote(await this.readSnapshot(), id); }
  async readOpenPdf(query: { page?: number; maxChars?: number }) { return buildOpenPdf(await this.readSnapshot(), query); }
  async getStudyStats() { return buildStats(await this.readSnapshot()); }

  async updateStudyStats(args: StudyStatsUpdate): Promise<StudyStatsUpdateResult> {
    // A missing snapshot means nothing is listening, so fail before queueing a command.
    await this.readSnapshot();

    const inbox = path.join(this.dir, "inbox");
    const acks = path.join(this.dir, "acks");
    for (const directory of [inbox, acks]) {
      if (!(await requireDirectory(directory))) {
        await mkdir(directory);
        await requireDirectory(directory);
      }
    }

    const id = randomUUID().replaceAll("-", "");
    const created = this.now();
    const command = {
      v: 1,
      id,
      type: "update_study_stats",
      createdAt: new Date(created).toISOString(),
      expiresAt: new Date(created + COMMAND_TTL_MS).toISOString(),
      args,
    };
    const commandFile = bridgeFilePath(inbox, id);
    const ackFile = bridgeFilePath(acks, id);
    await writeFileAtomic(inbox, `${id}.json`, JSON.stringify(command));

    const deadline = Date.now() + this.ackTimeoutMs;
    let ack = await this.readAck(ackFile, id);
    while (!ack && Date.now() < deadline) {
      await sleep(this.pollIntervalMs);
      ack = await this.readAck(ackFile, id);
    }
    if (!ack) {
      await unlink(commandFile).catch(() => undefined);
      // Hades may have applied the command while it was being withdrawn.
      ack = await this.readAck(ackFile, id);
    }
    if (!ack) throw new BridgeError("BRIDGE_TIMEOUT", "Hades did not acknowledge the update. Is the app open with 'Share live workspace with MCP server' enabled? The request was withdrawn; check get_study_stats before retrying in case it was applied.");
    await unlink(ackFile).catch(() => undefined);

    if (!ack.ok) {
      throw new BridgeError("BRIDGE_REJECTED", ACK_ERROR_MESSAGES[ack.error.code] ?? "Hades could not apply the update.");
    }
    return { applied: ack.applied, stats: ack.stats };
  }

  private async readAck(ackFile: string, id: string): Promise<z.infer<typeof ackSchema> | null> {
    const raw = await readRegularFile(ackFile, MAX_ACK_BYTES);
    if (raw === null) return null;
    let json: unknown;
    try { json = JSON.parse(raw); }
    catch { throw new BridgeError("BRIDGE_SNAPSHOT_INVALID", "Hades returned an unreadable acknowledgement."); }
    const parsed = ackSchema.safeParse(json);
    if (!parsed.success || parsed.data.id !== id) throw new BridgeError("BRIDGE_SNAPSHOT_INVALID", "Hades returned an unexpected acknowledgement.");
    return parsed.data;
  }
}
