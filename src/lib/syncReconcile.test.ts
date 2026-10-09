import { describe, it, expect } from "vitest";
import type { NoteFile } from "../store/useStore";
import {
  reconcile,
  applyPlanLocally,
  countPending,
  sanitizeBase,
  baseEntryOf,
  hashText,
  normalizeItem,
  EPOCH_ISO,
  SKEW_TOLERANCE_MS,
  TOMBSTONE_MAX_AGE_MS,
  type ReconcileInput,
  type ReconcilePlan,
  type RemoteItem,
  type SyncBase,
  type Tombstones,
} from "./syncReconcile";

const T0 = Date.UTC(2026, 0, 1, 12, 0, 0);
const ts = (sec: number) => new Date(T0 + sec * 1000).toISOString();

function note(id: string, over: Partial<NoteFile> = {}): NoteFile {
  return {
    id,
    name: `Note ${id}`,
    content: `content of ${id}`,
    tags: [],
    parentId: null,
    isFolder: false,
    createdAt: ts(0),
    updatedAt: ts(1),
    ...over,
  };
}
function folder(id: string, over: Partial<NoteFile> = {}): NoteFile {
  return note(id, { name: `Folder ${id}`, content: "", isFolder: true, ...over });
}
const remoteOf = (n: NoteFile, device = "devB"): RemoteItem => ({ ...n, device });

function baseOf(...items: NoteFile[]): SyncBase {
  const b: SyncBase = {};
  for (const i of items) b[i.id] = baseEntryOf(i);
  return b;
}

function run(over: Partial<ReconcileInput>): ReconcilePlan {
  return reconcile({
    local: [],
    remote: [],
    localTombstones: {},
    remoteTombstones: {},
    base: {},
    deviceId: "devA0000",
    now: ts(1000),
    ...over,
  });
}

const byId = (p: ReconcilePlan, id: string) => p.merged.find((m) => m.id === id);

describe("reconcile: one-sided changes", () => {
  it("pushes an item that exists only locally", () => {
    const n = note("a");
    const p = run({ local: [n] });
    expect(p.remoteWrites.map((w) => w.id)).toEqual(["a"]);
    expect(p.remoteWrites[0].device).toBe("devA0000");
    expect(p.localUpserts).toEqual([]);
    expect(p.base.a.h).toBe(hashText("content of a"));
  });

  it("pulls an item that exists only remotely", () => {
    const n = note("a");
    const p = run({ remote: [remoteOf(n)] });
    expect(p.localUpserts.map((u) => u.id)).toEqual(["a"]);
    expect(p.remoteWrites).toEqual([]);
    expect(p.localUpserts[0]).not.toHaveProperty("device");
  });

  it("produces an empty plan when both sides and the base agree", () => {
    const n = note("a");
    const p = run({ local: [n], remote: [remoteOf(n)], base: baseOf(n) });
    expect(p.isEmpty).toBe(true);
    expect(p.conflicts).toEqual([]);
  });

  it("pushes when only local changed since the base", () => {
    const old = note("a");
    const edited = note("a", { content: "new local text", updatedAt: ts(50) });
    const p = run({ local: [edited], remote: [remoteOf(old)], base: baseOf(old) });
    expect(p.conflicts).toEqual([]);
    expect(byId(p, "a")!.content).toBe("new local text");
    expect(p.remoteWrites.map((w) => w.id)).toEqual(["a"]);
    expect(p.localUpserts).toEqual([]);
  });

  it("pulls when only remote changed since the base", () => {
    const old = note("a");
    const edited = note("a", { content: "new remote text", updatedAt: ts(50) });
    const p = run({ local: [old], remote: [remoteOf(edited)], base: baseOf(old) });
    expect(p.conflicts).toEqual([]);
    expect(byId(p, "a")!.content).toBe("new remote text");
    expect(p.localUpserts.map((u) => u.id)).toEqual(["a"]);
    expect(p.remoteWrites).toEqual([]);
  });

  it("detects a remote change by content even when updatedAt is unchanged", () => {
    const old = note("a");
    const edited = note("a", { content: "edited in an external editor" });
    const p = run({ local: [old], remote: [remoteOf(edited)], base: baseOf(old) });
    expect(byId(p, "a")!.content).toBe("edited in an external editor");
  });

  it("re-pushes an item that is merely missing remotely, never deleting it", () => {
    const n = note("a");
    const p = run({ local: [n], remote: [], base: baseOf(n) });
    expect(byId(p, "a")).toBeDefined();
    expect(p.localDeletes).toEqual([]);
    expect(p.remoteWrites.map((w) => w.id)).toEqual(["a"]);
  });

  it("pulls back an item that is missing locally when no tombstone exists", () => {
    const n = note("a");
    const p = run({ local: [], remote: [remoteOf(n)], base: baseOf(n) });
    expect(p.localUpserts.map((u) => u.id)).toEqual(["a"]);
    expect(p.remoteDeletes).toEqual([]);
  });
});

