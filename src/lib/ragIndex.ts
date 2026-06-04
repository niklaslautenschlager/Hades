import { invoke } from "@tauri-apps/api/core";
import { useStore, type NoteFile, type LibraryDoc } from "../store/useStore";
import { libraryDocBytes, extractPdfText } from "./pdfLibrary";

// On-device semantic index over the user's notes + PDF library. Embeddings are
// produced locally by Ollama (privacy-first); vectors live in a JSON file under
// the app-data dir and are searched with brute-force cosine — plenty fast for a
// student's thousands of chunks. If Ollama isn't reachable, callers fall back to
// the keyword/recency context in aiContext.ts.

export const EMBED_MODEL = "nomic-embed-text";
const INDEX_PATH = "rag/index.json";
const CHUNK_TARGET = 800; // approx chars per chunk
const EMBED_BATCH = 64;

export interface RagChunk {
  id: string;
  sourceType: "note" | "pdf";
  sourceId: string;
  sourceName: string;
  text: string;
  vector: number[];
  updatedAt: string;
}

interface IndexFile {
  model: string;
  lastBuilt: string | null;
  chunks: RagChunk[];
}

let index: RagChunk[] = [];
let lastBuilt: string | null = null;
let loaded = false;

function ollamaBaseUrl(): string {
  return useStore.getState().aiVendorConfigs.ollama.baseUrl || "http://localhost:11434";
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// ── Persistence ──────────────────────────────────────────────────────────────

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  try {
    const buf = await invoke<ArrayBuffer>("app_data_read", { relPath: INDEX_PATH });
    const parsed = JSON.parse(new TextDecoder().decode(new Uint8Array(buf))) as IndexFile;
    index = Array.isArray(parsed.chunks) ? parsed.chunks : [];
    lastBuilt = parsed.lastBuilt ?? null;
  } catch {
    index = [];
    lastBuilt = null;
  }
  loaded = true;
}

async function persist(): Promise<void> {
  const file: IndexFile = { model: EMBED_MODEL, lastBuilt, chunks: index };
  const bytes = new TextEncoder().encode(JSON.stringify(file));
  await invoke("app_data_write", { relPath: INDEX_PATH, contents: Array.from(bytes) });
}

// ── Embeddings ─────────────────────────────────────────────────────────────

