import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryDoc, NoteFile } from "../store/useStore";

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
  return {
    libraryDocCachedText: vi.fn(),
    libraryDocText: vi.fn(), // the OCR-capable path: must never run while a chat message waits
    libraryDocBytes: vi.fn(),
    extractPdfPages: vi.fn(),
  };
});

vi.mock("./pdfLibrary", () => ({
  libraryDocCachedText: h.libraryDocCachedText,
  libraryDocText: h.libraryDocText,
  libraryDocBytes: h.libraryDocBytes,
  extractPdfPages: h.extractPdfPages,
}));

// Extraction results are cached per module instance, so every test loads a fresh one.
let useStore: typeof import("../store/useStore").useStore;
let getActiveNote: typeof import("./openDocs").getActiveNote;
let getOpenNotes: typeof import("./openDocs").getOpenNotes;
let getOpenPdfText: typeof import("./openDocs").getOpenPdfText;
let getOpenPdfContext: typeof import("./openDocs").getOpenPdfContext;

function note(id: string, name: string, content = "", isFolder = false): NoteFile {
  return { id, name, content, tags: [], parentId: null, isFolder, createdAt: "", updatedAt: "2026-10-01T00:00:00.000Z" };
}

function pagesOf(n: number, size = 300): string[] {
  return Array.from({ length: n }, (_, i) => `Page${i + 1} ` + `word${i + 1} `.repeat(Math.ceil(size / 8)).slice(0, size));
}

let urlSeq = 0;
function openBlobPdf(fileName = "Lecture_Notes.pdf", page?: number): string {
  const url = `blob:test-${++urlSeq}`;
  useStore.setState({
    notePdfUrl: url,
    notePdfFileName: fileName,
    notePdfDocId: null,
    pdfPages: page ? { [fileName]: page } : {},
  });
  return url;
}

const fetchMock = vi.fn();

