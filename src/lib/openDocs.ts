import { useStore, type NoteFile, type LibraryDoc } from "../store/useStore";
import { libraryDocCachedText, libraryDocBytes, extractPdfPages } from "./pdfLibrary";

export interface OpenPdfText {
  title: string;
  docId: string | null;
  currentPage: number | null;
  pageCount: number | null;
  text: string;
  truncated: boolean;
}

const DEFAULT_MAX_CHARS = 6000;
const DEFAULT_TIMEOUT_MS = 5000;
const MAX_CACHED_LOADS = 8;

export function getOpenNotes(): NoteFile[] {
  const { notes, openNoteIds } = useStore.getState();
  const byId = new Map((notes ?? []).map((n) => [n.id, n] as const));
  const out: NoteFile[] = [];
  for (const id of openNoteIds ?? []) {
    const n = byId.get(id);
    if (n && !n.isFolder) out.push(n);
  }
  return out;
}

export function getActiveNote(): NoteFile | null {
  const { notes, activeNoteId } = useStore.getState();
  if (!activeNoteId) return null;
  const n = (notes ?? []).find((x) => x.id === activeNoteId);
  return n && !n.isFolder ? n : null;
}

// ── PDF text ────────────────────────────────────────────────────────────────

interface PdfSource {
  /** pages[p - 1] when the text could be split per page, else null. */
  pages: string[] | null;
  full: string;
  pageCount: number | null;
}

// The promise is stored, not the value, so a send that times out still lets the
// extraction finish and the next chat turn reuses it (and concurrent turns
// don't start duplicate extractions). Failures are dropped so they can retry.
const loads = new Map<string, Promise<unknown>>();

function cached<T>(key: string, make: () => Promise<T>): Promise<T> {
  const hit = loads.get(key);
  if (hit) return hit as Promise<T>;
  const p = make();
  loads.set(key, p);
  while (loads.size > MAX_CACHED_LOADS) {
    const oldest = loads.keys().next().value;
    if (oldest === undefined) break;
    loads.delete(oldest);
  }
  p.catch(() => {
    if (loads.get(key) === p) loads.delete(key);
  });
  return p;
}

