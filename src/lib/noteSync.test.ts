import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// The store persists to localStorage, which Node does not have; give it one so every set() doesn't warn.
vi.hoisted(() => {
  const mem = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, String(v)),
    removeItem: (k: string) => void mem.delete(k),
  };
});

import { useStore, type NoteFile } from "../store/useStore";
import {
  SYNC_BETA_NOTICE,
  EDIT_DURING_SYNC_NOTICE,
  backoffMs,
  buildBackupJson,
  flushPendingForQuit,
  isSyncRunning,
  parseNoteFile,
  safeName,
  serializeNote,
  syncNow,
  type FsAdapter,
  type FsDirEntry,
} from "./noteSync";

// ── In-memory file system with failure injection ─────────────────────────────

const ROOT = "/sync/Hades";

interface Op {
  op: string;
  path: string;
  to?: string;
}

class FakeFs implements FsAdapter {
  files = new Map<string, string>();
  dirs = new Set<string>();
  log: Op[] = [];
  unavailable = false;
  hang = false;
  onOp: ((op: Op) => void) | null = null;
  private failures: { op: string; match: (p: string) => boolean; times: number }[] = [];

  constructor(root = ROOT) {
    this.mkdirSync(root);
  }

  private mkdirSync(p: string) {
    const parts = p.split("/").filter(Boolean);
    for (let i = 1; i <= parts.length; i++) this.dirs.add("/" + parts.slice(0, i).join("/"));
  }

  /** Mirrors Tauri's scope on Linux/macOS: "**" never matches dot-prefixed components. */
  private guard(op: string, path: string, to?: string) {
    const entry: Op = { op, path, to };
    this.log.push(entry);
    for (const p of [path, to]) {
      if (p === undefined) continue;
      const rel = p === ROOT ? "" : p.startsWith(ROOT + "/") ? p.slice(ROOT.length + 1) : p;
      if (rel.split("/").some((c) => c.startsWith("."))) throw new Error(`forbidden path (scope): ${p}`);
    }
    this.onOp?.(entry);
    if (this.unavailable) throw new Error(`No such file or directory: ${path}`);
    const f = this.failures.find((x) => x.op === op && x.match(path) && x.times > 0);
    if (f) {
      f.times--;
      throw new Error(`injected ${op} failure: ${path}`);
    }
  }

  failNext(op: string, match: (p: string) => boolean, times = 1) {
    this.failures.push({ op, match, times });
  }

  async readDir(path: string): Promise<FsDirEntry[]> {
    this.guard("readDir", path);
    if (this.hang) return new Promise(() => {});
    if (!this.dirs.has(path)) throw new Error(`No such directory: ${path}`);
    const out: FsDirEntry[] = [];
    const prefix = path + "/";
    for (const d of this.dirs) {
      if (d.startsWith(prefix) && !d.slice(prefix.length).includes("/")) {
        out.push({ name: d.slice(prefix.length), isDirectory: true, isFile: false });
      }
    }
    for (const f of this.files.keys()) {
      if (f.startsWith(prefix) && !f.slice(prefix.length).includes("/")) {
        out.push({ name: f.slice(prefix.length), isDirectory: false, isFile: true });
      }
    }
    return out;
  }

  async readTextFile(path: string): Promise<string> {
    this.guard("read", path);
    const v = this.files.get(path);
    if (v === undefined) throw new Error(`No such file: ${path}`);
    return v;
  }

  async writeTextFile(path: string, data: string): Promise<void> {
    this.guard("write", path);
    if (!this.dirs.has(path.slice(0, path.lastIndexOf("/")))) throw new Error(`No parent directory: ${path}`);
    this.files.set(path, data);
  }

  async mkdir(path: string): Promise<void> {
    this.guard("mkdir", path);
    this.mkdirSync(path);
  }

  async remove(path: string): Promise<void> {
    this.guard("remove", path);
    if (this.files.delete(path)) return;
    if (!this.dirs.has(path)) throw new Error(`No such file or directory: ${path}`);
    const prefix = path + "/";
    const busy = [...this.files.keys(), ...this.dirs].some((p) => p.startsWith(prefix));
    if (busy) throw new Error(`Directory not empty: ${path}`);
    this.dirs.delete(path);
  }

  async rename(from: string, to: string): Promise<void> {
    this.guard("rename", from, to);
    const v = this.files.get(from);
    if (v === undefined) throw new Error(`No such file: ${from}`);
    if (!this.dirs.has(to.slice(0, to.lastIndexOf("/")))) throw new Error(`No parent directory: ${to}`);
    this.files.delete(from);
    this.files.set(to, v);
  }

  async exists(path: string): Promise<boolean> {
    this.guard("exists", path);
    return this.files.has(path) || this.dirs.has(path);
  }

  // helpers (not part of the adapter, never logged)
  seed(rel: string, content: string) {
    const abs = `${ROOT}/${rel}`;
    this.mkdirSync(abs.slice(0, abs.lastIndexOf("/")));
    this.files.set(abs, content);
  }
  seedDir(rel: string) {
    this.mkdirSync(`${ROOT}/${rel}`);
  }
  read(rel: string): string | undefined {
    return this.files.get(`${ROOT}/${rel}`);
  }
  rels(): string[] {
    return [...this.files.keys()].map((f) => f.slice(ROOT.length + 1)).sort();
  }
  mdRels(): string[] {
    return this.rels().filter((r) => r.endsWith(".md"));
  }
  clearLog() {
    this.log = [];
  }
  mutations(): Op[] {
    return this.log.filter((o) => ["write", "mkdir", "remove", "rename"].includes(o.op));
  }
  manifest(): any {
    const raw = this.read("_hades.json");
    return raw === undefined ? undefined : JSON.parse(raw);
  }
}

/** Case-preserving, case-insensitive volume (macOS default, Windows): "Maths" and "maths" are one directory. */
class CaseFoldFs extends FakeFs {
  private canon(p: string): string {
    let cur = "";
    for (const part of p.split("/").filter(Boolean)) {
      const want = `${cur}/${part}`;
      const hit = [...this.dirs, ...this.files.keys()].find((k) => k.toLowerCase() === want.toLowerCase());
      cur = hit ?? want;
    }
    return cur || "/";
  }
  readDir(p: string) { return super.readDir(this.canon(p)); }
  readTextFile(p: string) { return super.readTextFile(this.canon(p)); }
  writeTextFile(p: string, d: string) { return super.writeTextFile(this.canon(p), d); }
  mkdir(p: string) { return super.mkdir(this.canon(p)); }
  remove(p: string) { return super.remove(this.canon(p)); }
  rename(a: string, b: string) { return super.rename(this.canon(a), this.canon(b)); }
  exists(p: string) { return super.exists(this.canon(p)); }
}

