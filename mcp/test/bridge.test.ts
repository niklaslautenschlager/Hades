import assert from "node:assert/strict";
import { mkdir, readdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { HadesNotesStore } from "../src/storage.js";
import { BridgeError, HadesBridge, bridgeFilePath, isValidWhen, parseWhen, type BridgeSnapshot } from "../src/bridge.js";
import { NOW, makeSnapshot, pageBody, pdfText, simulateApp, withTempDir, writeSnapshot } from "./fixtures.js";

const rejectsWith = (code: string) => (error: unknown) => {
  assert.ok(error instanceof BridgeError, `expected BridgeError, got ${String(error)}`);
  assert.equal((error as BridgeError).code, code);
  return true;
};

async function withBridge(
  run: (ctx: { root: string; dir: string; bridge: HadesBridge }) => Promise<void>,
  options: { now?: () => number; ackTimeoutMs?: number; snapshot?: BridgeSnapshot | null } = {},
): Promise<void> {
  await withTempDir(async (root) => {
    const dir = path.join(root, ".hades-bridge");
    if (options.snapshot !== null) await writeSnapshot(dir, options.snapshot ?? makeSnapshot());
    const bridge = HadesBridge.create(root, { now: options.now ?? (() => NOW), pollIntervalMs: 10, ackTimeoutMs: options.ackTimeoutMs ?? 400 });
    await run({ root, dir, bridge });
  });
}

async function trySymlink(target: string, link: string): Promise<boolean> {
  try { await symlink(target, link, "dir"); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EPERM") return false;
    throw error;
  }
}

// ── Snapshot handling ────────────────────────────────────────────────────────

test("reports a clear error when the bridge folder or snapshot is missing", async () => {
  await withBridge(async ({ root, dir, bridge }) => {
    await assert.rejects(bridge.getStudyStats(), rejectsWith("BRIDGE_NOT_RUNNING"));
    await mkdir(dir);
    await assert.rejects(bridge.getStudyStats(), (error: unknown) => {
      assert.ok(error instanceof BridgeError);
      assert.match(error.message, /not enabled or not running/);
      assert.ok(!error.message.includes(root));
      return true;
    });
  }, { snapshot: null });
});

test("rejects malformed or unsupported snapshots without leaking paths", async () => {
  await withBridge(async ({ root, dir, bridge }) => {
    for (const body of ["{not json", "[]", JSON.stringify({ ...makeSnapshot(), schema: 2 }), JSON.stringify({ ...makeSnapshot(), stats: { weeklyGoalHours: "lots" } })]) {
      await writeSnapshot(dir, body);
      await assert.rejects(bridge.getStudyStats(), (error: unknown) => {
        assert.ok(error instanceof BridgeError);
        assert.equal(error.code, "BRIDGE_SNAPSHOT_INVALID");
        assert.ok(!error.message.includes(root));
        return true;
      });
    }
    await writeSnapshot(dir, JSON.stringify({ ...makeSnapshot(), schema: 2 }));
    await assert.rejects(bridge.getStudyStats(), /different format version/);
  });
});

test("refuses an oversized snapshot", async () => {
  await withBridge(async ({ dir, bridge }) => {
    await writeSnapshot(dir, "x".repeat(9 * 1024 * 1024));
    await assert.rejects(bridge.getStudyStats(), rejectsWith("BRIDGE_SNAPSHOT_INVALID"));
  });
});

test("flags snapshots older than two minutes as stale but still returns them", async () => {
  const generated = makeSnapshot();
  for (const [offsetMs, stale] of [[30_000, false], [120_000, false], [121_000, true], [600_000, true]] as const) {
    await withBridge(async ({ bridge }) => {
      const stats = await bridge.getStudyStats();
      assert.equal(stats.bridge.stale, stale);
      assert.equal(stats.bridge.ageSeconds, Math.round(offsetMs / 1000));
      assert.equal(stats.bridge.generatedAt, generated.generatedAt);
      assert.equal(stats.weeklyGoalHours, 20);
      assert.equal("warning" in stats.bridge, stale);
    }, { now: () => NOW + offsetMs, snapshot: generated });
  }
});

test("treats a snapshot dated in the future as fresh", async () => {
  await withBridge(async ({ bridge }) => {
    const stats = await bridge.getStudyStats();
    assert.deepEqual([stats.bridge.stale, stats.bridge.ageSeconds], [false, 0]);
  }, { now: () => NOW - 60_000 });
});

test("get_study_stats returns the shared stats", async () => {
  await withBridge(async ({ bridge }) => {
    const stats = await bridge.getStudyStats();
    assert.equal(stats.hoursThisWeek, 3.5);
    assert.equal(stats.todayFocusSeconds, 1500);
    assert.deepEqual(stats.pomodoroCycle, { completedInCycle: 2, cycleLength: 4, sessionsToday: 6 });
    assert.equal(stats.goal, "Finish chapter 3");
  });
});

// ── query_schedule ───────────────────────────────────────────────────────────

test("query_schedule defaults to now through 14 days plus every open task", async () => {
  await withBridge(async ({ bridge }) => {
    const result = await bridge.querySchedule({ limit: 50 }) as { events: { id: string }[]; tasks: { id: string }[]; eventsTotal: number; window: { from: string; to: string }; note?: string };
    assert.deepEqual(result.events.map((event) => event.id), ["e-today", "e-late", "e-next", "e-exam"]);
    assert.equal(result.eventsTotal, 4);
    assert.equal(result.window.from, new Date(NOW).toISOString());
    assert.equal(result.window.to, new Date(NOW + 14 * 86_400_000).toISOString());
    assert.equal(result.note, undefined);
  });
});

test("query_schedule without a window returns open tasks only, soonest due first and undated last", async () => {
  await withBridge(async ({ bridge }) => {
    const result = await bridge.querySchedule({ include: ["tasks"], limit: 50 }) as { tasks: { id: string; completed: boolean }[]; tasksTotal: number };
    assert.deepEqual(result.tasks.map((task) => task.id), ["t-over", "t-soon", "t-later", "t-none"]);
    assert.ok(result.tasks.every((task) => task.completed === false), "completed tasks are not returned by default");
    assert.equal(result.tasksTotal, 4);
  });
});

test("query_schedule with an explicit window returns tasks due inside it, completed ones included and flagged", async () => {
  await withBridge(async ({ bridge }) => {
    const both = await bridge.querySchedule({ from: "2026-10-14", to: "2026-10-16", include: ["tasks"], limit: 50 }) as { tasks: { id: string; completed: boolean }[] };
    assert.deepEqual(both.tasks.map((task) => [task.id, task.completed]), [["t-done", true], ["t-soon", false]]);

    const fromOnly = await bridge.querySchedule({ from: "2026-10-02", include: ["tasks"], limit: 50 }) as { tasks: { id: string }[] };
    assert.deepEqual(fromOnly.tasks.map((task) => task.id), ["t-done-old", "t-done", "t-soon"], "'from' alone spans 14 days; overdue, undated and later tasks are excluded");

    const toOnly = await bridge.querySchedule({ to: "2026-10-16", include: ["tasks"], limit: 50 }) as { tasks: { id: string }[] };
    assert.deepEqual(toOnly.tasks.map((task) => task.id), ["t-done", "t-soon"], "'to' alone starts at now");
  });
});

test("query_schedule honours include and limit", async () => {
  await withBridge(async ({ bridge }) => {
    const onlyTasks = await bridge.querySchedule({ include: ["tasks"], limit: 2 }) as Record<string, unknown[]>;
    assert.equal("events" in onlyTasks, false);
    assert.equal(onlyTasks.tasks.length, 2);
    assert.equal(onlyTasks.tasksTotal as unknown as number, 4);
    const onlyEvents = await bridge.querySchedule({ include: ["events"], limit: 1 }) as Record<string, unknown[]>;
    assert.equal("tasks" in onlyEvents, false);
    assert.equal(onlyEvents.events.length, 1);
    assert.equal(onlyEvents.eventsTotal as unknown as number, 4);
  });
});

test("query_schedule interprets date-only bounds in the Hades timezone, inclusive of the whole day", async () => {
  await withBridge(async ({ bridge }) => {
    const result = await bridge.querySchedule({ from: "2026-10-12", to: "2026-10-12", limit: 50 }) as { events: { id: string }[]; tasks: unknown[]; window: { from: string; to: string } };
    assert.equal(result.window.from, "2026-10-12T04:00:00.000Z");
    assert.equal(result.window.to, "2026-10-13T03:59:59.999Z");
    assert.deepEqual(result.events.map((event) => event.id), ["e-today", "e-late"]);
    assert.deepEqual(result.tasks, []);
  });
});

test("query_schedule limits tasks to the window when one is given and flags ranges Hades does not share", async () => {
  await withBridge(async ({ bridge }) => {
    const result = await bridge.querySchedule({ from: "2026-10-14", to: "2026-10-16", limit: 50 }) as { tasks: { id: string }[]; note?: string };
    assert.deepEqual(result.tasks.map((task) => task.id), ["t-done", "t-soon"]);
    assert.equal(result.note, undefined);
    const wide = await bridge.querySchedule({ from: "2026-01-01", to: "2027-01-01", include: ["events"], limit: 50 }) as { events: unknown[]; note?: string };
    assert.match(wide.note ?? "", /only shares events between/);
    assert.doesNotMatch(wide.note ?? "", /Completed tasks/, "no task note when tasks were not requested");
    assert.equal(wide.events.length, 6);
    const wideTasks = await bridge.querySchedule({ from: "2026-01-01", to: "2027-01-01", include: ["tasks"], limit: 50 }) as { note?: string };
    assert.match(wideTasks.note ?? "", /Completed tasks are only shared when due between/);
  });
});

test("query_schedule rejects reversed and malformed windows", async () => {
  await withBridge(async ({ bridge }) => {
    await assert.rejects(bridge.querySchedule({ from: "2026-10-20", to: "2026-10-10", limit: 5 }), rejectsWith("INVALID_ARGUMENT"));
    await assert.rejects(bridge.querySchedule({ from: "next tuesday", limit: 5 }), rejectsWith("INVALID_ARGUMENT"));
    await assert.rejects(bridge.querySchedule({ to: "2026-02-31", limit: 5 }), rejectsWith("INVALID_ARGUMENT"));
  });
});

test("flags truncated schedules as possibly incomplete", async () => {
  const snapshot = makeSnapshot();
  snapshot.schedule.eventsTruncated = true;
  snapshot.schedule.tasksTruncated = true;
  await withBridge(async ({ bridge }) => {
    const result = await bridge.querySchedule({ limit: 50 }) as Record<string, unknown>;
    assert.equal(result.eventsMayBeIncomplete, true);
    assert.equal(result.tasksMayBeIncomplete, true);
  }, { snapshot });
});

test("date parsing handles offsets, DST and invalid calendar dates", () => {
  assert.equal(new Date(parseWhen("2026-10-12T09:00", "America/New_York", "start")).toISOString(), "2026-10-12T13:00:00.000Z");
  assert.equal(new Date(parseWhen("2026-11-02", "America/New_York", "start")).toISOString(), "2026-11-02T05:00:00.000Z");
  assert.equal(new Date(parseWhen("2026-11-01", "America/New_York", "end")).toISOString(), "2026-11-02T04:59:59.999Z");
  assert.equal(new Date(parseWhen("2026-10-12T09:00:00+0200", "America/New_York", "start")).toISOString(), "2026-10-12T07:00:00.000Z");
  assert.equal(new Date(parseWhen("2026-10-12T09:00:00Z", "Asia/Tokyo", "start")).toISOString(), "2026-10-12T09:00:00.000Z");
  assert.equal(new Date(parseWhen("2026-10-12", "Not/AZone", "start")).toISOString(), "2026-10-12T00:00:00.000Z");
  assert.equal(isValidWhen("2026-02-30"), false);
  assert.equal(isValidWhen("2026-10-12T24:00"), false);
  assert.equal(isValidWhen("2026-10-12T09:00:00.5+02:00"), true);
});

// ── Notes ────────────────────────────────────────────────────────────────────

test("list_open_notes returns metadata only and read_open_note defaults to the active note", async () => {
  await withBridge(async ({ bridge }) => {
    const listed = await bridge.listOpenNotes();
    assert.deepEqual(listed.notes.map((note) => [note.id, note.active]), [["n1", false], ["n2", true]]);
    assert.ok(listed.notes.every((note) => !("content" in note)));
    const active = await bridge.readOpenNote();
    assert.equal(active.id, "n2");
    assert.equal(active.content, "# Physics\nWaves");
    assert.equal((await bridge.readOpenNote("n1")).name, "Algebra");
    await assert.rejects(bridge.readOpenNote("closed-note"), rejectsWith("NOTE_NOT_FOUND"));
  });
});

test("read_open_note reports when no note is active", async () => {
  const snapshot = makeSnapshot();
  snapshot.notes.items.forEach((note) => { note.active = false; });
  await withBridge(async ({ bridge }) => {
    await assert.rejects(bridge.readOpenNote(), rejectsWith("NO_ACTIVE_NOTE"));
    assert.equal((await bridge.readOpenNote("n1")).id, "n1");
  }, { snapshot });
});

// ── PDF ──────────────────────────────────────────────────────────────────────

test("read_open_pdf returns the shared pages in order with metadata", async () => {
  await withBridge(async ({ bridge }) => {
    const pdf = await bridge.readOpenPdf({ maxChars: 50_000 });
    assert.equal(pdf.title, "Thesis");
    assert.equal(pdf.currentPage, 7);
    assert.equal(pdf.pageCount, 20);
    assert.equal(pdf.text, pdfText([5, 6, 7, 8, 9]));
    assert.equal(pdf.truncated, true, "the snapshot itself was truncated");
  });
});

test("read_open_pdf centres on the requested page and truncates to maxChars", async () => {
  await withBridge(async ({ bridge }) => {
    const pdf = await bridge.readOpenPdf({ page: 8, maxChars: 700 });
    assert.ok(pdf.text.includes(`[Page 8]\n${pageBody(8)}`));
    assert.ok(pdf.text.includes(`[Page 7]\n${pageBody(7)}`));
    assert.ok(pdf.text.includes("[Page 9]\n"));
    assert.ok(!pdf.text.includes(pageBody(9)), "page 9 is cut to fit");
    assert.ok(!pdf.text.includes("[Page 5]") && !pdf.text.includes("[Page 6]"));
    assert.ok(pdf.text.length <= 700 + 40);
    assert.equal(pdf.truncated, true);

    const only = await bridge.readOpenPdf({ page: 5, maxChars: 312 });
    assert.equal(only.text, `[Page 5]\n${pageBody(5)}`);
    assert.equal(only.truncated, true);
  });
});

test("read_open_pdf rejects pages Hades did not share and reports a missing PDF", async () => {
  await withBridge(async ({ bridge }) => {
    await assert.rejects(bridge.readOpenPdf({ page: 2 }), (error: unknown) => {
      assert.ok(error instanceof BridgeError);
      assert.equal(error.code, "PAGE_NOT_AVAILABLE");
      assert.match(error.message, /5-9/);
      return true;
    });
  });
  await withBridge(async ({ bridge }) => {
    await assert.rejects(bridge.readOpenPdf({}), rejectsWith("NO_OPEN_PDF"));
  }, { snapshot: makeSnapshot({ pdf: null }) });
});

test("read_open_pdf copes with text that has no page markers or is empty", async () => {
  const plain = makeSnapshot();
  plain.pdf = { ...plain.pdf!, text: "a".repeat(1000), truncated: false };
  await withBridge(async ({ bridge }) => {
    const pdf = await bridge.readOpenPdf({ page: 3, maxChars: 400 });
    assert.equal(pdf.text.length, 400);
    assert.equal(pdf.truncated, true);
    assert.match((pdf as { note?: string }).note ?? "", /page argument was ignored/);
  }, { snapshot: plain });

  const empty = makeSnapshot();
  empty.pdf = { ...empty.pdf!, text: "", truncated: false };
  await withBridge(async ({ bridge }) => {
    const pdf = await bridge.readOpenPdf({});
    assert.equal(pdf.text, "");
    assert.match((pdf as { note?: string }).note ?? "", /no extracted text/);
  }, { snapshot: empty });
});

// ── update_study_stats ───────────────────────────────────────────────────────

const newStats = { ...makeSnapshot().stats, hoursThisWeek: 4, todayFocusSeconds: 3300 };

test("update_study_stats queues a command and returns the stats Hades acknowledges", async () => {
  await withBridge(async ({ dir, bridge }) => {
    const app = simulateApp(dir, () => ({ ok: true, applied: { logFocusMinutes: 30, goal: "Revise" }, stats: newStats }));
    try {
      const result = await bridge.updateStudyStats({ logFocusMinutes: 30, goal: "Revise" });
      assert.deepEqual(result.applied, { logFocusMinutes: 30, goal: "Revise" });
      assert.equal(result.stats.todayFocusSeconds, 3300);
    } finally { await app.stop(); }

    assert.equal(app.seen.length, 1);
    const [command] = app.seen;
    assert.equal(command.v, 1);
    assert.equal(command.type, "update_study_stats");
    assert.match(command.id, /^[a-zA-Z0-9_-]{1,128}$/);
    assert.deepEqual(command.args, { logFocusMinutes: 30, goal: "Revise" });
    assert.equal(Date.parse(command.expiresAt) - Date.parse(command.createdAt), 120_000);
    assert.equal(Date.parse(command.createdAt), NOW);
    assert.deepEqual(await readdir(path.join(dir, "acks")), [], "the consumed ack is removed");
  });
});

test("update_study_stats times out, withdraws its command and says so", async () => {
  await withBridge(async ({ root, dir, bridge }) => {
    const started = Date.now();
    await assert.rejects(bridge.updateStudyStats({ weeklyGoalHours: 12 }), (error: unknown) => {
      assert.ok(error instanceof BridgeError);
      assert.equal(error.code, "BRIDGE_TIMEOUT");
      assert.match(error.message, /did not acknowledge/);
      assert.match(error.message, /withdrawn/);
      assert.ok(!error.message.includes(root));
      return true;
    });
    assert.ok(Date.now() - started >= 150, "waited for the acknowledgement");
    assert.deepEqual(await readdir(path.join(dir, "inbox")), [], "the unconsumed command was deleted");
  }, { ackTimeoutMs: 200 });
});

test("update_study_stats maps Hades rejections to fixed messages", async () => {
  await withBridge(async ({ dir, bridge }) => {
    for (const [code, message, pattern] of [
      ["EXPIRED", "x", /too late/],
      ["NO_CHANGES", "x", /did not contain any change/],
      ["SOMETHING_ELSE", "see /home/victim/secret", /could not apply/],
    ] as const) {
      const app = simulateApp(dir, () => ({ ok: false, error: { code, message } }));
      try {
        await assert.rejects(bridge.updateStudyStats({ goal: "x" }), (error: unknown) => {
          assert.ok(error instanceof BridgeError);
          assert.equal(error.code, "BRIDGE_REJECTED");
          assert.match(error.message, pattern);
          assert.ok(!error.message.includes("victim"));
          return true;
        });
      } finally { await app.stop(); }
    }
  });
});

test("update_study_stats does not queue anything when Hades is not running", async () => {
  await withBridge(async ({ dir, bridge }) => {
    await assert.rejects(bridge.updateStudyStats({ goal: "x" }), rejectsWith("BRIDGE_NOT_RUNNING"));
    await assert.rejects(readdir(path.join(dir, "inbox")), { code: "ENOENT" });
  }, { snapshot: null });
});

test("update_study_stats rejects an acknowledgement for a different command", async () => {
  await withBridge(async ({ dir, bridge }) => {
    const app = simulateApp(dir, () => ({ id: "someone-else", ok: true, applied: {}, stats: newStats }));
    try {
      await assert.rejects(bridge.updateStudyStats({ goal: "x" }), rejectsWith("BRIDGE_SNAPSHOT_INVALID"));
    } finally { await app.stop(); }
  });
});

// ── Path safety ──────────────────────────────────────────────────────────────

test("bridge file ids must match the safe pattern", () => {
  const directory = path.join(path.sep, "bridge", "inbox");
  assert.equal(bridgeFilePath(directory, "abc_DEF-123"), path.join(directory, "abc_DEF-123.json"));
  for (const id of ["..", "../escape", "a/b", "a\\b", "", "a.b", "a b", "x".repeat(129), "id\0", "..%2f", "C:\\evil"]) {
    assert.throws(() => bridgeFilePath(directory, id), rejectsWith("INVALID_ARGUMENT"), JSON.stringify(id));
  }
});

test("refuses a bridge folder that is a symbolic link", async (t) => {
  await withTempDir(async (outside) => {
    await withBridge(async ({ root, bridge }) => {
      await writeSnapshot(path.join(outside, "real"), makeSnapshot());
      if (!(await trySymlink(path.join(outside, "real"), path.join(root, ".hades-bridge")))) return t.skip("symlinks need elevated rights on this platform");
      await assert.rejects(bridge.getStudyStats(), rejectsWith("BRIDGE_UNSAFE_PATH"));
      await assert.rejects(bridge.updateStudyStats({ goal: "x" }), rejectsWith("BRIDGE_UNSAFE_PATH"));
      assert.deepEqual(await readdir(path.join(outside, "real")), ["state.json"], "nothing was written through the link");
    }, { snapshot: null });
  });
});

test("refuses a snapshot file that is a symbolic link", async (t) => {
  await withTempDir(async (outside) => {
    await withBridge(async ({ dir, bridge }) => {
      await mkdir(dir);
      await writeFile(path.join(outside, "elsewhere.json"), JSON.stringify(makeSnapshot()));
      try { await symlink(path.join(outside, "elsewhere.json"), path.join(dir, "state.json"), "file"); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EPERM") return t.skip("symlinks need elevated rights on this platform");
        throw error;
      }
      await assert.rejects(bridge.getStudyStats(), rejectsWith("BRIDGE_UNSAFE_PATH"));
    }, { snapshot: null });
  });
});

test("refuses an inbox that is a symbolic link and writes nothing through it", async (t) => {
  await withTempDir(async (outside) => {
    await withBridge(async ({ dir, bridge }) => {
      if (!(await trySymlink(outside, path.join(dir, "inbox")))) return t.skip("symlinks need elevated rights on this platform");
      await assert.rejects(bridge.updateStudyStats({ goal: "x" }), rejectsWith("BRIDGE_UNSAFE_PATH"));
      assert.deepEqual(await readdir(outside), [], "no command was written outside the bridge");
    });
  });
});

test("an explicit bridge directory replaces the default location", async () => {
  await withTempDir(async (root) => {
    const custom = path.join(root, "elsewhere", "bridge");
    await writeSnapshot(custom, makeSnapshot());
    const bridge = HadesBridge.create(root, { bridgeDir: custom, now: () => NOW });
    assert.equal((await bridge.getStudyStats()).weeklyGoalHours, 20);
    const fallback = HadesBridge.create(root, { now: () => NOW });
    await assert.rejects(fallback.getStudyStats(), rejectsWith("BRIDGE_NOT_RUNNING"));
  });
});

test("the notes store ignores the dot-prefixed bridge folder and its temp files", async () => {
  await withBridge(async ({ root, dir }) => {
    const store = await HadesNotesStore.open(root);
    await store.create("Real note", "body", []);
    const lookalike = "---\nid: injected\nname: Injected\nparentId: \ntags: \ncreatedAt: x\nupdatedAt: x\n---\nsmuggled";
    await mkdir(path.join(dir, "inbox"), { recursive: true });
    await writeFile(path.join(dir, "inbox", "injected.md"), lookalike);
    await writeFile(path.join(root, ".state.json.tmp.md"), lookalike);
    assert.deepEqual((await store.list()).map((note) => note.name), ["Real note"]);
  });
});
