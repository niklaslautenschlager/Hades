import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fsState = vi.hoisted(() => ({
  files: new Map<string, string>(),
  dirs: new Set<string>(),
  calls: [] as string[],
  fail: new Map<string, number>(),
  writeDelayMs: 0,
}));

const docs = vi.hoisted(() => ({
  notes: [] as unknown[],
  active: null as unknown,
  pdf: null as unknown,
  pdfThrows: false,
  pdfDelayMs: 0,
}));

vi.mock("@tauri-apps/plugin-fs", () => {
  const parent = (p: string) => p.slice(0, p.lastIndexOf("/"));
  const record = (op: string, p: string) => {
    fsState.calls.push(`${op} ${p}`);
    const left = fsState.fail.get(op) ?? 0;
    if (left > 0) {
      fsState.fail.set(op, left - 1);
      throw new Error(`${op} refused`);
    }
  };
  return {
    mkdir: async (p: string) => {
      record("mkdir", p);
      let cur = p;
      while (cur) {
        fsState.dirs.add(cur);
        cur = parent(cur);
      }
    },
    writeTextFile: async (p: string, data: string) => {
      record("write", p);
      if (fsState.writeDelayMs) await new Promise((resolve) => setTimeout(resolve, fsState.writeDelayMs));
      if (!fsState.dirs.has(parent(p))) throw new Error("no such directory");
      fsState.files.set(p, data);
    },
    rename: async (from: string, to: string) => {
      record("rename", from);
      const data = fsState.files.get(from);
      if (data === undefined) throw new Error("no such file");
      fsState.files.delete(from);
      fsState.files.set(to, data);
    },
    readTextFile: async (p: string) => {
      record("read", p);
      const data = fsState.files.get(p);
      if (data === undefined) throw new Error("no such file");
      return data;
    },
    readDir: async (p: string) => {
      record("readDir", p);
      if (!fsState.dirs.has(p)) throw new Error("no such directory");
      return [...fsState.files.keys()]
        .filter((f) => parent(f) === p)
        .map((f) => ({ name: f.slice(p.length + 1), isFile: true, isDirectory: false, isSymlink: false }));
    },
    remove: async (p: string) => {
      record("remove", p);
      if (!fsState.files.delete(p)) throw new Error("no such file");
    },
    exists: async (p: string) => {
      record("exists", p);
      return fsState.files.has(p) || fsState.dirs.has(p);
    },
  };
});

vi.mock("./openDocs", () => ({
  getOpenNotes: () => docs.notes,
  getActiveNote: () => docs.active,
  getOpenPdfText: async () => {
    if (docs.pdfDelayMs) await new Promise((resolve) => setTimeout(resolve, docs.pdfDelayMs));
    if (docs.pdfThrows) throw new Error("pdf exploded");
    return docs.pdf;
  },
}));

vi.mock("./sound", () => ({ playSound: vi.fn() }));

import { useStore } from "../store/useStore";
import type { CalendarEvent, NoteFile, Task } from "../store/useStore";
import { localDateString } from "./pomodoroCycle";
import {
  MAX_COMMAND_CHARS,
  MAX_EVENTS,
  MAX_NOTES,
  MAX_TASKS,
  NOTE_CHARS,
  PDF_CHARS,
  buildStudyStats,
  buildWorkspaceSnapshot,
  formatLocal,
  getBridgeStatus,
  startWorkspaceBridge,
  utcOffsetLabel,
  validateCommand,
} from "./workspaceBridge";
import type { SnapshotInput, WorkspaceSnapshot } from "./workspaceBridge";

const NOW = Date.parse("2026-10-14T12:00:00.000Z");
const DAY = 86_400_000;
const FOLDER = "/sync/HadesNotes";
const BRIDGE = `${FOLDER}/.hades-bridge`;

const event = (id: string, startMs: number, durationMs = 3_600_000, extra: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id,
  title: `Event ${id}`,
  start: new Date(startMs).toISOString(),
  end: new Date(startMs + durationMs).toISOString(),
  source: "local",
  ...extra,
});

const task = (id: string, extra: Partial<Task> = {}): Task => ({
  id,
  text: `Task ${id}`,
  completed: false,
  createdAt: new Date(NOW).toISOString(),
  ...extra,
});

const note = (id: string, content = "body", extra: Partial<NoteFile> = {}): NoteFile => ({
  id,
  name: `Note ${id}`,
  content,
  tags: [],
  parentId: null,
  isFolder: false,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-13T00:00:00.000Z",
  ...extra,
});

function baseInput(overrides: Partial<SnapshotInput> = {}): SnapshotInput {
  return {
    now: NOW,
    timeZone: "America/New_York",
    events: [],
    tasks: [],
    openNotes: [],
    activeNoteId: null,
    pdf: null,
    focusSessions: [],
    weeklyGoalHours: 20,
    sessionsCompleted: 0,
    lastSessionDate: null,
    sessionsUntilLongBreak: 4,
    goal: "",
    ...overrides,
  };
}

