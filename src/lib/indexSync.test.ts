import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  // zustand's persist middleware warns on every write when localStorage is missing (plain Node).
  const mem = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    },
  });
  return { syncIndex: vi.fn() };
});

vi.mock("./ragIndex", () => ({ syncIndex: h.syncIndex }));

import { useStore } from "../store/useStore";
import { startAutoIndexing } from "./indexSync";

const OK = { upserted: 1, removed: 0, chunks: 1, embedder: "local:hash-v1", rebuilt: false };
const ALL = ["note", "pdf", "event", "task"];

let stop: (() => void) | null = null;

function reset(over: Partial<ReturnType<typeof useStore.getState>> = {}) {
  useStore.setState({
    aiEnabled: true,
    notes: [],
    calendarEvents: [],
    tasks: [],
    libraryDocs: [],
    ...over,
  });
}

/** Start with AI on and let the initial full reconcile happen, then forget it. */
async function startAndSettle() {
  stop = startAutoIndexing();
  await vi.advanceTimersByTimeAsync(3000);
  h.syncIndex.mockClear();
}

const lastCall = () => h.syncIndex.mock.calls[h.syncIndex.mock.calls.length - 1]?.[0];

beforeEach(() => {
  vi.useFakeTimers();
  h.syncIndex.mockReset();
  h.syncIndex.mockResolvedValue(OK);
  reset();
});

afterEach(() => {
  stop?.();
  stop = null;
  vi.useRealTimers();
});

describe("startAutoIndexing", () => {
  it("builds the initial index in the background, after a short delay, for every kind", async () => {
    stop = startAutoIndexing();
    expect(h.syncIndex).not.toHaveBeenCalled(); // never blocks startup
    await vi.advanceTimersByTimeAsync(2999);
    expect(h.syncIndex).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(h.syncIndex).toHaveBeenCalledTimes(1);
    const arg = lastCall();
    expect(arg.kinds).toEqual(ALL);
    expect(arg.ids).toBeUndefined();
    expect(arg.signal).toBeInstanceOf(AbortSignal);
  });

  it("is idempotent: one subscription no matter how often it is started", async () => {
    stop = startAutoIndexing();
    const again = startAutoIndexing();
    expect(again).toBe(stop);
    await vi.advanceTimersByTimeAsync(3000);
    h.syncIndex.mockClear();
    useStore.getState().addTask("Write essay");
    await vi.advanceTimersByTimeAsync(1500);
    expect(h.syncIndex).toHaveBeenCalledTimes(1);
  });

  it("can be stopped and restarted", async () => {
    await startAndSettle();
    stop!();
    useStore.getState().addTask("ignored");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.syncIndex).not.toHaveBeenCalled();
    stop = startAutoIndexing();
    await vi.advanceTimersByTimeAsync(3000);
    expect(h.syncIndex).toHaveBeenCalledTimes(1);
  });

  it("does nothing while AI is disabled", async () => {
    reset({ aiEnabled: false });
    stop = startAutoIndexing();
    useStore.getState().addTask("x");
    useStore.getState().addCalendarEvent({ title: "e", start: new Date().toISOString(), end: new Date().toISOString(), source: "local" });
    useStore.setState({ notes: [{ id: "n", name: "N", content: "c", tags: [], parentId: null, isFolder: false, createdAt: "", updatedAt: "" }] });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.syncIndex).not.toHaveBeenCalled();
  });

  it("turning AI on triggers a full reconcile; turning it off cancels pending work", async () => {
    reset({ aiEnabled: false });
    stop = startAutoIndexing();
    useStore.setState({ aiEnabled: true });
    await vi.advanceTimersByTimeAsync(3000);
    expect(h.syncIndex).toHaveBeenCalledTimes(1);
    expect(lastCall().kinds).toEqual(ALL);
    h.syncIndex.mockClear();

    useStore.getState().addTask("pending when switched off");
    useStore.setState({ aiEnabled: false });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.syncIndex).not.toHaveBeenCalled();
  });

  it("aborts an in-flight build when AI is switched off", async () => {
    let signal!: AbortSignal;
    h.syncIndex.mockImplementation((o: { signal: AbortSignal }) => {
      signal = o.signal;
      return new Promise(() => {});
    });
    stop = startAutoIndexing();
    await vi.advanceTimersByTimeAsync(3000);
    expect(signal.aborted).toBe(false);
    useStore.setState({ aiEnabled: false });
    expect(signal.aborted).toBe(true);
  });
});

