import { invoke } from "@tauri-apps/api/core";
import {
  useStore,
  type NoteFile,
  type LibraryDoc,
  type CalendarEvent,
  type Task,
} from "../store/useStore";
import { libraryDocText } from "./pdfLibrary";
import { fmtRangeLocal, fmtPointLocal } from "./localTime";

// On-device index over the user's notes, PDF library, calendar events and
// tasks. One index file holds the vectors of exactly ONE embedder, recorded in
// the file: the built-in local hashing embedder (no network, works for every AI
// vendor) or Ollama's nomic-embed-text (semantic, used only while Ollama is
// reachable). Vectors are searched with brute-force cosine — plenty fast for a
// student's thousands of chunks. When the recorded embedder is unavailable,
// search degrades to keyword scoring.

export const EMBED_MODEL = "nomic-embed-text";
export const LOCAL_EMBEDDER_ID = "local:hash-v1";
const INDEX_PATH = "rag/index.json";
const INDEX_VERSION = 2;
const CHUNK_TARGET = 800; // approx chars per chunk
const EMBED_BATCH = 64;
const LOCAL_DIM = 512;

export const EVENT_WINDOW_BACK_DAYS = 7;
export const EVENT_WINDOW_FWD_DAYS = 120;
export const MAX_EVENT_CHUNKS = 500;
export const MAX_TASK_CHUNKS = 500;

const PROBE_TIMEOUT_MS = 5000;
const QUERY_EMBED_TIMEOUT_MS = 10_000;
const DOC_EMBED_TIMEOUT_MS = 120_000;

export type RagSourceType = "note" | "pdf" | "event" | "task";
export const ALL_SOURCE_TYPES: RagSourceType[] = ["note", "pdf", "event", "task"];

export interface RagChunk {
  id: string;
  sourceType: RagSourceType;
  sourceId: string;
  sourceName: string;
  text: string;
  vector: number[];
  updatedAt: string;
  /** Fingerprint of the source when this chunk was made; absent in pre-8.09.1 files. */
  sig?: string;
}

interface IndexFile {
  version: number;
  embedder: string | null;
  lastBuilt: string | null;
  chunks: RagChunk[];
  /** Sources that legitimately produced no chunks (e.g. a scanned PDF with no text), key → sig. */
  empty: Record<string, string>;
}

export class EmbedderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmbedderUnavailableError";
  }
}

let index: RagChunk[] = [];
let embedderId: string | null = null;
let lastBuilt: string | null = null;
let emptySources = new Map<string, string>();
let loaded = false;
let loading: Promise<void> | null = null;

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function srcKey(type: RagSourceType, id: string): string {
  return `${type}:${id}`;
}

function hashStr(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${s.length.toString(36)}${(h >>> 0).toString(36)}`;
}

function tick(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} timed out`)), ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

// Mutations are serialised so a background sync, a manual rebuild and a delete
// can never interleave their read-modify-write of the index.
let chain: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

// ── Persistence ──────────────────────────────────────────────────────────────

const CHUNK_TYPES = new Set<string>(ALL_SOURCE_TYPES);

function normalizeChunk(c: unknown): RagChunk | null {
  if (!c || typeof c !== "object") return null;
  const o = c as Record<string, unknown>;
  if (
    typeof o.id !== "string" ||
    typeof o.sourceId !== "string" ||
    typeof o.text !== "string" ||
    typeof o.sourceType !== "string" ||
    !CHUNK_TYPES.has(o.sourceType) ||
    !Array.isArray(o.vector) ||
    (o.vector.length > 0 && typeof o.vector[0] !== "number")
  ) {
    return null;
  }
  return {
    id: o.id,
    sourceType: o.sourceType as RagSourceType,
    sourceId: o.sourceId,
    sourceName: typeof o.sourceName === "string" ? o.sourceName : "",
    text: o.text,
    vector: o.vector as number[],
    updatedAt: typeof o.updatedAt === "string" ? o.updatedAt : "",
    sig: typeof o.sig === "string" ? o.sig : undefined,
  };
}

