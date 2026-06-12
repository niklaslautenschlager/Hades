import { invoke } from "@tauri-apps/api/core";
import { readFile } from "@tauri-apps/plugin-fs";
// Worker URL is a tiny string; the heavy pdf.js core is dynamically imported
// only when we actually need to read metadata or extract text.
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { LibraryDoc } from "../store/useStore";

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

// Extract all selectable text from a PDF, page by page. Used by the RAG index.
// Returns "" for scanned/image-only PDFs (no text layer).
export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  try {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    const task = pdfjs.getDocument({ data: new Uint8Array(bytes) });
    const doc = await task.promise;
    const parts: string[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const text = content.items
        .map((it) => ("str" in it ? (it as { str: string }).str : ""))
        .join(" ");
      if (text.trim()) parts.push(text);
    }
    await doc.destroy();
    return parts.join("\n\n");
  } catch {
    return "";
  }
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
  try {
    const text = await extractPdfText(bytes);
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

/** The hidden extracted text for a doc — from cache, extracting on a miss. */
export async function libraryDocText(doc: LibraryDoc): Promise<string> {
  try {
    const buf = await invoke<ArrayBuffer>("app_data_read", { relPath: textRelPath(doc.id) });
    const text = new TextDecoder().decode(new Uint8Array(buf));
    if (text.trim()) return text;
  } catch { /* cache miss */ }
  const text = await extractPdfText(await libraryDocBytes(doc));
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
