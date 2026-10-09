import { afterEach, describe, expect, it } from "vitest";
import { localDateString, needsCycleReset, nextAfterWorkComplete } from "./pomodoroCycle";

// Built from local components so every assertion holds in any host timezone.
const at = (y: number, mo: number, d: number, h = 12, mi = 0) => new Date(y, mo - 1, d, h, mi);

// The app tsconfig has no Node types, so reach process.env through globalThis.
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const originalTZ = env.TZ;
afterEach(() => {
  if (originalTZ === undefined) delete env.TZ;
  else env.TZ = originalTZ;
});

describe("localDateString", () => {
  it("formats local year, month and day with zero padding", () => {
    expect(localDateString(at(2026, 1, 5, 9, 3))).toBe("2026-01-05");
    expect(localDateString(at(2026, 12, 31, 23, 59))).toBe("2026-12-31");
  });

  it("uses the local date just after midnight and just before it", () => {
    expect(localDateString(at(2026, 10, 8, 0, 30))).toBe("2026-10-08");
    expect(localDateString(at(2026, 10, 8, 23, 30))).toBe("2026-10-08");
  });

  it("defaults to the current time", () => {
    expect(localDateString()).toBe(localDateString(new Date()));
  });

  // toISOString() would put these instants on the neighbouring day. The
  // precondition asserts guard against a host that ignores a runtime TZ change,
  // which would make the test pass vacuously.
  it.each(["Pacific/Auckland", "America/Los_Angeles", "Asia/Kolkata"])(
    "is the local calendar date, not the UTC date, in %s",
    (tz) => {
      env.TZ = tz;
      const lateEvening = new Date(2026, 9, 8, 23, 30);
      const earlyMorning = new Date(2026, 9, 8, 0, 30);
      expect(localDateString(lateEvening)).toBe("2026-10-08");
      expect(localDateString(earlyMorning)).toBe("2026-10-08");
      const utcDiffers =
        lateEvening.toISOString().slice(0, 10) !== "2026-10-08" ||
        earlyMorning.toISOString().slice(0, 10) !== "2026-10-08";
      expect(utcDiffers).toBe(true);
    }
  );
});

describe("needsCycleReset", () => {
  const today = at(2026, 10, 8, 9, 0);

  it("is true when the last session was on an earlier day", () => {
    expect(needsCycleReset("2026-10-07", 3, today)).toBe(true);
    expect(needsCycleReset("2025-12-31", 1, today)).toBe(true);
  });

  it("is false when the last session was today", () => {
    expect(needsCycleReset("2026-10-08", 3, today)).toBe(false);
  });

  it("is true for legacy state: no date but a non-zero counter", () => {
    expect(needsCycleReset(null, 7, today)).toBe(true);
  });

  it("is false for a fresh cycle: no date and a zero counter", () => {
    expect(needsCycleReset(null, 0, today)).toBe(false);
  });

  it("is true for a stale date even when the counter is already zero", () => {
    expect(needsCycleReset("2026-10-07", 0, today)).toBe(true);
  });

  it("does not reset for a date in the future (clock or timezone moved back)", () => {
    expect(needsCycleReset("2026-10-09", 2, today)).toBe(false);
  });

  it("treats corrupt persisted values as needing a reset", () => {
    expect(needsCycleReset("not-a-date", 2, today)).toBe(true);
    expect(needsCycleReset("2026-10-8", 2, today)).toBe(true);
    expect(needsCycleReset("2026-10-08T10:00:00Z", 2, today)).toBe(true);
    expect(needsCycleReset("2026-10-08", Number.NaN, today)).toBe(true);
    expect(needsCycleReset("2026-10-08", -1, today)).toBe(true);
    expect(needsCycleReset("2026-10-08", 1.5, today)).toBe(true);
    expect(needsCycleReset(42 as unknown as string, 1, today)).toBe(true);
  });

  it("flips at local midnight", () => {
    expect(needsCycleReset("2026-10-07", 3, at(2026, 10, 7, 23, 59))).toBe(false);
    expect(needsCycleReset("2026-10-07", 3, at(2026, 10, 8, 0, 0))).toBe(true);
  });

  it("compares local dates, not UTC dates, near midnight", () => {
    env.TZ = "America/Los_Angeles";
    const lateEvening = new Date(2026, 9, 8, 23, 30);
    expect(lateEvening.toISOString().slice(0, 10)).toBe("2026-10-09");
    expect(needsCycleReset("2026-10-08", 2, lateEvening)).toBe(false);
    env.TZ = "Pacific/Auckland";
    const earlyMorning = new Date(2026, 9, 8, 0, 30);
    expect(earlyMorning.toISOString().slice(0, 10)).toBe("2026-10-07");
    expect(needsCycleReset("2026-10-07", 2, earlyMorning)).toBe(true);
    expect(needsCycleReset("2026-10-08", 2, earlyMorning)).toBe(false);
  });
});