// ── Store scaffolding ────────────────────────────────────────────────────────

const pristine = useStore.getState();
const DEVICE_A = "aaaaaaaa11111111";
const DEVICE_B = "bbbbbbbb22222222";

function setDevice(over: Record<string, unknown> = {}) {
  useStore.setState(
    {
      ...pristine,
      notes: [],
      openNoteIds: [],
      activeNoteId: null,
      syncEnabled: true,
      syncFolder: ROOT,
      syncDeviceId: DEVICE_A,
      syncBase: {},
      deletedNoteIds: {},
      lastSyncAt: null,
      syncStatus: "idle",
      isSyncing: false,
      syncError: null,
      syncFailures: 0,
      nextSyncAt: 0,
      pendingCount: 0,
      hasPendingChanges: false,
      ...over,
    },
    true
  );
}

const DEVICE_KEYS = ["notes", "syncBase", "deletedNoteIds", "syncDeviceId", "lastSyncAt", "openNoteIds", "activeNoteId"] as const;
function saveDevice() {
  const s = useStore.getState() as unknown as Record<string, unknown>;
  return Object.fromEntries(DEVICE_KEYS.map((k) => [k, s[k]]));
}

const ago = (sec: number) => new Date(Date.now() - sec * 1000).toISOString();

function mk(id: string, over: Partial<NoteFile> = {}): NoteFile {
  return {
    id,
    name: `Note ${id}`,
    content: `body of ${id}`,
    tags: [],
    parentId: null,
    isFolder: false,
    createdAt: ago(1000),
    updatedAt: ago(500),
    ...over,
  };
}
const mkFolder = (id: string, over: Partial<NoteFile> = {}) =>
  mk(id, { name: `Folder ${id}`, content: "", isFolder: true, ...over });

const state = () => useStore.getState();
const noteById = (id: string) => state().notes.find((n) => n.id === id);

beforeEach(() => {
  setDevice();
});

// ── Format ───────────────────────────────────────────────────────────────────

describe("note file format", () => {
  it("round-trips a note including the device field", () => {
    const n = mk("abc123", { name: "Title: with colon", tags: ["x", "y"], parentId: "fold1", content: "line1\n---\nline2\n" });
    const p = parseNoteFile(serializeNote(n, "dev12345"))!;
    expect(p).toMatchObject({
      id: "abc123", name: "Title: with colon", parentId: "fold1", hasParentField: true,
      tags: ["x", "y"], device: "dev12345", content: "line1\n---\nline2\n",
    });
    expect(p.updatedAt).toBe(n.updatedAt);
  });

  it("keeps the legacy frontmatter keys first and in order so older readers still parse it", () => {
    const head = serializeNote(mk("a1"), "dev").split("\n").slice(0, 9).map((l) => l.split(":")[0]);
    expect(head).toEqual(["---", "id", "name", "parentId", "tags", "createdAt", "updatedAt", "device", "---"]);
  });

  it("parses legacy files without parentId, name or device", () => {
    const p = parseNoteFile("---\nid: abc123\ntags: a,b\ncreatedAt: 2024-01-15T10:30:00.000Z\nupdatedAt: 2024-01-20T14:22:00.000Z\n---\n\nHello")!;
    expect(p.hasParentField).toBe(false);
    expect(p.name).toBeNull();
    expect(p.device).toBeNull();
    expect(p.tags).toEqual(["a", "b"]);
    expect(p.content).toBe("\nHello");
  });

  it("tolerates CRLF headers, a BOM and a missing trailing newline", () => {
    expect(parseNoteFile("---\r\nid: a1\r\nname: N\r\n---\r\nbody")!.content).toBe("body");
    expect(parseNoteFile("﻿---\nid: a1\n---\nbody")!.id).toBe("a1");
    expect(parseNoteFile("---\nid: a1\nname: N\n---")!.content).toBe("");
  });

  it("rejects files that are not Hades notes or carry unsafe ids", () => {
    expect(parseNoteFile("# just markdown")).toBeNull();
    expect(parseNoteFile("---\ntitle: x\n---\nbody")).toBeNull();
    expect(parseNoteFile("---\nid: ../../etc/passwd\n---\nbody")).toBeNull();
    expect(parseNoteFile("---\nid: a/b\n---\nbody")).toBeNull();
  });

  it("makes file names safe on every platform", () => {
    expect(safeName('a/b\\c:d*e?f"g<h>i|j')).toBe("a-b-c-d-e-f-g-h-i-j");
    expect(safeName(".hidden")).toBe("_hidden");
    expect(safeName("..")).toBe("__");
    expect(safeName("trailing. . ")).toBe("trailing");
    expect(safeName("   ")).toBe("untitled");
    expect(safeName("x".repeat(200))).toHaveLength(80);
  });

  it("states the beta notice the UI must show", () => {
    expect(SYNC_BETA_NOTICE).toBe(
      "Cloud Sync is currently in Beta. Please back up your local database/data before enabling or switching to cloud sync."
    );
  });
});

describe("backoff schedule", () => {
  it("is 30 s when healthy, doubles per failure and caps at 10 minutes", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 50].map(backoffMs)).toEqual([
      30_000, 30_000, 60_000, 120_000, 240_000, 480_000, 600_000, 600_000, 600_000,
    ]);
  });
});

// ── Engine ───────────────────────────────────────────────────────────────────