/** Tolerant parse: anything unreadable yields an empty index, never an exception. */
function parseIndexFile(raw: unknown): { embedder: string | null; lastBuilt: string | null; chunks: RagChunk[]; empty: Map<string, string> } {
  const none = { embedder: null, lastBuilt: null, chunks: [] as RagChunk[], empty: new Map<string, string>() };
  if (!raw || typeof raw !== "object") return none;
  const o = raw as Record<string, unknown>;
  const chunks = Array.isArray(o.chunks)
    ? o.chunks.map(normalizeChunk).filter((c): c is RagChunk => c !== null)
    : [];
  let embedder: string | null = null;
  if (typeof o.embedder === "string" && o.embedder) embedder = o.embedder;
  else if (chunks.length > 0) embedder = `ollama:${typeof o.model === "string" && o.model ? o.model : EMBED_MODEL}`; // files written before 8.09.1 were Ollama-only
  const empty = new Map<string, string>();
  if (o.empty && typeof o.empty === "object") {
    for (const [k, v] of Object.entries(o.empty as Record<string, unknown>)) {
      if (typeof v === "string") empty.set(k, v);
    }
  }
  const built = typeof o.lastBuilt === "string" ? o.lastBuilt : null;
  // Nothing readable and never built: indistinguishable from no index at all.
  if (chunks.length === 0 && built === null) return none;
  return { embedder, lastBuilt: built, chunks, empty };
}

function ensureLoaded(): Promise<void> {
  if (loaded) return Promise.resolve();
  if (!loading) {
    loading = (async () => {
      try {
        const buf = await invoke<ArrayBuffer | number[]>("app_data_read", { relPath: INDEX_PATH });
        const parsed = parseIndexFile(JSON.parse(new TextDecoder().decode(new Uint8Array(buf))));
        index = parsed.chunks;
        embedderId = parsed.embedder;
        lastBuilt = parsed.lastBuilt;
        emptySources = parsed.empty;
      } catch {
        index = [];
        embedderId = null;
        lastBuilt = null;
        emptySources = new Map();
      }
      loaded = true;
      loading = null;
    })();
  }
  return loading;
}

async function persist(): Promise<void> {
  const file: IndexFile = {
    version: INDEX_VERSION,
    embedder: embedderId,
    lastBuilt,
    chunks: index,
    empty: Object.fromEntries(emptySources),
  };
  const bytes = new TextEncoder().encode(JSON.stringify(file));
  await invoke("app_data_write", { relPath: INDEX_PATH, contents: Array.from(bytes) });
}

// ── Embedders ────────────────────────────────────────────────────────────────

export interface Embedder {
  id: string;
  kind: "local" | "ollama";
  label: string;
  /** Cosine below this is treated as unrelated (unless a keyword matches). */
  minScore: number;
  available(): Promise<boolean>;
  embed(texts: string[], kind: "document" | "query"): Promise<number[][]>;
}

const EMBED_STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "at", "for", "with", "about", "as", "by",
  "from", "into", "over", "than", "then", "so", "if", "is", "are", "was", "were", "be", "been", "being",
  "am", "do", "does", "did", "have", "has", "had", "it", "its", "this", "that", "these", "those", "which",
  "what", "who", "whom", "when", "where", "why", "how", "i", "me", "my", "we", "our", "you", "your",
  "he", "she", "they", "them", "their", "his", "her", "not", "no", "can", "could", "would", "should",
  "will", "just", "also", "very", "there", "here", "any", "some", "all", "each", "more", "most",
]);

const CJK_RE = /[぀-ヿ㐀-鿿가-힯]/;

// Deliberately crude: query and document go through the same function, so a
// consistent (if ugly) stem is all that matters.
function stem(w: string): string {
  if (w.length <= 3 || /\d/.test(w)) return w;
  let s = w;
  if (s.endsWith("ies") && s.length > 4) s = `${s.slice(0, -3)}y`;
  else if (s.endsWith("ing") && s.length > 5) s = s.slice(0, -3);
  else if (s.endsWith("ed") && s.length > 4) s = s.slice(0, -2);
  else if (/(s|x|z|ch|sh)es$/.test(s) && s.length > 4) s = s.slice(0, -2);
  else if (s.endsWith("s") && !s.endsWith("ss")) s = s.slice(0, -1);
  if (s.endsWith("e") && s.length > 4) s = s.slice(0, -1);
  return s;
}

