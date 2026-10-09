import { invoke } from "@tauri-apps/api/core";
import { readFile } from "@tauri-apps/plugin-fs";
// Worker URL is a tiny string; the heavy pdf.js core is dynamically imported
// only when we actually need to read metadata or extract text.
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useStore, type LibraryDoc } from "../store/useStore";

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// Imported PDFs are copied here so the library is self-contained and survives
// the original file being moved or deleted. All file I/O goes through the Rust
// app_data_* commands — the JS fs-plugin scope can't reliably write into the
// app-data dir (caused the "forbidden path" import failure).
function relPath(id: string): string {
  return `library/${id}.pdf`;
}

// Hidden extracted-text cache, so the AI can read a PDF's content cheaply
// (and accurately) without re-running pdf.js every time.
function textRelPath(id: string): string {
  return `library/${id}.txt`;
}

// ── Metadata ───────────────────────────────────────────────────────────────

interface PdfMeta {
  title?: string;
  author?: string;
  pageCount?: number;
}

// Best-effort: any failure (corrupt PDF, unsupported worker, etc.) degrades to
// an empty result so the import still succeeds with a filename-based title.
async function extractMetadata(bytes: Uint8Array): Promise<PdfMeta> {
  try {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    // pdf.js detaches the buffer it's given — hand it a private copy.
    const task = pdfjs.getDocument({ data: new Uint8Array(bytes) });
    const doc = await task.promise;
    const pageCount = doc.numPages;
    const meta = await doc.getMetadata().catch(() => null);
    const info = (meta?.info ?? {}) as { Title?: string; Author?: string };
    await doc.destroy();
    return {
      title: info.Title?.trim() || undefined,
      author: info.Author?.trim() || undefined,
      pageCount,
    };
  } catch {
    return {};
  }
}

// Extract all selectable text from a PDF, page by page (text layer only).
// Returns "" for scanned/image-only PDFs (no text layer).
export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const { pages } = await extractPdfPages(bytes);
  return pages.filter((t) => t.trim()).join("\n\n");
}

/**
 * Per-page text layer: `pages[p - 1]` is page p ("" when it has no text).
 * Never throws; a failure yields `pageCount: 0`.
 */
export async function extractPdfPages(bytes: Uint8Array): Promise<{ pages: string[]; pageCount: number }> {
  try {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    const task = pdfjs.getDocument({ data: new Uint8Array(bytes) });
    const doc = await task.promise;
    const pageCount = doc.numPages;
    const pages: string[] = [];
    for (let p = 1; p <= pageCount; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      pages.push(content.items.map((it) => ("str" in it ? (it as { str: string }).str : "")).join(" "));
    }
    await doc.destroy();
    return { pages, pageCount };
  } catch {
    return { pages: [], pageCount: 0 };
  }
}

// ── Extraction cascade (§2.1) ─────────────────────────────────────────────────

// Quality gate: is the text-layer extraction actually usable, or is this a
// scanned/slide PDF we should OCR? Heuristic — enough words, and not dominated
// by non-text noise. `[IMPL CHOICE]`
function isUsableText(text: string): boolean {
  const t = text.trim();
  if (t.length < 120) return false;
  const words = t.split(/\s+/).filter((w) => w.length > 1);
  if (words.length < 30) return false;
  // Ratio of "wordy" characters; OCR-less scans often yield mostly symbols.
  const wordy = (t.match(/[\p{L}\p{N}]/gu) ?? []).length;
  return wordy / t.length > 0.55;
}

// Render each page to a PNG via pdf.js, then OCR it through the Rust command.
async function ocrPdf(bytes: Uint8Array, onPage?: (n: number, total: number) => void): Promise<string> {
  const available = await invoke<boolean>("ocr_available").catch(() => false);
  if (!available) throw new Error("OCR_UNAVAILABLE");

  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
  const maxPages = Math.min(doc.numPages, 60); // cap for performance
  const parts: string[] = [];

  for (let p = 1; p <= maxPages; p++) {
    onPage?.(p, maxPages);
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: 2 }); // 2x for legible OCR
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) continue;
    await page.render({ canvasContext: ctx, viewport }).promise;
    const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, "image/png"));
    if (!blob) continue;
    const png = Array.from(new Uint8Array(await blob.arrayBuffer()));
    try {
      const text = await invoke<string>("ocr_image", { png, lang: null });
      if (text.trim()) parts.push(text.trim());
    } catch { /* skip a failed page */ }
  }
  await doc.destroy();
  return parts.join("\n\n");
}

export interface ExtractionResult {
  text: string;
  method: "text-layer" | "ocr" | "none";
  ocrUnavailable?: boolean;
}

/**
 * The full cascade: text-layer extraction → quality gate → OCR fallback.
 * Logs every OCR escalation (so a frequently-escalating extractor is visible).
 */
