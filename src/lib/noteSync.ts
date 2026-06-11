import { mkdir, readDir, readTextFile, writeTextFile, remove } from "@tauri-apps/plugin-fs";
import { useStore, type NoteFile } from "../store/useStore";

// ─────────────────────────────────────────────────────────────────────────────
// Cloud sync engine (v2) — id-stable identity.
//
// Design principles (fixes the duplication/scatter bug):
//  • A note's identity is its `id`, carried in frontmatter together with its
//    `name` and `parentId`. The on-disk path is only a human-readable
//    projection — it is NEVER used to decide identity.
//  • Folders live in a versioned manifest (_hades.json) keyed by folder id.
//    Folder ids are never invented for an already-known path, so two devices
//    can't ping-pong fresh ids for the same logical folder.
//  • Every sync is a full reconcile: pull-merge by id, push notes whose disk
//    copy is missing/stale, then PRUNE files at stale paths (renames/moves),
//    duplicate-id files, and tombstoned notes. Repeated syncs are idempotent.
//  • Deletions propagate via tombstones (id → deletedAt) stored both in the
//    manifest and in the local store.
// ─────────────────────────────────────────────────────────────────────────────

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

const TOMBSTONE_MAX_AGE_MS = 90 * 24 * 3600_000;

// ── Frontmatter ───────────────────────────────────────────────────────────────

function serialize(note: NoteFile): string {
  return [
    "---",
    `id: ${note.id}`,
    `name: ${note.name.replace(/\n/g, " ")}`,
    `parentId: ${note.parentId ?? ""}`,
    `tags: ${note.tags.join(",")}`,
    `createdAt: ${note.createdAt}`,
    `updatedAt: ${note.updatedAt}`,
    "---",
    note.content,
  ].join("\n");
}

interface ParsedNote {
  id: string;
  name: string | null;      // null on legacy files (name lived in the filename)
  parentId: string | null;  // null = root; legacy files resolve via path
  hasParentField: boolean;  // legacy files lack the field entirely
  tags: string[];
  createdAt: string;
  updatedAt: string;
  content: string;
}

function parseFrontmatter(raw: string): ParsedNote | null {
  if (!raw.startsWith("---\n")) return null;
  const end = raw.indexOf("\n---\n", 4);
  if (end === -1) return null;
  const meta: Record<string, string> = {};
  for (const line of raw.slice(4, end).split("\n")) {
    const sep = line.indexOf(":");
    if (sep >= 0) meta[line.slice(0, sep).trim()] = line.slice(sep + 1).trim();
  }
  if (!meta.id) return null;
  return {
    id: meta.id,
    name: meta.name || null,
    parentId: meta.parentId || null,
    hasParentField: "parentId" in meta,
    tags: meta.tags ? meta.tags.split(",").map(t => t.trim()).filter(Boolean) : [],
    createdAt: meta.createdAt ?? new Date().toISOString(),
    updatedAt: meta.updatedAt ?? new Date().toISOString(),
    content: raw.slice(end + 5),
  };
}

// ── Path helpers ──────────────────────────────────────────────────────────────