describe("reconcile: conflicts never drop content", () => {
  const base = note("a", { content: "original", updatedAt: ts(1) });

  it("keeps the newer side and preserves the loser as a conflict copy", () => {
    const l = note("a", { content: "local edit", updatedAt: ts(20) });
    const r = remoteOf(note("a", { content: "remote edit", updatedAt: ts(30) }), "devBBBB");
    const p = run({ local: [l], remote: [r], base: baseOf(base) });
    expect(byId(p, "a")!.content).toBe("remote edit");
    expect(p.conflicts).toHaveLength(1);
    expect(p.conflicts[0].winner).toBe("remote");
    const copy = byId(p, p.conflicts[0].copyId!)!;
    expect(copy.content).toBe("local edit");
    expect(copy.name).toBe("Note a (conflict copy devA 2026-01-01 12:00)");
    expect(copy.isFolder).toBe(false);
    expect(p.copies).toEqual([copy.id]);
    expect(p.localUpserts.map((u) => u.id)).toEqual(expect.arrayContaining(["a", copy.id]));
    expect(p.remoteWrites.map((w) => w.id)).toContain(copy.id);
  });

  it("keeps the local side when it is newer and copies the remote loser", () => {
    const l = note("a", { content: "local edit", updatedAt: ts(40) });
    const r = remoteOf(note("a", { content: "remote edit", updatedAt: ts(30) }), "devBBBB");
    const p = run({ local: [l], remote: [r], base: baseOf(base) });
    expect(byId(p, "a")!.content).toBe("local edit");
    const copy = byId(p, p.conflicts[0].copyId!)!;
    expect(copy.content).toBe("remote edit");
    expect(copy.name).toContain("(conflict copy devB");
  });

  it("breaks timestamp ties by device id, identically from both devices' point of view", () => {
    const l = note("a", { content: "from A", updatedAt: ts(20) });
    const r = note("a", { content: "from B", updatedAt: ts(20) });
    const fromA = run({ deviceId: "devA0000", local: [l], remote: [remoteOf(r, "devB0000")], base: baseOf(base) });
    const fromB = run({ deviceId: "devB0000", local: [r], remote: [remoteOf(l, "devA0000")], base: baseOf(base) });
    expect(byId(fromA, "a")!.content).toBe("from B");
    expect(byId(fromB, "a")!.content).toBe("from B");
    const copyA = fromA.copies.map((c) => byId(fromA, c)!)[0];
    const copyB = fromB.copies.map((c) => byId(fromB, c)!)[0];
    expect(copyA).toEqual(copyB);
    expect(copyA.content).toBe("from A");
  });

  it("treats a first sync with differing copies on both sides as a conflict", () => {
    const l = note("a", { content: "local", updatedAt: ts(5) });
    const r = remoteOf(note("a", { content: "remote", updatedAt: ts(6) }));
    const p = run({ local: [l], remote: [r], base: {} });
    expect(p.copies).toHaveLength(1);
    const contents = p.merged.map((m) => m.content).sort();
    expect(contents).toEqual(["local", "remote"]);
  });

  it("does not stack conflict-copy suffixes when a copy conflicts again", () => {
    const first = run({
      local: [note("a", { content: "x", updatedAt: ts(5) })],
      remote: [remoteOf(note("a", { content: "y", updatedAt: ts(6) }))],
    });
    const copy = byId(first, first.copies[0])!;
    const p2 = run({
      local: [{ ...copy, content: "local", updatedAt: ts(100) }],
      remote: [remoteOf({ ...copy, content: "remote", updatedAt: ts(101) })],
    });
    const name = byId(p2, p2.copies[0])!.name;
    expect(name.match(/conflict copy/g)).toHaveLength(1);
  });

  it("merges a rename on one side with an edit on the other without a copy", () => {
    const l = note("a", { content: "original", name: "Renamed", updatedAt: ts(20) });
    const r = remoteOf(note("a", { content: "edited remotely", updatedAt: ts(25) }));
    const p = run({ local: [l], remote: [r], base: baseOf(base) });
    const m = byId(p, "a")!;
    expect(m.name).toBe("Renamed");
    expect(m.content).toBe("edited remotely");
    expect(p.copies).toEqual([]);
    expect(m.updatedAt).toBe(ts(25));
  });

  it("merges a move on one side with an edit on the other without a copy", () => {
    const f = folder("f");
    const b = note("a", { content: "original", updatedAt: ts(1) });
    const l = note("a", { content: "original", parentId: "f", updatedAt: ts(20) });
    const r = remoteOf(note("a", { content: "edited", updatedAt: ts(25) }));
    const p = run({ local: [f, l], remote: [remoteOf(f), r], base: baseOf(f, b) });
    const m = byId(p, "a")!;
    expect(m.parentId).toBe("f");
    expect(m.content).toBe("edited");
    expect(p.copies).toEqual([]);
  });

  it("resolves a rename-vs-rename by the newer timestamp without inventing content", () => {
    const l = note("a", { name: "Left", updatedAt: ts(20) });
    const r = remoteOf(note("a", { name: "Right", updatedAt: ts(30) }));
    const p = run({ local: [l], remote: [r], base: baseOf(base) });
    expect(byId(p, "a")!.name).toBe("Right");
    expect(p.copies).toEqual([]);
    expect(p.conflicts).toHaveLength(1);
  });

  it("does not create a copy when the losing content is empty", () => {
    const l = note("a", { content: "", updatedAt: ts(20) });
    const r = remoteOf(note("a", { content: "kept", updatedAt: ts(30) }));
    const p = run({ local: [l], remote: [r], base: baseOf(base) });
    expect(p.copies).toEqual([]);
    expect(byId(p, "a")!.content).toBe("kept");
  });

  it("never lets a rolled-back remote silently replace newer synced work", () => {
    const synced = note("a", { content: "latest synced work", updatedAt: ts(5000) });
    const rolledBack = remoteOf(note("a", { content: "old version from a restored backup", updatedAt: ts(10) }));
    const p = run({ local: [synced], remote: [rolledBack], base: baseOf(synced), now: ts(6000) });
    expect(byId(p, "a")!.content).toBe("latest synced work");
    expect(p.copies).toHaveLength(1);
    expect(byId(p, p.copies[0])!.content).toBe("old version from a restored backup");
    expect(p.remoteWrites.map((w) => w.id)).toContain("a");
  });

  it("tolerates small clock skew without treating a remote edit as a rollback", () => {
    const synced = note("a", { content: "synced", updatedAt: ts(1000) });
    const slightlyBehind = remoteOf(
      note("a", { content: "edit from a slow clock", updatedAt: new Date(T0 + 1000 * 1000 - SKEW_TOLERANCE_MS / 2).toISOString() })
    );
    const p = run({ local: [synced], remote: [slightlyBehind], base: baseOf(synced), now: ts(2000) });
    expect(p.copies).toEqual([]);
    expect(byId(p, "a")!.content).toBe("edit from a slow clock");
  });
});