function tokenize(text: string): string[] {
  const out: string[] = [];
  const words = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^\p{L}\p{N}]+/u);
  for (const w of words) {
    if (!w) continue;
    if (CJK_RE.test(w)) {
      // No spaces between words in these scripts: character bigrams stand in.
      const chars = Array.from(w);
      if (chars.length === 1) out.push(w);
      for (let i = 0; i + 1 < chars.length; i++) out.push(chars[i] + chars[i + 1]);
      continue;
    }
    if (EMBED_STOPWORDS.has(w)) continue;
    out.push(stem(w));
  }
  return out;
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Feature-hashed bag of word uni- and bi-grams, L2-normalised. Deterministic,
 * dependency-free and offline. Not semantic (no synonyms), but it ranks lexical
 * overlap well and works for every AI vendor.
 */
export function embedLocalText(text: string): number[] {
  const tokens = tokenize(text);
  const counts = new Map<string, number>();
  const bump = (f: string) => counts.set(f, (counts.get(f) ?? 0) + 1);
  for (let i = 0; i < tokens.length; i++) {
    bump(tokens[i]);
    if (i + 1 < tokens.length) bump(`${tokens[i]} ${tokens[i + 1]}`);
  }
  const vec = new Float64Array(LOCAL_DIM);
  for (const [feature, n] of counts) {
    const h = fnv1a(feature);
    const weight = (1 + Math.log(n)) * (feature.includes(" ") ? 0.7 : 1);
    const sign = Math.imul(h, 0x9e3779b1) >>> 31 ? -1 : 1;
    vec[h % LOCAL_DIM] += sign * weight;
  }
  let norm = 0;
  for (let i = 0; i < LOCAL_DIM; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm);
  const out: number[] = new Array(LOCAL_DIM);
  for (let i = 0; i < LOCAL_DIM; i++) {
    out[i] = norm === 0 ? 0 : Math.round((vec[i] / norm) * 1000) / 1000;
  }
  return out;
}

const localEmbedder: Embedder = {
  id: LOCAL_EMBEDDER_ID,
  kind: "local",
  label: "Built-in (on-device)",
  minScore: 0.12,
  available: async () => true,
  embed: async (texts) => texts.map(embedLocalText),
};

function ollamaBaseUrl(): string {
  return useStore.getState().aiVendorConfigs?.ollama?.baseUrl || "http://localhost:11434";
}

const probeCache = new Map<string, { at: number; ok: boolean }>();
const probeInflight = new Map<string, Promise<boolean>>();

// Ollama being installed is not enough: the embedding model must be pulled too,
// so the probe performs a real one-text embedding.
async function ollamaUsable(model: string): Promise<boolean> {
  const key = `${ollamaBaseUrl()}|${model}`;
  const hit = probeCache.get(key);
  if (hit && Date.now() - hit.at < (hit.ok ? 30_000 : 10_000)) return hit.ok;
  const running = probeInflight.get(key);
  if (running) return running;
  const p = (async () => {
    let ok = false;
    try {
      const vecs = await withTimeout(
        invoke<number[][]>("embed_texts", { baseUrl: ollamaBaseUrl(), model, texts: ["ping"] }),
        PROBE_TIMEOUT_MS,
        "Ollama probe"
      );
      ok = Array.isArray(vecs) && vecs.length === 1 && Array.isArray(vecs[0]) && vecs[0].length > 0;
    } catch {
      ok = false;
    }
    probeCache.set(key, { at: Date.now(), ok });
    probeInflight.delete(key);
    return ok;
  })();
  probeInflight.set(key, p);
  return p;
}

function roundVec(v: number[], decimals: number): number[] {
  const f = 10 ** decimals;
  return v.map((x) => Math.round(x * f) / f);
}

