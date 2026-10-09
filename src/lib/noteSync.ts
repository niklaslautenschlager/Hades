import * as tauriFs from "@tauri-apps/plugin-fs";
import { save } from "@tauri-apps/plugin-dialog";
import { useStore, type NoteFile, type SyncSnapshot } from "../store/useStore";
import {
  EPOCH_ISO,
  VALID_ID,
  hashText,
  itemHash,
  makeConflictCopy,
  matchesBase,
  normTs,
  normalizeItem,
  reconcile,
  sanitizeBase,
  sanitizeTombstones,
  type ReconcilePlan,
  type RemoteItem,
  type SyncBase,
  type Tombstones,
} from "./syncReconcile";

// ─────────────────────────────────────────────────────────────────────────────
// Cloud sync I/O layer. Decisions live in syncReconcile.ts (pure); this file
// reads the sync folder, asks reconcile() what to do, applies the remote half
// atomically (temp file + rename, manifest last) and then commits the local
// half in one store update.
//
// Paths: the sync folder comes from the OS dialog and may use "\" on Windows.
// It is used as an opaque prefix. Everything below it is addressed with "/"
// relative paths, which every platform's fs layer accepts.
// ─────────────────────────────────────────────────────────────────────────────

export const SYNC_BETA_NOTICE =
  "Cloud Sync is currently in Beta. Please back up your local database/data before enabling or switching to cloud sync.";

export const SYNC_INTERVAL_MS = 30_000;
export const BACKOFF_BASE_MS = 30_000;
export const BACKOFF_CAP_MS = 10 * 60_000;
const RUN_TIMEOUT_MS = 5 * 60_000;
const MAX_COMMIT_ATTEMPTS = 3;
const READ_CONCURRENCY = 8;
const INDEX_FILE = "_hades.json";
// No leading dot: Tauri's fs scope (`require_literal_leading_dot`, on by default on
// Linux and macOS) never matches dot-prefixed path components against the "**" entries
// in capabilities/default.json, so a dotted temp file would be denied there.
const TEMP_PREFIX = "hades-tmp-";
const TEMP_SUFFIX = ".tmp";

/** 30 s, doubling per consecutive failure, capped at 10 min; 30 s when healthy. */
export function backoffMs(failures: number): number {
  if (failures <= 0) return SYNC_INTERVAL_MS;
  return Math.min(BACKOFF_BASE_MS * 2 ** (failures - 1), BACKOFF_CAP_MS);
}

// ── File-system seam ─────────────────────────────────────────────────────────

export interface FsDirEntry {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
  isSymlink?: boolean;
}

export interface FsAdapter {
  readDir(path: string): Promise<FsDirEntry[]>;
  readTextFile(path: string): Promise<string>;
  writeTextFile(path: string, data: string): Promise<void>;
  /** Creates the directory and any missing parents. */
  mkdir(path: string): Promise<void>;
  remove(path: string): Promise<void>;
  /** Replaces an existing destination file. */
  rename(from: string, to: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}

export const tauriFsAdapter: FsAdapter = {
  readDir: (p) => tauriFs.readDir(p),
  readTextFile: (p) => tauriFs.readTextFile(p),
  writeTextFile: (p, d) => tauriFs.writeTextFile(p, d),
  mkdir: (p) => tauriFs.mkdir(p, { recursive: true }),
  remove: (p) => tauriFs.remove(p),
  rename: (a, b) => tauriFs.rename(a, b),
  exists: (p) => tauriFs.exists(p),
};

export class SyncError extends Error {
  constructor(readonly kind: "offline" | "error", message: string) {
    super(message);
    this.name = "SyncError";
  }
}

function errMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return typeof e === "string" ? e : JSON.stringify(e);
}

// ── Paths ─────────────────────────────────────────────────────────────────────

// Cutting between the halves of a surrogate pair leaves a lone surrogate, which no filesystem API accepts.
function truncateUnits(s: string, max: number): string {
  if (s.length <= max) return s;
  const last = s.charCodeAt(max - 1);
  return s.slice(0, last >= 0xd800 && last <= 0xdbff ? max - 1 : max);
}

