import type { PomodoroMode } from "../store/useStore";

const LOCAL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Local calendar date, not toISOString(): that is UTC and flips the day at the
// wrong hour for anyone away from UTC.
export function localDateString(now: Date = new Date()): string {
  const y = String(now.getFullYear()).padStart(4, "0");
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// A null date with a non-zero counter is pre-8.09.1 state that can't be dated;
// it is treated as stale. Corrupt values (bad counter, malformed date) also
// reset, since keeping them would poison every later increment.
export function needsCycleReset(
  lastSessionDate: string | null,
  sessionsCompleted: number,
  now: Date = new Date()
): boolean {
  if (!Number.isInteger(sessionsCompleted) || sessionsCompleted < 0) return true;
  if (lastSessionDate == null) return sessionsCompleted > 0;
  if (typeof lastSessionDate !== "string" || !LOCAL_DATE_RE.test(lastSessionDate)) return true;
  return lastSessionDate < localDateString(now);
}

export interface WorkCompletion {
  sessionsCompleted: number;
  lastSessionDate: string;
  nextMode: Exclude<PomodoroMode, "work">;
}

// Applies the day check itself so a work period that began before midnight and
// ends after it counts as session 1 of the new day even if no rollover ran.
export function nextAfterWorkComplete(
  lastSessionDate: string | null,
  sessionsCompleted: number,
  sessionsUntilLongBreak: number,
  now: Date = new Date()
): WorkCompletion {
  const base = needsCycleReset(lastSessionDate, sessionsCompleted, now) ? 0 : sessionsCompleted;
  const count = base + 1;
  const isLongBreak = sessionsUntilLongBreak > 0 && count % sessionsUntilLongBreak === 0;
  return {
    sessionsCompleted: count,
    lastSessionDate: localDateString(now),
    nextMode: isLongBreak ? "longBreak" : "break",
  };
}