export function safeName(name: string): string {
  return (name.replace(/[/\\:*?"<>|]/g, "-").trim().slice(0, 80)) || "untitled";
}

/** Relative dir parts for a folder/note's container, walking parentId chain. */
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

function noteRelPath(note: NoteFile, byId: Map<string, NoteFile>): string {
  const dir = containerParts(note.parentId, byId);
  return [...dir, `${safeName(note.name)}-${note.id}.md`].join("/");
}

function folderRelDir(folder: NoteFile, byId: Map<string, NoteFile>): string {
  return [...containerParts(folder.parentId, byId), safeName(folder.name)].join("/");
}

// ── Manifest (_hades.json) ───────────────────────────────────────────────────

const INDEX_FILE = "_hades.json";

interface ManifestFolder {
  id: string;
  name: string;
  parentId: string | null;
  updatedAt: string;
}

interface Manifest {
  version: 2;
  folders: ManifestFolder[];
  tombstones: Record<string, string>; // id → deletedAt ISO
}

function emptyManifest(): Manifest {
  return { version: 2, folders: [], tombstones: {} };
}

async function readManifest(root: string): Promise<Manifest> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readTextFile(`${root}/${INDEX_FILE}`));
  } catch {
    return emptyManifest();
  }
  const obj = raw as Record<string, unknown>;

  if (obj && obj.version === 2 && Array.isArray(obj.folders)) {
    return {
      version: 2,
      folders: (obj.folders as ManifestFolder[]).filter(f => f && typeof f.id === "string"),
      tombstones:
        obj.tombstones && typeof obj.tombstones === "object"
          ? (obj.tombstones as Record<string, string>)
          : {},
    };
  }

  // Legacy v1 shape: { folderIds: { "A/B": "<id>" } } — reconstruct hierarchy
  // from the path keys so existing folder ids survive the upgrade.
  if (obj && obj.folderIds && typeof obj.folderIds === "object") {
    const pathToId = obj.folderIds as Record<string, string>;
    const folders: ManifestFolder[] = [];
    const now = new Date(0).toISOString(); // epoch → any real local edit wins
    for (const [path, id] of Object.entries(pathToId)) {
      const parts = path.split("/");
      const parentPath = parts.slice(0, -1).join("/");
      folders.push({
        id,
        name: parts[parts.length - 1],
        parentId: parentPath ? pathToId[parentPath] ?? null : null,
        updatedAt: now,
      });
    }
    return { version: 2, folders, tombstones: {} };
  }

  return emptyManifest();
}

async function writeManifest(root: string, notes: NoteFile[], tombstones: Record<string, string>): Promise<void> {
  const manifest: Manifest = {
    version: 2,
    folders: notes
      .filter(n => n.isFolder)
      .map(f => ({ id: f.id, name: f.name, parentId: f.parentId, updatedAt: f.updatedAt })),
    tombstones,
  };
  await writeTextFile(`${root}/${INDEX_FILE}`, JSON.stringify(manifest, null, 2));
}

// ── Disk walking ─────────────────────────────────────────────────────────────

interface DiskFile {
  rel: string;          // path relative to root, "/"-joined
  parts: string[];      // path segments
  parsed: ParsedNote | null;
}

async function walkDisk(
  root: string,
  relParts: string[],
  files: DiskFile[],
  dirs: string[]
): Promise<void> {
  const entries = await readDir([root, ...relParts].join("/"));
  for (const e of entries) {
    if (e.name.startsWith(".") || e.name === INDEX_FILE) continue;
    if (e.isDirectory) {
      const childParts = [...relParts, e.name];
      dirs.push(childParts.join("/"));
      await walkDisk(root, childParts, files, dirs);
    } else if (e.isFile && e.name.endsWith(".md")) {
      const parts = [...relParts, e.name];
      let parsed: ParsedNote | null = null;
      try {
        parsed = parseFrontmatter(await readTextFile([root, ...parts].join("/")));
      } catch { /* unreadable — leave untouched */ }
      files.push({ rel: parts.join("/"), parts, parsed });
    }
  }
}

/** Legacy filename → display name (strip "-<id6>" or "-<fullid>" suffix). */
function nameFromFilename(filename: string): string {
  const base = filename.replace(/\.md$/, "");
  const m = /^(.+)-[a-z0-9]{6,}$/.exec(base);
  return m ? m[1] : base;
}

// ── Full reconcile sync ───────────────────────────────────────────────────────

export interface FullSyncResult {
  mergedNotes: NoteFile[];
}