beforeEach(async () => {
  vi.resetModules();
  ({ useStore } = await import("../store/useStore"));
  ({ getActiveNote, getOpenNotes, getOpenPdfText, getOpenPdfContext } = await import("./openDocs"));
  h.libraryDocCachedText.mockReset();
  h.libraryDocText.mockReset();
  h.libraryDocBytes.mockReset();
  h.extractPdfPages.mockReset();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });
  vi.stubGlobal("fetch", fetchMock);
  useStore.setState({
    notes: [],
    activeNoteId: null,
    openNoteIds: [],
    notePdfUrl: null,
    notePdfFileName: "",
    notePdfDocId: null,
    pdfPages: {},
    libraryDocs: [],
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("open notes", () => {
  it("returns the notes open as tabs in tab order, skipping folders and dangling ids", () => {
    useStore.setState({
      notes: [note("a", "Alpha", "A"), note("b", "Beta", "B"), note("f", "Folder", "", true), note("c", "Closed", "C")],
      openNoteIds: ["b", "ghost", "f", "a"],
      activeNoteId: "a",
    });
    expect(getOpenNotes().map((n) => n.id)).toEqual(["b", "a"]);
  });

  it("returns the active note, or null for none / a folder / a deleted id", () => {
    useStore.setState({ notes: [note("a", "Alpha", "A"), note("f", "Folder", "", true)], openNoteIds: ["a"], activeNoteId: "a" });
    expect(getActiveNote()?.name).toBe("Alpha");
    useStore.setState({ activeNoteId: "f" });
    expect(getActiveNote()).toBeNull();
    useStore.setState({ activeNoteId: "gone" });
    expect(getActiveNote()).toBeNull();
    useStore.setState({ activeNoteId: null });
    expect(getActiveNote()).toBeNull();
  });

  it("tolerates corrupt state", () => {
    useStore.setState({ openNoteIds: undefined as unknown as string[] });
    expect(getOpenNotes()).toEqual([]);
  });
});

describe("PDF opened from a file or URL (blob)", () => {
  it("is null when no PDF is open, without touching the extractor", async () => {
    expect(await getOpenPdfText()).toBeNull();
    expect(h.extractPdfPages).not.toHaveBeenCalled();
  });

  it("fetches the blob, extracts per-page text and puts the current page first", async () => {
    const pages = pagesOf(10);
    h.extractPdfPages.mockResolvedValue({ pages, pageCount: 10 });
    openBlobPdf("Lecture_Notes.pdf", 5);
    const r = (await getOpenPdfText())!;
    expect(r).toMatchObject({ title: "Lecture Notes", docId: null, currentPage: 5, pageCount: 10, truncated: false });
    expect(r.text).toContain("[Page 4]");
    expect(r.text).toContain("[Page 5]");
    expect(r.text).toContain("[Page 6]");
    expect(r.text).toContain("Page5 word5");
    // Whole short document fits: every page is there, in page order.
    const order = [...r.text.matchAll(/\[Page (\d+)\]/g)].map((m) => Number(m[1]));
    expect(order).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("defaults to page 1 when no page was ever recorded", async () => {
    h.extractPdfPages.mockResolvedValue({ pages: pagesOf(3), pageCount: 3 });
    openBlobPdf();
    expect((await getOpenPdfText())!.currentPage).toBe(1);
  });

  it("keeps the current page and its neighbours when the cap forces truncation", async () => {
    h.extractPdfPages.mockResolvedValue({ pages: pagesOf(30, 500), pageCount: 30 });
    openBlobPdf("Big.pdf", 20);
    const r = (await getOpenPdfText({ maxChars: 2000 }))!;
    expect(r.truncated).toBe(true);
    expect(r.text.length).toBeLessThanOrEqual(2000);
    for (const p of [19, 20, 21]) expect(r.text).toContain(`[Page ${p}]`);
    expect(r.text).toContain("Page20 word20");
    expect(r.text).not.toContain("[Page 1]");
  });

  it("honours an explicit page and clamps maxChars", async () => {
    h.extractPdfPages.mockResolvedValue({ pages: pagesOf(8, 400), pageCount: 8 });
    openBlobPdf("Doc.pdf", 2);
    const r = (await getOpenPdfText({ page: 7, maxChars: 900 }))!;
    expect(r.currentPage).toBe(2); // where the user actually is
    expect(r.text.indexOf("[Page 7]")).toBeGreaterThanOrEqual(0);
    expect(r.text).toContain("[Page 6]");
    expect(r.text).toContain("[Page 8]");
    expect(r.truncated).toBe(true);
    // A silly maxChars is raised to a sane floor rather than returning nothing.
    expect((await getOpenPdfText({ page: 1, maxChars: 1 }))!.text.length).toBeGreaterThan(100);
  });

  it("caches the extraction by blob URL so repeated chat turns are free", async () => {
    h.extractPdfPages.mockResolvedValue({ pages: pagesOf(4), pageCount: 4 });
    openBlobPdf();
    await getOpenPdfText();
    await getOpenPdfText({ page: 3 });
    await getOpenPdfText();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(h.extractPdfPages).toHaveBeenCalledTimes(1);
    openBlobPdf("Other.pdf");
    await getOpenPdfText();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("times out without blocking, reports pending, and the next turn has the text", async () => {
    let finish!: (v: { pages: string[]; pageCount: number }) => void;
    h.extractPdfPages.mockReturnValue(new Promise((res) => { finish = res; }));
    openBlobPdf("Slow.pdf", 2);

    const t0 = Date.now();
    const ctx = (await getOpenPdfContext({ timeoutMs: 30 }))!;
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(ctx.pending).toBe(true);
    expect(ctx.pdf).toMatchObject({ title: "Slow", text: "", truncated: false, currentPage: 2 });
    const plain = (await getOpenPdfText({ timeoutMs: 10 }))!;
    expect(plain.text).toBe("");

    finish({ pages: pagesOf(3), pageCount: 3 });
    const later = (await getOpenPdfContext({ timeoutMs: 1000 }))!;
    expect(later.pending).toBe(false);
    expect(later.pdf.text).toContain("Page2 word2");
    expect(fetchMock).toHaveBeenCalledTimes(1); // the background extraction was reused
  });

  it("never throws or hangs on failures, and retries the extraction next time", async () => {
    openBlobPdf("Broken.pdf");
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    const first = (await getOpenPdfContext({ timeoutMs: 500 }))!;
    expect(first.pending).toBe(true);
    expect(first.pdf.text).toBe("");

    h.extractPdfPages.mockResolvedValue({ pages: [], pageCount: 0 }); // pdf.js failure => 0 pages
    const second = (await getOpenPdfContext({ timeoutMs: 500 }))!;
    expect(second.pending).toBe(true);

    h.extractPdfPages.mockResolvedValue({ pages: pagesOf(2), pageCount: 2 });
    const third = (await getOpenPdfContext({ timeoutMs: 500 }))!;
    expect(third.pending).toBe(false);
    expect(third.pdf.text).toContain("[Page 1]");
  });

  it("a non-OK fetch is a failure, not empty text", async () => {
    openBlobPdf("Gone.pdf");
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) });
    expect((await getOpenPdfContext({ timeoutMs: 500 }))!.pending).toBe(true);
  });

  it("a scanned PDF (no text layer) comes back empty but not pending", async () => {
    h.extractPdfPages.mockResolvedValue({ pages: ["", "", ""], pageCount: 3 });
    openBlobPdf("Scan.pdf");
    const ctx = (await getOpenPdfContext({ timeoutMs: 500 }))!;
    expect(ctx.pending).toBe(false);
    expect(ctx.pdf).toMatchObject({ text: "", pageCount: 3, truncated: false });
  });
});

describe("library PDF", () => {
  const doc: LibraryDoc = { id: "doc1", title: "Campbell Biology", fileName: "campbell.pdf", pageCount: 4, addedAt: "2026-09-01T00:00:00.000Z" };

  function openLibrary(page?: number) {
    useStore.setState({
      libraryDocs: [doc],
      notePdfUrl: "blob:lib-1",
      notePdfFileName: doc.title,
      notePdfDocId: doc.id,
      pdfPages: page ? { [doc.id]: page } : {},
    });
  }

  it("reuses the hidden text cache and maps blocks to pages when every page has text", async () => {
    h.libraryDocCachedText.mockResolvedValue(["alpha one", "beta two", "gamma three", "delta four"].join("\n\n"));
    openLibrary(3);
    const r = (await getOpenPdfText())!;
    expect(r).toMatchObject({ title: "Campbell Biology", docId: "doc1", currentPage: 3, pageCount: 4, truncated: false });
    expect(r.text).toContain("[Page 3]\ngamma three");
    expect(h.libraryDocBytes).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("when blocks don't line up with the page count, parses the PDF once for per-page text", async () => {
    // Page 2 is blank, so the cache has 3 blocks for a 4-page doc.
    h.libraryDocCachedText.mockResolvedValue(["alpha", "gamma", "delta"].join("\n\n"));
    h.libraryDocBytes.mockResolvedValue(new Uint8Array([1]));
    h.extractPdfPages.mockResolvedValue({ pages: ["alpha", "", "gamma", "delta"], pageCount: 4 });
    openLibrary(3);
    const r = (await getOpenPdfText())!;
    expect(r.text).toContain("[Page 3]\ngamma");
    expect(r.text).toContain("[Page 4]\ndelta");
    expect(r.text).not.toContain("[Page 2]");
    await getOpenPdfText({ page: 1 });
    expect(h.extractPdfPages).toHaveBeenCalledTimes(1);
    expect(h.libraryDocBytes).toHaveBeenCalledTimes(1);
  });

  it("falls back to the plain cached text when pages can't be recovered", async () => {
    h.libraryDocCachedText.mockResolvedValue("alpha\n\ngamma\n\ndelta");
    h.libraryDocBytes.mockResolvedValue(new Uint8Array([1]));
    h.extractPdfPages.mockResolvedValue({ pages: [], pageCount: 0 });
    openLibrary(3);
    const r = (await getOpenPdfText())!;
    expect(r.text).toBe("alpha\n\ngamma\n\ndelta");
    expect(r.truncated).toBe(false);
  });

  it("flags truncation for long cached text without page structure", async () => {
    h.libraryDocCachedText.mockResolvedValue("x".repeat(9000));
    h.libraryDocBytes.mockResolvedValue(new Uint8Array([1]));
    h.extractPdfPages.mockResolvedValue({ pages: [], pageCount: 0 });
    openLibrary();
    const r = (await getOpenPdfText({ maxChars: 3000 }))!;
    expect(r.text).toHaveLength(3000);
    expect(r.truncated).toBe(true);
  });

  it("with no cached text it reads the PDF's text layer, never the OCR cascade", async () => {
    h.libraryDocCachedText.mockResolvedValue("");
    h.libraryDocBytes.mockResolvedValue(new Uint8Array([1]));
    h.extractPdfPages.mockResolvedValue({ pages: ["one", "two", "three", "four"], pageCount: 4 });
    openLibrary(2);
    const r = (await getOpenPdfText())!;
    expect(r.text).toContain("[Page 2]\ntwo");
    expect(h.libraryDocText).not.toHaveBeenCalled();
  });

  it("a scanned library PDF with no cache comes back empty without OCR", async () => {
    h.libraryDocCachedText.mockResolvedValue("");
    h.libraryDocBytes.mockResolvedValue(new Uint8Array([1]));
    h.extractPdfPages.mockResolvedValue({ pages: ["", "", "", ""], pageCount: 4 });
    openLibrary(1);
    const ctx = (await getOpenPdfContext())!;
    expect(ctx.pending).toBe(false);
    expect(ctx.pdf.text).toBe("");
    expect(h.libraryDocText).not.toHaveBeenCalled();
  });

  it("a slow read can't hold up the send and isn't started twice", async () => {
    h.libraryDocCachedText.mockReturnValue(new Promise(() => {}));
    openLibrary(1);
    const ctx = (await getOpenPdfContext({ timeoutMs: 20 }))!;
    expect(ctx.pending).toBe(true);
    expect(ctx.pdf).toMatchObject({ title: "Campbell Biology", docId: "doc1", text: "" });
    await getOpenPdfContext({ timeoutMs: 20 });
    expect(h.libraryDocCachedText).toHaveBeenCalledTimes(1);
  });
});
