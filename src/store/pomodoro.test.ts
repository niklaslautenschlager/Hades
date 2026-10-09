import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/sound", () => ({ playSound: vi.fn() }));

import { useStore } from "./useStore";

// The app tsconfig has no Node types, so reach process.env through globalThis.
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;

const MIN = 60_000;
const local = (y: number, mo: number, d: number, h = 12, mi = 0) => new Date(y, mo - 1, d, h, mi);

function resetPomodoro(overrides: Partial<ReturnType<typeof useStore.getState>> = {}) {
  useStore.setState({
    pomodoroMode: "work",
    timeLeft: 25 * 60,
    isRunning: false,
    _intervalId: null,
    timerEndsAt: null,
    sessionsCompleted: 0,
    lastSessionDate: null,
    workDuration: 25,
    breakDuration: 5,
    longBreakDuration: 15,
    sessionsUntilLongBreak: 4,
    focusSessions: [],
    activeTaskId: null,
    sessionReflectionEnabled: false,
    reflectionPending: false,
    ...overrides,
  });
}

const get = () => useStore.getState();

beforeEach(() => {
  // Node has no localStorage, so the persist middleware warns on every write.
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.useFakeTimers();
  vi.setSystemTime(local(2026, 10, 8, 10, 0));
  resetPomodoro();
});