export async function fullSync(root: string, localNotes: NoteFile[]): Promise<FullSyncResult> {
  await mkdir(root, { recursive: true });

  const store = useStore.getState();
  const now = new Date().toISOString();

  // ── 1) Read manifest + walk disk ──────────────────────────────────────────
  const manifest = await readManifest(root);
  const files: DiskFile[] = [];
  const diskDirs: string[] = [];
  await walkDisk(root, [], files, diskDirs);

  // ── 2) Merge tombstones (local store ∪ manifest), drop ancient ones ───────
  const tombstones: Record<string, string> = {};
  const cutoff = Date.now() - TOMBSTONE_MAX_AGE_MS;
  for (const src of [manifest.tombstones, store.deletedNoteIds]) {
    for (const [id, deletedAt] of Object.entries(src)) {
      const t = Date.parse(deletedAt);
      if (!isNaN(t) && t < cutoff) continue;
      if (!tombstones[id] || tombstones[id] < deletedAt) tombstones[id] = deletedAt;
    }
  }
  const isTombstoned = (n: { id: string; updatedAt: string }) =>
    tombstones[n.id] !== undefined && n.updatedAt <= tombstones[n.id];

  // ── 3) Merge folders by id (manifest ↔ local, newer updatedAt wins) ───────
  const merged = new Map<string, NoteFile>();
  for (const n of localNotes) {
    if (!isTombstoned(n)) merged.set(n.id, n);
  }
  for (const mf of manifest.folders) {
    if (tombstones[mf.id] && (merged.get(mf.id)?.updatedAt ?? "") <= tombstones[mf.id]) continue;
    const existing = merged.get(mf.id);
    if (!existing) {
      merged.set(mf.id, {
        id: mf.id, name: mf.name, content: "", tags: [],
        parentId: mf.parentId, isFolder: true,
        createdAt: mf.updatedAt, updatedAt: mf.updatedAt,
      });
    } else if (existing.isFolder && mf.updatedAt > existing.updatedAt) {
      merged.set(mf.id, { ...existing, name: mf.name, parentId: mf.parentId, updatedAt: mf.updatedAt });
    }
  }

  // Path → folder-id map (for resolving LEGACY files only). Built from merged
  // folders; never overwritten by disk paths.
  const folderPathToId = new Map<string, string>();
  {
    const byId = new Map([...merged].filter(([, n]) => n.isFolder));
    for (const [, f] of byId) {
      folderPathToId.set(folderRelDir(f, byId), f.id);
    }
  }

  // Resolve a legacy file's folder path to a parent id, creating folder nodes
  // only for genuinely unknown paths (one-time migration of pre-v2 layouts).
  const resolveLegacyParent = (parts: string[]): string | null => {
    let parentId: string | null = null;
    for (let i = 0; i < parts.length; i++) {
      const path = parts.slice(0, i + 1).join("/");
      let fid = folderPathToId.get(path);
      if (!fid) {
        fid = uid();
        folderPathToId.set(path, fid);
        merged.set(fid, {
          id: fid, name: parts[i], content: "", tags: [],
          parentId, isFolder: true, createdAt: now, updatedAt: now,
        });
      }
      parentId = fid;
    }
    return parentId;
  };

  // ── 4) Merge notes by id (newest updatedAt wins; dedup duplicate files) ───
  // Group disk files by note id, keeping the newest copy as authoritative.
  const diskById = new Map<string, DiskFile & { parsed: ParsedNote }>();
  for (const f of files) {
    if (!f.parsed) continue;
    const prev = diskById.get(f.parsed.id);
    if (!prev || f.parsed.updatedAt > prev.parsed.updatedAt) {
      diskById.set(f.parsed.id, f as DiskFile & { parsed: ParsedNote });
    }
  }

  for (const [id, file] of diskById) {
    const p = file.parsed;
    if (tombstones[id] && p.updatedAt <= tombstones[id]) continue; // deleted elsewhere

    // Determine the incoming parentId.
    let parentId: string | null;
    if (p.hasParentField) {
      parentId = p.parentId;
      if (parentId && !merged.get(parentId)?.isFolder) {
        // Folder not known yet (manifest still propagating through the cloud).
        // Materialize a visible placeholder named after the on-disk dir so the
        // note is never orphaned; the manifest entry will correct it by id.
        const dirName = file.parts.length > 1 ? file.parts[file.parts.length - 2] : "Recovered";
        merged.set(parentId, {
          id: parentId, name: dirName, content: "", tags: [],
          parentId: null, isFolder: true,
          createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
        });
      }
    } else {
      // Legacy file — folder comes from its on-disk location.
      parentId = resolveLegacyParent(file.parts.slice(0, -1));
    }

    const name = p.name ?? nameFromFilename(file.parts[file.parts.length - 1]);
    const existing = merged.get(id);
    if (!existing) {
      merged.set(id, {
        id, name, content: p.content, tags: p.tags,
        parentId, isFolder: false, createdAt: p.createdAt, updatedAt: p.updatedAt,
      });
    } else if (!existing.isFolder && p.updatedAt > existing.updatedAt) {
      merged.set(id, { ...existing, name, content: p.content, tags: p.tags, parentId, updatedAt: p.updatedAt });
    }
  }

  const mergedNotes = [...merged.values()];
  const byId = new Map(mergedNotes.map(n => [n.id, n]));

  // ── 5) PUSH: write notes whose disk copy is missing, stale, or mis-placed ─
  const expectedNotePaths = new Map<string, string>(); // note id → expected rel path
  for (const n of mergedNotes) {
    if (!n.isFolder) expectedNotePaths.set(n.id, noteRelPath(n, byId));
  }

  // Ensure folder directories exist.
  const expectedDirs = new Set<string>();
  for (const n of mergedNotes) {
    if (n.isFolder) expectedDirs.add(folderRelDir(n, byId));
  }
  for (const dir of expectedDirs) {
    await mkdir(`${root}/${dir}`, { recursive: true });
  }

  const diskRelSet = new Set(files.map(f => f.rel));
  for (const n of mergedNotes) {
    if (n.isFolder) continue;
    const expected = expectedNotePaths.get(n.id)!;
    const diskCopy = diskById.get(n.id);
    const needsWrite =
      !diskCopy ||                                  // never uploaded
      diskCopy.parsed.updatedAt < n.updatedAt ||    // local is newer
      !diskRelSet.has(expected);                    // renamed/moved → new path
    if (needsWrite) {
      const dir = expected.split("/").slice(0, -1).join("/");
      if (dir) await mkdir(`${root}/${dir}`, { recursive: true });
      await writeTextFile(`${root}/${expected}`, serialize({ ...n, updatedAt: n.updatedAt }));
    }
  }

  // ── 6) PRUNE: tombstoned files, stale-path duplicates, duplicate-id copies ─
  for (const f of files) {
    if (!f.parsed) continue; // never touch files we can't attribute
    const id = f.parsed.id;
    const expected = expectedNotePaths.get(id);
    const shouldRemove =
      (tombstones[id] !== undefined && !byId.has(id)) || // deleted note's file
      (expected !== undefined && f.rel !== expected);    // stale rename/move or duplicate copy
    if (shouldRemove) {
      try { await remove(`${root}/${f.rel}`); } catch { /* already gone */ }
    }
  }

  // Remove directories that no longer correspond to a live folder — only when
  // they're empty (so we never destroy unknown user files).
  const candidateDirs = diskDirs
    .filter(d => !expectedDirs.has(d))
    .sort((a, b) => b.split("/").length - a.split("/").length); // deepest first
  for (const d of candidateDirs) {
    try {
      const entries = await readDir(`${root}/${d}`);
      if (entries.length === 0) await remove(`${root}/${d}`);
    } catch { /* already gone */ }
  }

  // ── 7) Manifest + tombstone bookkeeping ────────────────────────────────────
  await writeManifest(root, mergedNotes, tombstones);
  useStore.getState().setDeletedNoteIds(tombstones);

  return { mergedNotes };
}