describe("reconcile: deletes", () => {
  it("deletes on both sides when the tombstone is newer than the item", () => {
    const n = note("a", { updatedAt: ts(10) });
    const p = run({ local: [n], remote: [remoteOf(n)], base: baseOf(n), remoteTombstones: { a: ts(20) } });
    expect(p.merged).toEqual([]);
    expect(p.localDeletes).toEqual(["a"]);
    expect(p.remoteDeletes).toEqual(["a"]);
    expect(p.base).toEqual({});
    expect(p.tombstones.a).toBe(ts(20));
  });

  it("propagates a local tombstone to the remote", () => {
    const n = note("a", { updatedAt: ts(10) });
    const p = run({ local: [], remote: [remoteOf(n)], base: baseOf(n), localTombstones: { a: ts(20) } });
    expect(p.remoteDeletes).toEqual(["a"]);
    expect(p.remoteTombstonesChanged).toBe(true);
    expect(p.localTombstonesChanged).toBe(false);
  });

  it("lets an edit newer than the tombstone resurrect the item", () => {
    const edited = note("a", { content: "edited after delete", updatedAt: ts(30) });
    const p = run({ local: [edited], remote: [], base: baseOf(note("a")), remoteTombstones: { a: ts(20) } });
    expect(byId(p, "a")!.content).toBe("edited after delete");
    expect(p.remoteWrites.map((w) => w.id)).toEqual(["a"]);
  });

  it("lets a remote edit newer than a local tombstone resurrect the item locally", () => {
    const edited = remoteOf(note("a", { content: "remote edit", updatedAt: ts(30) }));
    const p = run({ local: [], remote: [edited], localTombstones: { a: ts(20) } });
    expect(p.localUpserts.map((u) => u.id)).toEqual(["a"]);
  });

  it("deletes when the tombstone is equal to or newer than the last edit", () => {
    const n = note("a", { updatedAt: ts(20) });
    const p = run({ local: [n], remote: [remoteOf(n)], base: baseOf(n), remoteTombstones: { a: ts(20) } });
    expect(p.merged).toEqual([]);
  });

  it("drops a stale local copy when the remote has a newer live version than the tombstone", () => {
    const stale = note("a", { content: "stale", updatedAt: ts(10) });
    const fresh = remoteOf(note("a", { content: "fresh", updatedAt: ts(30) }));
    const p = run({ local: [stale], remote: [fresh], remoteTombstones: { a: ts(20) } });
    expect(byId(p, "a")!.content).toBe("fresh");
    expect(p.copies).toEqual([]);
  });

  it("never treats a file merely absent remotely as a delete", () => {
    const n = note("a");
    const p = run({ local: [n], remote: [], base: baseOf(n), remoteTombstones: {} });
    expect(p.localDeletes).toEqual([]);
  });

  it("drops tombstones older than 90 days, letting a very stale copy come back", () => {
    const n = note("a", { updatedAt: ts(0) });
    const now = T0 + TOMBSTONE_MAX_AGE_MS + 5 * 24 * 3600_000;
    const old = new Date(T0 + 1000).toISOString();
    const p = run({ local: [n], remote: [], remoteTombstones: { a: old }, now });
    expect(p.tombstones).toEqual({});
    expect(byId(p, "a")).toBeDefined();
  });

  it("ignores tombstones with unparseable dates instead of deleting anything", () => {
    const n = note("a");
    const p = run({ local: [n], remote: [remoteOf(n)], base: baseOf(n), remoteTombstones: { a: "not a date" } });
    expect(byId(p, "a")).toBeDefined();
    expect(p.tombstones).toEqual({});
  });

  it("keeps a note alive and moves it to the root when its folder was deleted elsewhere", () => {
    const f = folder("f", { updatedAt: ts(5) });
    const child = note("c", { parentId: "f", updatedAt: ts(50) });
    const p = run({
      local: [f],
      remote: [remoteOf(f), remoteOf(child)],
      base: baseOf(f),
      localTombstones: { f: ts(20) },
    });
    expect(byId(p, "f")).toBeUndefined();
    expect(byId(p, "c")!.parentId).toBeNull();
  });
});