function ollamaEmbedder(model: string): Embedder {
  return {
    id: `ollama:${model}`,
    kind: "ollama",
    label: `Ollama · ${model}`,
    minScore: -1,
    available: () => ollamaUsable(model),
    // nomic-embed-text (and similar) expect task prefixes for best retrieval.
    embed: async (texts, kind) => {
      if (texts.length === 0) return [];
      const prefix = kind === "query" ? "search_query: " : "search_document: ";
      const out: number[][] = [];
      for (let i = 0; i < texts.length; i += EMBED_BATCH) {
        const batch = texts.slice(i, i + EMBED_BATCH).map((t) => prefix + t);
        const vecs = await withTimeout(
          invoke<number[][]>("embed_texts", { baseUrl: ollamaBaseUrl(), model, texts: batch }),
          kind === "query" ? QUERY_EMBED_TIMEOUT_MS : DOC_EMBED_TIMEOUT_MS,
          "Ollama embedding"
        );
        if (!Array.isArray(vecs) || vecs.length !== batch.length) throw new Error("Malformed embedding response");
        out.push(...vecs.map((v) => roundVec(v, 5)));
      }
      return out;
    },
  };
}

function getEmbedder(id: string | null): Embedder | null {
  if (!id) return null;
  if (id === LOCAL_EMBEDDER_ID) return localEmbedder;
  if (id.startsWith("ollama:") && id.length > "ollama:".length) return ollamaEmbedder(id.slice("ollama:".length));
  return null; // written by a newer/unknown embedder — keyword fallback only
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

// ── Sources ──────────────────────────────────────────────────────────────────

interface SourceDesc {
  type: RagSourceType;
  id: string;
  sig: string;
  updatedAt: string;
  build(): Promise<RagChunk[]>;
}

const noteSigs = new WeakMap<NoteFile, string>();
function noteSig(n: NoteFile): string {
  let sig = noteSigs.get(n);
  if (!sig) {
    sig = `${n.updatedAt}|${hashStr(`${n.name}\u0000${n.content}`)}`;
    noteSigs.set(n, sig);
  }
  return sig;
}

function noteDesc(note: NoteFile): SourceDesc {
  return {
    type: "note",
    id: note.id,
    sig: noteSig(note),
    updatedAt: note.updatedAt || "",
    build: async () => {
      const now = note.updatedAt || new Date().toISOString();
      return chunkText(note.content).map((text) => ({
        id: uid(),
        sourceType: "note" as const,
        sourceId: note.id,
        sourceName: note.name || "Untitled note",
        text,
        vector: [],
        updatedAt: now,
        sig: noteSig(note),
      }));
    },
  };
}

function docDesc(doc: LibraryDoc): SourceDesc {
  const sig = `${doc.id}|${hashStr(`${doc.title}\u0000${doc.fileName}`)}`;
  return {
    type: "pdf",
    id: doc.id,
    sig,
    updatedAt: doc.addedAt || "",
    build: async () => {
      let text = "";
      try {
        // Routes through the extraction cascade (text layer → OCR) + hidden cache.
        text = await libraryDocText(doc);
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
        sig,
      }));
    },
  };
}