export function safeName(name: string): string {
  const cleaned = truncateUnits(
    name
      .replace(/[/\\:*?"<>|]/g, "-")
      .trim(),
    80
  )
    // A leading dot would hide the file from every reader; Windows drops trailing dots and spaces.
    .replace(/^\.+/, (m) => "_".repeat(m.length))
    .replace(/[. ]+$/, "");
  return cleaned || "untitled";
}

// Whether two spellings that differ only in case name the same file depends on the volume
// (macOS and Windows fold case, Linux does not). Until it has been probed we assume the
// folding case: wrongly treating a case-insensitive volume as case-sensitive would delete a
// file it had just overwritten, while the opposite mistake only stalls a case-only rename.
let foldCase = true;
const pathKey = (p: string) => {
  const nfc = p.normalize("NFC");
  return foldCase ? nfc.toLowerCase() : nfc;
};

const caseProbeCache = new WeakMap<FsAdapter, Map<string, boolean>>();

export async function detectCaseFold(fs: FsAdapter, root: string, tag: string): Promise<boolean> {
  let byRoot = caseProbeCache.get(fs);
  if (!byRoot) caseProbeCache.set(fs, (byRoot = new Map()));
  const known = byRoot.get(root);
  if (known !== undefined) return known;
  const stem = `${TEMP_PREFIX}${tag}-CaseProbe-${randomSuffix()}${TEMP_SUFFIX}`;
  const upper = joinRoot(root, stem);
  let folds = true;
  try {
    await fs.writeTextFile(upper, "");
    try {
      folds = await fs.exists(joinRoot(root, stem.toLowerCase()));
    } finally {
      try {
        await fs.remove(upper);
      } catch {
        // A leftover probe is swept like any other temp file of this device.
      }
    }
    byRoot.set(root, folds);
  } catch {
    // Read-only or unavailable folder: keep the safe assumption and probe again next run.
  }
  return folds;
}

function joinRoot(root: string, rel: string): string {
  const base = root.replace(/[\\/]+$/, "");
  return rel ? `${base}/${rel}` : base;
}

function dirOf(rel: string): string {
  const i = rel.lastIndexOf("/");
  return i < 0 ? "" : rel.slice(0, i);
}

function containerParts(parentId: string | null, byId: Map<string, NoteFile>): string[] {
  const segs: string[] = [];
  const seen = new Set<string>();
  let pid = parentId;
  while (pid && !seen.has(pid)) {
    seen.add(pid);
    const p = byId.get(pid);
    if (!p || !p.isFolder) break;
    segs.unshift(safeName(p.name));
    pid = p.parentId;
  }
  return segs;
}

export function noteRelPath(note: NoteFile, byId: Map<string, NoteFile>): string {
  return [...containerParts(note.parentId, byId), `${safeName(note.name)}-${note.id}.md`].join("/");
}

export function folderRelDir(folder: NoteFile, byId: Map<string, NoteFile>): string {
  return [...containerParts(folder.parentId, byId), safeName(folder.name)].join("/");
}

function nameFromFilename(filename: string): string {
  const base = filename.replace(/\.md$/i, "");
  const m = /^(.+)-[a-z0-9]{6,}$/.exec(base);
  return m ? m[1] : base;
}

// ── Note files ────────────────────────────────────────────────────────────────

function oneLine(s: string): string {
  return s.replace(/[\r\n]+/g, " ");
}

export function serializeNote(note: NoteFile, device: string): string {
  return [
    "---",
    `id: ${note.id}`,
    `name: ${oneLine(note.name)}`,
    `parentId: ${note.parentId ?? ""}`,
    `tags: ${note.tags.map(oneLine).join(",")}`,
    `createdAt: ${note.createdAt}`,
    `updatedAt: ${note.updatedAt}`,
    `device: ${device}`,
    "---",
    note.content,
  ].join("\n");
}

export interface ParsedNote {
  id: string;
  name: string | null;
  parentId: string | null;
  hasParentField: boolean;
  tags: string[];
  createdAt: string | null;
  updatedAt: string | null;
  device: string | null;
  content: string;
}

export function parseNoteFile(raw: string): ParsedNote | null {
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const nl = text.startsWith("---\n") ? "\n" : text.startsWith("---\r\n") ? "\r\n" : null;
  if (nl === null) return null;
  const open = 3 + nl.length;
  const marker = `${nl}---${nl}`;
  let headerEnd = text.indexOf(marker, open);
  let contentStart: number;
  if (headerEnd >= 0) {
    contentStart = headerEnd + marker.length;
  } else if (text.endsWith(`${nl}---`) && text.length - 3 - nl.length >= open) {
    headerEnd = text.length - 3 - nl.length;
    contentStart = text.length;
  } else {
    return null;
  }
  const meta: Record<string, string> = {};
  for (const line of text.slice(open, headerEnd).split(/\r?\n/)) {
    const sep = line.indexOf(":");
    if (sep >= 0) meta[line.slice(0, sep).trim()] = line.slice(sep + 1).trim();
  }
  if (!meta.id || !VALID_ID.test(meta.id)) return null;
  const parentId = meta.parentId && VALID_ID.test(meta.parentId) ? meta.parentId : null;
  return {
    id: meta.id,
    name: meta.name || null,
    parentId,
    hasParentField: "parentId" in meta,
    tags: meta.tags ? meta.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
    createdAt: meta.createdAt ?? null,
    updatedAt: meta.updatedAt ?? null,
    device: meta.device || null,
    content: text.slice(contentStart),
  };
}

// ── Manifest (_hades.json) ────────────────────────────────────────────────────

interface ManifestFolder {
  id: string;
  name: string;
  parentId: string | null;
  updatedAt: string;
  createdAt?: string;
  device?: string;
}

interface Manifest {
  version: 2;
  rev: number;
  folders: ManifestFolder[];
  tombstones: Tombstones;
  legacy: boolean;
}

function parseManifest(text: string): Manifest | null {
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;

  if (o.version === 2 && Array.isArray(o.folders)) {
    const folders: ManifestFolder[] = [];
    for (const f of o.folders as Partial<ManifestFolder>[]) {
      if (!f || typeof f.id !== "string" || !VALID_ID.test(f.id)) continue;
      folders.push({
        id: f.id,
        name: typeof f.name === "string" ? f.name : "Untitled",
        parentId: typeof f.parentId === "string" && f.parentId ? f.parentId : null,
        updatedAt: normTs(f.updatedAt, EPOCH_ISO),
        createdAt: typeof f.createdAt === "string" ? f.createdAt : undefined,
        device: typeof f.device === "string" ? f.device : undefined,
      });
    }
    return {
      version: 2,
      rev: typeof o.rev === "number" && Number.isFinite(o.rev) ? o.rev : 0,
      folders,
      tombstones: sanitizeTombstones(o.tombstones),
      legacy: false,
    };
  }

  // v1 shape: { folderIds: { "A/B": "<id>" } } — hierarchy is encoded in the path keys.
  if (o.folderIds && typeof o.folderIds === "object") {
    const pathToId = o.folderIds as Record<string, unknown>;
    const folders: ManifestFolder[] = [];
    for (const [path, id] of Object.entries(pathToId)) {
      if (typeof id !== "string" || !VALID_ID.test(id)) continue;
      const parts = path.split("/");
      const parentPath = parts.slice(0, -1).join("/");
      const parent = parentPath ? pathToId[parentPath] : null;
      folders.push({
        id,
        name: parts[parts.length - 1],
        parentId: typeof parent === "string" && VALID_ID.test(parent) ? parent : null,
        updatedAt: EPOCH_ISO,
      });
    }
    return { version: 2, rev: 0, folders, tombstones: {}, legacy: true };
  }
  return null;
}

function toManifestFolder(n: NoteFile): ManifestFolder {
  return { id: n.id, name: n.name, parentId: n.parentId, updatedAt: n.updatedAt, createdAt: n.createdAt };
}

function folderSignature(folders: ManifestFolder[]): string {
  return JSON.stringify(
    [...folders]
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .map((f) => [f.id, f.name, f.parentId, f.updatedAt])
  );
}

function tombstoneSignature(t: Tombstones): string {
  return JSON.stringify(Object.keys(t).sort().map((k) => [k, Date.parse(t[k])]));
}

// ── Reading the sync folder ───────────────────────────────────────────────────

interface RemoteFile {
  rel: string;
  item: RemoteItem;
}

export interface RemoteSnapshot {
  manifest: Manifest | null;
  manifestPresent: boolean;
  items: RemoteItem[];
  tombstones: Tombstones;
  /** Every parseable note file per id, authoritative copy first. */
  filesById: Map<string, RemoteFile[]>;
  /** Items that only exist in memory (preserved duplicate versions) and must be written. */
  virtualIds: Set<string>;
  dirs: string[];
  tempFiles: string[];
  noteCount: number;
}

async function readInChunks<T, R>(items: T[], fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += READ_CONCURRENCY) {
    out.push(...(await Promise.all(items.slice(i, i + READ_CONCURRENCY).map(fn))));
  }
  return out;
}

interface Walked {
  files: string[];
  dirs: string[];
  temps: string[];
}

async function walk(fs: FsAdapter, root: string, rel: string, tag: string, out: Walked): Promise<void> {
  const entries = await fs.readDir(joinRoot(root, rel));
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const e of entries) {
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    // Dot entries (the MCP bridge dir, OS metadata, other tools) are never ours to read or delete.
    if (e.name.startsWith(".")) continue;
    if (e.isFile && e.name.startsWith(TEMP_PREFIX) && e.name.endsWith(TEMP_SUFFIX)) {
      // Only a leftover temp file this device created is ours to sweep; other devices' are in flight.
      if (e.name.startsWith(`${TEMP_PREFIX}${tag}-`)) out.temps.push(childRel);
      continue;
    }
    if (e.name === INDEX_FILE || e.isSymlink) continue;
    if (e.isDirectory) {
      out.dirs.push(childRel);
      await walk(fs, root, childRel, tag, out);
    } else if (e.isFile && /\.md$/i.test(e.name)) {
      out.files.push(childRel);
    }
  }
}