afterEach(() => {
  get().pauseTimer();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("persisted shape", () => {
  it("defaults lastSessionDate to null so older persisted state hydrates cleanly", () => {
    expect(useStore.getInitialState().lastSessionDate).toBeNull();
  });
});

describe("rolloverIfNewDay (app start / focus)", () => {
  it.each(["break", "longBreak"] as const)(
    "resets the counter and returns a stale %s to a fresh Focus interval when idle",
    (staleMode) => {
      resetPomodoro({
        sessionsCompleted: 3,
        lastSessionDate: "2026-10-07",
        pomodoroMode: staleMode,
        timeLeft: 90,
      });
      get().rolloverIfNewDay();
      expect(get().sessionsCompleted).toBe(0);
      expect(get().lastSessionDate).toBeNull();
      expect(get().pomodoroMode).toBe("work");
      expect(get().timeLeft).toBe(25 * 60);
      expect(get().isRunning).toBe(false);
    }
  );

  it("uses the configured work duration for the fresh interval", () => {
    resetPomodoro({
      workDuration: 50,
      sessionsCompleted: 2,
      lastSessionDate: "2026-10-07",
      pomodoroMode: "break",
      timeLeft: 120,
    });
    get().rolloverIfNewDay();
    expect(get().timeLeft).toBe(50 * 60);
  });

  it("resets the counter but leaves a running timer's mode and countdown untouched", () => {
    resetPomodoro({
      sessionsCompleted: 3,
      lastSessionDate: "2026-10-07",
      pomodoroMode: "break",
      timeLeft: 123,
      isRunning: true,
      timerEndsAt: Date.now() + 123_000,
    });
    const endsAt = get().timerEndsAt;
    get().rolloverIfNewDay();
    expect(get().sessionsCompleted).toBe(0);
    expect(get().lastSessionDate).toBeNull();
    expect(get().pomodoroMode).toBe("break");
    expect(get().timeLeft).toBe(123);
    expect(get().isRunning).toBe(true);
    expect(get().timerEndsAt).toBe(endsAt);
  });

  it("leaves a real running countdown alone when the day changes under it", () => {
    resetPomodoro({ pomodoroMode: "break", timeLeft: 5 * 60, sessionsCompleted: 2, lastSessionDate: "2026-10-08" });
    get().startTimer();
    const endsAt = get().timerEndsAt;
    vi.setSystemTime(local(2026, 10, 9, 0, 1));
    get().rolloverIfNewDay();
    expect(get().sessionsCompleted).toBe(0);
    expect(get().pomodoroMode).toBe("break");
    expect(get().isRunning).toBe(true);
    expect(get().timerEndsAt).toBe(endsAt);
  });

  it("resets legacy state: no lastSessionDate but a non-zero counter", () => {
    resetPomodoro({ sessionsCompleted: 7, lastSessionDate: null, pomodoroMode: "longBreak", timeLeft: 900 });
    get().rolloverIfNewDay();
    expect(get().sessionsCompleted).toBe(0);
    expect(get().pomodoroMode).toBe("work");
    expect(get().timeLeft).toBe(25 * 60);
  });

  it("is a no-op with no state write when there is nothing to reset", () => {
    const listener = vi.fn();
    const unsubscribe = useStore.subscribe(listener);

    resetPomodoro();
    listener.mockClear();
    const before = get();
    get().rolloverIfNewDay();
    expect(listener).not.toHaveBeenCalled();
    expect(get()).toBe(before);

    resetPomodoro({ sessionsCompleted: 2, lastSessionDate: "2026-10-08", pomodoroMode: "break", timeLeft: 200 });
    listener.mockClear();
    const sameDay = get();
    get().rolloverIfNewDay();
    expect(listener).not.toHaveBeenCalled();
    expect(get()).toBe(sameDay);

    unsubscribe();
  });

  it("is idempotent: the second call after a reset writes nothing", () => {
    resetPomodoro({ sessionsCompleted: 3, lastSessionDate: "2026-10-07", pomodoroMode: "break", timeLeft: 60 });
    get().rolloverIfNewDay();
    const listener = vi.fn();
    const unsubscribe = useStore.subscribe(listener);
    get().rolloverIfNewDay();
    unsubscribe();
    expect(listener).not.toHaveBeenCalled();
  });

  it("does not undo a deliberate mode switch made after the reset", () => {
    resetPomodoro({ sessionsCompleted: 3, lastSessionDate: "2026-10-07", pomodoroMode: "break", timeLeft: 60 });
    get().rolloverIfNewDay();
    get().setPomodoroMode("longBreak");
    get().rolloverIfNewDay();
    expect(get().pomodoroMode).toBe("longBreak");
  });

  it("repairs a corrupt counter or date", () => {
    resetPomodoro({ sessionsCompleted: Number.NaN, lastSessionDate: "garbage" });
    get().rolloverIfNewDay();
    expect(get().sessionsCompleted).toBe(0);
    expect(get().lastSessionDate).toBeNull();
  });

  it("works on state rehydrated from a pre-8.09.1 blob that has no lastSessionDate", async () => {
    const legacyBlob = JSON.stringify({
      state: { sessionsCompleted: 5, pomodoroMode: "longBreak", timeLeft: 900 },
      version: 12,
    });
    vi.stubGlobal("window", {
      localStorage: { getItem: () => legacyBlob, setItem: () => {}, removeItem: () => {} },
    });
    vi.resetModules();
    try {
      const { useStore: hydrated } = await import("./useStore");
      expect(hydrated.persist.hasHydrated()).toBe(true);
      expect(hydrated.getState().sessionsCompleted).toBe(5);
      expect(hydrated.getState().lastSessionDate).toBeNull();

      hydrated.getState().rolloverIfNewDay();
      expect(hydrated.getState().sessionsCompleted).toBe(0);
      expect(hydrated.getState().pomodoroMode).toBe("work");
      expect(hydrated.getState().timeLeft).toBe(25 * 60);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("completing a work period", () => {
  it("yesterday ended 3/4: today's first completed session is 1 and followed by a short break", () => {
    resetPomodoro({ sessionsCompleted: 3, lastSessionDate: "2026-10-07" });
    get().startTimer();
    vi.advanceTimersByTime(25 * MIN);
    expect(get().isRunning).toBe(false);
    expect(get().sessionsCompleted).toBe(1);
    expect(get().lastSessionDate).toBe("2026-10-08");
    expect(get().pomodoroMode).toBe("break");
    expect(get().timeLeft).toBe(5 * 60);
  });

  it("same day 3/4: the 4th completion gives a long break", () => {
    resetPomodoro({ sessionsCompleted: 3, lastSessionDate: "2026-10-08" });
    get().startTimer();
    vi.advanceTimersByTime(25 * MIN);
    expect(get().sessionsCompleted).toBe(4);
    expect(get().lastSessionDate).toBe("2026-10-08");
    expect(get().pomodoroMode).toBe("longBreak");
    expect(get().timeLeft).toBe(15 * 60);
  });

  it("legacy state (no date, counter 3) does not trigger a long break on the first session", () => {
    resetPomodoro({ sessionsCompleted: 3, lastSessionDate: null });
    get().startTimer();
    vi.advanceTimersByTime(25 * MIN);
    expect(get().sessionsCompleted).toBe(1);
    expect(get().pomodoroMode).toBe("break");
  });

  it("a fresh install records its first session with today's date", () => {
    get().startTimer();
    vi.advanceTimersByTime(25 * MIN);
    expect(get().sessionsCompleted).toBe(1);
    expect(get().lastSessionDate).toBe("2026-10-08");
    expect(get().focusSessions).toHaveLength(1);
  });

  it("a period started at 23:55 and finished at 00:05 is session 1 of the new day", () => {
    vi.setSystemTime(local(2026, 10, 7, 23, 55));
    resetPomodoro({ workDuration: 10, timeLeft: 10 * 60, sessionsCompleted: 3, lastSessionDate: "2026-10-07" });
    get().startTimer();
    expect(get().sessionsCompleted).toBe(3);

    vi.advanceTimersByTime(10 * MIN);

    expect(new Date().getDate()).toBe(8);
    expect(get().isRunning).toBe(false);
    expect(get().sessionsCompleted).toBe(1);
    expect(get().lastSessionDate).toBe("2026-10-08");
    expect(get().pomodoroMode).toBe("break");
  });

  it("is still session 1 when a focus-triggered rollover already ran mid-period", () => {
    vi.setSystemTime(local(2026, 10, 7, 23, 55));
    resetPomodoro({ workDuration: 10, timeLeft: 10 * 60, sessionsCompleted: 3, lastSessionDate: "2026-10-07" });
    get().startTimer();

    vi.advanceTimersByTime(6 * MIN);
    get().rolloverIfNewDay();
    expect(get().sessionsCompleted).toBe(0);
    expect(get().isRunning).toBe(true);
    expect(get().pomodoroMode).toBe("work");

    vi.advanceTimersByTime(4 * MIN);
    expect(get().sessionsCompleted).toBe(1);
    expect(get().pomodoroMode).toBe("break");
    expect(get().lastSessionDate).toBe("2026-10-08");
  });

  it("starting a session on a new day from a stale break begins a fresh Focus interval", () => {
    resetPomodoro({
      sessionsCompleted: 4,
      lastSessionDate: "2026-10-07",
      pomodoroMode: "longBreak",
      timeLeft: 15 * 60,
    });
    get().startTimer();
    expect(get().pomodoroMode).toBe("work");
    expect(get().sessionsCompleted).toBe(0);
    expect(get().timerEndsAt).toBe(Date.now() + 25 * 60 * 1000);
    expect(get().isRunning).toBe(true);
  });

  it.each([
    ["America/Los_Angeles", 23, 30],
    ["Pacific/Auckland", 0, 30],
  ] as const)("stamps the local date, not the UTC date (%s %i:%i)", (tz, hour, minute) => {
    const prev = env.TZ;
    env.TZ = tz;
    try {
      const instant = new Date(2026, 9, 8, hour, minute);
      expect(instant.toISOString().slice(0, 10)).not.toBe("2026-10-08");
      vi.setSystemTime(instant);
      resetPomodoro({ workDuration: 1, timeLeft: 60 });
      get().startTimer();
      vi.advanceTimersByTime(MIN);
      expect(get().lastSessionDate).toBe("2026-10-08");
    } finally {
      if (prev === undefined) delete env.TZ;
      else env.TZ = prev;
    }
  });
});

describe("skipSession", () => {
  it("skipping a work period sets lastSessionDate and advances the counter", () => {
    expect(get().lastSessionDate).toBeNull();
    get().skipSession();
    expect(get().sessionsCompleted).toBe(1);
    expect(get().lastSessionDate).toBe("2026-10-08");
    expect(get().pomodoroMode).toBe("break");
    expect(get().isRunning).toBe(false);
  });

  it("skipping the 4th work period of the day gives a long break", () => {
    resetPomodoro({ sessionsCompleted: 3, lastSessionDate: "2026-10-08" });
    get().skipSession();
    expect(get().sessionsCompleted).toBe(4);
    expect(get().pomodoroMode).toBe("longBreak");
  });

  it("skipping a running work period stops it and counts it", () => {
    get().startTimer();
    vi.advanceTimersByTime(3 * MIN);
    get().skipSession();
    expect(get().isRunning).toBe(false);
    expect(get().timerEndsAt).toBeNull();
    expect(get().sessionsCompleted).toBe(1);
    expect(get().lastSessionDate).toBe("2026-10-08");
  });

  it("a skip after midnight starts the new day's cycle at 1, not a long break", () => {
    resetPomodoro({ sessionsCompleted: 3, lastSessionDate: "2026-10-07" });
    get().skipSession();
    expect(get().sessionsCompleted).toBe(1);
    expect(get().lastSessionDate).toBe("2026-10-08");
    expect(get().pomodoroMode).toBe("break");
  });

  it("skipping a stale break on a new day yields a fresh Focus interval and no counted session", () => {
    resetPomodoro({
      sessionsCompleted: 4,
      lastSessionDate: "2026-10-07",
      pomodoroMode: "longBreak",
      timeLeft: 15 * 60,
    });
    get().skipSession();
    expect(get().pomodoroMode).toBe("work");
    expect(get().sessionsCompleted).toBe(0);
    expect(get().lastSessionDate).toBeNull();
    expect(get().timeLeft).toBe(25 * 60);
  });
});

describe("break periods", () => {
  it.each([
    ["break", 5],
    ["longBreak", 15],
  ] as const)("a completed %s leaves the counter and date alone and returns to Focus", (mode, minutes) => {
    resetPomodoro({
      pomodoroMode: mode,
      timeLeft: minutes * 60,
      sessionsCompleted: 2,
      lastSessionDate: "2026-10-08",
    });
    get().startTimer();
    vi.advanceTimersByTime(minutes * MIN);
    expect(get().isRunning).toBe(false);
    expect(get().pomodoroMode).toBe("work");
    expect(get().sessionsCompleted).toBe(2);
    expect(get().lastSessionDate).toBe("2026-10-08");
    expect(get().focusSessions).toHaveLength(0);
  });

  it.each(["break", "longBreak"] as const)(
    "skipping a same-day %s leaves the counter and date alone",
    (mode) => {
      resetPomodoro({
        pomodoroMode: mode,
        timeLeft: 60,
        sessionsCompleted: 2,
        lastSessionDate: "2026-10-08",
      });
      get().skipSession();
      expect(get().pomodoroMode).toBe("work");
      expect(get().sessionsCompleted).toBe(2);
      expect(get().lastSessionDate).toBe("2026-10-08");
    }
  );

  it("a break that finishes after midnight does not stamp a session date", () => {
    vi.setSystemTime(local(2026, 10, 7, 23, 58));
    resetPomodoro({
      pomodoroMode: "break",
      breakDuration: 5,
      timeLeft: 5 * 60,
      sessionsCompleted: 2,
      lastSessionDate: "2026-10-07",
    });
    get().startTimer();
    vi.advanceTimersByTime(5 * MIN);
    expect(get().pomodoroMode).toBe("work");
    expect(get().sessionsCompleted).toBe(0);
    expect(get().lastSessionDate).toBeNull();
  });
});