function eventText(e: CalendarEvent, now: Date): string {
  const desc = (e.description ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
  return `Event: ${e.title || "Untitled event"} — ${fmtRangeLocal(e.start, e.end || e.start, now)}${e.isDeadline ? " [DEADLINE]" : ""}${desc ? ` — ${desc}` : ""}`;
}

function eventDesc(e: CalendarEvent): SourceDesc {
  const sig = hashStr([e.title, e.start, e.end, e.isDeadline ? "1" : "0", e.description ?? ""].join("\u0000"));
  return {
    type: "event",
    id: e.id,
    sig,
    updatedAt: e.start,
    build: async () => [
      {
        id: uid(),
        sourceType: "event" as const,
        sourceId: e.id,
        sourceName: e.title || "Untitled event",
        text: eventText(e, new Date()),
        vector: [],
        updatedAt: e.start,
        sig,
      },
    ],
  };
}

/** Events inside [-7d, +120d] (ongoing ones included), nearest first when capped. */
function eventsInWindow(events: CalendarEvent[], nowMs: number): CalendarEvent[] {
  const from = nowMs - EVENT_WINDOW_BACK_DAYS * 86400_000;
  const to = nowMs + EVENT_WINDOW_FWD_DAYS * 86400_000;
  const inWindow: { e: CalendarEvent; start: number }[] = [];
  for (const e of events) {
    const start = new Date(e.start).getTime();
    if (isNaN(start)) continue;
    const endRaw = new Date(e.end).getTime();
    const end = isNaN(endRaw) ? start : endRaw;
    if (end >= from && start <= to) inWindow.push({ e, start });
  }
  if (inWindow.length > MAX_EVENT_CHUNKS) {
    inWindow.sort((a, b) => Math.abs(a.start - nowMs) - Math.abs(b.start - nowMs));
    inWindow.length = MAX_EVENT_CHUNKS;
  }
  return inWindow.map((x) => x.e);
}

function taskText(t: Task, now: Date): string {
  return `Task: ${t.text.trim()}${t.dueDate ? ` — due ${fmtPointLocal(t.dueDate, now)}` : ""} [${t.completed ? "done" : "open"}]`;
}

function taskDesc(t: Task): SourceDesc {
  const sig = hashStr([t.text, t.dueDate ?? "", t.completed ? "1" : "0"].join("\u0000"));
  return {
    type: "task",
    id: t.id,
    sig,
    updatedAt: t.createdAt,
    build: async () => [
      {
        id: uid(),
        sourceType: "task" as const,
        sourceId: t.id,
        sourceName: t.text.trim().split("\n")[0].slice(0, 100),
        text: taskText(t, new Date()),
        vector: [],
        updatedAt: t.createdAt,
        sig,
      },
    ],
  };
}

function tasksToIndex(tasks: Task[]): Task[] {
  const usable = tasks.filter((t) => t.text && t.text.trim());
  if (usable.length <= MAX_TASK_CHUNKS) return usable;
  const open = usable
    .filter((t) => !t.completed)
    .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"));
  const done = usable
    .filter((t) => t.completed)
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  return [...open, ...done].slice(0, MAX_TASK_CHUNKS);
}

function describeSources(kinds: RagSourceType[], nowMs: number, ids: Set<string> | null): SourceDesc[] {
  const s = useStore.getState();
  const want = (id: string) => !ids || ids.has(id);
  const out: SourceDesc[] = [];
  if (kinds.includes("note")) {
    for (const n of s.notes ?? []) {
      if (!n.isFolder && n.content.trim() && want(n.id)) out.push(noteDesc(n));
    }
  }
  if (kinds.includes("pdf")) {
    for (const d of s.libraryDocs ?? []) if (want(d.id)) out.push(docDesc(d));
  }
  if (kinds.includes("event")) {
    for (const e of eventsInWindow(s.calendarEvents ?? [], nowMs)) if (want(e.id)) out.push(eventDesc(e));
  }
  if (kinds.includes("task")) {
    for (const t of tasksToIndex(s.tasks ?? [])) if (want(t.id)) out.push(taskDesc(t));
  }
  return out;
}

// ── Reconciliation ───────────────────────────────────────────────────────────

interface Plan {
  upsert: SourceDesc[];
  remove: string[]; // srcKeys
}

function planSync(kinds: RagSourceType[], ids: Set<string> | null, nowMs: number): Plan {
  const kindSet = new Set<string>(kinds);
  const existing = new Map<string, RagChunk>(); // srcKey → first chunk
  for (const c of index) {
    if (!kindSet.has(c.sourceType) || (ids && !ids.has(c.sourceId))) continue;
    const k = srcKey(c.sourceType, c.sourceId);
    if (!existing.has(k)) existing.set(k, c);
  }

  const desired = describeSources(kinds, nowMs, ids);
  const desiredKeys = new Set(desired.map((d) => srcKey(d.type, d.id)));

  const upsert: SourceDesc[] = [];
  for (const d of desired) {
    const k = srcKey(d.type, d.id);
    const have = existing.get(k);
    if (have) {
      // Chunks written before 8.09.1 carry no fingerprint; for those the old
      // updatedAt comparison is the best available signal.
      const fresh = have.sig ? have.sig === d.sig : d.type !== "note" || have.updatedAt >= d.updatedAt;
      if (fresh) continue;
    } else if (emptySources.get(k) === d.sig) {
      continue;
    }
    upsert.push(d);
  }

  const remove = [...existing.keys()].filter((k) => !desiredKeys.has(k));
  for (const k of emptySources.keys()) {
    const sep = k.indexOf(":");
    const type = k.slice(0, sep) as RagSourceType;
    const id = k.slice(sep + 1);
    if (kindSet.has(type) && (!ids || ids.has(id)) && !desiredKeys.has(k)) remove.push(k);
  }
  return { upsert, remove };
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const e = new Error("Indexing cancelled");
    e.name = "AbortError";
    throw e;
  }
}

