import { mkdir, readDir, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import type { NoteFile } from "../store/useStore";

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// ── Frontmatter ───────────────────────────────────────────────────────────────

function serialize(note: NoteFile): string {
  return `---\nid: ${note.id}\ntags: ${note.tags.join(",")}\ncreatedAt: ${note.createdAt}\nupdatedAt: ${note.updatedAt}\n---\n${note.content}`;
}

function parseFrontmatter(raw: string): {
  id: string; tags: string[]; createdAt: string; updatedAt: string; content: string;
} | null {
  if (!raw.startsWith("---\n")) return null;
  const end = raw.indexOf("\n---\n", 4);
  if (end === -1) return null;
  const meta: Record<string, string> = {};
  for (const line of raw.slice(4, end).split("\n")) {
    const sep = line.indexOf(": ");
    if (sep >= 0) meta[line.slice(0, sep).trim()] = line.slice(sep + 2).trim();
  }
  if (!meta.id) return null;
  return {
    id: meta.id,
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

function noteContainerDir(note: NoteFile, allNotes: NoteFile[], root: string): string {
  const segs: string[] = [];
  let pid = note.parentId;
  while (pid) {
    const p = allNotes.find(n => n.id === pid);
    if (!p) break;
    segs.unshift(safeName(p.name));
    pid = p.parentId;
  }
  return [root, ...segs].join("/");
}

function noteFilePath(note: NoteFile, allNotes: NoteFile[], root: string): string {
  const dir = noteContainerDir(note, allNotes, root);
  return `${dir}/${safeName(note.name)}-${note.id.slice(0, 6)}.md`;
}

function folderAbsPath(folder: NoteFile, allNotes: NoteFile[], root: string): string {
  return `${noteContainerDir(folder, allNotes, root)}/${safeName(folder.name)}`;
}

// ── Folder index ──────────────────────────────────────────────────────────────

const INDEX_FILE = "_hades.json";
interface FolderIndex { folderIds: Record<string, string>; }

async function readFolderIndex(root: string): Promise<FolderIndex> {
  try {
    return JSON.parse(await readTextFile(`${root}/${INDEX_FILE}`)) as FolderIndex;
  } catch {
    return { folderIds: {} };
  }
}

async function writeFolderIndex(root: string, notes: NoteFile[]): Promise<void> {
  const ids: Record<string, string> = {};
  for (const f of notes.filter(n => n.isFolder)) {
    const segs = [safeName(f.name)];
    let pid = f.parentId;
    while (pid) {
      const p = notes.find(n => n.id === pid);
      if (!p) break;
      segs.unshift(safeName(p.name));
      pid = p.parentId;
    }
    ids[segs.join("/")] = f.id;
  }
  await writeTextFile(`${root}/${INDEX_FILE}`, JSON.stringify({ folderIds: ids }, null, 2));
}

// ── Write dirty notes to sync folder ─────────────────────────────────────────

export async function syncDirtyNotes(
  allNotes: NoteFile[],
  root: string,
  lastSyncAt: string | null
): Promise<void> {
  await mkdir(root, { recursive: true });

  const dirtyNotes = allNotes.filter(
    n => !n.isFolder && (!lastSyncAt || n.updatedAt > lastSyncAt)
  );
  if (dirtyNotes.length === 0 && allNotes.filter(n => n.isFolder).length === 0) return;

  // Ensure all folder directories exist
  for (const f of allNotes.filter(n => n.isFolder)) {
    await mkdir(folderAbsPath(f, allNotes, root), { recursive: true });
  }

  for (const note of dirtyNotes) {
    await mkdir(noteContainerDir(note, allNotes, root), { recursive: true });
    await writeTextFile(noteFilePath(note, allNotes, root), serialize(note));
  }

  await writeFolderIndex(root, allNotes);
}

// ── Collect all .md files recursively ────────────────────────────────────────

async function collectMdFiles(
  dir: string,
  relParts: string[],
  out: { full: string; parts: string[] }[]
): Promise<void> {
  const entries = await readDir(dir);
  for (const e of entries) {
    if (e.name.startsWith(".") || e.name === INDEX_FILE) continue;
    const childFull = `${dir}/${e.name}`;
    if (e.isDirectory) {
      await collectMdFiles(childFull, [...relParts, e.name], out);
    } else if (e.isFile && e.name.endsWith(".md")) {
      out.push({ full: childFull, parts: [...relParts, e.name] });
    }
  }
}

// ── Initial bidirectional sync ────────────────────────────────────────────────

export interface InitialSyncResult {
  mergedNotes: NoteFile[];
  // Notes that exist locally but not on disk — need uploading
  needsUploadCount: number;
}

function resolveOrCreateFolderPath(
  parts: string[],
  pathToId: Map<string, string>,
  notes: NoteFile[]
): string | null {
  if (parts.length === 0) return null;
  let parentId: string | null = null;
  for (let i = 0; i < parts.length; i++) {
    const path = parts.slice(0, i + 1).join("/");
    let fid = pathToId.get(path);
    if (!fid) {
      fid = uid();
      pathToId.set(path, fid);
    }
    // CRITICAL: ensure an actual folder node exists for this id. The id may be
    // known from the folder index (_hades.json) written by another device, in
    // which case no folder NoteFile exists yet locally. Without this, incoming
    // notes get attached to a parentId that has no node → orphaned & invisible.
    if (!notes.some((n) => n.id === fid && n.isFolder)) {
      notes.push({
        id: fid, name: parts[i], content: "", tags: [],
        parentId, isFolder: true,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      });
    }
    parentId = fid;
  }
  return parentId;
}

export async function initialSync(
  root: string,
  localNotes: NoteFile[]
): Promise<InitialSyncResult> {
  await mkdir(root, { recursive: true });

  const index = await readFolderIndex(root);
  const mdFiles: { full: string; parts: string[] }[] = [];
  await collectMdFiles(root, [], mdFiles);

  // First run: no disk notes — upload everything
  if (mdFiles.length === 0) {
    return { mergedNotes: localNotes, needsUploadCount: localNotes.filter(n => !n.isFolder).length };
  }

  // Parse disk files
  interface RawDisk {
    id: string; name: string; content: string; tags: string[];
    createdAt: string; updatedAt: string; folderParts: string[];
  }

  const diskNotes: RawDisk[] = [];
  for (const { full, parts } of mdFiles) {
    try {
      const fm = parseFrontmatter(await readTextFile(full));
      if (!fm) continue;
      const filename = parts[parts.length - 1];
      const m = /^(.+)-[a-z0-9]{6}\.md$/.exec(filename) ?? /^(.+)\.md$/.exec(filename);
      diskNotes.push({ ...fm, name: m ? m[1] : filename.replace(/\.md$/, ""), folderParts: parts.slice(0, -1) });
    } catch {}
  }

  // Build folder-path → id map. Local folders are authoritative (so a folder
  // that already exists locally keeps its id and we don't create a duplicate);
  // the on-disk index only fills in paths we don't have locally.
  const pathToId = new Map<string, string>();
  for (const f of localNotes.filter(n => n.isFolder)) {
    const segs = [safeName(f.name)];
    let pid = f.parentId;
    while (pid) {
      const p = localNotes.find(n => n.id === pid);
      if (!p) break;
      segs.unshift(safeName(p.name));
      pid = p.parentId;
    }
    pathToId.set(segs.join("/"), f.id);
  }
  for (const [path, id] of Object.entries(index.folderIds)) {
    if (!pathToId.has(path)) pathToId.set(path, id);
  }

  // Merge
  const result: NoteFile[] = [...localNotes];
  const diskIds = new Set(diskNotes.map(d => d.id));
  let needsUploadCount = 0;

  for (const disk of diskNotes) {
    const parentId = resolveOrCreateFolderPath(disk.folderParts, pathToId, result);
    const localIdx = result.findIndex(n => n.id === disk.id);

    if (localIdx >= 0) {
      const local = result[localIdx];
      if (disk.updatedAt > local.updatedAt) {
        // Disk is newer → update local
        result[localIdx] = { ...local, name: disk.name, content: disk.content, tags: disk.tags, updatedAt: disk.updatedAt, parentId };
      }
      // else local is newer → will be uploaded at next sync
    } else {
      // New note from another device
      result.push({
        id: disk.id, name: disk.name, content: disk.content, tags: disk.tags,
        parentId, isFolder: false, createdAt: disk.createdAt, updatedAt: disk.updatedAt,
      });
    }
  }

  // Count local-only notes that need uploading
  for (const n of localNotes) {
    if (!n.isFolder && !diskIds.has(n.id)) needsUploadCount++;
  }

  return { mergedNotes: result, needsUploadCount };
}