describe("first sync", () => {
  it("pushes every note and folder, writes the manifest and records the base", async () => {
    const fs = new FakeFs();
    const folder = mkFolder("f1", { name: "Physics" });
    const inFolder = mk("n1", { name: "Optics", parentId: "f1", tags: ["lens"] });
    const root = mk("n2", { name: "Inbox" });
    setDevice({ notes: [folder, inFolder, root] });

    const out = await syncNow({ fs, trigger: "manual" });

    expect(out.ok).toBe(true);
    expect(fs.mdRels()).toEqual(["Inbox-n2.md", "Physics/Optics-n1.md"]);
    const file = fs.read("Physics/Optics-n1.md")!;
    expect(file.startsWith("---\nid: n1\nname: Optics\nparentId: f1\ntags: lens\ncreatedAt: ")).toBe(true);
    expect(file.endsWith("\n---\nbody of n1")).toBe(true);
    const m = fs.manifest();
    expect(m.version).toBe(2);
    expect(m.folders.map((f: any) => [f.id, f.name, f.parentId])).toEqual([["f1", "Physics", null]]);

    const s = state();
    expect(s.syncStatus).toBe("idle");
    expect(s.isSyncing).toBe(false);
    expect(s.syncError).toBeNull();
    expect(s.lastSyncAt).not.toBeNull();
    expect(s.pendingCount).toBe(0);
    expect(s.hasPendingChanges).toBe(false);
    expect(Object.keys(s.syncBase).sort()).toEqual(["f1", "n1", "n2"]);
    expect(s.nextSyncAt).toBeGreaterThan(Date.now());
  });

  it("generates the device id once and keeps it", async () => {
    const fs = new FakeFs();
    setDevice({ syncDeviceId: "", notes: [mk("n1")] });
    await syncNow({ fs });
    const id = state().syncDeviceId;
    expect(id).toMatch(/^[0-9a-f]{16}$/);
    await syncNow({ fs });
    expect(state().syncDeviceId).toBe(id);
    expect(fs.read(fs.mdRels()[0])).toContain(`device: ${id}`);
  });

  it("does nothing and reports an error when sync is not set up", async () => {
    const fs = new FakeFs();
    setDevice({ syncEnabled: false, notes: [mk("n1")] });
    const out = await syncNow({ fs });
    expect(out.ok).toBe(false);
    expect(fs.log).toEqual([]);
  });

  it("is idempotent: a second run changes nothing on disk or in the store", async () => {
    const fs = new FakeFs();
    setDevice({ notes: [mkFolder("f1"), mk("n1", { parentId: "f1" }), mk("n2")] });
    await syncNow({ fs });
    const files = new Map(fs.files);
    const notes = state().notes;
    fs.clearLog();
    await syncNow({ fs });
    expect(fs.mutations()).toEqual([]);
    expect(new Map(fs.files)).toEqual(files);
    expect(state().notes).toBe(notes);
  });
});

describe("two devices", () => {
  it("lets a second device pull everything, then converge on edits and moves", async () => {
    const fs = new FakeFs();
    setDevice({ notes: [mkFolder("f1", { name: "Physics" }), mk("n1", { parentId: "f1", name: "Optics" }), mk("n2")] });
    await syncNow({ fs });
    const devA = saveDevice();

    setDevice({ syncDeviceId: DEVICE_B });
    const outB = await syncNow({ fs });
    expect(outB.ok).toBe(true);
    expect(state().notes.map((n) => n.id).sort()).toEqual(["f1", "n1", "n2"]);
    expect(noteById("n1")).toMatchObject({ name: "Optics", parentId: "f1", content: "body of n1" });
    expect(state().pendingCount).toBe(0);

    state().updateNote("n2", { content: "edited on B" });
    state().moveNote("n1", null);
    await syncNow({ fs });
    const devB = saveDevice();

    setDevice(devA);
    await syncNow({ fs });
    expect(noteById("n2")!.content).toBe("edited on B");
    expect(noteById("n1")!.parentId).toBeNull();
    expect(fs.mdRels()).toEqual(["Optics-n1.md", "Note n2-n2.md"].sort());
    expect(fs.rels().some((r) => r.startsWith("Physics/"))).toBe(false);

    setDevice(devB);
    fs.clearLog();
    await syncNow({ fs });
    expect(fs.mutations()).toEqual([]);
  });

  it("propagates deletes through tombstones and removes the file", async () => {
    const fs = new FakeFs();
    setDevice({ notes: [mk("n1"), mk("n2")] });
    await syncNow({ fs });
    const devA = saveDevice();
    setDevice({ syncDeviceId: DEVICE_B });
    await syncNow({ fs });

    state().deleteNote("n1");
    await syncNow({ fs });
    expect(fs.mdRels()).toEqual(["Note n2-n2.md"]);
    expect(fs.manifest().tombstones).toHaveProperty("n1");

    setDevice(devA);
    await syncNow({ fs });
    expect(state().notes.map((n) => n.id)).toEqual(["n2"]);
  });

  it("preserves both versions when two devices edit the same note offline", async () => {
    const fs = new FakeFs();
    setDevice({ notes: [mk("n1", { content: "start" })] });
    await syncNow({ fs });
    const devA = saveDevice();
    setDevice({ syncDeviceId: DEVICE_B });
    await syncNow({ fs });

    state().updateNote("n1", { content: "B was here" });
    const devB = saveDevice();
    setDevice(devA);
    state().updateNote("n1", { content: "A was here" });
    await syncNow({ fs });
    setDevice(devB);
    await syncNow({ fs });

    const texts = state().notes.map((n) => n.content).sort();
    expect(texts).toEqual(["A was here", "B was here"]);
    const copy = state().notes.find((n) => n.name.includes("conflict copy"))!;
    expect(copy.name).toMatch(/^Note n1 \(conflict copy [0-9a-z]{4} \d{4}-\d{2}-\d{2} \d{2}:\d{2}\)$/);
    expect(fs.mdRels()).toHaveLength(2);
  });
});

