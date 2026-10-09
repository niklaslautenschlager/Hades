import { mkdir, mkdtemp, readFile, readdir, rename, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { BridgeSnapshot } from "../src/bridge.js";

export const NOW = Date.parse("2026-10-12T10:00:00.000Z");

const pageBody = (page: number) => `p${page} ${"x".repeat(296)}`;
export const pdfText = (pages: number[]) => pages.map((page) => `[Page ${page}]\n${pageBody(page)}`).join("\n\n");
export { pageBody };

export function makeSnapshot(overrides: Partial<BridgeSnapshot> = {}, generatedAt = new Date(NOW).toISOString()): BridgeSnapshot {
  const event = (id: string, title: string, start: string, end: string, isDeadline = false) => ({
    id, title, start, end, startLocal: `local ${start}`, endLocal: `local ${end}`, isDeadline, source: "local" as const,
  });
  return {
    schema: 1,
    generatedAt,
    timezone: "America/New_York",
    utcOffset: "-04:00",
    schedule: {
      window: { from: new Date(NOW - 7 * 86_400_000).toISOString(), to: new Date(NOW + 60 * 86_400_000).toISOString() },
      events: [
        event("e-far", "Far project", "2026-11-20T15:00:00.000Z", "2026-11-20T16:00:00.000Z"),
        event("e-past", "Past lecture", "2026-10-09T14:00:00.000Z", "2026-10-09T15:00:00.000Z"),
        event("e-today", "Standup", "2026-10-12T14:00:00.000Z", "2026-10-12T14:30:00.000Z"),
        event("e-late", "Late study group", "2026-10-13T02:00:00.000Z", "2026-10-13T03:00:00.000Z"),
        event("e-next", "After midnight local", "2026-10-13T05:00:00.000Z", "2026-10-13T06:00:00.000Z"),
        event("e-exam", "Exam", "2026-10-20T13:00:00.000Z", "2026-10-20T14:00:00.000Z", true),
      ],
      eventsTruncated: false,
      tasks: [
        { id: "t-none", text: "Read chapter", completed: false, dueDate: null, dueLocal: null },
        { id: "t-soon", text: "Problem set", completed: false, dueDate: "2026-10-15T20:00:00.000Z", dueLocal: "Thu 2026-10-15 16:00" },
        { id: "t-later", text: "Term paper", completed: false, dueDate: "2026-11-30T20:00:00.000Z", dueLocal: "Mon 2026-11-30 15:00" },
        { id: "t-over", text: "Overdue form", completed: false, dueDate: "2026-10-01T20:00:00.000Z", dueLocal: "Thu 2026-10-01 16:00" },
        { id: "t-done", text: "Submitted lab", completed: true, dueDate: "2026-10-15T10:00:00.000Z", dueLocal: "Thu 2026-10-15 06:00" },
        { id: "t-done-old", text: "Old reading", completed: true, dueDate: "2026-10-06T10:00:00.000Z", dueLocal: "Tue 2026-10-06 06:00" },
      ],
      tasksTruncated: false,
    },
    notes: {
      items: [
        { id: "n1", name: "Algebra", active: false, updatedAt: "2026-10-11T08:00:00.000Z", content: "# Algebra\nGroups", contentLength: 16, truncated: false },
        { id: "n2", name: "Physics", active: true, updatedAt: "2026-10-12T09:00:00.000Z", content: "# Physics\nWaves", contentLength: 15, truncated: false },
      ],
      omitted: 0,
    },
    pdf: { title: "Thesis", docId: "doc1", currentPage: 7, pageCount: 20, text: pdfText([5, 6, 7, 8, 9]), truncated: true },
    stats: {
      weeklyGoalHours: 20,
      hoursThisWeek: 3.5,
      todayFocusSeconds: 1500,
      pomodoroCycle: { completedInCycle: 2, cycleLength: 4, sessionsToday: 6 },
      goal: "Finish chapter 3",
    },
    ...overrides,
  };
}

export async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "hades-bridge-"));
  try { await run(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

export async function writeSnapshot(bridgeDir: string, snapshot: unknown): Promise<void> {
  await mkdir(bridgeDir, { recursive: true });
  await writeFile(path.join(bridgeDir, "state.json"), typeof snapshot === "string" ? snapshot : JSON.stringify(snapshot));
}

export interface SimulatedCommand {
  v: number;
  id: string;
  type: string;
  createdAt: string;
  expiresAt: string;
  args: Record<string, unknown>;
}

/** Plays the Hades app: consumes inbox commands and writes acks the way the app does. */
export function simulateApp(bridgeDir: string, respond: (command: SimulatedCommand) => Record<string, unknown> | null) {
  const seen: SimulatedCommand[] = [];
  let stopped = false;
  const loop = (async () => {
    const inbox = path.join(bridgeDir, "inbox");
    const acks = path.join(bridgeDir, "acks");
    while (!stopped) {
      let names: string[] = [];
      try { names = await readdir(inbox); } catch { /* inbox not created yet */ }
      for (const name of names.filter((entry) => /^[a-zA-Z0-9_-]+\.json$/.test(entry))) {
        const file = path.join(inbox, name);
        let command: SimulatedCommand;
        try { command = JSON.parse(await readFile(file, "utf8")) as SimulatedCommand; } catch { continue; }
        seen.push(command);
        const ack = respond(command);
        if (ack) {
          await mkdir(acks, { recursive: true });
          const temp = path.join(acks, `.${command.id}.tmp`);
          await writeFile(temp, JSON.stringify({ v: 1, id: command.id, at: new Date().toISOString(), ...ack }));
          await rename(temp, path.join(acks, `${command.id}.json`));
          await unlink(file).catch(() => undefined);
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  })();
  return { seen, stop: async () => { stopped = true; await loop; } };
}