function sortedVersions(files: RemoteFile[]): RemoteFile[] {
  const key = (f: RemoteFile) => {
    const n = normalizeItem(f.item);
    return { u: Date.parse(n.updatedAt), dev: f.item.device ?? "", h: itemHash(n) };
  };
  return [...files].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka.u !== kb.u) return kb.u - ka.u;
    if (ka.dev !== kb.dev) return ka.dev < kb.dev ? 1 : -1;
    if (ka.h !== kb.h) return ka.h < kb.h ? 1 : -1;
    return a.rel < b.rel ? -1 : 1;
  });
}

export interface ReadContext {
  deviceId: string;
  base: SyncBase;
  localFolders: readonly NoteFile[];
}

export async function readRemote(fs: FsAdapter, root: string, ctx: ReadContext): Promise<RemoteSnapshot> {
  const tag = ctx.deviceId.slice(0, 8);
  const rootEntries = await fs.readDir(joinRoot(root, ""));
  const manifestPresent = rootEntries.some((e) => e.name === INDEX_FILE && e.isFile);
  let manifest: Manifest | null = null;
  if (manifestPresent) manifest = parseManifest(await fs.readTextFile(joinRoot(root, INDEX_FILE)));

  const walked: Walked = { files: [], dirs: [], temps: [] };
  await walk(fs, root, "", tag, walked);

  const parsedFiles = await readInChunks(walked.files, async (rel) => {
    let raw: string;
    try {
      raw = await fs.readTextFile(joinRoot(root, rel));
    } catch (e) {
      throw new SyncError("error", `Could not read "${rel}" in the sync folder: ${errMessage(e)}`);
    }
    return { rel, parsed: parseNoteFile(raw) };
  });

  const folderById = new Map<string, RemoteItem>();
  for (const f of manifest?.folders ?? []) {
    folderById.set(f.id, {
      id: f.id,
      name: f.name,
      content: "",
      tags: [],
      parentId: f.parentId,
      isFolder: true,
      createdAt: f.createdAt ?? f.updatedAt,
      updatedAt: f.updatedAt,
      device: f.device,
    });
  }
  const localFolderIds = new Set(ctx.localFolders.map((f) => f.id));

  // Directory path → folder id, for files that predate parentId and for folders
  // the manifest has not delivered yet. Manifest folders win over local ones.
  const pathIndex = new Map<string, string>();
  {
    const union = new Map<string, NoteFile>();
    for (const f of ctx.localFolders) union.set(f.id, f);
    for (const [id, f] of folderById) union.set(id, f);
    for (const f of [...folderById.values(), ...ctx.localFolders]) {
      const key = pathKey(folderRelDir(f, union));
      if (!pathIndex.has(key)) pathIndex.set(key, f.id);
    }
  }
  const resolvePath = (parts: string[]): string | null => {
    let parent: string | null = null;
    for (let i = 0; i < parts.length; i++) {
      const key = pathKey(parts.slice(0, i + 1).join("/"));
      let id = pathIndex.get(key);
      if (!id) {
        id = `d${hashText(key)}`;
        pathIndex.set(key, id);
        const item: RemoteItem = {
          id, name: parts[i], content: "", tags: [], parentId: parent, isFolder: true,
          createdAt: EPOCH_ISO, updatedAt: EPOCH_ISO,
        };
        folderById.set(id, item);
      }
      parent = id;
    }
    return parent;
  };

  const byId = new Map<string, RemoteFile[]>();
  for (const { rel, parsed } of parsedFiles) {
    if (!parsed) continue;
    const parts = rel.split("/");
    const dirParts = parts.slice(0, -1);
    let parentId: string | null;
    if (parsed.hasParentField) {
      parentId = parsed.parentId;
      if (parentId && !folderById.has(parentId) && !localFolderIds.has(parentId)) {
        const item: RemoteItem = {
          id: parentId,
          name: dirParts.length ? dirParts[dirParts.length - 1] : "Recovered",
          content: "", tags: [], parentId: resolvePath(dirParts.slice(0, -1)), isFolder: true,
          createdAt: EPOCH_ISO, updatedAt: EPOCH_ISO,
        };
        folderById.set(parentId, item);
      }
    } else {
      parentId = resolvePath(dirParts);
    }
    const updatedAt = normTs(parsed.updatedAt, normTs(parsed.createdAt, EPOCH_ISO));
    const item: RemoteItem = {
      id: parsed.id,
      name: parsed.name ?? nameFromFilename(parts[parts.length - 1]),
      content: parsed.content,
      tags: parsed.tags,
      parentId,
      isFolder: false,
      createdAt: normTs(parsed.createdAt, updatedAt),
      updatedAt,
      device: parsed.device ?? undefined,
    };
    const list = byId.get(item.id) ?? [];
    list.push({ rel, item });
    byId.set(item.id, list);
  }

  // The same id in several files happens after a rename, and when a cloud client
  // keeps a "conflicted copy". An older copy that matches what we last synced is
  // superseded; anything else is preserved as a conflict copy before its file is pruned.
  const filesById = new Map<string, RemoteFile[]>();
  const virtualIds = new Set<string>();
  const noteItems: RemoteItem[] = [];
  for (const [id, group] of byId) {
    const ordered = sortedVersions(group);
    filesById.set(id, ordered);
    const winner = ordered[0].item;
    noteItems.push(winner);
    const b = ctx.base[id];
    for (const other of ordered.slice(1)) {
      const o = normalizeItem(other.item);
      const w = normalizeItem(winner);
      const identical = o.name === w.name && o.content === w.content && o.parentId === w.parentId && o.tags.join(",") === w.tags.join(",");
      if (identical || (b !== undefined && matchesBase(o, b))) continue;
      const copy = makeConflictCopy(o, other.item.device, w.parentId);
      if (!byId.has(copy.id) && !virtualIds.has(copy.id)) {
        noteItems.push({ ...copy, device: other.item.device });
        virtualIds.add(copy.id);
      }
    }
  }

  const tombstones = manifest?.tombstones ?? {};
  return {
    manifest,
    manifestPresent,
    items: [...folderById.values(), ...noteItems],
    tombstones,
    filesById,
    virtualIds,
    dirs: walked.dirs,
    tempFiles: walked.temps,
    noteCount: byId.size,
  };
}