async function embedChunks(
  emb: Embedder,
  chunks: RagChunk[],
  signal?: AbortSignal,
  onProgress?: (done: number, total: number) => void
): Promise<void> {
  const total = chunks.length;
  for (let i = 0; i < total; i += EMBED_BATCH) {
    throwIfAborted(signal);
    const slice = chunks.slice(i, i + EMBED_BATCH);
    const vectors = await emb.embed(slice.map((c) => c.text), "document");
    if (vectors.length !== slice.length) throw new Error("Embedding count mismatch");
    slice.forEach((c, j) => { c.vector = vectors[j]; });
    onProgress?.(Math.min(i + EMBED_BATCH, total), total);
    if (emb.kind === "local") await tick();
  }
}

async function buildChunks(descs: SourceDesc[], signal?: AbortSignal): Promise<{ chunks: RagChunk[]; empty: Map<string, string> }> {
  const chunks: RagChunk[] = [];
  const empty = new Map<string, string>();
  let n = 0;
  for (const d of descs) {
    throwIfAborted(signal);
    let built: RagChunk[] = [];
    try {
      built = await d.build();
    } catch {
      built = [];
    }
    if (built.length === 0) empty.set(srcKey(d.type, d.id), d.sig);
    else chunks.push(...built);
    if (++n % 16 === 0) await tick();
  }
  return { chunks, empty };
}

export type EmbedderChoice = "auto" | "local" | "ollama";