describe("incremental re-indexing", () => {
  it("a new calendar event re-indexes just that event after ~1.5 s", async () => {
    await startAndSettle();
    useStore.getState().addCalendarEvent({ title: "Midterm", start: new Date(2026, 9, 14, 14).toISOString(), end: new Date(2026, 9, 14, 15).toISOString(), source: "local" });
    const id = useStore.getState().calendarEvents[0].id;
    await vi.advanceTimersByTimeAsync(1499);
    expect(h.syncIndex).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(h.syncIndex).toHaveBeenCalledTimes(1);
    expect(lastCall()).toMatchObject({ kinds: ["event"], ids: [id] });
  });

  it("a new task re-indexes just that task", async () => {
    await startAndSettle();
    const id = useStore.getState().addTask("Finish problem set");
    await vi.advanceTimersByTimeAsync(1500);
    expect(h.syncIndex).toHaveBeenCalledTimes(1);
    expect(lastCall()).toMatchObject({ kinds: ["task"], ids: [id] });
  });

  it("editing a note waits for a 4 s pause and re-indexes only that note", async () => {
    reset({
      notes: [
        { id: "a", name: "A", content: "one", tags: [], parentId: null, isFolder: false, createdAt: "", updatedAt: "2026-10-01T00:00:00.000Z" },
        { id: "b", name: "B", content: "two", tags: [], parentId: null, isFolder: false, createdAt: "", updatedAt: "2026-10-01T00:00:00.000Z" },
      ],
    });
    await startAndSettle();

    useStore.getState().updateNote("a", { content: "one!" });
    await vi.advanceTimersByTimeAsync(3000);
    useStore.getState().updateNote("a", { content: "one!!" }); // still typing: the timer restarts
    await vi.advanceTimersByTimeAsync(3999);
    expect(h.syncIndex).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(h.syncIndex).toHaveBeenCalledTimes(1);
    expect(lastCall()).toMatchObject({ kinds: ["note"], ids: ["a"] });
  });

  it("a deleted event or task is passed through so its chunks get removed", async () => {
    await startAndSettle();
    useStore.getState().addCalendarEvent({ title: "Gone soon", start: new Date().toISOString(), end: new Date().toISOString(), source: "local" });
    const taskId = useStore.getState().addTask("Gone too");
    await vi.advanceTimersByTimeAsync(1500);
    h.syncIndex.mockClear();

    const eventId = useStore.getState().calendarEvents[0].id;
    useStore.getState().deleteCalendarEvent(eventId);
    useStore.getState().deleteTask(taskId);
    await vi.advanceTimersByTimeAsync(1500);
    const calls = h.syncIndex.mock.calls.map((c) => c[0]);
    expect(calls).toContainEqual(expect.objectContaining({ kinds: ["event"], ids: [eventId] }));
    expect(calls).toContainEqual(expect.objectContaining({ kinds: ["task"], ids: [taskId] }));
  });

  it("a deleted note and a library PDF change are picked up too", async () => {
    reset({ notes: [{ id: "a", name: "A", content: "one", tags: [], parentId: null, isFolder: false, createdAt: "", updatedAt: "" }] });
    await startAndSettle();
    useStore.getState().addLibraryDoc({ id: "doc1", title: "Campbell", fileName: "c.pdf", addedAt: "2026-10-01T00:00:00.000Z" });
    await vi.advanceTimersByTimeAsync(1500);
    expect(lastCall()).toMatchObject({ kinds: ["pdf"], ids: ["doc1"] });

    h.syncIndex.mockClear();
    useStore.setState({ notes: [] });
    await vi.advanceTimersByTimeAsync(4000);
    expect(lastCall()).toMatchObject({ kinds: ["note"], ids: ["a"] });
  });

  it("an iCal feed sync (not the UI) is caught through the store", async () => {
    await startAndSettle();
    useStore.getState().syncIcalEvents("feed1", [
      { id: "ical-1", title: "Lecture 1", start: new Date(2026, 9, 12, 9).toISOString(), end: new Date(2026, 9, 12, 10).toISOString(), source: "ical", icalFeedId: "feed1" },
      { id: "ical-2", title: "Lecture 2", start: new Date(2026, 9, 13, 9).toISOString(), end: new Date(2026, 9, 13, 10).toISOString(), source: "ical", icalFeedId: "feed1" },
    ]);
    await vi.advanceTimersByTimeAsync(1500);
    expect(h.syncIndex).toHaveBeenCalledTimes(1);
    expect(lastCall().kinds).toEqual(["event"]);
    expect([...lastCall().ids].sort()).toEqual(["ical-1", "ical-2"]);
  });

  it("an agent tool creating events and tasks is caught the same way", async () => {
    await startAndSettle();
    // Same store actions the agent's add_calendar_event / create_tasks tools call.
    useStore.getState().addCalendarEvent({ title: "Study block", start: new Date(2026, 9, 10, 10).toISOString(), end: new Date(2026, 9, 10, 11).toISOString(), source: "local" });
    useStore.getState().addTask("Task from agent", { dueDate: new Date(2026, 9, 11, 9).toISOString() });
    await vi.advanceTimersByTimeAsync(1500);
    const kinds = h.syncIndex.mock.calls.map((c) => c[0].kinds[0]).sort();
    expect(kinds).toEqual(["event", "task"]);
  });

  it("unrelated store changes (timer ticks, theme) never trigger indexing", async () => {
    await startAndSettle();
    useStore.setState({ timeLeft: 100 });
    useStore.setState({ goal: "x" });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.syncIndex).not.toHaveBeenCalled();
  });

  it("changes made while a sync is running are not lost", async () => {
    await startAndSettle();
    let release!: () => void;
    h.syncIndex.mockImplementationOnce(() => new Promise((res) => { release = () => res(OK); }));
    useStore.getState().addTask("first");
    await vi.advanceTimersByTimeAsync(1500);
    expect(h.syncIndex).toHaveBeenCalledTimes(1);
    const second = useStore.getState().addTask("second");
    await vi.advanceTimersByTimeAsync(1500);
    expect(h.syncIndex).toHaveBeenCalledTimes(1); // serialised: waits for the running one
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.syncIndex).toHaveBeenCalledTimes(2);
    expect(lastCall()).toMatchObject({ kinds: ["task"], ids: [second] });
  });
});