// ── Writing the sync folder ───────────────────────────────────────────────────

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

async function atomicWrite(fs: FsAdapter, root: string, rel: string, data: string, tag: string): Promise<void> {
  const dir = dirOf(rel);
  const tmp = joinRoot(root, `${dir ? `${dir}/` : ""}${TEMP_PREFIX}${tag}-${randomSuffix()}${TEMP_SUFFIX}`);
  try {
    await fs.writeTextFile(tmp, data);
    await fs.rename(tmp, joinRoot(root, rel));
  } catch (e) {
    try {
      await fs.remove(tmp);
    } catch {
      // The temp file never got created; a leftover is swept on the next successful run.
    }
    throw e;
  }
}

export async function applyRemote(
  fs: FsAdapter,
  root: string,
  snap: RemoteSnapshot,
  plan: ReconcilePlan,
  deviceId: string,
  isCurrent: () => boolean = () => true
): Promise<void> {
  // A run that timed out is abandoned, not cancelled: without this check its remaining
  // writes would land on top of whatever the next run has already put in the folder.
  const alive = () => {
    if (!isCurrent()) throw new SyncError("error", "Sync was abandoned after a timeout.");
  };
  const tag = deviceId.slice(0, 8);
  const byId = new Map(plan.merged.map((m) => [m.id, m]));
  const knownDirs = new Set(snap.dirs.map(pathKey));
  const ensureDir = async (rel: string) => {
    if (!rel || knownDirs.has(pathKey(rel))) return;
    alive();
    await fs.mkdir(joinRoot(root, rel));
    knownDirs.add(pathKey(rel));
  };

  const wantedDirs = new Set<string>();
  for (const n of plan.merged) if (n.isFolder) wantedDirs.add(folderRelDir(n, byId));
  for (const d of [...wantedDirs].sort()) await ensureDir(d);

  const writeIds = new Set(plan.remoteWrites.map((w) => w.id));
  const copyIds = new Set([...plan.copies, ...snap.virtualIds]);
  const jobs: { rel: string; note: NoteFile }[] = [];
  const staleRels: string[] = [];
  for (const n of plan.merged) {
    if (n.isFolder) continue;
    const rel = noteRelPath(n, byId);
    const files = snap.filesById.get(n.id) ?? [];
    // Only the authoritative copy counts: another file at the expected path may be an older
    // or conflicting version that must be overwritten (after it has been preserved).
    const inPlace = files.length > 0 && pathKey(files[0].rel) === pathKey(rel);
    if (writeIds.has(n.id) || copyIds.has(n.id) || !inPlace) jobs.push({ rel, note: n });
    for (const f of files) if (pathKey(f.rel) !== pathKey(rel)) staleRels.push(f.rel);
  }
  // Preserved versions go first so they are on disk before anything overwrites their source.
  jobs.sort((a, b) => {
    const ca = copyIds.has(a.note.id) ? 0 : 1;
    const cb = copyIds.has(b.note.id) ? 0 : 1;
    return ca - cb || (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0);
  });
  for (const job of jobs) {
    alive();
    await ensureDir(dirOf(job.rel));
    await atomicWrite(fs, root, job.rel, serializeNote(job.note, deviceId), tag);
  }

  // The manifest is the commit point of a run: written last, only when it changed.
  const folders = plan.merged.filter((n) => n.isFolder).map(toManifestFolder);
  const m = snap.manifest;
  const manifestChanged =
    !m ||
    m.legacy ||
    folderSignature(m.folders) !== folderSignature(folders) ||
    tombstoneSignature(m.tombstones) !== tombstoneSignature(plan.tombstones);
  if (manifestChanged) {
    alive();
    const body = {
      version: 2,
      rev: (m?.rev ?? 0) + 1,
      device: deviceId,
      writtenAt: new Date().toISOString(),
      folders: folders.map((f) => ({ ...f, device: deviceId })),
      tombstones: plan.tombstones,
    };
    await atomicWrite(fs, root, INDEX_FILE, JSON.stringify(body, null, 2), tag);
  }

  // Cleanup is best effort: whatever fails here is attributable and retried next run.
  const rm = async (rel: string) => {
    alive();
    try {
      await fs.remove(joinRoot(root, rel));
    } catch {
      // Already gone, or held open by the cloud client.
    }
  };
  for (const rel of staleRels) await rm(rel);
  for (const id of plan.remoteDeletes) {
    if (plan.tombstones[id] === undefined) continue;
    for (const f of snap.filesById.get(id) ?? []) await rm(f.rel);
  }
  for (const rel of snap.tempFiles) await rm(rel);

  const wantedKeys = new Set([...wantedDirs].map(pathKey));
  const orphanDirs = snap.dirs
    .filter((d) => !wantedKeys.has(pathKey(d)))
    .sort((a, b) => b.split("/").length - a.split("/").length);
  for (const d of orphanDirs) {
    try {
      const entries = await fs.readDir(joinRoot(root, d));
      if (entries.length === 0) await fs.remove(joinRoot(root, d));
    } catch {
      // Already gone; a non-empty directory holds files that are not ours and stays.
    }
  }
}