describe("buildWorkspaceSnapshot", () => {
  it("produces the versioned envelope with ISO and local times and no device identity", () => {
    const snap = buildWorkspaceSnapshot(baseInput({ events: [event("a", Date.parse("2026-10-14T14:00:00Z"))] }));
    expect(snap.schema).toBe(1);
    expect(snap.generatedAt).toBe("2026-10-14T12:00:00.000Z");
    expect(snap.timezone).toBe("America/New_York");
    expect(snap.utcOffset).toBe("-04:00");
    expect(snap.schedule.window).toEqual({ from: "2026-10-07T12:00:00.000Z", to: "2026-12-13T12:00:00.000Z" });
    expect(snap.schedule.events[0]).toEqual({
      id: "a",
      title: "Event a",
      start: "2026-10-14T14:00:00.000Z",
      end: "2026-10-14T15:00:00.000Z",
      startLocal: "Wed 2026-10-14 10:00",
      endLocal: "Wed 2026-10-14 11:00",
      isDeadline: false,
      source: "local",
    });
    expect(JSON.stringify(snap)).not.toMatch(/deviceId/i);
  });

  it("formats local times and offsets for half-hour zones and falls back to UTC for bad zones", () => {
    expect(utcOffsetLabel(NOW, "Asia/Kolkata")).toBe("+05:30");
    expect(formatLocal(NOW, "Asia/Kolkata")).toBe("Wed 2026-10-14 17:30");
    expect(buildWorkspaceSnapshot(baseInput({ timeZone: "Not/AZone" })).timezone).toBe("UTC");
  });

  it("keeps only events overlapping -7d..+60d, skips unparsable ones and never shares descriptions", () => {
    const events = [
      event("long-gone", NOW - 8 * DAY),
      event("last-week", NOW - 6 * DAY),
      event("spans-start", NOW - 8 * DAY, 2 * DAY),
      event("soon", NOW + DAY, 3_600_000, { description: "private details", isDeadline: true, source: "ical" }),
      event("edge", NOW + 59 * DAY),
      event("too-far", NOW + 61 * DAY),
      { ...event("broken", NOW), start: "not a date" },
    ];
    const snap = buildWorkspaceSnapshot(baseInput({ events }));
    expect(snap.schedule.events.map((e) => e.id)).toEqual(["spans-start", "last-week", "soon", "edge"]);
    expect(snap.schedule.events.find((e) => e.id === "soon")).toMatchObject({ isDeadline: true, source: "ical" });
    expect(JSON.stringify(snap)).not.toContain("private details");
    expect(snap.schedule.eventsTruncated).toBe(false);
  });

  it(`caps events at ${MAX_EVENTS}, dropping the past before the future`, () => {
    const past = Array.from({ length: 200 }, (_, i) => event(`past-${i}`, NOW - 6 * DAY + i * 60_000));
    const future = Array.from({ length: 200 }, (_, i) => event(`future-${i}`, NOW + DAY + i * 60_000));
    const snap = buildWorkspaceSnapshot(baseInput({ events: [...past, ...future] }));
    expect(snap.schedule.events).toHaveLength(MAX_EVENTS);
    expect(snap.schedule.eventsTruncated).toBe(true);
    const ids = snap.schedule.events.map((e) => e.id);
    expect(ids.filter((id) => id.startsWith("future-"))).toHaveLength(200);
    expect(ids.filter((id) => id.startsWith("past-"))).toHaveLength(100);
    expect(ids).toContain("past-199");
    expect(ids).not.toContain("past-0");
    expect(ids).toEqual([...ids].sort((a, b) => snap.schedule.events.findIndex((e) => e.id === a) - snap.schedule.events.findIndex((e) => e.id === b)));
  });

  it("tolerates corrupt persisted entries instead of failing the whole snapshot", () => {
    const snap = buildWorkspaceSnapshot(
      baseInput({
        events: [null, { id: "x" }, event("ok", NOW + DAY)] as never,
        tasks: [null, task("t")] as never,
        openNotes: [null, note("n")] as never,
      })
    );
    expect(snap.schedule.events.map((e) => e.id)).toEqual(["ok"]);
    expect(snap.schedule.tasks.map((t) => t.id)).toEqual(["t"]);
    expect(snap.notes.items.map((n) => n.id)).toEqual(["n"]);
    expect(buildWorkspaceSnapshot(baseInput({ events: undefined as never, tasks: undefined as never, openNotes: undefined as never })).notes.items).toEqual([]);
  });

  it("shares every open task plus completed ones due inside the window, soonest due first, undated last", () => {
    const tasks = [
      task("undated"),
      task("later", { dueDate: "2026-11-01T10:00:00.000Z" }),
      task("done-in-window", { completed: true, dueDate: "2026-10-15T09:00:00.000Z" }),
      task("done-undated", { completed: true }),
      task("done-ancient", { completed: true, dueDate: "2026-01-15T10:00:00.000Z" }),
      task("done-far-future", { completed: true, dueDate: "2027-03-01T10:00:00.000Z" }),
      task("soon", { dueDate: "2026-10-15T10:00:00.000Z" }),
      task("overdue-open", { dueDate: "2026-01-10T10:00:00.000Z" }),
      task("bad-date", { dueDate: "whenever" }),
    ];
    const snap = buildWorkspaceSnapshot(baseInput({ tasks }));
    expect(snap.schedule.tasks.map((t) => [t.id, t.completed])).toEqual([
      ["overdue-open", false],
      ["done-in-window", true],
      ["soon", false],
      ["later", false],
      ["undated", false],
      ["bad-date", false],
    ]);
    expect(snap.schedule.tasks[2]).toMatchObject({ dueDate: "2026-10-15T10:00:00.000Z", dueLocal: "Thu 2026-10-15 06:00" });
    expect(snap.schedule.tasks[5]).toMatchObject({ dueDate: null, dueLocal: null });
    expect(snap.schedule.tasksTruncated).toBe(false);
  });

  it(`caps tasks at ${MAX_TASKS}, keeping open tasks ahead of completed ones`, () => {
    const open = Array.from({ length: MAX_TASKS - 5 }, (_, i) => task(`open${i}`));
    const done = Array.from({ length: 20 }, (_, i) => task(`done${i}`, { completed: true, dueDate: new Date(NOW + (i + 1) * 3_600_000).toISOString() }));
    const snap = buildWorkspaceSnapshot(baseInput({ tasks: [...done, ...open] }));
    expect(snap.schedule.tasks).toHaveLength(MAX_TASKS);
    expect(snap.schedule.tasks.filter((t) => !t.completed)).toHaveLength(MAX_TASKS - 5);
    expect(snap.schedule.tasks.filter((t) => t.completed).map((t) => t.id)).toEqual(["done0", "done1", "done2", "done3", "done4"]);
    expect(snap.schedule.tasksTruncated).toBe(true);

    const many = Array.from({ length: MAX_TASKS + 5 }, (_, i) => task(`t${i}`));
    const overfull = buildWorkspaceSnapshot(baseInput({ tasks: many }));
    expect(overfull.schedule.tasks).toHaveLength(MAX_TASKS);
    expect(overfull.schedule.tasksTruncated).toBe(true);
  });

  it("shares open notes with capped content, flagging truncation and the active note", () => {
    const big = "x".repeat(NOTE_CHARS + 500);
    const snap = buildWorkspaceSnapshot(
      baseInput({ openNotes: [note("a", "short"), note("b", big), note("folder", "", { isFolder: true })], activeNoteId: "b" })
    );
    expect(snap.notes.items.map((n) => [n.id, n.active])).toEqual([["a", false], ["b", true]]);
    const b = snap.notes.items[1];
    expect(b.content).toHaveLength(NOTE_CHARS);
    expect(b.contentLength).toBe(NOTE_CHARS + 500);
    expect(b.truncated).toBe(true);
    expect(snap.notes.items[0]).toMatchObject({ content: "short", truncated: false, contentLength: 5 });
    expect(snap.notes.omitted).toBe(0);
  });

  it("does not split a surrogate pair when clipping", () => {
    const content = "a".repeat(NOTE_CHARS - 1) + "😀" + "tail";
    const [item] = buildWorkspaceSnapshot(baseInput({ openNotes: [note("a", content)] })).notes.items;
    expect(item.content).toHaveLength(NOTE_CHARS - 1);
    expect(item.truncated).toBe(true);
  });

  it(`shares at most ${MAX_NOTES} notes and always keeps the active one`, () => {
    const notes = Array.from({ length: MAX_NOTES + 6 }, (_, i) => note(`n${i}`));
    const snap = buildWorkspaceSnapshot(baseInput({ openNotes: notes, activeNoteId: "n25" }));
    expect(snap.notes.items).toHaveLength(MAX_NOTES);
    expect(snap.notes.omitted).toBe(6);
    expect(snap.notes.items.find((n) => n.active)?.id).toBe("n25");
    expect(snap.notes.items.map((n) => n.id).slice(0, 3)).toEqual(["n0", "n1", "n2"]);
  });

  it("passes the open PDF through with sanitised page numbers and a text cap", () => {
    const pdf = { title: "Thesis", docId: "d1", currentPage: 3, pageCount: 0, text: "y".repeat(PDF_CHARS + 10), truncated: false };
    const snap = buildWorkspaceSnapshot(baseInput({ pdf }));
    expect(snap.pdf).toMatchObject({ title: "Thesis", docId: "d1", currentPage: 3, pageCount: null, truncated: true });
    expect(snap.pdf?.text).toHaveLength(PDF_CHARS);
    expect(buildWorkspaceSnapshot(baseInput({ pdf: null })).pdf).toBeNull();
  });
});