async function loadBlobSource(url: string): Promise<PdfSource> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`PDF fetch failed (${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const { pages, pageCount } = await extractPdfPages(bytes);
  if (!pageCount) throw new Error("PDF text extraction failed");
  return { pages, full: pages.filter((t) => t.trim()).join("\n\n"), pageCount };
}

// Only the cached text and the PDF's own text layer are used here: the slow OCR
// cascade must never run while a chat message waits. (Indexing fills the cache.)
// The cache joins non-empty pages with a blank line, so it maps back to page
// numbers only when every page contributed exactly one block.
async function loadLibrarySource(doc: LibraryDoc): Promise<PdfSource> {
  const cachedText = await cached(`lib:${doc.id}`, () => libraryDocCachedText(doc));
  const blocks = cachedText.split(/\n\n/);
  if (cachedText && doc.pageCount && blocks.length === doc.pageCount) {
    return { pages: blocks, full: cachedText, pageCount: doc.pageCount };
  }
  const r = await cached(`libpages:${doc.id}`, async () => extractPdfPages(await libraryDocBytes(doc)));
  if (r.pageCount && r.pages.some((t) => t.trim())) {
    return { pages: r.pages, full: cachedText || r.pages.filter((t) => t.trim()).join("\n\n"), pageCount: r.pageCount };
  }
  return { pages: null, full: cachedText, pageCount: doc.pageCount ?? (r.pageCount || null) };
}

function fileTitle(fileName: string): string {
  return fileName.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ").trim() || "Untitled PDF";
}

function assemble(src: PdfSource, target: number, maxChars: number): { text: string; truncated: boolean } {
  const { pages, full } = src;
  if (!pages) {
    const text = full.slice(0, maxChars);
    return { text, truncated: full.length > maxChars };
  }
  const count = pages.length;
  // Current page and its neighbours first, then what follows, then what precedes.
  const order: number[] = [];
  for (const p of [target, target - 1, target + 1]) if (p >= 1 && p <= count) order.push(p);
  for (let p = target + 2; p <= count; p++) order.push(p);
  for (let p = 1; p < target - 1; p++) order.push(p);

  const picked = new Map<number, string>();
  let used = 0;
  let truncated = false;
  for (const p of order) {
    const body = (pages[p - 1] ?? "").trim();
    if (!body) continue;
    // Budget includes the "[Page N]\n" label and the blank line between pages.
    const overhead = `[Page ${p}]\n`.length + (picked.size > 0 ? 2 : 0);
    const room = maxChars - used - overhead;
    if (room <= 0) {
      truncated = true;
      continue;
    }
    const piece = body.length > room ? body.slice(0, room) : body;
    if (piece.length < body.length) truncated = true;
    picked.set(p, piece);
    used += overhead + piece.length;
  }
  const text = [...picked.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([p, t]) => `[Page ${p}]\n${t}`)
    .join("\n\n");
  return { text, truncated };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<{ ok: true; value: T } | { ok: false }> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false }), ms);
    p.then(
      (value) => {
        clearTimeout(timer);
        resolve({ ok: true, value });
      },
      () => {
        clearTimeout(timer);
        resolve({ ok: false });
      }
    );
  });
}

export interface OpenPdfContext {
  pdf: OpenPdfText;
  /** True when the text could not be produced in time (extraction continues in the background). */
  pending: boolean;
}

/** Like getOpenPdfText, but also says whether the text is still being extracted. */
export async function getOpenPdfContext(
  opts: { page?: number; maxChars?: number; timeoutMs?: number } = {}
): Promise<OpenPdfContext | null> {
  try {
    const s = useStore.getState();
    const url = s.notePdfUrl;
    if (!url) return null;
    const docId = s.notePdfDocId ?? null;
    const libDoc = docId ? s.libraryDocs.find((d) => d.id === docId) ?? null : null;
    const title = libDoc?.title || fileTitle(s.notePdfFileName || "");
    const stored = s.pdfPages?.[docId ?? s.notePdfFileName ?? url];
    const currentPage = typeof stored === "number" && stored >= 1 ? Math.floor(stored) : 1;
    const maxChars = Math.max(200, Math.min(opts.maxChars ?? DEFAULT_MAX_CHARS, 50000));
    const timeoutMs = Math.max(0, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const wanted = opts.page && opts.page >= 1 ? Math.floor(opts.page) : currentPage;
    const target = libDoc?.pageCount ? Math.min(wanted, libDoc.pageCount) : wanted;

    const base: OpenPdfText = {
      title,
      docId,
      currentPage,
      pageCount: libDoc?.pageCount ?? null,
      text: "",
      truncated: false,
    };

    const sourceP = libDoc ? loadLibrarySource(libDoc) : cached(`blob:${url}`, () => loadBlobSource(url));
    const r = await withTimeout(sourceP, timeoutMs);
    if (!r.ok) {
      return { pdf: base, pending: true };
    }
    const src = r.value;
    const clampedTarget = src.pageCount ? Math.min(target, src.pageCount) : target;
    const { text, truncated } = assemble(src, clampedTarget, maxChars);
    return {
      pdf: { ...base, pageCount: src.pageCount ?? base.pageCount, text, truncated },
      pending: false,
    };
  } catch {
    return null;
  }
}

/**
 * Text of the PDF currently open in the Notes PDF pane (current page ±1 first,
 * then the rest of the document up to `maxChars`). null when no PDF is open.
 * Never throws and never waits longer than `timeoutMs`: on timeout the metadata
 * is returned with empty text while extraction keeps running for the next call.
 */
export async function getOpenPdfText(
  opts: { page?: number; maxChars?: number; timeoutMs?: number } = {}
): Promise<OpenPdfText | null> {
  const ctx = await getOpenPdfContext(opts);
  return ctx ? ctx.pdf : null;
}