describe("reconcile: folder structure", () => {
  it("merges a folder rename with a folder move by id", () => {
    const f0 = folder("f", { name: "Old", parentId: null, updatedAt: ts(1) });
    const p0 = folder("p", { updatedAt: ts(1) });
    const renamed = folder("f", { name: "Renamed", updatedAt: ts(20) });
    const moved = folder("f", { name: "Old", parentId: "p", updatedAt: ts(25) });
    const p = run({ local: [p0, renamed], remote: [remoteOf(p0), remoteOf(moved)], base: baseOf(p0, f0) });
    expect(byId(p, "f")!.name).toBe("Renamed");
    expect(byId(p, "f")!.parentId).toBe("p");
    expect(p.copies).toEqual([]);
  });

  it("breaks parent cycles at the smallest id regardless of input order", () => {
    const x = folder("x", { parentId: "y" });
    const y = folder("y", { parentId: "x" });
    const a = run({ local: [x, y] });
    const b = run({ local: [y, x] });
    expect(a.merged).toEqual(b.merged);
    expect(byId(a, "x")!.parentId).toBeNull();
    expect(byId(a, "y")!.parentId).toBe("x");
  });

  it("breaks a cycle that only exists in the merge of two devices' moves", () => {
    const x0 = folder("x", { updatedAt: ts(1) });
    const y0 = folder("y", { updatedAt: ts(1) });
    const xInY = folder("x", { parentId: "y", updatedAt: ts(10) });
    const yInX = folder("y", { parentId: "x", updatedAt: ts(11) });
    const p = run({ local: [xInY, y0], remote: [remoteOf(x0), remoteOf(yInX)], base: baseOf(x0, y0) });
    const parents = [byId(p, "x")!.parentId, byId(p, "y")!.parentId].sort();
    expect(parents).toEqual([null, "x"].sort());
  });

  it("moves notes with an unknown or non-folder parent to the root", () => {
    const n1 = note("n1", { parentId: "ghost" });
    const n2 = note("n2", { parentId: "n1" });
    const p = run({ local: [n1, n2] });
    expect(byId(p, "n1")!.parentId).toBeNull();
    expect(byId(p, "n2")!.parentId).toBeNull();
  });

  it("repairs a self-parenting folder", () => {
    const p = run({ local: [folder("f", { parentId: "f" })] });
    expect(byId(p, "f")!.parentId).toBeNull();
  });
});