describe("failures never surface", () => {
  it("swallows sync errors (sync and async) and retries with backoff, then stops", async () => {
    h.syncIndex.mockRejectedValue(new Error("Ollama isn't reachable"));
    stop = startAutoIndexing();
    await vi.advanceTimersByTimeAsync(3000);
    expect(h.syncIndex).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(h.syncIndex).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(h.syncIndex).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(h.syncIndex).toHaveBeenCalledTimes(4);
    // Out of retries: quiet until something changes.
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(h.syncIndex).toHaveBeenCalledTimes(4);
  });

  it("after retries run out, the next change reconciles everything again", async () => {
    h.syncIndex.mockRejectedValue(new Error("down"));
    stop = startAutoIndexing();
    await vi.advanceTimersByTimeAsync(3000 + 30_000 + 120_000 + 600_000);
    expect(h.syncIndex).toHaveBeenCalledTimes(4);
    h.syncIndex.mockClear();
    h.syncIndex.mockResolvedValue(OK);
    useStore.getState().addTask("back online");
    await vi.advanceTimersByTimeAsync(1500);
    expect(h.syncIndex).toHaveBeenCalledTimes(1);
    expect(lastCall().kinds).toEqual(ALL);
  });

  it("a throwing syncIndex (not just a rejecting one) is contained too", async () => {
    h.syncIndex.mockImplementation(() => {
      throw new Error("boom");
    });
    await startAndSettle();
    useStore.getState().addTask("x");
    await vi.advanceTimersByTimeAsync(1500);
    expect(h.syncIndex).toHaveBeenCalled();
  });

  it("a recovered sync resets the backoff", async () => {
    h.syncIndex.mockRejectedValueOnce(new Error("blip")).mockResolvedValue(OK);
    stop = startAutoIndexing();
    await vi.advanceTimersByTimeAsync(3000);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(h.syncIndex).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(h.syncIndex).toHaveBeenCalledTimes(2);
  });
});