// nomic-embed-text (and similar) expect task prefixes for best retrieval.
async function embed(texts: string[], kind: "document" | "query"): Promise<number[][]> {
  if (texts.length === 0) return [];
  const prefix = kind === "query" ? "search_query: " : "search_document: ";
  const prefixed = texts.map((t) => prefix + t);
  const out: number[][] = [];
  for (let i = 0; i < prefixed.length; i += EMBED_BATCH) {
    const batch = prefixed.slice(i, i + EMBED_BATCH);
    const vecs = await invoke<number[][]>("embed_texts", {
      baseUrl: ollamaBaseUrl(),
      model: EMBED_MODEL,
      texts: batch,
    });
    out.push(...vecs);
  }
  return out;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// ── Chunking ─────────────────────────────────────────────────────────────────

function chunkText(text: string): string[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (!clean) return [];
  // Split on blank lines / headings, then pack paragraphs up to the target size.
  const paras = clean.split(/\n\s*\n+/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let buf = "";
  for (const p of paras) {
    if (buf && buf.length + p.length + 2 > CHUNK_TARGET) {
      chunks.push(buf);
      buf = "";
    }
    if (p.length > CHUNK_TARGET * 1.5) {
      // A single huge paragraph — hard-split it.
      for (let i = 0; i < p.length; i += CHUNK_TARGET) {
        chunks.push(p.slice(i, i + CHUNK_TARGET));
      }
    } else {
      buf = buf ? `${buf}\n\n${p}` : p;
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}

async function chunksForNote(note: NoteFile): Promise<RagChunk[]> {
  const now = note.updatedAt || new Date().toISOString();
  return chunkText(note.content).map((text) => ({
    id: uid(),
    sourceType: "note" as const,
    sourceId: note.id,
    sourceName: note.name || "Untitled note",
    text,
    vector: [],
    updatedAt: now,
  }));
}

async function chunksForDoc(doc: LibraryDoc): Promise<RagChunk[]> {
  let text = "";
  try {
    const bytes = await libraryDocBytes(doc);
    text = await extractPdfText(bytes);
  } catch {
    text = "";
  }
  return chunkText(text).map((t) => ({
    id: uid(),
    sourceType: "pdf" as const,
    sourceId: doc.id,
    sourceName: doc.title || doc.fileName,
    text: t,
    vector: [],
    updatedAt: doc.addedAt,
  }));
}

async function embedChunks(chunks: RagChunk[]): Promise<void> {
  if (chunks.length === 0) return;
  const vectors = await embed(chunks.map((c) => c.text), "document");
  chunks.forEach((c, i) => {
    c.vector = vectors[i] ?? [];
  });
}

// ── Public API ─────────────────────────────────────────────────────────────

export interface RagStatus {
  chunks: number;
  lastBuilt: string | null;
}

export async function getRagStatus(): Promise<RagStatus> {
  await ensureLoaded();
  return { chunks: index.length, lastBuilt };
}

/** Full rebuild from all notes + library PDFs. Throws if embeddings fail. */
export async function rebuildIndex(onProgress?: (done: number, total: number) => void): Promise<number> {
  const s = useStore.getState();
  const notes = s.notes.filter((n) => !n.isFolder && n.content.trim().length > 0);

  const next: RagChunk[] = [];
  for (const note of notes) next.push(...(await chunksForNote(note)));
  for (const doc of s.libraryDocs) next.push(...(await chunksForDoc(doc)));

  // Embed in batches with progress.
  for (let i = 0; i < next.length; i += EMBED_BATCH) {
    const slice = next.slice(i, i + EMBED_BATCH);
    await embedChunks(slice);
    onProgress?.(Math.min(i + EMBED_BATCH, next.length), next.length);
  }

  index = next.filter((c) => c.vector.length > 0);
  lastBuilt = new Date().toISOString();
  loaded = true;
  await persist();
  return index.length;
}

/** Re-index a single note (incremental, debounced by callers). Best-effort. */
export async function indexNote(note: NoteFile): Promise<void> {
  try {
    await ensureLoaded();
    if (index.length === 0) return; // don't lazily build a full index on every keystroke
    const fresh = await chunksForNote(note);
    await embedChunks(fresh);
    index = index.filter((c) => c.sourceId !== note.id).concat(fresh.filter((c) => c.vector.length > 0));
    await persist();
  } catch {
    /* embeddings unavailable — leave the index as-is */
  }
}

/** Index a freshly-imported PDF. Best-effort. */
export async function indexLibraryDoc(doc: LibraryDoc): Promise<void> {
  try {
    await ensureLoaded();
    if (index.length === 0) return;
    const fresh = await chunksForDoc(doc);
    await embedChunks(fresh);
    index = index.concat(fresh.filter((c) => c.vector.length > 0));
    await persist();
  } catch {
    /* ignore */
  }
}

export async function removeFromIndex(sourceId: string): Promise<void> {
  await ensureLoaded();
  const before = index.length;
  index = index.filter((c) => c.sourceId !== sourceId);
  if (index.length !== before) await persist();
}

export interface RagHit {
  text: string;
  sourceName: string;
  sourceType: "note" | "pdf";
  score: number;
}

/** Semantic search. Returns [] (and never throws) when embeddings are unavailable. */
export async function search(query: string, k = 6): Promise<RagHit[]> {
  await ensureLoaded();
  if (index.length === 0) return [];
  let qvec: number[];
  try {
    [qvec] = await embed([query], "query");
  } catch {
    return [];
  }
  if (!qvec) return [];
  return index
    .map((c) => ({
      text: c.text,
      sourceName: c.sourceName,
      sourceType: c.sourceType,
      score: cosine(qvec, c.vector),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

/** Reset the in-memory cache (called after wiping AI data). */
export async function clearIndex(): Promise<void> {
  index = [];
  lastBuilt = null;
  loaded = true;
  try {
    await invoke("app_data_remove", { relPath: INDEX_PATH });
  } catch {
    /* ignore */
  }
}