// ── Preflight ─────────────────────────────────────────────────────────────────

function offlineMessage(root: string): string {
  return `The sync folder is not available (${root}). Check that the drive is connected and your cloud app is running. Your notes are safe on this device and will sync when it is back.`;
}

async function preflight(fs: FsAdapter, root: string, knownItems: number): Promise<void> {
  try {
    await fs.readDir(joinRoot(root, ""));
    return;
  } catch {
    // fall through to find out whether the folder is missing or merely unreadable
  }
  let exists = false;
  try {
    exists = await fs.exists(joinRoot(root, ""));
  } catch {
    exists = false;
  }
  // A folder that vanished after we synced into it is an unplugged drive or a stopped
  // cloud client, not a reason to recreate it empty and treat the remote as wiped.
  if (exists || knownItems > 0) throw new SyncError("offline", offlineMessage(root));
  try {
    await fs.mkdir(joinRoot(root, ""));
    await fs.readDir(joinRoot(root, ""));
  } catch {
    throw new SyncError("offline", offlineMessage(root));
  }
}

// ── Engine ────────────────────────────────────────────────────────────────────

export type SyncTrigger = "timer" | "startup" | "manual" | "quit";

export interface SyncOutcome {
  ok: boolean;
  kind?: "offline" | "error";
  message?: string;
  pushed: number;
  pulled: number;
  conflicts: number;
  /** Items edited while the sync ran; they are picked up by the next run. */
  deferred: number;
}