describe("reconcile: input hygiene and clocks", () => {
  it("normalises invalid timestamps and never throws", () => {
    const bad = note("a", { updatedAt: "garbage", createdAt: "also garbage" });
    const rbad = remoteOf(note("b", { updatedAt: "", createdAt: "" }));
    const p = run({ local: [bad], remote: [rbad] });
    expect(byId(p, "a")!.updatedAt).toBe(EPOCH_ISO);
    expect(byId(p, "a")!.createdAt).toBe(EPOCH_ISO);
    expect(byId(p, "b")!.updatedAt).toBe(EPOCH_ISO);
  });

  it("falls back to createdAt when updatedAt is invalid", () => {
    const n = note("a", { updatedAt: "nope", createdAt: ts(7) });
    expect(normalizeItem(n).updatedAt).toBe(ts(7));
  });

  it("repairs non-canonical local fields through a local upsert", () => {
    const n = note("a", { name: "  padded \n", tags: ["x, y", "x", ""], updatedAt: "2026-01-01T12:00:05Z" });
    const p = run({ local: [n] });
    const m = byId(p, "a")!;
    expect(m.name).toBe("padded");
    expect(m.tags).toEqual(["x", "y"]);
    expect(m.updatedAt).toBe("2026-01-01T12:00:05.000Z");
    expect(p.localUpserts.map((u) => u.id)).toEqual(["a"]);
  });

  it("clamps a local timestamp from the far future to now before it can leave the device", () => {
    const future = note("a", { updatedAt: new Date(T0 + 3 * 24 * 3600_000).toISOString() });
    const now = ts(1000);
    const p = run({ local: [future], now });
    expect(byId(p, "a")!.updatedAt).toBe(now);
    expect(p.remoteWrites[0].updatedAt).toBe(now);
  });

  it("does not rewrite a future-dated remote stamp, and still preserves a concurrent local edit", () => {
    const b = note("a", { content: "original", updatedAt: ts(1) });
    const futureRemote = remoteOf(
      note("a", { content: "from a fast clock", updatedAt: new Date(T0 + 5 * 24 * 3600_000).toISOString() })
    );
    const local = note("a", { content: "genuinely newer local edit", updatedAt: ts(900) });
    const p = run({ local: [local], remote: [futureRemote], base: baseOf(b), now: ts(1000) });
    const contents = p.merged.map((m) => m.content).sort();
    expect(contents).toEqual(["from a fast clock", "genuinely newer local edit"]);
    expect(byId(p, "a")!.updatedAt).toBe(futureRemote.updatedAt);
  });

  it("ignores items with ids that could escape a directory", () => {
    const evil = remoteOf(note("../../etc/passwd"));
    const slash = note("a/b");
    const p = run({ local: [slash], remote: [evil] });
    expect(p.merged).toEqual([]);
    expect(p.localDeletes).toEqual([]);
    expect(p.remoteDeletes).toEqual([]);
  });

  it("is deterministic and independent of the order of its inputs", () => {
    const b1 = note("a", { content: "orig" });
    const b2 = note("b", { content: "orig" });
    const local = [
      note("a", { content: "L-a", updatedAt: ts(10) }),
      note("b", { content: "L-b", updatedAt: ts(40) }),
      note("c"),
      folder("f"),
    ];
    const remote = [
      remoteOf(note("a", { content: "R-a", updatedAt: ts(11) })),
      remoteOf(note("b", { content: "R-b", updatedAt: ts(30) })),
      remoteOf(note("d")),
      remoteOf(folder("g")),
    ];
    const args = { base: baseOf(b1, b2), localTombstones: { z: ts(5) }, remoteTombstones: { y: ts(6) } };
    const p1 = run({ local, remote, ...args });
    const p2 = run({ local: [...local].reverse(), remote: [...remote].reverse(), ...args });
    expect(p2).toEqual(p1);
    expect(run({ local, remote, ...args })).toEqual(p1);
  });

  it("sanitizes a corrupt persisted base into 'nothing known'", () => {
    expect(sanitizeBase(null)).toEqual({});
    expect(sanitizeBase("junk")).toEqual({});
    expect(sanitizeBase([1, 2])).toEqual({});
    expect(sanitizeBase({ a: { h: 1 }, "bad/id": baseEntryOf(note("x")), ok: baseEntryOf(note("ok")) })).toEqual({
      ok: baseEntryOf(note("ok")),
    });
    const p = run({ local: [note("a")], remote: [remoteOf(note("a"))], base: "garbage" as unknown as SyncBase });
    expect(p.isEmpty).toBe(false);
    expect(byId(p, "a")).toBeDefined();
  });
});

describe("countPending", () => {
  it("counts new, changed and deleted items against the base", () => {
    const a = note("a");
    const b = note("b");
    const base = baseOf(a, b, note("gone"));
    expect(countPending([a, b], base)).toBe(1);
    expect(countPending([a, { ...b, content: "changed" }, note("new")], base)).toBe(3);
    expect(countPending([a, b, note("gone")], base)).toBe(0);
  });

  it("counts everything as pending against a corrupt base", () => {
    expect(countPending([note("a"), note("b")], "oops")).toBe(2);
  });

  it("ignores updatedAt-only differences", () => {
    const a = note("a");
    expect(countPending([{ ...a, updatedAt: ts(999) }], baseOf(a))).toBe(0);
  });
});