describe("buildStudyStats", () => {
  const fresh = localDateString(new Date(NOW));
  const stale = localDateString(new Date(NOW - 3 * DAY));

  it("sums this Monday-based week and today the way the Statistics screen does", () => {
    const stats = buildStudyStats(
      {
        focusSessions: [
          { date: "2026-10-09", duration: 5000, sessions: 2 },
          { date: "2026-10-12", duration: 3600, sessions: 1 },
          { date: "2026-10-14", duration: 1800, sessions: 1 },
        ],
        weeklyGoalHours: 12,
        sessionsCompleted: 6,
        lastSessionDate: fresh,
        sessionsUntilLongBreak: 4,
        goal: "Chapter 3",
      },
      NOW
    );
    expect(stats).toEqual({
      weeklyGoalHours: 12,
      hoursThisWeek: 1.5,
      todayFocusSeconds: 1800,
      pomodoroCycle: { completedInCycle: 2, cycleLength: 4, sessionsToday: 6 },
      goal: "Chapter 3",
    });
  });

  it("treats a counter from a previous day as zero", () => {
    const stats = buildStudyStats(
      { focusSessions: [], weeklyGoalHours: 20, sessionsCompleted: 3, lastSessionDate: stale, sessionsUntilLongBreak: 4, goal: "" },
      NOW
    );
    expect(stats.pomodoroCycle).toEqual({ completedInCycle: 0, cycleLength: 4, sessionsToday: 0 });
  });

  it("survives corrupt persisted values", () => {
    const stats = buildStudyStats(
      {
        focusSessions: [{ date: "2026-10-14", duration: Number.NaN, sessions: 1 }, null, { date: 5, duration: 10 }] as never,
        weeklyGoalHours: Number.NaN,
        sessionsCompleted: -2,
        lastSessionDate: "garbage" as never,
        sessionsUntilLongBreak: 0,
        goal: undefined as never,
      },
      NOW
    );
    expect(stats).toEqual({
      weeklyGoalHours: 0,
      hoursThisWeek: 0,
      todayFocusSeconds: 0,
      pomodoroCycle: { completedInCycle: 0, cycleLength: 4, sessionsToday: 0 },
      goal: "",
    });
    expect(buildStudyStats({ focusSessions: "nope" as never, weeklyGoalHours: 1, sessionsCompleted: 0, lastSessionDate: null, sessionsUntilLongBreak: 4, goal: "" }, NOW).hoursThisWeek).toBe(0);
  });
});