export interface BuildOptions {
  embedder?: EmbedderChoice;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

async function rebuildLocked(opts: BuildOptions): Promise<SyncResult> {
  const choice = opts.embedder ?? "auto";
  const ollama = ollamaEmbedder(EMBED_MODEL);
  let emb: Embedder = localEmbedder;
  if (choice !== "local") {
    if (await ollama.available()) emb = ollama;
    else if (choice === "ollama") {
      throw new EmbedderUnavailableError(
        `Ollama isn't reachable or the embedding model is missing. Run \`ollama pull ${EMBED_MODEL}\` and make sure Ollama is running.`
      );
    }
  }

  const { chunks, empty } = await buildChunks(describeSources(ALL_SOURCE_TYPES, Date.now(), null), opts.signal);
  try {
    await embedChunks(emb, chunks, opts.signal, opts.onProgress);
  } catch (e) {
    // Ollama died mid-build: finish with the local embedder instead of leaving no index.
    if (emb.kind === "ollama" && choice === "auto" && !(e instanceof Error && e.name === "AbortError")) {
      emb = localEmbedder;
      await embedChunks(emb, chunks, opts.signal, opts.onProgress);
    } else {
      throw e;
    }
  }

  index = chunks.filter((c) => c.vector.length > 0);
  emptySources = empty;
  embedderId = emb.id;
  lastBuilt = new Date().toISOString();
  loaded = true;
  await persist();
  return { upserted: index.length, removed: 0, chunks: index.length, embedder: embedderId, rebuilt: true };
}

export interface SyncOptions {
  /** Kinds to reconcile. Default: all. */
  kinds?: RagSourceType[];
  /** Limit the reconcile to these source ids (the changed items). */
  ids?: string[];
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

export interface SyncResult {
  /** Chunks written (for a rebuild: the whole index). */
  upserted: number;
  /** Sources whose chunks were removed. */
  removed: number;
  chunks: number;
  embedder: string | null;
  rebuilt: boolean;
}

/**
 * Bring the index in line with the store: embeds only sources whose fingerprint
 * changed, drops chunks of deleted/out-of-window sources, and builds the whole
 * index when none exists. Throws EmbedderUnavailableError when the index's
 * embedder (Ollama) is down; callers retry later.
 */
export function syncIndex(opts: SyncOptions = {}): Promise<SyncResult> {
  return withLock(async () => {
    await ensureLoaded();
    throwIfAborted(opts.signal);
    if (!embedderId || (lastBuilt === null && index.length === 0)) {
      return rebuildLocked({ embedder: "auto", signal: opts.signal, onProgress: opts.onProgress });
    }

    const emb = getEmbedder(embedderId);
    if (!emb) throw new EmbedderUnavailableError(`Unknown index embedder "${embedderId}" — rebuild the index.`);

    const kinds = opts.kinds && opts.kinds.length ? opts.kinds : ALL_SOURCE_TYPES;
    const ids = opts.ids ? new Set(opts.ids) : null;
    const plan = planSync(kinds, ids, Date.now());
    if (plan.upsert.length === 0 && plan.remove.length === 0) {
      return { upserted: 0, removed: 0, chunks: index.length, embedder: embedderId, rebuilt: false };
    }
    if (plan.upsert.length > 0 && !(await emb.available())) {
      throw new EmbedderUnavailableError(`${emb.label} isn't reachable.`);
    }

    const { chunks, empty } = await buildChunks(plan.upsert, opts.signal);
    await embedChunks(emb, chunks, opts.signal, opts.onProgress);

    const touched = new Set<string>(plan.remove);
    for (const d of plan.upsert) touched.add(srcKey(d.type, d.id));
    index = index
      .filter((c) => !touched.has(srcKey(c.sourceType, c.sourceId)))
      .concat(chunks.filter((c) => c.vector.length > 0));
    for (const k of touched) emptySources.delete(k);
    for (const [k, sig] of empty) emptySources.set(k, sig);
    await persist();
    return { upserted: chunks.length, removed: plan.remove.length, chunks: index.length, embedder: embedderId, rebuilt: false };
  });
}

/**
 * Full rebuild from everything in the store. Prefers Ollama when reachable,
 * otherwise the built-in embedder; `embedder: "ollama"` insists on Ollama and
 * throws if it can't be used. Returns the number of chunks indexed.
 */
export function rebuildIndex(
  onProgress?: (done: number, total: number) => void,
  opts: { embedder?: EmbedderChoice; signal?: AbortSignal } = {}
): Promise<number> {
  return withLock(async () => {
    await ensureLoaded();
    const r = await rebuildLocked({ ...opts, onProgress });
    return r.chunks;
  });
}

// ── Status ───────────────────────────────────────────────────────────────────

export interface RagStatus {
  chunks: number;
  lastBuilt: string | null;
  /** Sources waiting to be (re)indexed or dropped. */
  pending: number;
  embedder: { id: string; kind: "local" | "ollama" | "unknown"; label: string } | null;
  /** Whether the index's own embedder can run right now (always true for the built-in one). */
  embedderReady: boolean;
  ollamaReachable: boolean;
}

export async function getRagStatus(): Promise<RagStatus> {
  await ensureLoaded();
  const emb = getEmbedder(embedderId);
  const ollamaReachable = emb?.kind === "ollama" ? await emb.available() : await ollamaUsable(EMBED_MODEL);
  const built = embedderId !== null && !(lastBuilt === null && index.length === 0);
  const plan = planSync(ALL_SOURCE_TYPES, null, Date.now());
  return {
    chunks: index.length,
    lastBuilt,
    pending: built ? plan.upsert.length + plan.remove.length : describeSources(ALL_SOURCE_TYPES, Date.now(), null).length,
    embedder: embedderId
      ? { id: embedderId, kind: emb?.kind ?? "unknown", label: emb?.label ?? embedderId }
      : null,
    embedderReady: emb ? (emb.kind === "local" ? true : ollamaReachable) : false,
    ollamaReachable,
  };
}

// ── Search ───────────────────────────────────────────────────────────────────

export interface RagHit {
  text: string;
  sourceId: string;
  sourceName: string;
  sourceType: RagSourceType;
  score: number;
}

export interface SearchOpts {
  /** Restrict retrieval to a single note/PDF (e.g. "chat with this PDF"). */
  sourceId?: string;
  /** Restrict retrieval to these kinds of source. */
  types?: RagSourceType[];
}

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "about",
  "my", "me", "i", "you", "it", "is", "are", "was", "what", "which", "that",
  "this", "from", "do", "does", "say", "says", "how", "why", "when",
]);