describe("applyPlanLocally", () => {
  const cur = (notes: NoteFile[], base: SyncBase = {}, tombstones: Tombstones = {}) => ({ notes, base, tombstones });

  it("applies upserts, deletes and the new base when nothing changed meanwhile", () => {
    const a = note("a", { updatedAt: ts(10) });
    const b = note("b", { updatedAt: ts(10) });
    const remoteA = remoteOf(note("a", { content: "remote", updatedAt: ts(20) }));
    const notes = [a, b];
    const plan = run({
      local: notes,
      remote: [remoteA, remoteOf(note("c"))],
      base: baseOf(a, b),
      remoteTombstones: { b: ts(30) },
    });
    const res = applyPlanLocally({ notes, tombstones: {} }, cur(notes, baseOf(a, b)), plan);
    expect(res.skipped).toEqual([]);
    expect(res.notes.map((n) => n.id).sort()).toEqual(["a", "c"]);
    expect(res.notes.find((n) => n.id === "a")!.content).toBe("remote");
    expect(res.removedIds).toEqual(["b"]);
    expect(res.base).toEqual(plan.base);
    expect(res.tombstones).toEqual(plan.tombstones);
  });

  it("leaves an item alone that was edited during the sync and keeps its pull-side base", () => {
    const a = note("a", { content: "v1", updatedAt: ts(10) });
    const snapshot = [a];
    const remoteA = remoteOf(note("a", { content: "remote v2", updatedAt: ts(20) }));
    const plan = run({ local: snapshot, remote: [remoteA], base: baseOf(a) });
    const edited = { ...a, content: "v1 plus typing", updatedAt: ts(25) };
    const res = applyPlanLocally({ notes: snapshot, tombstones: {} }, cur([edited], baseOf(a)), plan);
    expect(res.skipped).toEqual(["a"]);
    expect(res.notes).toEqual([edited]);
    expect(res.base.a).toEqual(baseOf(a).a);

    const again = run({ local: res.notes, remote: [remoteA], base: res.base, now: ts(2000) });
    expect(again.copies).toHaveLength(1);
    expect(again.merged.map((m) => m.content).sort()).toEqual(["remote v2", "v1 plus typing"]);
  });

  it("advances the base of an edited item when the plan already pushed it", () => {
    const a = note("a", { content: "v1", updatedAt: ts(10) });
    const pushed = note("a", { content: "v2", updatedAt: ts(20) });
    const plan = run({ local: [pushed], remote: [remoteOf(a)], base: baseOf(a) });
    expect(plan.remoteWrites.map((w) => w.id)).toEqual(["a"]);
    const edited = { ...pushed, content: "v2 plus typing", updatedAt: ts(25) };
    const res = applyPlanLocally({ notes: [pushed], tombstones: {} }, cur([edited], baseOf(a)), plan);
    expect(res.base.a).toEqual(plan.base.a);
    const again = run({ local: res.notes, remote: [remoteOf(pushed)], base: res.base, now: ts(2000) });
    expect(again.copies).toEqual([]);
    expect(again.merged[0].content).toBe("v2 plus typing");
  });

  it("does not resurrect an item the user deleted during the sync", () => {
    const a = note("a", { updatedAt: ts(10) });
    const plan = run({
      local: [a],
      remote: [remoteOf(note("a", { content: "remote", updatedAt: ts(20) }))],
      base: baseOf(a),
    });
    const res = applyPlanLocally(
      { notes: [a], tombstones: {} },
      cur([], baseOf(a), { a: ts(30) }),
      plan
    );
    expect(res.notes).toEqual([]);
    expect(res.skipped).toEqual(["a"]);
    expect(res.tombstones.a).toBe(ts(30));
  });

  it("keeps new local notes created during the sync", () => {
    const a = note("a");
    const plan = run({ local: [a], remote: [remoteOf(note("b"))] });
    const fresh = note("fresh");
    const res = applyPlanLocally({ notes: [a], tombstones: {} }, cur([a, fresh]), plan);
    expect(res.notes.map((n) => n.id).sort()).toEqual(["a", "b", "fresh"]);
    expect(res.base.fresh).toBeUndefined();
  });
});

// ── Simulation ──────────────────────────────────────────────────────────────

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Dev {
  id: string;
  notes: NoteFile[];
  tombs: Tombstones;
  base: SyncBase;
}
interface Remote {
  items: Map<string, RemoteItem>;
  tombs: Tombstones;
}

function syncDevice(dev: Dev, remote: Remote, now: number): ReconcilePlan {
  const plan = reconcile({
    local: dev.notes,
    remote: [...remote.items.values()],
    localTombstones: dev.tombs,
    remoteTombstones: remote.tombs,
    base: dev.base,
    deviceId: dev.id,
    now,
  });
  for (const w of plan.remoteWrites) remote.items.set(w.id, w);
  for (const id of plan.remoteDeletes) remote.items.delete(id);
  remote.tombs = plan.tombstones;
  const res = applyPlanLocally(
    { notes: dev.notes, tombstones: dev.tombs },
    { notes: dev.notes, tombstones: dev.tombs, base: dev.base },
    plan
  );
  expect(res.skipped).toEqual([]);
  dev.notes = [...res.notes];
  dev.base = res.base;
  dev.tombs = res.tombstones;
  return plan;
}

