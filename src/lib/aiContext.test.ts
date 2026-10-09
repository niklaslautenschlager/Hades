import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NoteFile } from "../store/useStore";

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
  return { search: vi.fn(), extractPdfPages: vi.fn(), libraryDocCachedText: vi.fn(), libraryDocBytes: vi.fn() };
});

vi.mock("./ragIndex", () => ({ search: h.search }));
vi.mock("./pdfLibrary", () => ({
  libraryDocCachedText: h.libraryDocCachedText,
  libraryDocText: vi.fn(),
  libraryDocBytes: h.libraryDocBytes,
  extractPdfPages: h.extractPdfPages,
}));

import { useStore } from "../store/useStore";
import { buildOpenDocumentContext, retrieveContext } from "./aiContext";

function note(id: string, name: string, content: string): NoteFile {
  return { id, name, content, tags: [], parentId: null, isFolder: false, createdAt: "", updatedAt: "2026-10-01T00:00:00.000Z" };
}

let urlSeq = 0;
const fetchMock = vi.fn();

beforeEach(() => {
  h.search.mockReset();
  h.extractPdfPages.mockReset();
  h.libraryDocCachedText.mockReset();
  h.libraryDocBytes.mockReset();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(4) });
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

function openBlobPdf(fileName: string, page: number) {
  useStore.setState({ notePdfUrl: `blob:ctx-${++urlSeq}`, notePdfFileName: fileName, notePdfDocId: null, pdfPages: { [fileName]: page } });
}