const emptyOutcome = (): SyncOutcome => ({ ok: true, pushed: 0, pulled: 0, conflicts: 0, deferred: 0 });

async function failureOutcome(e: unknown, fs: FsAdapter, root: string): Promise<SyncOutcome> {
  const base = { ...emptyOutcome(), ok: false };
  if (e instanceof SyncError) return { ...base, kind: e.kind, message: e.message };
  let reachable = true;
  try {
    await fs.readDir(joinRoot(root, ""));
  } catch {
    reachable = false;
  }
  return reachable
    ? { ...base, kind: "error", message: errMessage(e) }
    : { ...base, kind: "offline", message: offlineMessage(root) };
}

async function execute(root: string, fs: FsAdapter, isCurrent: () => boolean): Promise<SyncOutcome> {
  const outcome = emptyOutcome();
  try {
    for (let attempt = 0; attempt < MAX_COMMIT_ATTEMPTS; attempt++) {
      const st = useStore.getState();
      if (!st.syncEnabled || st.syncFolder !== root) return outcome;
      const deviceId = st.ensureSyncDeviceId();
      const snapshot: SyncSnapshot = {
        notes: st.notes,
        tombstones: sanitizeTombstones(st.deletedNoteIds),
        folder: root,
      };
      const base = sanitizeBase(st.syncBase);
      const baseCount = Object.keys(base).length;

      await preflight(fs, root, baseCount);
      foldCase = await detectCaseFold(fs, root, deviceId.slice(0, 8));
      const remote = await readRemote(fs, root, {
        deviceId,
        base,
        localFolders: st.notes.filter((n) => n.isFolder),
      });
      if (baseCount > 0 && !remote.manifestPresent && remote.noteCount === 0) {
        throw new SyncError(
          "offline",
          `The sync folder looks empty, but this device has synced ${baseCount} items to it before. It may be unmounted or its cloud client may not be running, so nothing was changed. If you really emptied it, choose the folder again in Settings to upload everything afresh.`
        );
      }

      const plan = reconcile({
        local: st.notes,
        remote: remote.items,
        localTombstones: snapshot.tombstones,
        remoteTombstones: remote.tombstones,
        base,
        deviceId,
        now: Date.now(),
      });
      await applyRemote(fs, root, remote, plan, deviceId, isCurrent);
      if (!isCurrent()) return { ...outcome, ok: false, kind: "error", message: "Sync was abandoned after a timeout." };

      const res = useStore.getState().commitSyncResult(snapshot, plan);
      outcome.pushed += plan.remoteWrites.length;
      outcome.pulled += plan.localUpserts.length;
      outcome.conflicts += plan.conflicts.length;
      outcome.deferred = res.skipped.length;
      if (!res.applied || res.skipped.length === 0) return outcome;
    }
    return outcome;
  } catch (e) {
    return failureOutcome(e, fs, root);
  }
}