const strip = (n: NoteFile | RemoteItem): NoteFile => {
  const { device: _d, ...rest } = n as RemoteItem;
  return rest;
};
const sortedNotes = (notes: NoteFile[]) => [...notes].map(strip).sort((a, b) => (a.id < b.id ? -1 : 1));

interface Tok {
  noteId: string;
  at: number;
}

function simulate(seed: number) {
  const rnd = mulberry32(seed);
  const int = (n: number) => Math.floor(rnd() * n);
  const pickOf = <T,>(arr: T[]): T | undefined => (arr.length ? arr[int(arr.length)] : undefined);

  const nDev = 2 + int(2);
  const devs: Dev[] = Array.from({ length: nDev }, (_, i) => ({
    id: `dev${String.fromCharCode(97 + i)}${seed.toString(36)}xx`,
    notes: [],
    tombs: {},
    base: {},
  }));
  const remote: Remote = { items: new Map(), tombs: {} };
  const tokens = new Map<string, Tok>();
  const userDeleted = new Set<string>();
  let clock = T0;
  let counter = 0;
  const stamp = () => {
    clock += int(4); // 0 ms steps produce exact timestamp ties
    return new Date(clock).toISOString();
  };

  const descendants = (dev: Dev, id: string): Set<string> => {
    const out = new Set<string>([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const n of dev.notes) {
        if (n.parentId && out.has(n.parentId) && !out.has(n.id)) {
          out.add(n.id);
          grew = true;
        }
      }
    }
    return out;
  };

  const steps = 40 + int(40);
  for (let s = 0; s < steps; s++) {
    const dev = devs[int(devs.length)];
    const r = rnd();
    const folders = dev.notes.filter((n) => n.isFolder);
    const plain = dev.notes.filter((n) => !n.isFolder);
    if (r < 0.2) {
      const id = `n${counter++}`;
      const tok = `t${counter}`;
      const at = stamp();
      tokens.set(tok, { noteId: id, at: Date.parse(at) });
      dev.notes = [
        ...dev.notes,
        note(id, { content: tok, name: `Name ${id}`, parentId: pickOf(folders)?.id ?? null, createdAt: at, updatedAt: at }),
      ];
    } else if (r < 0.28) {
      const id = `f${counter++}`;
      const at = stamp();
      dev.notes = [...dev.notes, folder(id, { parentId: pickOf(folders)?.id ?? null, createdAt: at, updatedAt: at })];
    } else if (r < 0.5) {
      const n = pickOf(plain);
      if (n) {
        const tok = `t${counter++}`;
        const at = stamp();
        tokens.set(tok, { noteId: n.id, at: Date.parse(at) });
        dev.notes = dev.notes.map((x) => (x.id === n.id ? { ...x, content: `${x.content}|${tok}`, updatedAt: at } : x));
      }
    } else if (r < 0.58) {
      const n = pickOf(dev.notes);
      if (n) {
        const at = stamp();
        dev.notes = dev.notes.map((x) => (x.id === n.id ? { ...x, name: `Renamed ${counter++}`, updatedAt: at } : x));
      }
    } else if (r < 0.66) {
      const n = pickOf(dev.notes);
      if (n) {
        const bad = n.isFolder ? descendants(dev, n.id) : new Set<string>();
        const target = pickOf([null, ...folders.filter((f) => !bad.has(f.id)).map((f) => f.id)]) ?? null;
        const at = stamp();
        dev.notes = dev.notes.map((x) => (x.id === n.id ? { ...x, parentId: target, updatedAt: at } : x));
      }
    } else if (r < 0.74) {
      const n = pickOf(dev.notes);
      if (n) {
        const gone = descendants(dev, n.id);
        const at = stamp();
        for (const x of dev.notes) {
          if (!gone.has(x.id)) continue;
          dev.tombs = { ...dev.tombs, [x.id]: at };
          for (const tok of x.content.split("|")) if (tok) userDeleted.add(tok);
        }
        dev.notes = dev.notes.filter((x) => !gone.has(x.id));
      }
    } else {
      clock += 1 + int(3);
      syncDevice(dev, remote, clock);
    }
  }

  // Settle: every device syncs in a random order until nobody has anything left to do.
  let rounds = 0;
  for (; rounds < 8; rounds++) {
    let dirty = false;
    const order = [...devs].sort(() => rnd() - 0.5);
    for (const d of order) {
      clock += 1;
      if (!syncDevice(d, remote, clock).isEmpty) dirty = true;
    }
    if (!dirty) break;
  }
  return { devs, remote, tokens, userDeleted, rounds };
}

