import { useStore } from "../store/useStore";
import { completeOnce } from "./aiOneShot";

// F13 — turn the week's raw focus data + reflections + task activity into a
// short, encouraging narrative with one concrete suggestion for next week.

function weekStartISO(): string {
  const d = new Date();
  const day = d.getDay();
  d.setDate(d.getDate() - day + (day === 0 ? -6 : 1)); // Monday
  d.setHours(0, 0, 0, 0);
  return d.toISOString().split("T")[0];
}

export function buildWeekFacts(): string {
  const s = useStore.getState();
  const weekStart = weekStartISO();

  const sessions = s.focusSessions.filter((f) => f.date >= weekStart);
  const totalSecs = sessions.reduce((a, b) => a + b.duration, 0);
  const totalSessions = sessions.reduce((a, b) => a + b.sessions, 0);
  const goalSecs = s.weeklyGoalHours * 3600;

  const byDay = sessions
    .map((f) => `${f.date}: ${(f.duration / 3600).toFixed(1)}h (${f.sessions} sessions)`)
    .join("\n");

  const reflections = s.focusReflections
    .filter((r) => r.at.split("T")[0] >= weekStart)
    .map((r) => `- ${r.text}`)
    .slice(-40)
    .join("\n");

  const doneTasks = s.tasks.filter((t) => t.completed).length;
  const openTasks = s.tasks.filter((t) => !t.completed).length;

  return [
    `Week starting ${weekStart}.`,
    `Focus: ${(totalSecs / 3600).toFixed(1)}h of a ${s.weeklyGoalHours}h goal (${Math.round((totalSecs / Math.max(goalSecs, 1)) * 100)}%), ${totalSessions} pomodoro sessions.`,
    `Per day:\n${byDay || "(no focus logged)"}`,
    `Tasks: ${doneTasks} completed, ${openTasks} still open.`,
    reflections ? `What the user said they accomplished:\n${reflections}` : "No session reflections logged.",
  ].join("\n\n");
}

export function hasWeekData(): boolean {
  const s = useStore.getState();
  const weekStart = weekStartISO();
  return s.focusSessions.some((f) => f.date >= weekStart && f.duration > 0);
}

const SYSTEM = `You write a brief weekly study review for one student, in the second person ("you").
Structure (use short markdown):
- One sentence summarizing the week's focus vs. their goal.
- 2-3 bullet observations grounded ONLY in the data provided (highlight the strongest day, momentum, what they accomplished).
- One concrete, encouraging suggestion for next week.
Keep it under 130 words. Warm but not gushing. Never invent numbers or facts not in the data.`;

export async function generateWeeklyReview(): Promise<string> {
  const facts = buildWeekFacts();
  return (await completeOnce({ system: SYSTEM, user: facts, maxTokens: 512 })).trim();
}