let inflight: Promise<SyncOutcome> | null = null;
let currentRun = 0;

export function isSyncRunning(): boolean {
  return inflight !== null;
}

export interface SyncOptions {
  trigger?: SyncTrigger;
  fs?: FsAdapter;
}

/**
 * The only entry point that talks to the sync folder. Timer, startup, manual and
 * quit syncs share one lock: a second caller gets the run that is already going.
 * Never rejects.
 */
export function syncNow(opts: SyncOptions = {}): Promise<SyncOutcome> {
  if (inflight) return inflight;
  const st = useStore.getState();
  const root = st.syncFolder;
  if (!st.syncEnabled || !root) {
    return Promise.resolve({ ...emptyOutcome(), ok: false, kind: "error", message: "Cloud sync is not set up." });
  }
  const fs = opts.fs ?? tauriFsAdapter;
  const runId = ++currentRun;
  const isCurrent = () => runId === currentRun;

  st.patchSyncRuntime({
    isSyncing: true,
    syncStatus: "syncing",
    syncError: null,
    ...(opts.trigger === "manual" ? { syncFailures: 0 } : {}),
  });

  const run = (async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<SyncOutcome>((resolve) => {
      timer = setTimeout(() => {
        currentRun++; // a late finisher must not commit into state a newer run owns
        resolve({
          ...emptyOutcome(),
          ok: false,
          kind: "error",
          message: "Sync timed out. The sync folder is not responding.",
        });
      }, RUN_TIMEOUT_MS);
    });
    const outcome = await Promise.race([execute(root, fs, isCurrent), timeout]);
    clearTimeout(timer);
    settle(root, outcome);
    return outcome;
  })();

  const tracked = run.finally(() => {
    if (inflight === tracked) inflight = null;
  });
  inflight = tracked;
  return tracked;
}