export async function extractPdfMarkdown(
  bytes: Uint8Array,
  ctx?: { name?: string; onOcrPage?: (n: number, total: number) => void }
): Promise<ExtractionResult> {
  const layer = await extractPdfText(bytes);
  if (isUsableText(layer)) {
    return { text: layer, method: "text-layer" };
  }

  // Escalate to OCR.
  const reason = layer.trim().length === 0 ? "no text layer" : "low-quality text layer";
  try {
    const ocrText = await ocrPdf(bytes, ctx?.onOcrPage);
    logOcrEscalation(ctx?.name, reason, ocrText.trim().length > 0);
    if (ocrText.trim()) return { text: ocrText, method: "ocr" };
    return { text: layer, method: "none" };
  } catch (e) {
    const unavailable = e instanceof Error && e.message === "OCR_UNAVAILABLE";
    logOcrEscalation(ctx?.name, unavailable ? `${reason} (OCR unavailable)` : `${reason} (OCR error)`, false);
    // Fall back to whatever text layer we had (may be empty).
    return { text: layer, method: layer.trim() ? "text-layer" : "none", ocrUnavailable: unavailable };
  }
}

function logOcrEscalation(name: string | undefined, reason: string, ok: boolean) {
  // eslint-disable-next-line no-console
  console.info(`[OCR] escalated${name ? ` "${name}"` : ""}: ${reason} → ${ok ? "got text" : "no text"}`);
  try {
    useStore.getState().recordOcrEscalation(`${name ?? "PDF"}: ${reason}`);
  } catch { /* store not ready */ }
}

function titleFromFileName(fileName: string): string {
  return fileName.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ").trim() || "Untitled";
}

// ── Import ─────────────────────────────────────────────────────────────────

async function importPdfBytes(bytes: Uint8Array, fileName: string): Promise<LibraryDoc> {
  const id = uid();
  await invoke("app_data_write", { relPath: relPath(id), contents: Array.from(bytes) });

  const meta = await extractMetadata(bytes);

  // Extract + cache the full text now (hidden) so AI features are instant.
  // Uses the full cascade (text layer → OCR fallback).
  try {
    const { text } = await extractPdfMarkdown(bytes, { name: fileName });
    await invoke("app_data_write", {
      relPath: textRelPath(id),
      contents: Array.from(new TextEncoder().encode(text)),
    });
  } catch { /* best-effort */ }

  return {
    id,
    title: meta.title || titleFromFileName(fileName),
    author: meta.author,
    pageCount: meta.pageCount,
    fileName,
    sizeBytes: bytes.byteLength,
    addedAt: new Date().toISOString(),
  };
}

/** Import a PDF that already lives on disk (native file picker / drag-drop). */
export async function importPdfFromPath(filePath: string): Promise<LibraryDoc> {
  const bytes = await readFile(filePath);
  const fileName = filePath.split(/[/\\]/).pop() || "document.pdf";
  return importPdfBytes(bytes, fileName);
}

/** Import a PDF from in-memory bytes (e.g. an <input type=file>). */
export async function importPdfFromBytes(bytes: Uint8Array, fileName: string): Promise<LibraryDoc> {
  return importPdfBytes(bytes, fileName);
}

// ── Read / delete ────────────────────────────────────────────────────────────

/** Read the stored PDF bytes (used by the RAG indexer). */
export async function libraryDocBytes(doc: LibraryDoc): Promise<Uint8Array> {
  const buf = await invoke<ArrayBuffer>("app_data_read", { relPath: relPath(doc.id) });
  return new Uint8Array(buf);
}

/** Read a stored PDF and return a blob URL for the viewer. Caller revokes it. */
export async function libraryDocBlobUrl(doc: LibraryDoc): Promise<string> {
  const buf = await invoke<ArrayBuffer>("app_data_read", { relPath: relPath(doc.id) });
  const blob = new Blob([buf], { type: "application/pdf" });
  return URL.createObjectURL(blob);
}

/** The hidden extracted text if it is cached, "" otherwise. Never extracts. */
export async function libraryDocCachedText(doc: LibraryDoc): Promise<string> {
  try {
    const buf = await invoke<ArrayBuffer>("app_data_read", { relPath: textRelPath(doc.id) });
    const text = new TextDecoder().decode(new Uint8Array(buf));
    return text.trim() ? text : "";
  } catch {
    return "";
  }
}

/** The hidden extracted text for a doc — from cache, extracting on a miss. */
export async function libraryDocText(doc: LibraryDoc): Promise<string> {
  const cachedText = await libraryDocCachedText(doc);
  if (cachedText) return cachedText;
  const { text } = await extractPdfMarkdown(await libraryDocBytes(doc), { name: doc.title || doc.fileName });
  try {
    await invoke("app_data_write", {
      relPath: textRelPath(doc.id),
      contents: Array.from(new TextEncoder().encode(text)),
    });
  } catch { /* ignore */ }
  return text;
}

/** Delete the stored file. Missing file is not an error. */
export async function deleteLibraryFile(doc: LibraryDoc): Promise<void> {
  for (const rp of [relPath(doc.id), textRelPath(doc.id)]) {
    try {
      await invoke("app_data_remove", { relPath: rp });
    } catch {
      /* already gone — ignore */
    }
  }
}

export function formatBytes(n?: number): string {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