describe("nextAfterWorkComplete", () => {
  it("starts a fresh cycle when yesterday ended 3/4: counter 1 and a short break", () => {
    const r = nextAfterWorkComplete("2026-10-07", 3, 4, at(2026, 10, 8, 9, 0));
    expect(r).toEqual({ sessionsCompleted: 1, lastSessionDate: "2026-10-08", nextMode: "break" });
  });

  it("gives a long break on the 4th same-day completion", () => {
    const r = nextAfterWorkComplete("2026-10-08", 3, 4, at(2026, 10, 8, 15, 0));
    expect(r).toEqual({ sessionsCompleted: 4, lastSessionDate: "2026-10-08", nextMode: "longBreak" });
  });

  it("gives short breaks before the cycle completes", () => {
    const now = at(2026, 10, 8, 9, 0);
    expect(nextAfterWorkComplete("2026-10-08", 0, 4, now).nextMode).toBe("break");
    expect(nextAfterWorkComplete("2026-10-08", 1, 4, now).nextMode).toBe("break");
    expect(nextAfterWorkComplete("2026-10-08", 2, 4, now).nextMode).toBe("break");
  });

  it("repeats long breaks every N sessions within a day", () => {
    const now = at(2026, 10, 8, 18, 0);
    expect(nextAfterWorkComplete("2026-10-08", 7, 4, now).nextMode).toBe("longBreak");
    expect(nextAfterWorkComplete("2026-10-08", 5, 4, now).nextMode).toBe("break");
  });

  it("honours a custom sessionsUntilLongBreak", () => {
    const now = at(2026, 10, 8, 9, 0);
    expect(nextAfterWorkComplete("2026-10-08", 1, 2, now).nextMode).toBe("longBreak");
    expect(nextAfterWorkComplete("2026-10-08", 2, 3, now).nextMode).toBe("longBreak");
  });

  it("never grants a long break for a nonsensical interval", () => {
    const now = at(2026, 10, 8, 9, 0);
    expect(nextAfterWorkComplete("2026-10-08", 3, 0, now).nextMode).toBe("break");
    expect(nextAfterWorkComplete("2026-10-08", 3, Number.NaN, now).nextMode).toBe("break");
  });

  it("counts a period that crosses midnight as session 1 of the new day", () => {
    // Started 23:55 with 3/4 done that evening; completes 00:05.
    const r = nextAfterWorkComplete("2026-10-07", 3, 4, at(2026, 10, 8, 0, 5));
    expect(r.sessionsCompleted).toBe(1);
    expect(r.nextMode).toBe("break");
    expect(r.lastSessionDate).toBe("2026-10-08");
  });

  it("treats legacy state (no date, counter > 0) as a fresh cycle", () => {
    const r = nextAfterWorkComplete(null, 3, 4, at(2026, 10, 8, 9, 0));
    expect(r).toEqual({ sessionsCompleted: 1, lastSessionDate: "2026-10-08", nextMode: "break" });
  });

  it("starts from 1 with no date and no sessions", () => {
    const r = nextAfterWorkComplete(null, 0, 4, at(2026, 10, 8, 9, 0));
    expect(r.sessionsCompleted).toBe(1);
  });

  it("recovers from a corrupt counter instead of propagating NaN", () => {
    const r = nextAfterWorkComplete("2026-10-08", Number.NaN, 4, at(2026, 10, 8, 9, 0));
    expect(r.sessionsCompleted).toBe(1);
  });

  it("stamps the local date, not the UTC date, near midnight", () => {
    env.TZ = "America/Los_Angeles";
    const lateEvening = new Date(2026, 9, 8, 23, 30);
    expect(nextAfterWorkComplete(null, 0, 4, lateEvening).lastSessionDate).toBe("2026-10-08");
    env.TZ = "Pacific/Auckland";
    const earlyMorning = new Date(2026, 9, 8, 0, 30);
    expect(nextAfterWorkComplete(null, 0, 4, earlyMorning).lastSessionDate).toBe("2026-10-08");
  });
});