describe("validateCommand", () => {
  const command = (over: Record<string, unknown> = {}, id = "cmd1") =>
    JSON.stringify({
      v: 1,
      id,
      type: "update_study_stats",
      createdAt: new Date(NOW).toISOString(),
      expiresAt: new Date(NOW + 120_000).toISOString(),
      args: { weeklyGoalHours: 12 },
      ...over,
    });

  it("accepts the whitelisted command and normalises its arguments", () => {
    expect(validateCommand(command(), "cmd1", NOW)).toEqual({ ok: true, args: { weeklyGoalHours: 12 } });
    expect(validateCommand(command({ args: { weeklyGoalHours: 12.34, logFocusMinutes: 30.4, goal: "  Revise\n  notes " } }), "cmd1", NOW)).toEqual({
      ok: true,
      args: { weeklyGoalHours: 12.3, logFocusMinutes: 30, goal: "Revise notes" },
    });
  });

  it("clamps values into range instead of trusting the sender", () => {
    const verdict = (args: Record<string, unknown>) => validateCommand(command({ args }), "cmd1", NOW);
    expect(verdict({ weeklyGoalHours: 0.2 })).toEqual({ ok: true, args: { weeklyGoalHours: 1 } });
    expect(verdict({ weeklyGoalHours: 5000 })).toEqual({ ok: true, args: { weeklyGoalHours: 100 } });
    expect(verdict({ logFocusMinutes: 0 })).toEqual({ ok: true, args: { logFocusMinutes: 1 } });
    expect(verdict({ logFocusMinutes: 100000 })).toEqual({ ok: true, args: { logFocusMinutes: 480 } });
    expect(verdict({ goal: "g".repeat(500) })).toEqual({ ok: true, args: { goal: "g".repeat(200) } });
  });

  it("rejects anything outside the strict schema", () => {
    const bad = (text: string) => validateCommand(text, "cmd1", NOW);
    expect(bad("not json")).toEqual({ ok: false, code: "INVALID_COMMAND" });
    expect(bad("[]")).toEqual({ ok: false, code: "INVALID_COMMAND" });
    expect(bad("null")).toEqual({ ok: false, code: "INVALID_COMMAND" });
    expect(bad(command({ extra: true }))).toEqual({ ok: false, code: "INVALID_COMMAND" });
    expect(bad(command({ args: { weeklyGoalHours: 5, deleteNotes: true } }))).toEqual({ ok: false, code: "INVALID_COMMAND" });
    expect(bad(command({ args: { weeklyGoalHours: "5" } }))).toEqual({ ok: false, code: "INVALID_COMMAND" });
    expect(bad(command({ args: { logFocusMinutes: null } }))).toEqual({ ok: false, code: "INVALID_COMMAND" });
    expect(bad(command({ args: { goal: 7 } }))).toEqual({ ok: false, code: "INVALID_COMMAND" });
    expect(bad(command({ args: { goal: "   " } }))).toEqual({ ok: false, code: "INVALID_COMMAND" });
    expect(bad(command({ args: [] }))).toEqual({ ok: false, code: "INVALID_COMMAND" });
    expect(bad(command({ v: 2 }))).toEqual({ ok: false, code: "INVALID_COMMAND" });
    expect(bad(command({ id: "someone-else" }))).toEqual({ ok: false, code: "INVALID_COMMAND" });
    expect(bad(command({ expiresAt: "soon" }))).toEqual({ ok: false, code: "INVALID_COMMAND" });
    expect(bad(command({ expiresAt: undefined }))).toEqual({ ok: false, code: "INVALID_COMMAND" });
    expect(bad("x".repeat(MAX_COMMAND_CHARS + 1))).toEqual({ ok: false, code: "INVALID_COMMAND" });
  });

  it("whitelists the command type", () => {
    for (const type of ["delete_note", "update_note", "eval", "update_study_stats "]) {
      expect(validateCommand(command({ type }), "cmd1", NOW)).toEqual({ ok: false, code: "UNSUPPORTED_COMMAND" });
    }
  });

  it("rejects expired commands and commands that claim an unreasonably long life", () => {
    expect(validateCommand(command({ expiresAt: new Date(NOW - 1).toISOString() }), "cmd1", NOW)).toEqual({ ok: false, code: "EXPIRED" });
    expect(validateCommand(command({ expiresAt: new Date(NOW).toISOString() }), "cmd1", NOW)).toMatchObject({ ok: true });
    expect(validateCommand(command({ expiresAt: new Date(NOW + 3_600_000).toISOString() }), "cmd1", NOW)).toEqual({ ok: false, code: "INVALID_COMMAND" });
  });

  it("reports commands with nothing to apply", () => {
    expect(validateCommand(command({ args: {} }), "cmd1", NOW)).toEqual({ ok: false, code: "NO_CHANGES" });
  });
});