function queryTerms(q: string): string[] {
  const seen = new Set<string>();
  for (const t of q.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (t.length >= 3 && !STOPWORDS.has(t)) seen.add(t);
    if (seen.size >= 24) break; // keep long-text queries (related notes) cheap
  }
  return [...seen];
}

function keywordScore(text: string, sourceName: string, terms: string[]): number {
  if (terms.length === 0) return 0;
  const lower = text.toLowerCase();
  const name = sourceName.toLowerCase();
  let score = 0;
  for (const t of terms) {
    if (name.includes(t)) score += 3;
    let i = 0;
    let occ = 0;
    while (occ < 5 && (i = lower.indexOf(t, i)) !== -1) {
      occ++;
      i += t.length;
    }
    score += occ;
  }
  return score;
}

function toHit(c: RagChunk, score: number): RagHit {
  return { text: c.text, sourceId: c.sourceId, sourceName: c.sourceName, sourceType: c.sourceType, score };
}

/**
 * Hybrid search: the index's own embedder blended with a keyword bonus.
 * Degrades gracefully — keyword-only over indexed chunks when that embedder is
 * unavailable (Ollama down), and keyword-only over the live note store when
 * there is no index at all. Never throws.
 */
export async function search(query: string, k = 6, opts: SearchOpts = {}): Promise<RagHit[]> {
  try {
    await ensureLoaded();
    const terms = queryTerms(query);
    let pool = index;
    if (opts.sourceId) pool = pool.filter((c) => c.sourceId === opts.sourceId);
    if (opts.types) pool = pool.filter((c) => opts.types!.includes(c.sourceType));

    // 1) Semantic (or local-lexical) + keyword bonus over the indexed chunks.
    if (pool.length > 0) {
      const emb = getEmbedder(embedderId);
      let qvec: number[] | null = null;
      if (emb) {
        try {
          if (await emb.available()) [qvec] = await emb.embed([query], "query");
        } catch {
          qvec = null;
        }
      }
      if (qvec && qvec.length > 0) {
        const qv = qvec;
        const minScore = emb?.minScore ?? 0;
        return pool
          .map((c) => {
            const kw = keywordScore(c.text, c.sourceName, terms);
            const cos = cosine(qv, c.vector);
            // Cosine is the primary signal; a capped keyword bonus nudges exact
            // term matches above near-ties.
            return { c, cos, kw, score: cos + 0.04 * Math.min(kw, 5) };
          })
          .filter((x) => x.cos >= minScore || x.kw >= 3)
          .sort((a, b) => b.score - a.score)
          .slice(0, k)
          .map((x) => toHit(x.c, x.score));
      }

      // 2) Embedder unavailable — keyword-only over the indexed chunks.
      const hits = pool
        .map((c) => ({ c, score: keywordScore(c.text, c.sourceName, terms) }))
        .filter((h) => h.score >= 3)
        .sort((a, b) => b.score - a.score)
        .slice(0, k)
        .map((h) => toHit(h.c, h.score));
      if (hits.length > 0) return hits;
    }

    // 3) No index (or no scoped chunks) — keyword over the live note store so
    //    retrieval still works before anything has been indexed.
    if (opts.types && !opts.types.includes("note")) return [];
    const notes = useStore
      .getState()
      .notes.filter((n) => !n.isFolder && n.content.trim().length > 0)
      .filter((n) => !opts.sourceId || n.id === opts.sourceId);
    return notes
      .map((n) => ({
        text: n.content.slice(0, 1500),
        sourceId: n.id,
        sourceName: n.name || "Untitled note",
        sourceType: "note" as const,
        score: keywordScore(n.content, n.name, terms),
      }))
      .filter((h) => h.score >= 3)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  } catch {
    return [];
  }
}

/** Reset the index (called after wiping AI data). */
export function clearIndex(): Promise<void> {
  return withLock(async () => {
    index = [];
    embedderId = null;
    lastBuilt = null;
    emptySources = new Map();
    loaded = true;
    try {
      await invoke("app_data_remove", { relPath: INDEX_PATH });
    } catch {
      /* ignore */
    }
  });
}
