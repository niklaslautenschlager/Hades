import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarEvent, NoteFile, Task } from "../store/useStore";

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

  const files = new Map<string, Uint8Array>();
  const ollama = { up: false };
  const embedCalls: string[][] = [];
  const docTexts = new Map<string, string>();

  // Stand-in for nomic-embed-text: a 16-bucket bag of words, enough to be deterministic.
  function fakeOllamaVector(text: string): number[] {
    const v = new Array(16).fill(0);
    for (const w of text.toLowerCase().split(/[^a-z]+/).filter(Boolean)) {
      let s = 0;
      for (const ch of w) s += ch.charCodeAt(0);
      v[s % 16] += 1;
    }
    return v;
  }

  const invoke = vi.fn(async (cmd: string, args: Record<string, unknown>) => {
    switch (cmd) {
      case "app_data_read": {
        const f = files.get(args.relPath as string);
        if (!f) throw new Error("No such file");
        return f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength);
      }
      case "app_data_write":
        files.set(args.relPath as string, Uint8Array.from(args.contents as number[]));
        return undefined;
      case "app_data_remove":
        files.delete(args.relPath as string);
        return undefined;
      case "embed_texts": {
        const texts = args.texts as string[];
        embedCalls.push(texts);
        if (!ollama.up) throw new Error("Embedding request failed: Connection refused");
        return texts.map(fakeOllamaVector);
      }
      default:
        throw new Error(`unexpected invoke ${cmd}`);
    }
  });
  return { files, ollama, embedCalls, docTexts, invoke };
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("./pdfLibrary", () => ({
  libraryDocText: vi.fn(async (doc: { id: string }) => h.docTexts.get(doc.id) ?? ""),
}));

type Rag = typeof import("./ragIndex");
type StoreMod = typeof import("../store/useStore");

const INDEX = "rag/index.json";

// Module state (the loaded index, probe cache) is per-import, so each test gets a fresh copy.
async function fresh(): Promise<{ rag: Rag; useStore: StoreMod["useStore"] }> {
  vi.resetModules();
  const rag = await import("./ragIndex");
  const { useStore } = await import("../store/useStore");
  useStore.setState({ notes: [], calendarEvents: [], tasks: [], libraryDocs: [] });
  return { rag, useStore };
}

function note(id: string, name: string, content: string, updatedAt = "2026-10-01T10:00:00.000Z"): NoteFile {
  return { id, name, content, tags: [], parentId: null, isFolder: false, createdAt: updatedAt, updatedAt };
}

function readIndexFile(): { embedder: string | null; chunks: Array<{ id: string; sourceType: string; sourceId: string; sourceName: string; text: string; vector: number[] }>; version: number } {
  return JSON.parse(new TextDecoder().decode(h.files.get(INDEX)!));
}

function writeIndexFile(raw: string | object) {
  const text = typeof raw === "string" ? raw : JSON.stringify(raw);
  h.files.set(INDEX, new TextEncoder().encode(text));
}

const NOTES = [
  note("photo", "Photosynthesis", "Photosynthesis is how plants convert light energy into chemical energy inside the chloroplasts."),
  note("french", "French Revolution", "The French Revolution began in 1789 with the storming of the Bastille and ended the monarchy."),
  note("algebra", "Linear Algebra", "A matrix represents a linear map. Eigenvalues and eigenvectors describe its invariant directions."),
];