describe("simulation: devices syncing through a shared remote", () => {
  const RUNS = 250;

  it(`converges, is idempotent and loses no live content over ${RUNS} seeded runs`, () => {
    const stats = { copies: 0, runsWithCopies: 0, runsWithDeletes: 0, runsWithFolders: 0, multiDevice3: 0 };
    for (let seed = 1; seed <= RUNS; seed++) {
      const { devs, remote, tokens, userDeleted, rounds } = simulate(seed);
      const ctx = `seed ${seed}`;

      expect(rounds, `${ctx}: did not settle`).toBeLessThan(8);

      const reference = sortedNotes(devs[0].notes);
      for (const d of devs) expect(sortedNotes(d.notes), `${ctx}: ${d.id} diverged`).toEqual(reference);
      expect(sortedNotes([...remote.items.values()]), `${ctx}: remote diverged`).toEqual(reference);
      for (const d of devs) expect(d.tombs, `${ctx}: tombstones diverged`).toEqual(remote.tombs);

      // Idempotence: another full pass changes nothing.
      for (const d of devs) {
        const plan = syncDevice(d, remote, T0 + 10_000_000);
        expect(plan.isEmpty, `${ctx}: not idempotent for ${d.id}`).toBe(true);
      }

      // No live content lost unless an explicit delete at least as new exists.
      const present = new Set<string>();
      for (const n of reference) for (const tok of n.content.split("|")) present.add(tok);
      for (const [tok, info] of tokens) {
        if (present.has(tok) || userDeleted.has(tok)) continue;
        const t = remote.tombs[info.noteId];
        expect(
          t !== undefined && Date.parse(t) >= info.at,
          `${ctx}: content ${tok} of ${info.noteId} vanished without a newer delete`
        ).toBe(true);
      }

      const copyCount = reference.filter((n) => n.id.startsWith("cc")).length;
      stats.copies += copyCount;
      if (copyCount > 0) stats.runsWithCopies++;
      if (Object.keys(remote.tombs).length > 0) stats.runsWithDeletes++;
      if (reference.some((n) => n.isFolder)) stats.runsWithFolders++;
      if (devs.length === 3) stats.multiDevice3++;

      // Structure is sound: parents exist, are folders, and chains terminate.
      const ids = new Map(reference.map((n) => [n.id, n]));
      for (const n of reference) {
        if (n.parentId !== null) {
          expect(ids.get(n.parentId)?.isFolder, `${ctx}: ${n.id} has a bad parent`).toBe(true);
        }
        const seen = new Set<string>();
        for (let cur: string | null = n.id; cur !== null; cur = ids.get(cur)!.parentId) {
          expect(seen.has(cur), `${ctx}: cycle through ${cur}`).toBe(false);
          seen.add(cur);
        }
      }
    }
    // Guard against a vacuous simulation: the interesting paths must be hit.
    expect(stats.runsWithCopies).toBeGreaterThan(RUNS / 5);
    expect(stats.runsWithDeletes).toBeGreaterThan(RUNS / 2);
    expect(stats.runsWithFolders).toBeGreaterThan(RUNS / 2);
    expect(stats.multiDevice3).toBeGreaterThan(RUNS / 4);
  });

  it("keeps all three versions of a note edited concurrently on three devices, in every sync order", () => {
    const orders = [
      [0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0],
    ];
    const finals = orders.map((order) => {
      const origin = note("n", { content: "origin", updatedAt: ts(1) });
      const remote: Remote = { items: new Map(), tombs: {} };
      const devs: Dev[] = ["devaaaa", "devbbbb", "devcccc"].map((id) => ({ id, notes: [origin], tombs: {}, base: baseOf(origin) }));
      remote.items.set("n", remoteOf(origin, "devaaaa"));
      devs[0].notes = [{ ...origin, content: "edit A", updatedAt: ts(10) }];
      devs[1].notes = [{ ...origin, content: "edit B", updatedAt: ts(20) }];
      devs[2].notes = [{ ...origin, content: "edit C", updatedAt: ts(15) }];
      for (let round = 0; round < 3; round++) for (const i of order) syncDevice(devs[i], remote, T0 + (100 + round * 10) * 1000);
      const reference = sortedNotes(devs[0].notes);
      for (const d of devs) expect(sortedNotes(d.notes)).toEqual(reference);
      expect(sortedNotes([...remote.items.values()])).toEqual(reference);
      expect(reference.map((n) => n.content).sort()).toEqual(["edit A", "edit B", "edit C"]);
      expect(reference.find((n) => n.id === "n")!.content).toBe("edit B");
      return reference;
    });
    for (const f of finals) expect(f).toEqual(finals[0]);
  });
});