describe("buildOpenDocumentContext", () => {
  it("is empty when nothing is open", async () => {
    expect(await buildOpenDocumentContext()).toEqual({ text: "", coveredSourceIds: [] });
  });

  it("labels the active note with its title and full text", async () => {
    useStore.setState({ notes: [note("a", "Cell Biology", "Mitochondria make ATP.")], openNoteIds: ["a"], activeNoteId: "a" });
    const r = await buildOpenDocumentContext();
    expect(r.text).toContain("## Currently open in Hades");
    expect(r.text).toContain("### Open note: Cell Biology\nMitochondria make ATP.");
    expect(r.coveredSourceIds).toEqual(["a"]);
  });

  it("caps a long note at ~6000 characters, flags it, and does not claim it was shared in full", async () => {
    useStore.setState({ notes: [note("a", "Long", "x".repeat(20000))], activeNoteId: "a", openNoteIds: ["a"] });
    const r = await buildOpenDocumentContext();
    expect(r.text).toContain("…(truncated)");
    expect(r.text.length).toBeLessThan(6400);
    expect(r.coveredSourceIds).toEqual([]);
  });

  it("notes an empty note instead of dropping it", async () => {
    useStore.setState({ notes: [note("a", "Blank", "  ")], activeNoteId: "a", openNoteIds: ["a"] });
    expect((await buildOpenDocumentContext()).text).toContain("(this note is empty)");
  });

  it("includes the open PDF with its current page first, labelled by page", async () => {
    h.extractPdfPages.mockResolvedValue({ pages: ["intro", "the core idea", "an example", "summary"], pageCount: 4 });
    openBlobPdf("Lecture 3.pdf", 2);
    const r = await buildOpenDocumentContext();
    expect(r.text).toContain("### Open PDF: Lecture 3 (viewing page 2 of 4)");
    expect(r.text).toContain("[Page 2]\nthe core idea");
    expect(r.text).toContain("[Page 3]\nan example");
    expect(r.text).not.toContain("truncated");
  });

  it("both at once, note first then PDF", async () => {
    useStore.setState({ notes: [note("a", "My note", "hello")], activeNoteId: "a", openNoteIds: ["a"] });
    h.extractPdfPages.mockResolvedValue({ pages: ["p1"], pageCount: 1 });
    openBlobPdf("Paper.pdf", 1);
    const { text } = await buildOpenDocumentContext();
    expect(text.indexOf("### Open note")).toBeGreaterThan(-1);
    expect(text.indexOf("### Open note")).toBeLessThan(text.indexOf("### Open PDF"));
  });

  it("sends without the PDF text when extraction is slow, says so in one line, and has it next turn", async () => {
    let finish!: (v: { pages: string[]; pageCount: number }) => void;
    h.extractPdfPages.mockReturnValue(new Promise((res) => { finish = res; }));
    openBlobPdf("Slow.pdf", 3);

    const first = await buildOpenDocumentContext({ timeoutMs: 20 });
    expect(first.text).toContain("### Open PDF: Slow (viewing page 3)");
    expect(first.text).toContain("still being extracted");
    expect(first.text).not.toContain("[Page");
    expect(first.coveredSourceIds).toEqual([]);

    finish({ pages: ["a", "b", "c big page"], pageCount: 3 });
    const second = await buildOpenDocumentContext({ timeoutMs: 1000 });
    expect(second.text).toContain("[Page 3]\nc big page");
    expect(second.text).not.toContain("still being extracted");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("an extraction failure never becomes a chat error", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    openBlobPdf("Broken.pdf", 1);
    const r = await buildOpenDocumentContext({ timeoutMs: 500 });
    expect(r.text).toContain("still being extracted");
  });

  it("says when a PDF has no text layer", async () => {
    h.extractPdfPages.mockResolvedValue({ pages: ["", ""], pageCount: 2 });
    openBlobPdf("Scan.pdf", 1);
    expect((await buildOpenDocumentContext()).text).toContain("No selectable text was found");
  });

  it("does not claim page labels for text that has no page structure (OCR / scanned library PDFs)", async () => {
    h.libraryDocCachedText.mockResolvedValue("recognised text with no page breaks at all");
    h.extractPdfPages.mockResolvedValue({ pages: [], pageCount: 0 });
    useStore.setState({
      libraryDocs: [{ id: "d9", title: "Scanned notes", fileName: "scan.pdf", pageCount: 5, addedAt: "" }],
      notePdfUrl: "blob:scan", notePdfFileName: "Scanned notes", notePdfDocId: "d9", pdfPages: { d9: 3 },
    });
    const { text } = await buildOpenDocumentContext();
    expect(text).toContain("recognised text with no page breaks at all");
    expect(text).toContain("not split by page");
    expect(text).not.toContain("Pages are labelled");
    expect(text).not.toMatch(/\[Page \d+\]/);
  });

  it("marks a truncated PDF and does not list it as fully covered", async () => {
    h.libraryDocCachedText.mockResolvedValue(Array.from({ length: 6 }, (_, i) => `page${i + 1} ` + "y".repeat(3000)).join("\n\n"));
    useStore.setState({
      libraryDocs: [{ id: "d1", title: "Textbook", fileName: "t.pdf", pageCount: 6, addedAt: "" }],
      notePdfUrl: "blob:lib", notePdfFileName: "Textbook", notePdfDocId: "d1", pdfPages: { d1: 1 },
    });
    const r = await buildOpenDocumentContext();
    expect(r.text).toContain("truncated — only part of the document is shown");
    expect(r.coveredSourceIds).toEqual([]);
  });
});

describe("retrieveContext", () => {
  it("builds labelled blocks for notes, PDFs, events and tasks with a local-time hint and the citation rule", async () => {
    h.search.mockResolvedValue([
      { text: "Mitochondria", sourceId: "n1", sourceName: "Biology", sourceType: "note", score: 1 },
      { text: "Chapter 1", sourceId: "d1", sourceName: "Campbell", sourceType: "pdf", score: 0.9 },
      { text: "Event: Midterm review — Wed Oct 14, 14:00–15:30", sourceId: "e1", sourceName: "Midterm review", sourceType: "event", score: 0.8 },
      { text: "Task: Problem set [open]", sourceId: "t1", sourceName: "Problem set", sourceType: "task", score: 0.7 },
    ]);
    const out = await retrieveContext("midterm");
    expect(out).toContain("### Note: Biology");
    expect(out).toContain("### PDF: Campbell");
    expect(out).toContain("### Event: Midterm review");
    expect(out).toContain("### Task: Problem set");
    expect(out).toContain("Current local time:");
    expect(out).toContain("[Event: <title>] or [Task: <text>]");
  });

  it("omits the clock line when no schedule items were retrieved", async () => {
    h.search.mockResolvedValue([{ text: "x", sourceId: "n1", sourceName: "Biology", sourceType: "note", score: 1 }]);
    expect(await retrieveContext("q")).not.toContain("Current local time");
  });

  it("drops sources that were already shared in full as the open document", async () => {
    h.search.mockResolvedValue([
      { text: "dup", sourceId: "a", sourceName: "Open note", sourceType: "note", score: 1 },
      { text: "other", sourceId: "b", sourceName: "Other note", sourceType: "note", score: 0.5 },
    ]);
    const out = await retrieveContext("q", { skipSourceIds: ["a"] });
    expect(out).not.toContain("Open note");
    expect(out).toContain("Other note");
  });

  it("falls back to the recency snapshot (skipping the open note) when nothing matches or search fails", async () => {
    useStore.setState({ notes: [note("a", "Open note", "AAA"), note("b", "Other note", "BBB")], activeNoteId: "a" });
    h.search.mockResolvedValue([]);
    const out = await retrieveContext("q", { skipSourceIds: ["a"] });
    expect(out).toContain("Other note");
    expect(out).not.toContain("AAA");
    h.search.mockRejectedValue(new Error("boom"));
    expect(await retrieveContext("q")).toContain("### Note: Open note");
  });
});