// ── Engine ───────────────────────────────────────────────────────────────────

const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);
const readState = (): WorkspaceSnapshot => JSON.parse(fsState.files.get(`${BRIDGE}/state.json`) ?? "null");
const fsWrites = () => fsState.calls.filter((c) => c.startsWith("write ") || c.startsWith("rename "));
const stateWrites = () => fsState.calls.filter((c) => c === `rename ${BRIDGE}/state.json.tmp`).length;

function putCommand(id: string, over: Record<string, unknown> = {}, args: Record<string, unknown> = { weeklyGoalHours: 12 }) {
  fsState.files.set(
    `${BRIDGE}/inbox/${id}.json`,
    JSON.stringify({
      v: 1,
      id,
      type: "update_study_stats",
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 120_000).toISOString(),
      args,
      ...over,
    })
  );
}

const ackOf = (id: string) => {
  const raw = fsState.files.get(`${BRIDGE}/acks/${id}.json`);
  return raw === undefined ? undefined : JSON.parse(raw);
};

function resetStore(over: Partial<ReturnType<typeof useStore.getState>> = {}) {
  useStore.setState({
    mcpBridgeEnabled: true,
    syncFolder: FOLDER,
    calendarEvents: [],
    tasks: [],
    notes: [],
    openNoteIds: [],
    activeNoteId: null,
    focusSessions: [],
    weeklyGoalHours: 20,
    sessionsCompleted: 0,
    lastSessionDate: null,
    sessionsUntilLongBreak: 4,
    goal: "",
    notePdfUrl: null,
    ...over,
  });
}

let stop: (() => void) | null = null;
const start = () => {
  stop = startWorkspaceBridge();
  return stop;
};

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  fsState.files.clear();
  fsState.dirs.clear();
  fsState.dirs.add(FOLDER);
  fsState.calls.length = 0;
  fsState.fail.clear();
  fsState.writeDelayMs = 0;
  docs.notes = [];
  docs.active = null;
  docs.pdf = null;
  docs.pdfThrows = false;
  docs.pdfDelayMs = 0;
  resetStore();
});