beforeEach(() => {
  h.files.clear();
  h.embedCalls.length = 0;
  h.docTexts.clear();
  h.ollama.up = false;
  h.invoke.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("built-in local embedder", () => {
  it("is deterministic, fixed-size and L2-normalised", async () => {
    const { rag } = await fresh();
    const a = rag.embedLocalText("Photosynthesis converts light into chemical energy");
    const b = rag.embedLocalText("Photosynthesis converts light into chemical energy");
    expect(a).toEqual(b);
    expect(a).toHaveLength(512);
    const norm = Math.sqrt(a.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeGreaterThan(0.98);
    expect(norm).toBeLessThan(1.02);
    expect(rag.embedLocalText("something else entirely")).not.toEqual(a);
    expect(rag.embedLocalText("   ").every((x) => x === 0)).toBe(true);
  });

  it("is insensitive to case, accents and simple inflection", async () => {
    const { rag } = await fresh();
    expect(rag.embedLocalText("Plants convert LIGHT")).toEqual(rag.embedLocalText("plant converts light"));
    expect(rag.embedLocalText("café résumé")).toEqual(rag.embedLocalText("cafe resume"));
  });

  it("ranks the relevant chunk first with Ollama completely absent", async () => {
    const { rag, useStore } = await fresh();
    useStore.setState({ notes: NOTES });
    const n = await rag.rebuildIndex();
    expect(n).toBe(3);
    expect(readIndexFile().embedder).toBe("local:hash-v1");

    const hits = await rag.search("how do plants convert sunlight into energy?", 3);
    expect(hits[0].sourceName).toBe("Photosynthesis");
    const hits2 = await rag.search("who stormed the Bastille in 1789", 3);
    expect(hits2[0].sourceName).toBe("French Revolution");
    const hits3 = await rag.search("eigenvalues of a matrix", 3);
    expect(hits3[0].sourceName).toBe("Linear Algebra");
  });

  it("returns nothing for an unrelated query instead of padding with noise", async () => {
    const { rag, useStore } = await fresh();
    useStore.setState({ notes: NOTES });
    await rag.rebuildIndex();
    expect(await rag.search("zzzz qqqq xxxx", 6)).toEqual([]);
  });

  it("search_notes-style scoped and typed lookups work without Ollama", async () => {
    const { rag, useStore } = await fresh();
    useStore.setState({
      notes: NOTES,
      libraryDocs: [{ id: "doc1", title: "Campbell Biology", fileName: "campbell.pdf", addedAt: "2026-09-01T00:00:00.000Z" }],
    });
    h.docTexts.set("doc1", "Chapter 8: Photosynthesis. The light reactions occur in the thylakoid membranes of the chloroplast.");
    await rag.rebuildIndex();
    const scoped = await rag.search("light reactions thylakoid", 6, { sourceId: "doc1" });
    expect(scoped.length).toBeGreaterThan(0);
    expect(scoped.every((x) => x.sourceId === "doc1" && x.sourceType === "pdf")).toBe(true);
    const notesOnly = await rag.search("photosynthesis chloroplast", 6, { types: ["note"] });
    expect(notesOnly.every((x) => x.sourceType === "note")).toBe(true);
  });
});

describe("embedder selection and recording", () => {
  it("a rebuild prefers Ollama when reachable and records it", async () => {
    const { rag, useStore } = await fresh();
    h.ollama.up = true;
    useStore.setState({ notes: NOTES });
    await rag.rebuildIndex();
    const file = readIndexFile();
    expect(file.embedder).toBe("ollama:nomic-embed-text");
    expect(file.version).toBe(2);
    expect(file.chunks[0].vector).toHaveLength(16);
    // Documents are embedded with the nomic task prefix.
    expect(h.embedCalls.flat().some((t) => t.startsWith("search_document: "))).toBe(true);

    await rag.search("plants light energy", 3);
    expect(h.embedCalls.flat().some((t) => t.startsWith("search_query: "))).toBe(true);
  });

  it("falls back to the local embedder when Ollama rejects", async () => {
    const { rag, useStore } = await fresh();
    useStore.setState({ notes: NOTES });
    await expect(rag.rebuildIndex()).resolves.toBe(3);
    expect(readIndexFile().embedder).toBe("local:hash-v1");
    const status = await rag.getRagStatus();
    expect(status.embedder).toMatchObject({ id: "local:hash-v1", kind: "local" });
    expect(status.embedderReady).toBe(true);
    expect(status.ollamaReachable).toBe(false);
  });

  it("search keeps working on keywords when the recorded Ollama embedder goes down", async () => {
    const { rag, useStore } = await fresh();
    h.ollama.up = true;
    useStore.setState({ notes: NOTES });
    await rag.rebuildIndex();
    h.ollama.up = false;
    const hits = await rag.search("chloroplasts convert light", 3);
    expect(hits[0].sourceName).toBe("Photosynthesis");
  });

  it("insisting on Ollama while it is down fails clearly and leaves the index alone", async () => {
    const { rag, useStore } = await fresh();
    useStore.setState({ notes: NOTES });
    await rag.rebuildIndex();
    const before = readIndexFile();
    await expect(rag.rebuildIndex(undefined, { embedder: "ollama" })).rejects.toThrow(/Ollama/);
    expect(readIndexFile()).toEqual(before);
  });

  it("offers an upgrade path: a local index plus a reachable Ollama rebuilds as semantic", async () => {
    const { rag, useStore } = await fresh();
    useStore.setState({ notes: NOTES });
    await rag.rebuildIndex();
    expect((await rag.getRagStatus()).ollamaReachable).toBe(false);
    h.ollama.up = true;
    // Let the failed-probe cache lapse.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 60_000);
    expect((await rag.getRagStatus()).ollamaReachable).toBe(true);
    await rag.rebuildIndex(undefined, { embedder: "ollama" });
    expect(readIndexFile().embedder).toBe("ollama:nomic-embed-text");
  });

  it("an Ollama build that dies midway completes with the local embedder", async () => {
    const { rag, useStore } = await fresh();
    h.ollama.up = true;
    useStore.setState({ notes: NOTES });
    // Probe succeeds, then the real batch fails.
    let calls = 0;
    const real = h.invoke.getMockImplementation()!;
    h.invoke.mockImplementation(async (cmd, args) => {
      if (cmd === "embed_texts" && ++calls > 1) throw new Error("Embedding request failed: reset");
      return real(cmd, args);
    });
    try {
      await rag.rebuildIndex();
    } finally {
      h.invoke.mockImplementation(real);
    }
    expect(readIndexFile().embedder).toBe("local:hash-v1");
    expect(readIndexFile().chunks).toHaveLength(3);
  });
});

describe("on-disk format", () => {
  it("loads an old index (no embedder field) as ollama:nomic-embed-text", async () => {
    writeIndexFile({
      model: "nomic-embed-text",
      lastBuilt: "2026-09-01T00:00:00.000Z",
      chunks: [
        { id: "c1", sourceType: "note", sourceId: "photo", sourceName: "Photosynthesis", text: "Plants convert light energy via chloroplasts.", vector: [0.1, 0.2, 0.3], updatedAt: "2026-10-01T10:00:00.000Z" },
        { id: "c2", sourceType: "pdf", sourceId: "doc1", sourceName: "Campbell", text: "Mitochondria produce ATP.", vector: [0.3, 0.2, 0.1], updatedAt: "2026-09-01T00:00:00.000Z" },
      ],
    });
    const { rag, useStore } = await fresh();
    useStore.setState({ notes: [NOTES[0]] });
    const status = await rag.getRagStatus();
    expect(status.chunks).toBe(2);
    expect(status.embedder?.id).toBe("ollama:nomic-embed-text");
    expect(status.embedder?.kind).toBe("ollama");
    expect(status.embedderReady).toBe(false); // Ollama is down in this test
    expect(status.lastBuilt).toBe("2026-09-01T00:00:00.000Z");
    // Ollama down => keyword path over the legacy chunks.
    const hits = await rag.search("chloroplasts light energy", 3);
    expect(hits[0].sourceId).toBe("photo");
  });

  it("legacy chunks without fingerprints are treated as fresh unless the note is newer", async () => {
    writeIndexFile({
      model: "nomic-embed-text",
      lastBuilt: "2026-09-01T00:00:00.000Z",
      chunks: [
        { id: "c1", sourceType: "note", sourceId: "photo", sourceName: "Photosynthesis", text: "old", vector: [1], updatedAt: NOTES[0].updatedAt },
      ],
    });
    h.ollama.up = true;
    const { rag, useStore } = await fresh();
    useStore.setState({ notes: [NOTES[0]] });
    expect((await rag.syncIndex()).upserted).toBe(0);

    useStore.setState({ notes: [{ ...NOTES[0], updatedAt: "2026-10-05T00:00:00.000Z" }] });
    expect((await rag.syncIndex()).upserted).toBeGreaterThan(0);
    expect(readIndexFile().chunks[0].text).toContain("chloroplasts");
  });

  const CORRUPT: Array<[string, string]> = [
    ["not json at all", "this is {{{ not json"],
    ["empty file", ""],
    ["an array", "[1,2,3]"],
    ["null", "null"],
    ["chunks not an array", JSON.stringify({ embedder: "local:hash-v1", chunks: "nope" })],
    ["truncated json", '{"embedder":"local:hash-v1","chunks":[{"id":"a"'],
  ];
  for (const [label, raw] of CORRUPT) {
    it(`treats a corrupt index (${label}) as empty and never throws`, async () => {
      writeIndexFile(raw);
      const { rag, useStore } = await fresh();
      useStore.setState({ notes: NOTES });
      const status = await rag.getRagStatus();
      expect(status.chunks).toBe(0);
      expect(status.embedder).toBeNull();
      // Search still works off the live notes, and a sync rebuilds a healthy index.
      const hits = await rag.search("chloroplasts convert light energy", 3);
      expect(hits[0].sourceName).toBe("Photosynthesis");
      await rag.syncIndex();
      expect(readIndexFile().chunks.length).toBeGreaterThan(0);
    });
  }

  it("drops malformed chunks but keeps the valid ones", async () => {
    writeIndexFile({
      embedder: "local:hash-v1",
      lastBuilt: "2026-10-01T00:00:00.000Z",
      chunks: [
        null,
        { id: 5 },
        { id: "bad-type", sourceType: "video", sourceId: "x", text: "t", vector: [1] },
        { id: "bad-vec", sourceType: "note", sourceId: "x", text: "t", vector: "nope" },
        { id: "ok", sourceType: "note", sourceId: "photo", sourceName: "Photosynthesis", text: "plants light", vector: [], updatedAt: "" },
      ],
    });
    const { rag } = await fresh();
    expect((await rag.getRagStatus()).chunks).toBe(1);
  });

  it("an index from an unknown embedder degrades to keywords and reports itself unusable", async () => {
    writeIndexFile({
      embedder: "local:hash-v9",
      lastBuilt: "2026-10-01T00:00:00.000Z",
      chunks: [{ id: "c", sourceType: "note", sourceId: "photo", sourceName: "Photosynthesis", text: "plants convert light", vector: [1, 2], updatedAt: "" }],
    });
    const { rag } = await fresh();
    const status = await rag.getRagStatus();
    expect(status.embedder?.kind).toBe("unknown");
    expect(status.embedderReady).toBe(false);
    expect((await rag.search("plants convert light", 3))[0].sourceId).toBe("photo");
    await expect(rag.syncIndex()).rejects.toThrow(/rebuild/i);
  });
});

describe("calendar events and tasks", () => {
  function at(days: number, hour = 14, min = 0): Date {
    const d = new Date(2026, 9, 8, hour, min, 0, 0);
    d.setDate(d.getDate() + days);
    return d;
  }
  function ev(id: string, title: string, start: Date, end: Date, extra: Partial<CalendarEvent> = {}): CalendarEvent {
    return { id, title, start: start.toISOString(), end: end.toISOString(), source: "local", ...extra };
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 8, 12, 0, 0));
  });

  it("renders events and tasks as short local-time text and finds them", async () => {
    const { rag, useStore } = await fresh();
    const tasks: Task[] = [
      { id: "t1", text: "Finish problem set 4", completed: false, createdAt: "2026-10-01T00:00:00.000Z", dueDate: at(2, 18).toISOString() },
      { id: "t2", text: "Read chapter 3", completed: true, createdAt: "2026-10-02T00:00:00.000Z" },
    ];
    useStore.setState({
      notes: [],
      calendarEvents: [
        ev("e1", "Midterm review", at(6, 14), at(6, 15, 30), { isDeadline: true, description: "Bring  your\nnotes" }),
        ev("e2", "Overnight lab", at(1, 22), at(2, 8)),
      ],
      tasks,
    });
    await rag.rebuildIndex();
    const chunks = readIndexFile().chunks;
    const text = (id: string) => chunks.find((c) => c.sourceId === id)!.text;

    // Oct 8 2026 is a Thursday, so +6 days is Wednesday Oct 14.
    expect(text("e1")).toBe("Event: Midterm review — Wed Oct 14, 14:00–15:30 [DEADLINE] — Bring your notes");
    expect(text("e2")).toBe("Event: Overnight lab — Fri Oct 9, 22:00 – Sat Oct 10, 08:00");
    expect(text("t1")).toBe("Task: Finish problem set 4 — due Sat Oct 10, 18:00 [open]");
    expect(text("t2")).toBe("Task: Read chapter 3 [done]");
    expect(chunks.filter((c) => c.sourceType === "event").map((c) => c.sourceName).sort()).toEqual(["Midterm review", "Overnight lab"]);

    const hits = await rag.search("when is the midterm review", 3);
    expect(hits[0]).toMatchObject({ sourceType: "event", sourceName: "Midterm review" });
    const t = await rag.search("problem set 4 due", 3, { types: ["task"] });
    expect(t[0]).toMatchObject({ sourceType: "task", sourceName: "Finish problem set 4" });
  });

  it("only indexes events from 7 days ago to 120 days ahead (ongoing events included)", async () => {
    const { rag, useStore } = await fresh();
    useStore.setState({
      calendarEvents: [
        ev("old", "Ancient", at(-10), at(-10, 15)),
        ev("recent", "Recent", at(-5), at(-5, 15)),
        ev("ongoing", "Long conference", at(-9), at(-3)),
        ev("far", "Far future", at(100), at(100, 15)),
        ev("toofar", "Too far", at(130), at(130, 15)),
        { id: "junk", title: "Bad date", start: "not a date", end: "", source: "local" },
      ],
    });
    await rag.rebuildIndex();
    const ids = readIndexFile().chunks.filter((c) => c.sourceType === "event").map((c) => c.sourceId).sort();
    expect(ids).toEqual(["far", "ongoing", "recent"]);
  });

  it("caps events at 500 chunks, keeping those nearest to now (iCal expansion can't explode the index)", async () => {
    const { rag, useStore } = await fresh();
    const many: CalendarEvent[] = [];
    for (let i = 0; i < 700; i++) {
      const start = new Date(2026, 9, 8, 12 + i, 0, 0);
      many.push(ev(`ical-${i}`, `Lecture ${i}`, start, new Date(start.getTime() + 3600_000), { source: "ical", icalFeedId: "f1" }));
    }
    useStore.setState({ calendarEvents: many });
    await rag.rebuildIndex();
    const events = readIndexFile().chunks.filter((c) => c.sourceType === "event");
    expect(events).toHaveLength(500);
    const ids = new Set(events.map((c) => c.sourceId));
    expect(ids.has("ical-0")).toBe(true);
    expect(ids.has("ical-499")).toBe(true);
    expect(ids.has("ical-699")).toBe(false);
  });

  it("incremental sync embeds only changed items and removes deleted ones", async () => {
    const { rag, useStore } = await fresh();
    useStore.setState({
      notes: NOTES,
      calendarEvents: [ev("e1", "Midterm review", at(6, 14), at(6, 15, 30))],
      tasks: [{ id: "t1", text: "Finish problem set", completed: false, createdAt: "2026-10-01T00:00:00.000Z" }],
    });
    await rag.syncIndex(); // no index yet => full build
    const first = readIndexFile().chunks;
    expect(first.map((c) => c.sourceType).sort()).toEqual(["event", "note", "note", "note", "task"]);
    const idOf = (cs: typeof first, sourceId: string) => cs.find((c) => c.sourceId === sourceId)!.id;

    // Nothing changed => nothing re-embedded.
    expect(await rag.syncIndex()).toMatchObject({ upserted: 0, removed: 0, rebuilt: false });

    // Edit one note, add one event, complete the task.
    useStore.setState({
      notes: [NOTES[0], { ...NOTES[1], content: NOTES[1].content + " Robespierre led the Terror.", updatedAt: "2026-10-08T11:00:00.000Z" }, NOTES[2]],
      calendarEvents: [
        ev("e1", "Midterm review", at(6, 14), at(6, 15, 30)),
        ev("e2", "Office hours", at(3, 10), at(3, 11)),
      ],
      tasks: [{ id: "t1", text: "Finish problem set", completed: true, createdAt: "2026-10-01T00:00:00.000Z" }],
    });
    const r = await rag.syncIndex({ kinds: ["event"], ids: ["e2"] });
    expect(r.upserted).toBe(1);
    // Scoped to e2: the edited note and the task are still stale.
    expect((await rag.getRagStatus()).pending).toBe(2);

    await rag.syncIndex({ kinds: ["note", "task"], ids: ["french", "t1"] });
    const second = readIndexFile().chunks;
    expect(idOf(second, "photo")).toBe(idOf(first, "photo"));
    expect(idOf(second, "algebra")).toBe(idOf(first, "algebra"));
    expect(idOf(second, "e1")).toBe(idOf(first, "e1"));
    expect(idOf(second, "french")).not.toBe(idOf(first, "french"));
    expect(second.find((c) => c.sourceId === "french")!.text).toContain("Robespierre");
    expect(second.find((c) => c.sourceId === "t1")!.text).toMatch(/\[done\]$/);
    expect(second.some((c) => c.sourceId === "e2")).toBe(true);
    expect((await rag.getRagStatus()).pending).toBe(0);

    // Deletions drop their chunks.
    useStore.setState({
      notes: [NOTES[0], NOTES[2]],
      calendarEvents: [ev("e2", "Office hours", at(3, 10), at(3, 11))],
      tasks: [],
    });
    const del = await rag.syncIndex({ ids: ["french", "e1", "t1"] });
    expect(del.removed).toBe(3);
    const third = readIndexFile().chunks;
    expect(third.some((c) => ["french", "e1", "t1"].includes(c.sourceId))).toBe(false);
    expect(third.some((c) => c.sourceId === "photo")).toBe(true);
  });

  it("a PDF that yields no text is remembered, not re-extracted on every sync", async () => {
    const { rag, useStore } = await fresh();
    const pdfLib = await import("./pdfLibrary");
    useStore.setState({
      libraryDocs: [{ id: "scan", title: "Scanned handout", fileName: "scan.pdf", addedAt: "2026-09-01T00:00:00.000Z" }],
    });
    await rag.syncIndex();
    const calls = vi.mocked(pdfLib.libraryDocText).mock.calls.length;
    expect(calls).toBeGreaterThan(0);
    await rag.syncIndex();
    await rag.syncIndex({ kinds: ["pdf"] });
    expect(vi.mocked(pdfLib.libraryDocText).mock.calls.length).toBe(calls);
    expect((await rag.getRagStatus()).pending).toBe(0);
  });

  it("with an Ollama-built index and Ollama down, a sync that needs embeddings throws and changes nothing", async () => {
    const { rag, useStore } = await fresh();
    h.ollama.up = true;
    useStore.setState({ notes: NOTES });
    await rag.rebuildIndex();
    const before = readIndexFile();
    h.ollama.up = false;
    vi.setSystemTime(Date.now() + 120_000); // let the cached "reachable" probe expire
    useStore.setState({ notes: [...NOTES, note("new", "New note", "Fresh content about enzymes")] });
    await expect(rag.syncIndex()).rejects.toBeInstanceOf(rag.EmbedderUnavailableError);
    expect(readIndexFile()).toEqual(before);
    // Pure removals need no embedder and still go through.
    useStore.setState({ notes: [NOTES[0], NOTES[1]] });
    await expect(rag.syncIndex({ ids: ["algebra"] })).resolves.toMatchObject({ removed: 1 });
  });

  it("a cancelled build leaves the previous index untouched", async () => {
    const { rag, useStore } = await fresh();
    useStore.setState({ notes: NOTES });
    await rag.rebuildIndex();
    const before = readIndexFile();
    const ctl = new AbortController();
    ctl.abort();
    await expect(rag.syncIndex({ signal: ctl.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(readIndexFile()).toEqual(before);
  });

  it("clearIndex wipes memory and disk, and a later sync rebuilds", async () => {
    const { rag, useStore } = await fresh();
    useStore.setState({ notes: NOTES });
    await rag.rebuildIndex();
    await rag.clearIndex();
    expect(h.files.has(INDEX)).toBe(false);
    expect((await rag.getRagStatus()).chunks).toBe(0);
    await rag.syncIndex();
    expect(readIndexFile().chunks).toHaveLength(3);
  });
});