describe("unavailable sync folder", () => {
  async function syncedFixture() {
    const fs = new FakeFs();
    setDevice({ notes: [mk("n1"), mk("n2")] });
    await syncNow({ fs });
    return fs;
  }

  it("changes nothing locally and goes offline with a backoff when the folder is unreachable", async () => {
    const fs = await syncedFixture();
    state().updateNote("n1", { content: "typed while the drive was unplugged" });
    const before = state();
    fs.unavailable = true;
    fs.clearLog();

    const out = await syncNow({ fs, trigger: "timer" });

    expect(out).toMatchObject({ ok: false, kind: "offline" });
    expect(out.message).toMatch(/not available/);
    const after = state();
    expect(after.notes).toBe(before.notes);
    expect(after.syncBase).toBe(before.syncBase);
    expect(after.deletedNoteIds).toBe(before.deletedNoteIds);
    expect(after.syncStatus).toBe("offline");
    expect(after.syncFailures).toBe(1);
    expect(after.syncError).toMatch(/not available/);
    expect(after.pendingCount).toBe(1);
    expect(after.nextSyncAt - Date.now()).toBeGreaterThan(25_000);
    expect(after.nextSyncAt - Date.now()).toBeLessThanOrEqual(30_000);
    expect(fs.mutations()).toEqual([]);

    await syncNow({ fs });
    expect(state().syncFailures).toBe(2);
    expect(state().nextSyncAt - Date.now()).toBeGreaterThan(55_000);

    fs.unavailable = false;
    const ok = await syncNow({ fs, trigger: "manual" });
    expect(ok.ok).toBe(true);
    expect(state().syncStatus).toBe("idle");
    expect(state().syncFailures).toBe(0);
    expect(state().syncError).toBeNull();
    expect(state().pendingCount).toBe(0);
    expect(fs.read("Note n1-n1.md")).toContain("typed while the drive was unplugged");
  });

  it("resets the backoff when the user presses Retry now", async () => {
    const fs = await syncedFixture();
    fs.unavailable = true;
    for (let i = 0; i < 3; i++) await syncNow({ fs });
    expect(state().syncFailures).toBe(3);
    await syncNow({ fs, trigger: "manual" });
    expect(state().syncFailures).toBe(1);
  });

  it("treats a vanished root as unavailable, not as a wiped remote, once we have synced into it", async () => {
    const fs = await syncedFixture();
    for (const f of [...fs.files.keys()]) fs.files.delete(f);
    fs.dirs.delete(ROOT);
    const before = state().notes;
    fs.clearLog();

    const out = await syncNow({ fs });

    expect(out).toMatchObject({ ok: false, kind: "offline" });
    expect(fs.mutations()).toEqual([]);
    expect(fs.dirs.has(ROOT)).toBe(false);
    expect(state().notes).toBe(before);
  });

  it("refuses to treat an emptied but existing folder as a wiped remote", async () => {
    const fs = await syncedFixture();
    for (const f of [...fs.files.keys()]) fs.files.delete(f);
    const before = state().notes;
    fs.clearLog();

    const out = await syncNow({ fs });

    expect(out).toMatchObject({ ok: false, kind: "offline" });
    expect(out.message).toMatch(/looks empty/);
    expect(fs.mutations()).toEqual([]);
    expect(state().notes).toBe(before);
    expect(Object.keys(state().syncBase)).toHaveLength(2);
  });

  it("re-uploads everything once the user chooses the folder again", async () => {
    const fs = await syncedFixture();
    for (const f of [...fs.files.keys()]) fs.files.delete(f);
    state().setSyncFolder(ROOT);
    expect(state().syncBase).toEqual({});
    const out = await syncNow({ fs });
    expect(out.ok).toBe(true);
    expect(fs.mdRels()).toHaveLength(2);
  });

  it("creates a missing folder on the very first sync", async () => {
    const fs = new FakeFs("/elsewhere");
    fs.dirs.delete(ROOT);
    setDevice({ notes: [mk("n1")] });
    const out = await syncNow({ fs });
    expect(out.ok).toBe(true);
    expect(fs.dirs.has(ROOT)).toBe(true);
    expect(fs.mdRels()).toEqual(["Note n1-n1.md"]);
  });

  it("reports an offline error when the folder cannot even be created", async () => {
    const fs = new FakeFs("/elsewhere");
    fs.dirs.delete(ROOT);
    fs.failNext("mkdir", () => true, 5);
    setDevice({ notes: [mk("n1")] });
    const out = await syncNow({ fs });
    expect(out).toMatchObject({ ok: false, kind: "offline" });
  });
});