afterEach(async () => {
  stop?.();
  stop = null;
  await tick(60_000);
  useStore.setState({ mcpBridgeEnabled: false, syncFolder: null });
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("startWorkspaceBridge: opt-in gating", () => {
  it("does nothing at all while the flag is off, even with a sync folder", async () => {
    resetStore({ mcpBridgeEnabled: false });
    start();
    await tick(120_000);
    expect(fsState.calls).toEqual([]);
    expect(getBridgeStatus().state).toBe("off");
  });

  it("does nothing while no sync folder is configured and says why", async () => {
    resetStore({ syncFolder: null });
    start();
    await tick(120_000);
    expect(fsState.calls).toEqual([]);
    expect(getBridgeStatus().state).toBe("no-folder");
    resetStore({ syncFolder: "   " });
    await tick(60_000);
    expect(fsState.calls).toEqual([]);
  });

  it("defaults to disabled so existing users are not opted in", () => {
    expect(useStore.getInitialState().mcpBridgeEnabled).toBe(false);
  });

  it("is idempotent: a second start returns the same stop function and adds no timers", async () => {
    const first = start();
    const second = startWorkspaceBridge();
    expect(second).toBe(first);
    await tick(1_000);
    const writes = stateWrites();
    expect(writes).toBe(1);
    await tick(60_000);
    expect(stateWrites()).toBeLessThanOrEqual(2);
  });

  it("stop() ends all activity and allows a clean restart", async () => {
    start();
    await tick(1_000);
    stop?.();
    stop = null;
    fsState.calls.length = 0;
    await tick(120_000);
    expect(fsState.calls).toEqual([]);
    expect(getBridgeStatus().state).toBe("off");
    start();
    await tick(1_000);
    expect(stateWrites()).toBe(1);
  });
});

describe("startWorkspaceBridge: snapshot", () => {
  it("writes the snapshot atomically into <folder>/.hades-bridge and creates inbox/acks", async () => {
    resetStore({
      calendarEvents: [event("e1", NOW + DAY)],
      tasks: [task("t1")],
      weeklyGoalHours: 15,
      goal: "Revise",
    });
    docs.notes = [note("n1", "hello")];
    docs.active = docs.notes[0];
    docs.pdf = { title: "Thesis", docId: null, currentPage: 2, pageCount: 9, text: "[Page 2]\nhi", truncated: false };
    start();
    await tick(1_000);

    expect(fsState.dirs.has(`${BRIDGE}/inbox`)).toBe(true);
    expect(fsState.dirs.has(`${BRIDGE}/acks`)).toBe(true);
    const snap = readState();
    expect(snap.schema).toBe(1);
    expect(snap.schedule.events.map((e) => e.id)).toEqual(["e1"]);
    expect(snap.schedule.tasks.map((t) => t.id)).toEqual(["t1"]);
    expect(snap.notes.items).toMatchObject([{ id: "n1", active: true, content: "hello" }]);
    expect(snap.pdf).toMatchObject({ title: "Thesis", currentPage: 2, pageCount: 9 });
    expect(snap.stats).toMatchObject({ weeklyGoalHours: 15, goal: "Revise" });
    expect(fsState.files.has(`${BRIDGE}/state.json.tmp`)).toBe(false);
    expect(fsState.calls.some((c) => c === `write ${BRIDGE}/state.json.tmp`)).toBe(true);
    expect(getBridgeStatus()).toMatchObject({ state: "active", error: null });
    expect(getBridgeStatus().lastWriteAt).toBe(snap.generatedAt);
  });

  it("normalises a trailing separator on the folder", async () => {
    resetStore({ syncFolder: `${FOLDER}/` });
    start();
    await tick(1_000);
    expect(fsState.files.has(`${BRIDGE}/state.json`)).toBe(true);
    expect(fsState.calls.some((c) => c.includes("//"))).toBe(false);
  });

  it("debounces store changes: one rewrite about 2s after a burst", async () => {
    start();
    await tick(1_000);
    expect(stateWrites()).toBe(1);

    for (let i = 0; i < 20; i++) {
      useStore.setState({ goal: `typing ${i}` });
      await tick(50);
    }
    expect(stateWrites()).toBe(1);
    await tick(1_900);
    expect(stateWrites()).toBe(1);
    await tick(200);
    expect(stateWrites()).toBe(2);
    expect(readState().stats.goal).toBe("typing 19");
  });

  it("flushes within the max wait even if changes never stop", async () => {
    start();
    await tick(1_000);
    for (let i = 0; i < 60; i++) {
      useStore.setState({ goal: `keystroke ${i}` });
      await tick(500);
    }
    expect(stateWrites()).toBeGreaterThanOrEqual(3);
  });

  it("picks up a change made while a slow write is in flight without waiting for the heartbeat", async () => {
    fsState.writeDelayMs = 3_000;
    start();
    await tick(100);
    useStore.setState({ goal: "changed mid-write" });
    await tick(7_000);
    expect(readState().stats.goal).toBe("changed mid-write");
  });

  it("ignores store changes that do not affect the shared data", async () => {
    start();
    await tick(1_000);
    const before = stateWrites();
    useStore.setState({ timeLeft: 1234, theme: "nord" });
    await tick(5_000);
    expect(stateWrites()).toBe(before);
  });

  it("refreshes an unchanged snapshot on the heartbeat so it never looks stale", async () => {
    start();
    await tick(1_000);
    const first = readState().generatedAt;
    await tick(30_000);
    expect(readState().generatedAt).toBe(first);
    await tick(30_000);
    expect(Date.parse(readState().generatedAt) - Date.parse(first)).toBeGreaterThanOrEqual(45_000);
    expect(Date.parse(readState().generatedAt) - Date.parse(first)).toBeLessThanOrEqual(75_000);
  });

  it("leaves the previous state.json intact when an atomic write fails, then recovers", async () => {
    start();
    await tick(1_000);
    const good = fsState.files.get(`${BRIDGE}/state.json`);
    expect(good).toBeDefined();

    fsState.fail.set("rename", 1);
    useStore.setState({ goal: "will not land" });
    await tick(2_500);
    expect(fsState.files.get(`${BRIDGE}/state.json`)).toBe(good);
    expect(fsState.files.has(`${BRIDGE}/state.json.tmp`)).toBe(false);
    expect(getBridgeStatus().state).toBe("error");
    expect(getBridgeStatus().error).toContain("rename refused");

    await tick(15_000);
    expect(readState().stats.goal).toBe("will not land");
    expect(getBridgeStatus()).toMatchObject({ state: "active", error: null });
  });

  it("leaves the previous state.json intact when the temp write fails", async () => {
    start();
    await tick(1_000);
    const good = fsState.files.get(`${BRIDGE}/state.json`);
    fsState.fail.set("write", 1);
    useStore.setState({ goal: "nope" });
    await tick(2_500);
    expect(fsState.files.get(`${BRIDGE}/state.json`)).toBe(good);
    expect(getBridgeStatus().state).toBe("error");
  });

  it("never recreates a missing sync folder and writes nothing when it is gone", async () => {
    fsState.dirs.delete(FOLDER);
    start();
    await tick(60_000);
    expect(fsState.calls.filter((c) => c.startsWith("mkdir"))).toEqual([]);
    expect(fsState.files.size).toBe(0);
    expect(getBridgeStatus().state).toBe("error");
    expect(getBridgeStatus().error).toContain("not available");
  });

  it("surfaces filesystem failures as status, never as exceptions", async () => {
    fsState.fail.set("mkdir", 1000);
    start();
    await expect(tick(60_000)).resolves.not.toThrow();
    expect(getBridgeStatus().state).toBe("error");
    expect(getBridgeStatus().error).toContain("mkdir refused");
  });

  it("still writes a snapshot when PDF extraction throws", async () => {
    docs.pdfThrows = true;
    start();
    await tick(1_000);
    expect(readState().pdf).toBeNull();
  });

  it("removes the snapshot when the user turns the bridge off and writes again when it is turned back on", async () => {
    start();
    await tick(1_000);
    expect(fsState.files.has(`${BRIDGE}/state.json`)).toBe(true);

    useStore.getState().setMcpBridgeEnabled(false);
    await tick(100);
    expect(fsState.files.has(`${BRIDGE}/state.json`)).toBe(false);
    fsState.calls.length = 0;
    await tick(120_000);
    expect(fsState.calls).toEqual([]);

    useStore.getState().setMcpBridgeEnabled(true);
    await tick(1_000);
    expect(fsState.files.has(`${BRIDGE}/state.json`)).toBe(true);
  });

  it("moves the snapshot when the sync folder changes", async () => {
    start();
    await tick(1_000);
    fsState.dirs.add("/other/place");
    useStore.getState().setSyncFolder("/other/place");
    await tick(1_000);
    expect(fsState.files.has(`${BRIDGE}/state.json`)).toBe(false);
    expect(fsState.files.has("/other/place/.hades-bridge/state.json")).toBe(true);
  });
});

describe("startWorkspaceBridge: commands", () => {
  it("applies update_study_stats through the store, acks with the new stats and deletes the command", async () => {
    start();
    await tick(1_000);
    putCommand("cmd1", {}, { weeklyGoalHours: 12, logFocusMinutes: 30, goal: "Chapter 4" });
    await tick(5_000);

    const s = useStore.getState();
    expect(s.weeklyGoalHours).toBe(12);
    expect(s.goal).toBe("Chapter 4");
    const today = new Date(NOW).toISOString().split("T")[0];
    expect(s.focusSessions.find((f) => f.date === today)).toMatchObject({ duration: 1800 });

    const ack = ackOf("cmd1");
    expect(ack).toMatchObject({ v: 1, id: "cmd1", ok: true, applied: { weeklyGoalHours: 12, logFocusMinutes: 30, goal: "Chapter 4" } });
    expect(ack.stats).toMatchObject({ weeklyGoalHours: 12, todayFocusSeconds: 1800, goal: "Chapter 4" });
    expect(Number.isNaN(Date.parse(ack.at))).toBe(false);
    expect(fsState.files.has(`${BRIDGE}/inbox/cmd1.json`)).toBe(false);
    expect([...fsState.files.keys()].some((k) => k.endsWith(".tmp"))).toBe(false);
  });

  it("applies the clamps even when the sender asks for more", async () => {
    start();
    await tick(1_000);
    putCommand("big", {}, { weeklyGoalHours: 9999, logFocusMinutes: 99999 });
    await tick(5_000);
    expect(useStore.getState().weeklyGoalHours).toBe(100);
    const today = new Date(NOW).toISOString().split("T")[0];
    expect(useStore.getState().focusSessions.find((f) => f.date === today)?.duration).toBe(480 * 60);
    expect(ackOf("big").applied).toEqual({ weeklyGoalHours: 100, logFocusMinutes: 480 });
  });

  it("does not apply the same command twice, even if the file reappears or the ack is gone", async () => {
    start();
    await tick(1_000);
    putCommand("once", {}, { logFocusMinutes: 10 });
    await tick(5_000);
    const today = new Date(NOW).toISOString().split("T")[0];
    const minutes = () => useStore.getState().focusSessions.find((f) => f.date === today)?.duration;
    expect(minutes()).toBe(600);

    putCommand("once", {}, { logFocusMinutes: 10 });
    await tick(5_000);
    expect(minutes()).toBe(600);
    expect(fsState.files.has(`${BRIDGE}/inbox/once.json`)).toBe(false);

    fsState.files.delete(`${BRIDGE}/acks/once.json`);
    putCommand("once", {}, { logFocusMinutes: 10 });
    await tick(5_000);
    expect(minutes()).toBe(600);
  });

  it("dedupes against an ack left on disk by an earlier session", async () => {
    start();
    await tick(1_000);
    fsState.files.set(`${BRIDGE}/acks/old1.json`, JSON.stringify({ v: 1, id: "old1", ok: true, at: new Date().toISOString(), applied: {}, stats: {} }));
    putCommand("old1", {}, { logFocusMinutes: 10 });
    await tick(5_000);
    expect(useStore.getState().focusSessions).toEqual([]);
    expect(fsState.files.has(`${BRIDGE}/inbox/old1.json`)).toBe(false);
  });

  it("answers expired and malformed commands with an error ack and changes nothing", async () => {
    start();
    await tick(1_000);
    putCommand("late", { expiresAt: new Date(Date.now() - 1_000).toISOString() });
    putCommand("extra", {}, { weeklyGoalHours: 5, wipeEverything: true });
    putCommand("alien", { type: "delete_all_notes" });
    fsState.files.set(`${BRIDGE}/inbox/junk.json`, "{{{{");
    await tick(5_000);

    expect(ackOf("late")).toMatchObject({ ok: false, error: { code: "EXPIRED" } });
    expect(ackOf("extra")).toMatchObject({ ok: false, error: { code: "INVALID_COMMAND" } });
    expect(ackOf("alien")).toMatchObject({ ok: false, error: { code: "UNSUPPORTED_COMMAND" } });
    expect(ackOf("junk")).toMatchObject({ ok: false, error: { code: "INVALID_COMMAND" } });
    expect(useStore.getState().weeklyGoalHours).toBe(20);
    expect(useStore.getState().notes).toEqual([]);
    for (const id of ["late", "extra", "alien", "junk"]) expect(fsState.files.has(`${BRIDGE}/inbox/${id}.json`)).toBe(false);
  });

  it("rejects a command whose id does not match its file name", async () => {
    start();
    await tick(1_000);
    putCommand("filename", { id: "other" });
    await tick(5_000);
    expect(ackOf("filename")).toMatchObject({ ok: false, error: { code: "INVALID_COMMAND" } });
    expect(ackOf("other")).toBeUndefined();
  });

  it("ignores inbox entries that are not <safe-id>.json files and never reads them", async () => {
    start();
    await tick(1_000);
    for (const name of ["notes.txt", "a b.json", ".hidden.json", "x.json.tmp", `${"a".repeat(129)}.json`, "..json"]) {
      fsState.files.set(`${BRIDGE}/inbox/${name}`, "{}");
    }
    await tick(10_000);
    expect(fsState.calls.filter((c) => c.startsWith("read ") && c.includes("/inbox/"))).toEqual([]);
    expect(fsState.files.has(`${BRIDGE}/inbox/notes.txt`)).toBe(true);
    expect([...fsState.files.keys()].some((k) => k.startsWith(`${BRIDGE}/acks/`))).toBe(false);
  });

  it("processes at most ten commands per poll", async () => {
    start();
    await tick(1_000);
    for (let i = 0; i < 12; i++) putCommand(`c${String(i).padStart(2, "0")}`, {}, { logFocusMinutes: 1 });
    await tick(5_000);
    const acked = () => [...fsState.files.keys()].filter((k) => k.startsWith(`${BRIDGE}/acks/`)).length;
    expect(acked()).toBe(10);
    await tick(5_000);
    expect(acked()).toBe(12);
  });

  it("survives an unreadable inbox and keeps polling", async () => {
    start();
    await tick(1_000);
    fsState.dirs.delete(`${BRIDGE}/inbox`);
    await tick(5_000);
    expect(getBridgeStatus().state).toBe("error");
    putCommand("after", {}, { logFocusMinutes: 5 });
    fsState.dirs.add(`${BRIDGE}/inbox`);
    await tick(10_000);
    expect(ackOf("after")).toMatchObject({ ok: true });
    expect(getBridgeStatus().state).toBe("active");
  });

  it("acknowledges commands promptly even while a slow PDF extraction holds up the snapshot", async () => {
    docs.pdfDelayMs = 60_000;
    start();
    await tick(1_000);
    putCommand("quick", {}, { logFocusMinutes: 5 });
    await tick(5_000);
    expect(ackOf("quick")).toMatchObject({ ok: true });
  });

  it("prunes acks older than ten minutes, keeping fresh ones and never touching files that are not acks", async () => {
    start();
    await tick(1_000);
    const ack = (id: string, at: string) => fsState.files.set(`${BRIDGE}/acks/${id}.json`, JSON.stringify({ v: 1, id, at }));
    ack("fresh", new Date(Date.now() - 60_000).toISOString());
    ack("old", new Date(Date.now() - 11 * 60_000).toISOString());
    fsState.files.set(`${BRIDGE}/acks/garbled.json`, "###");
    fsState.files.set(`${BRIDGE}/acks/foreign.json`, JSON.stringify({ unrelated: "somebody else's file" }));
    fsState.files.set(`${BRIDGE}/acks/mismatch.json`, JSON.stringify({ v: 1, id: "other", at: "2000-01-01T00:00:00.000Z" }));
    fsState.files.set(`${BRIDGE}/acks/notes.txt`, "keep");
    await tick(61_000);
    expect(fsState.files.has(`${BRIDGE}/acks/fresh.json`)).toBe(true);
    expect(fsState.files.has(`${BRIDGE}/acks/old.json`)).toBe(false);
    expect(fsState.files.has(`${BRIDGE}/acks/garbled.json`)).toBe(true);
    expect(fsState.files.has(`${BRIDGE}/acks/foreign.json`)).toBe(true);
    expect(fsState.files.has(`${BRIDGE}/acks/mismatch.json`)).toBe(true);
    expect(fsState.files.has(`${BRIDGE}/acks/notes.txt`)).toBe(true);
  });

  it("never writes outside the bridge folder", async () => {
    start();
    await tick(1_000);
    putCommand("w1", {}, { goal: "../../etc/passwd" });
    await tick(70_000);
    const outside = fsWrites().filter((c) => !c.includes(`${BRIDGE}/`));
    expect(outside).toEqual([]);
  });
});