function settle(root: string, outcome: SyncOutcome): void {
  const s = useStore.getState();
  const now = Date.now();
  // Sync was switched off or pointed elsewhere while this run was going: its result says nothing about the new setup.
  if (!s.syncEnabled || s.syncFolder !== root) {
    s.patchSyncRuntime({ isSyncing: false, syncStatus: "idle", syncError: null });
    return;
  }
  s.refreshPendingCount();
  if (outcome.ok) {
    s.patchSyncRuntime({
      isSyncing: false,
      syncStatus: "idle",
      syncError: null,
      syncFailures: 0,
      nextSyncAt: now + SYNC_INTERVAL_MS,
    });
    s.setLastSyncAt(new Date(now).toISOString());
  } else {
    const failures = s.syncFailures + 1;
    s.patchSyncRuntime({
      isSyncing: false,
      syncStatus: outcome.kind ?? "error",
      syncError: outcome.message ?? "Sync failed.",
      syncFailures: failures,
      nextSyncAt: now + backoffMs(failures),
    });
  }
}

/** Quit path: sync, and once more if edits landed during the run. */
export async function flushPendingForQuit(fs?: FsAdapter): Promise<SyncOutcome> {
  let outcome = await syncNow({ trigger: "quit", fs });
  for (let i = 0; i < 2 && outcome.ok && useStore.getState().pendingCount > 0; i++) {
    outcome = await syncNow({ trigger: "quit", fs });
  }
  return outcome;
}

// ── Backup ────────────────────────────────────────────────────────────────────

/** Notes plus the rest of the persisted store, minus API keys. */
export function buildBackupJson(state: object): string {
  const s = state as Record<string, unknown>;
  const configs = (s.aiVendorConfigs ?? {}) as Record<string, Record<string, unknown>>;
  const scrubbed = {
    ...s,
    apiKey: "",
    aiVendorConfigs: Object.fromEntries(Object.entries(configs).map(([k, v]) => [k, { ...v, apiKey: "" }])),
    syncBase: undefined,
  };
  const header = { format: "hades-backup", version: 1, createdAt: new Date().toISOString(), notes: s.notes ?? [] };
  try {
    return JSON.stringify({ ...header, store: scrubbed }, null, 2);
  } catch {
    return JSON.stringify(header, null, 2);
  }
}

/** Resolves to the saved path, or null when the user cancels the dialog. */
export async function saveBackupViaDialog(): Promise<string | null> {
  const stamp = new Date().toISOString().slice(0, 10);
  const path = await save({
    title: "Save a backup of your Hades data",
    defaultPath: `hades-backup-${stamp}.json`,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (!path) return null;
  await tauriFs.writeTextFile(path, buildBackupJson(useStore.getState()));
  return path;
}