describe("failures while writing", () => {
  it("leaves previously valid files intact, cleans temp files, and succeeds on retry", async () => {
    const fs = new FakeFs();
    setDevice({ notes: [mk("n1", { content: "old 1" }), mk("n2", { content: "old 2" }), mk("n3", { content: "old 3" })] });
    await syncNow({ fs });
    const before = new Map(fs.files);

    state().updateNote("n1", { content: "new 1" });
    state().updateNote("n2", { content: "new 2" });
    state().updateNote("n3", { content: "new 3" });
    const localBefore = state().notes;
    const baseBefore = state().syncBase;
    let seen = 0;
    fs.onOp = (op) => {
      if (op.op === "rename" && op.to!.endsWith(".md") && ++seen === 2) fs.failNext("rename", () => true, 1);
    };

    const out = await syncNow({ fs, trigger: "manual" });

    expect(out.ok).toBe(false);
    expect(out.kind).toBe("error");
    expect(out.message).toMatch(/injected rename failure/);
    fs.onOp = null;
    expect(state().notes).toBe(localBefore);
    expect(state().syncBase).toBe(baseBefore);
    expect(state().syncStatus).toBe("error");
    expect(state().pendingCount).toBe(3);
    // every .md is either the complete old or the complete new file, never partial or missing
    for (const rel of ["Note n1-n1.md", "Note n2-n2.md", "Note n3-n3.md"]) {
      const content = fs.read(rel)!;
      expect(content.startsWith("---\nid: ")).toBe(true);
      expect(content.endsWith("old " + rel[6]) || content.endsWith("new " + rel[6])).toBe(true);
    }
    expect([...before.keys()].every((k) => fs.files.has(k))).toBe(true);
    expect(fs.rels().filter((r) => r.includes("hades-tmp-"))).toEqual([]);
    expect(fs.read("_hades.json")).toBe(before.get(`${ROOT}/_hades.json`));

    const retry = await syncNow({ fs, trigger: "manual" });
    expect(retry.ok).toBe(true);
    expect(fs.read("Note n1-n1.md")!.endsWith("new 1")).toBe(true);
    expect(fs.read("Note n2-n2.md")!.endsWith("new 2")).toBe(true);
    expect(fs.read("Note n3-n3.md")!.endsWith("new 3")).toBe(true);
    expect(state().pendingCount).toBe(0);
    expect(state().syncStatus).toBe("idle");
  });

  it("does not leave a half-written file behind when the temp write itself fails", async () => {
    const fs = new FakeFs();
    setDevice({ notes: [mk("n1")] });
    fs.failNext("write", (p) => !p.includes("CaseProbe"), 1);
    const out = await syncNow({ fs });
    expect(out.ok).toBe(false);
    expect(fs.mdRels()).toEqual([]);
    expect(state().syncBase).toEqual({});
    expect((await syncNow({ fs })).ok).toBe(true);
  });

  it("writes the manifest after every note file and prunes only afterwards", async () => {
    const fs = new FakeFs();
    setDevice({ notes: [mk("n1", { name: "Before" }), mk("n2")] });
    await syncNow({ fs });
    state().updateNote("n1", { name: "After" });
    state().updateNote("n2", { content: "changed" });
    state().deleteNote("n2");
    state().addFolder();
    fs.clearLog();
    await syncNow({ fs });

    const ops = fs.log.filter((o) => o.op === "rename" || o.op === "remove");
    const manifestIdx = ops.findIndex((o) => o.op === "rename" && o.to!.endsWith("/_hades.json"));
    expect(manifestIdx).toBeGreaterThan(-1);
    const lastNoteRename = ops.map((o, i) => (o.op === "rename" && o.to!.endsWith(".md") ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
    expect(lastNoteRename).toBeGreaterThan(-1);
    expect(lastNoteRename).toBeLessThan(manifestIdx);
    const firstRemoveOfNote = ops.findIndex((o) => o.op === "remove" && o.path.endsWith(".md"));
    expect(firstRemoveOfNote).toBeGreaterThan(manifestIdx);
    expect(fs.mdRels()).toEqual(["After-n1.md"]);
  });

  it("classifies a failure on a reachable folder as a plain error", async () => {
    const fs = new FakeFs();
    setDevice({ notes: [mk("n1")] });
    fs.failNext("write", (p) => !p.includes("CaseProbe"), 1);
    const out = await syncNow({ fs });
    expect(out.kind).toBe("error");
    expect(state().syncStatus).toBe("error");
  });
});

describe("compatibility with existing sync folders", () => {
  it("loads a legacy v1 manifest and frontmatter files that predate name and parentId", async () => {
    const fs = new FakeFs();
    fs.seed("_hades.json", JSON.stringify({ folderIds: { Physics: "fold1", "Physics/Optics": "fold2" } }));
    fs.seed(
      "Physics/Optics/Lens-abc123.md",
      "---\nid: abc123def\ntags: lens,glass\ncreatedAt: 2024-01-15T10:30:00.000Z\nupdatedAt: 2024-01-20T14:22:00.000Z\n---\n\nConvex lens notes"
    );
    fs.seed("Loose-zzz999.md", "---\nid: zzz999xyz\ncreatedAt: 2024-01-15T10:30:00.000Z\nupdatedAt: 2024-01-20T14:22:00.000Z\n---\nroot note");
    setDevice({ notes: [] });

    const out = await syncNow({ fs });

    expect(out.ok).toBe(true);
    expect(noteById("fold1")).toMatchObject({ name: "Physics", parentId: null, isFolder: true });
    expect(noteById("fold2")).toMatchObject({ name: "Optics", parentId: "fold1", isFolder: true });
    expect(noteById("abc123def")).toMatchObject({
      name: "Lens", parentId: "fold2", tags: ["lens", "glass"], content: "\nConvex lens notes", isFolder: false,
    });
    expect(noteById("zzz999xyz")).toMatchObject({ name: "Loose", parentId: null });

    // migrated: manifest is v2 and the note moved to the current naming scheme
    expect(fs.manifest().version).toBe(2);
    expect(fs.manifest().folders.map((f: any) => f.id).sort()).toEqual(["fold1", "fold2"]);
    expect(fs.mdRels()).toEqual(["Loose-zzz999xyz.md", "Physics/Optics/Lens-abc123def.md"]);
    expect(fs.read("Physics/Optics/Lens-abc123def.md")).toContain("parentId: fold2");
  });

  it("creates deterministic folders for legacy directories the manifest does not know", async () => {
    const mk1 = () => {
      const fs = new FakeFs();
      fs.seed("Old/Stuff/Thing-q1w2e3.md", "---\nid: q1w2e3r4\nupdatedAt: 2024-02-02T00:00:00.000Z\n---\nx");
      return fs;
    };
    setDevice({ notes: [], syncDeviceId: DEVICE_A });
    await syncNow({ fs: mk1() });
    const first = state().notes.filter((n) => n.isFolder).map((n) => [n.id, n.name, n.parentId]);
    setDevice({ notes: [], syncDeviceId: DEVICE_B });
    await syncNow({ fs: mk1() });
    const second = state().notes.filter((n) => n.isFolder).map((n) => [n.id, n.name, n.parentId]);
    expect(first).toHaveLength(2);
    expect(second).toEqual(first);
    expect(noteById("q1w2e3r4")!.parentId).toBe(first.find((f) => f[1] === "Stuff")![0]);
  });

  it("recovers a note whose folder is missing from the manifest under a folder named after its directory", async () => {
    const fs = new FakeFs();
    fs.seed("Math/Proof-p1p1p1.md", "---\nid: p1p1p1\nname: Proof\nparentId: mathfolder\nupdatedAt: 2025-01-01T00:00:00.000Z\n---\nQED");
    setDevice({ notes: [] });
    await syncNow({ fs });
    expect(noteById("mathfolder")).toMatchObject({ name: "Math", isFolder: true });
    expect(noteById("p1p1p1")!.parentId).toBe("mathfolder");
  });

  it("restores a corrupt manifest instead of failing, without losing notes", async () => {
    const fs = new FakeFs();
    fs.seed("_hades.json", '{"version":2,"folders":[{"id":"f1","na');
    fs.seed("N-n1n1n1.md", "---\nid: n1n1n1\nname: N\nparentId: \nupdatedAt: 2025-01-01T00:00:00.000Z\n---\nkeep");
    setDevice({ notes: [] });
    const out = await syncNow({ fs });
    expect(out.ok).toBe(true);
    expect(noteById("n1n1n1")!.content).toBe("keep");
    expect(fs.manifest().version).toBe(2);
  });
});

describe("files the engine must not touch", () => {
  it("never reads, writes, prunes or deletes dot-prefixed files and directories", async () => {
    const fs = new FakeFs();
    fs.seed(".hades-bridge/snapshot.json", '{"bridge":true}');
    fs.seed(".hades-bridge/commands/x.json", "{}");
    fs.seed(".git/config", "[core]");
    fs.seed(".DS_Store", "binary");
    fs.seed(".sneaky-n9n9n9.md", "---\nid: n9n9n9\nname: Sneaky\n---\nshould not import");
    fs.seed(".hidden/Inside-n8n8n8.md", "---\nid: n8n8n8\nname: Inside\n---\nshould not import");
    const dotFiles = new Map([...fs.files].filter(([p]) => p.slice(ROOT.length + 1).startsWith(".")));
    setDevice({ notes: [mk("n1"), mk("n2")] });
    await syncNow({ fs });
    state().deleteNote("n1");
    state().updateNote("n2", { name: "Renamed" });
    await syncNow({ fs });

    for (const [p, v] of dotFiles) expect(fs.files.get(p)).toBe(v);
    expect(state().notes.map((n) => n.id)).toEqual(["n2"]);
    const touched = fs.log.filter((o) => o.path.slice(ROOT.length).split("/").some((c) => c.startsWith(".")) || o.to?.slice(ROOT.length).split("/").some((c) => c.startsWith(".")));
    expect(touched).toEqual([]);
  });

  it("never issues an operation on a path with a dot-prefixed component under the sync root", async () => {
    // FakeFs also throws on such paths, mirroring Tauri's require_literal_leading_dot scope on Linux/macOS.
    const fs = new FakeFs();
    fs.seed(".hades-bridge/snapshot.json", "{}");
    setDevice({ notes: [] });
    const s = state();
    s.addFolder();
    s.addNote(state().notes[0].id);
    s.addNote(null);
    state().updateNote(state().notes[2].id, { name: ".starts with a dot" });
    state().updateNote(state().notes[0].id, { name: "..." });
    expect((await syncNow({ fs })).ok).toBe(true);
    const folderId = state().notes[0].id;
    state().moveNote(state().notes[2].id, folderId);
    state().updateNote(folderId, { name: "Renamed folder." });
    expect((await syncNow({ fs })).ok).toBe(true);
    state().deleteNote(folderId);
    expect((await syncNow({ fs })).ok).toBe(true);

    const dotted = fs.log.filter((o) =>
      [o.path, o.to].some((p) => p !== undefined && p.startsWith(ROOT + "/") && p.slice(ROOT.length + 1).split("/").some((c) => c.startsWith(".")))
    );
    expect(dotted).toEqual([]);
    expect(fs.log.some((o) => o.op === "rename" && /\/hades-tmp-[^/]+\.tmp$/.test(o.path))).toBe(true);
    expect(fs.rels().filter((r) => r.startsWith("."))).toEqual([".hades-bridge/snapshot.json"]);
  });

  it("leaves unknown user files and non-empty unknown directories alone, but tidies its own leftovers", async () => {
    const fs = new FakeFs();
    fs.seed("readme.txt", "my own file");
    fs.seed("Journal/random.md", "# not a hades note\njust markdown");
    fs.seed("Journal/photo.png", "png");
    fs.seed("Obsidian/vault.md", "---\ntitle: other tool\n---\nbody");
    fs.seedDir("EmptyOrphan");
    fs.seed("hades-tmp-aaaaaaaa-old1.tmp", "stale temp of this device");
    fs.seed("hades-tmp-bbbbbbbb-live.tmp", "in-flight temp of another device");
    setDevice({ notes: [mk("n1")] });

    await syncNow({ fs });

    expect(fs.read("readme.txt")).toBe("my own file");
    expect(fs.read("Journal/random.md")).toBe("# not a hades note\njust markdown");
    expect(fs.read("Journal/photo.png")).toBe("png");
    expect(fs.read("Obsidian/vault.md")).toContain("other tool");
    expect(fs.dirs.has(`${ROOT}/EmptyOrphan`)).toBe(false);
    expect(fs.read("hades-tmp-aaaaaaaa-old1.tmp")).toBeUndefined();
    expect(fs.read("hades-tmp-bbbbbbbb-live.tmp")).toBe("in-flight temp of another device");
    expect(state().notes.map((n) => n.id)).toEqual(["n1"]);
  });

  it("removes the old file of a renamed or moved note and the directory it leaves empty", async () => {
    const fs = new FakeFs();
    setDevice({ notes: [mkFolder("f1", { name: "Old" }), mk("n1", { parentId: "f1" })] });
    await syncNow({ fs });
    expect(fs.mdRels()).toEqual(["Old/Note n1-n1.md"]);
    state().moveNote("n1", null);
    state().deleteNote("f1");
    await syncNow({ fs });
    expect(fs.mdRels()).toEqual(["Note n1-n1.md"]);
    expect(fs.dirs.has(`${ROOT}/Old`)).toBe(false);
  });

  it("removes only files attributable to a tombstoned id", async () => {
    const fs = new FakeFs();
    setDevice({ notes: [mk("n1"), mk("n2")] });
    await syncNow({ fs });
    fs.seed("Note n1-copy.md", "not parseable as a hades note");
    state().deleteNote("n1");
    await syncNow({ fs });
    expect(fs.mdRels()).toEqual(["Note n1-copy.md", "Note n2-n2.md"]);
  });
});

describe("duplicate files for one note id", () => {
  it("prunes a stale copy that matches what was last synced instead of inventing a conflict", async () => {
    const fs = new FakeFs();
    setDevice({ notes: [mk("n1", { content: "v1" })] });
    await syncNow({ fs });
    const oldFile = fs.read("Note n1-n1.md")!;
    const devA = saveDevice();

    setDevice({ syncDeviceId: DEVICE_B });
    await syncNow({ fs });
    state().updateNote("n1", { name: "Renamed", content: "v2" });
    await syncNow({ fs });
    fs.seed("Note n1-n1.md", oldFile); // the other device's cleanup of the old path never happened

    setDevice(devA);
    const out = await syncNow({ fs });

    expect(out.ok).toBe(true);
    expect(fs.mdRels()).toEqual(["Renamed-n1.md"]);
    expect(state().notes).toHaveLength(1);
    expect(noteById("n1")).toMatchObject({ name: "Renamed", content: "v2" });
  });

  it("keeps the content of a cloud-client 'conflicted copy' as a conflict-copy note", async () => {
    const fs = new FakeFs();
    setDevice({ notes: [mk("n1", { content: "shared" })] });
    await syncNow({ fs });
    const stamp = (n: number) => new Date(Date.now() - n * 1000).toISOString();
    fs.seed("Note n1-n1.md", `---\nid: n1\nname: Note n1\nparentId: \ntags: \ncreatedAt: ${stamp(900)}\nupdatedAt: ${stamp(100)}\ndevice: cccccccc\n---\nedit from the phone`);
    fs.seed("Note n1-n1 (conflicted copy).md", `---\nid: n1\nname: Note n1\nparentId: \ntags: \ncreatedAt: ${stamp(900)}\nupdatedAt: ${stamp(90)}\ndevice: dddddddd\n---\nedit from the tablet`);

    const out = await syncNow({ fs });

    expect(out.ok).toBe(true);
    const texts = state().notes.map((n) => n.content).sort();
    expect(texts).toEqual(["edit from the phone", "edit from the tablet"]);
    expect(fs.mdRels()).toHaveLength(2);
    expect(fs.mdRels().some((r) => r.includes("conflicted"))).toBe(false);
    const all = fs.mdRels().map((r) => fs.read(r)!).join("\n");
    expect(all).toContain("edit from the phone");
    expect(all).toContain("edit from the tablet");
    expect(state().notes.some((n) => n.name.includes("conflict copy cccc"))).toBe(true);
    expect(fs.read("Note n1-n1.md")).toContain("edit from the tablet");
  });
});

describe("edits made while a sync is in flight", () => {
  it("never overwrites text typed during the sync and pushes it on the next run without a false conflict", async () => {
    const fs = new FakeFs();
    setDevice({ notes: [mk("n1", { content: "v1" }), mk("n2", { content: "other" })] });
    await syncNow({ fs });

    state().updateNote("n1", { content: "edit before sync" });
    let fired = false;
    fs.onOp = (op) => {
      if (!fired && op.op === "rename" && op.to!.endsWith(".md")) {
        fired = true;
        state().updateNote("n1", { content: "typed during the sync" });
      }
    };
    const out = await syncNow({ fs, trigger: "timer" });
    fs.onOp = null;

    expect(fired).toBe(true);
    expect(out.ok).toBe(true);
    expect(noteById("n1")!.content).toBe("typed during the sync");
    expect(fs.read("Note n1-n1.md")!.endsWith("edit before sync")).toBe(true);
    expect(state().pendingCount).toBe(1);
    expect(state().hasPendingChanges).toBe(true);

    expect((await syncNow({ fs })).ok).toBe(true);
    expect(fs.read("Note n1-n1.md")!.endsWith("typed during the sync")).toBe(true);
    expect(state().notes).toHaveLength(2);
    expect(state().pendingCount).toBe(0);
  });

  it("keeps both texts when the item being pulled is edited locally during the sync", async () => {
    const fs = new FakeFs();
    setDevice({ notes: [mk("n1", { content: "v1" })] });
    await syncNow({ fs });
    const devA = saveDevice();

    setDevice({ syncDeviceId: DEVICE_B });
    await syncNow({ fs });
    state().updateNote("n1", { content: "from device B" });
    await syncNow({ fs });

    setDevice(devA);
    let fired = false;
    fs.onOp = (op) => {
      if (!fired && op.op === "read" && op.path.endsWith("n1.md")) {
        fired = true;
        state().updateNote("n1", { content: "typed on A during the sync" });
      }
    };
    await syncNow({ fs });
    fs.onOp = null;

    expect(fired).toBe(true);
    const texts = state().notes.map((n) => n.content).sort();
    expect(texts).toEqual(["from device B", "typed on A during the sync"]);
    expect(state().pendingCount).toBe(0);
  });

  it("does not resurrect a note deleted while the sync was running", async () => {
    const fs = new FakeFs();
    setDevice({ notes: [mk("n1"), mk("n2")] });
    await syncNow({ fs });
    state().updateNote("n1", { content: "edit to push" });
    let fired = false;
    fs.onOp = (op) => {
      if (!fired && op.op === "rename" && op.to!.endsWith(".md")) {
        fired = true;
        state().deleteNote("n1");
      }
    };
    await syncNow({ fs });
    fs.onOp = null;
    expect(state().notes.map((n) => n.id)).toEqual(["n2"]);
    await syncNow({ fs });
    expect(fs.mdRels()).toEqual(["Note n2-n2.md"]);
  });

  it("discards the result if the user switched folders mid-run", async () => {
    const fs = new FakeFs();
    setDevice({ notes: [mk("n1")] });
    fs.onOp = (op) => {
      if (op.op === "rename" && op.to!.endsWith("_hades.json")) state().setSyncFolder("/somewhere/else");
    };
    const out = await syncNow({ fs });
    fs.onOp = null;
    expect(out.ok).toBe(true);
    expect(state().syncBase).toEqual({});
    expect(state().syncFolder).toBe("/somewhere/else");
  });
});

describe("editing during a sync", () => {
  // Jump the clock past the warning throttle so earlier mid-run tests don't mute it.
  const later = (h: number) => vi.spyOn(Date, "now").mockReturnValue(Date.now() + h * 3600_000);
  afterEach(() => vi.restoreAllMocks());
  const notices = () => state().toasts.filter((t) => t.message === EDIT_DURING_SYNC_NOTICE);

  it("does not warn when the only change is the engine pulling notes in", async () => {
    const fs = new FakeFs();
    setDevice({ notes: [mk("n1")] });
    await syncNow({ fs });
    setDevice({ syncDeviceId: DEVICE_B });
    later(10);
    await syncNow({ fs });
    expect(noteById("n1")).toBeDefined();
    expect(notices()).toHaveLength(0);
  });

  it("warns once when the user edits mid-run, and keeps the edit", async () => {
    const fs = new FakeFs();
    setDevice({ notes: [mk("n1")] });
    later(20);
    fs.onOp = (op) => {
      if (op.op === "rename" && op.to!.endsWith(".md")) {
        state().updateNote("n1", { content: "typed mid-sync" });
        state().updateNote("n1", { content: "typed mid-sync, more" });
      }
    };
    await syncNow({ fs });
    fs.onOp = null;
    expect(notices()).toHaveLength(1);
    expect(noteById("n1")!.content).toBe("typed mid-sync, more");
  });
});

describe("single-flight lock and timeouts", () => {
  it("shares one run between concurrent callers", async () => {
    const fs = new FakeFs();
    setDevice({ notes: [mk("n1")] });
    const a = syncNow({ fs, trigger: "timer" });
    expect(isSyncRunning()).toBe(true);
    expect(state().syncStatus).toBe("syncing");
    expect(state().isSyncing).toBe(true);
    const b = syncNow({ fs, trigger: "startup" });
    const c = syncNow({ fs, trigger: "manual" });
    expect(b).toBe(a);
    expect(c).toBe(a);
    await a;
    expect(isSyncRunning()).toBe(false);
    expect(fs.log.filter((o) => o.op === "rename" && o.to!.endsWith("_hades.json"))).toHaveLength(1);
    expect(fs.log.filter((o) => o.op === "readDir" && o.path === ROOT).length).toBeGreaterThan(0);
    const next = syncNow({ fs });
    expect(next).not.toBe(a);
    await next;
  });

  it("flushPendingForQuit joins a running sync and syncs again while edits keep landing", async () => {
    const fs = new FakeFs();
    setDevice({ notes: [mk("n1", { content: "v1" })] });
    await syncNow({ fs });

    state().updateNote("n1", { content: "edit 0" });
    let edits = 0;
    fs.onOp = (op) => {
      if (op.op === "rename" && op.to!.endsWith(".md") && edits < 2) {
        edits++;
        state().updateNote("n1", { content: `edit ${edits}` });
      }
    };
    const timerRun = syncNow({ fs, trigger: "timer" });
    const out = await flushPendingForQuit(fs);
    fs.onOp = null;

    expect(out.ok).toBe(true);
    expect(isSyncRunning()).toBe(false);
    expect(await timerRun).toBeDefined();
    expect(state().pendingCount).toBe(0);
    expect(fs.read("Note n1-n1.md")!.endsWith("edit 2")).toBe(true);
    expect(state().notes).toHaveLength(1);
  });

  describe("with fake timers", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("gives up on a hung folder, frees the lock and lets the next run proceed", async () => {
      const fs = new FakeFs();
      setDevice({ notes: [mk("n1")] });
      fs.hang = true;
      const hung = syncNow({ fs });
      expect(isSyncRunning()).toBe(true);
      await vi.advanceTimersByTimeAsync(5 * 60_000 + 10);
      const out = await hung;
      expect(out).toMatchObject({ ok: false, kind: "error" });
      expect(out.message).toMatch(/timed out/);
      expect(isSyncRunning()).toBe(false);
      expect(state().syncStatus).toBe("error");

      fs.hang = false;
      const again = await syncNow({ fs, trigger: "manual" });
      expect(again.ok).toBe(true);
      expect(fs.mdRels()).toEqual(["Note n1-n1.md"]);
    });

    it("stops an abandoned run from writing once it has timed out", async () => {
      const fs = new FakeFs();
      setDevice({ notes: [mk("n1"), mk("n2"), mk("n3")] });
      let fired = false;
      fs.onOp = (op) => {
        if (op.op === "write" && !op.path.includes("CaseProbe") && !fired) {
          fired = true;
          vi.advanceTimersByTime(5 * 60_000 + 10); // the run times out in the middle of its writes
        }
      };
      const out = await syncNow({ fs });
      expect(out).toMatchObject({ ok: false, kind: "error" });
      expect(out.message).toMatch(/timed out/);
      await vi.advanceTimersByTimeAsync(1000);
      expect(fs.mdRels()).toHaveLength(1);
      expect(fs.manifest()).toBeUndefined();
    });
  });
});

describe("case-only renames", () => {
  const conflictCopies = () => state().notes.filter((n) => n.name.includes("conflict copy"));

  async function renameFolderCaseOnly(fs: FakeFs) {
    setDevice({ notes: [mkFolder("f1", { name: "Maths" }), mk("n1", { parentId: "f1", name: "Algebra", content: "x = 1" })] });
    expect((await syncNow({ fs })).ok).toBe(true);
    state().updateNote("f1", { name: "maths" });
    return syncNow({ fs });
  }

  it("on a case-sensitive volume the renamed folder is created and the old one removed", async () => {
    const fs = new FakeFs();
    const out = await renameFolderCaseOnly(fs);
    expect(out.ok).toBe(true);
    expect(fs.mdRels()).toEqual(["maths/Algebra-n1.md"]);
    expect(fs.dirs.has(`${ROOT}/Maths`)).toBe(false);
    expect(conflictCopies()).toEqual([]);
    expect(noteById("n1")?.content).toBe("x = 1");
  });

  it("on a case-insensitive volume nothing is deleted after the same folder is 'renamed'", async () => {
    const fs = new CaseFoldFs();
    const out = await renameFolderCaseOnly(fs);
    expect(out.ok).toBe(true);
    expect(fs.mdRels()).toHaveLength(1);
    expect(fs.read(fs.mdRels()[0])).toContain("x = 1");
    expect(conflictCopies()).toEqual([]);
    expect(noteById("n1")?.content).toBe("x = 1");
  });

  for (const [label, make] of [["case-sensitive", () => new FakeFs()], ["case-insensitive", () => new CaseFoldFs()]] as const) {
    it(`a note renamed only in case leaves exactly one file and no conflict copy (${label})`, async () => {
      const fs = make();
      setDevice({ notes: [mk("n1", { name: "Foo", content: "body" })] });
      expect((await syncNow({ fs })).ok).toBe(true);
      state().updateNote("n1", { name: "foo" });
      expect((await syncNow({ fs })).ok).toBe(true);
      expect((await syncNow({ fs })).ok).toBe(true);
      expect(fs.mdRels()).toHaveLength(1);
      expect(fs.read(fs.mdRels()[0])).toContain("body");
      expect(conflictCopies()).toEqual([]);
      expect(state().notes.filter((n) => !n.isFolder)).toHaveLength(1);
    });
  }

  it("probes the volume once per folder and leaves no probe file behind", async () => {
    const fs = new FakeFs();
    setDevice({ notes: [mk("n1")] });
    await syncNow({ fs });
    await syncNow({ fs });
    const probeWrites = fs.log.filter((o) => o.op === "write" && o.path.includes("CaseProbe"));
    expect(probeWrites).toHaveLength(1);
    expect(fs.rels().filter((r) => r.includes("CaseProbe"))).toEqual([]);
  });
});

describe("file names", () => {
  const lone = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

  it("never cuts an emoji in half when shortening a long title", () => {
    for (const pad of [77, 78, 79, 80, 81]) {
      const name = safeName("x".repeat(pad) + "😀😀😀");
      expect(lone.test(name)).toBe(false);
      expect(name.length).toBeLessThanOrEqual(80);
    }
  });

  it("keeps ordinary long names at 80 units", () => {
    expect(safeName("y".repeat(200))).toHaveLength(80);
  });
});

describe("backup", () => {
  it("includes the notes and the store but never API keys or the sync base", () => {
    setDevice({ notes: [mk("n1")], syncBase: { n1: { h: "x", u: "y", n: "z", t: "", p: null } } });
    useStore.setState({ apiKey: "sk-secret-top", aiVendorConfigs: { ...state().aiVendorConfigs, openai: { apiKey: "sk-secret", model: "m" } } });
    const json = buildBackupJson(state());
    const parsed = JSON.parse(json);
    expect(parsed.format).toBe("hades-backup");
    expect(parsed.notes.map((n: NoteFile) => n.id)).toEqual(["n1"]);
    expect(parsed.store.tasks).toBeDefined();
    expect(json).not.toContain("sk-secret");
    expect(parsed.store.syncBase).toBeUndefined();
  });

  it("falls back to notes only when the store cannot be serialised", () => {
    const circular: Record<string, unknown> = { notes: [mk("n1")] };
    circular.self = circular;
    const parsed = JSON.parse(buildBackupJson(circular));
    expect(parsed.notes).toHaveLength(1);
    expect(parsed.store).toBeUndefined();
  });
});
