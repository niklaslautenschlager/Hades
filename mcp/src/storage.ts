import { randomUUID } from "node:crypto";
import { lstat, readFile, readdir, realpath, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export interface HadesNote {
  id: string;
  name: string;
  parentId: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  content: string;
  path: string;
}

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

function parseNote(raw: string, filePath: string): HadesNote | null {
  if (!raw.startsWith("---\n")) return null;
  const end = raw.indexOf("\n---\n", 4);
  if (end < 0) return null;
  const meta: Record<string, string> = {};
  for (const line of raw.slice(4, end).split("\n")) {
    const sep = line.indexOf(":");
    if (sep >= 0) meta[line.slice(0, sep).trim()] = line.slice(sep + 1).trim();
  }
  if (!meta.id) return null;
  const fallback = path.basename(filePath, ".md").replace(/-[a-z0-9-]{6,}$/i, "");
  return {
    id: meta.id,
    name: meta.name || fallback,
    parentId: meta.parentId || null,
    tags: meta.tags ? meta.tags.split(",").map((tag) => tag.trim()).filter(Boolean) : [],
    createdAt: meta.createdAt || new Date(0).toISOString(),
    updatedAt: meta.updatedAt || new Date(0).toISOString(),
    content: raw.slice(end + 5),
    path: filePath,
  };
}

function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "-").trim().slice(0, 80) || "untitled";
}

function serialize(note: HadesNote): string {
  return [
    "---",
    `id: ${note.id}`,
    `name: ${note.name.replace(/[\r\n]/g, " ")}`,
    `parentId: ${note.parentId ?? ""}`,
    `tags: ${note.tags.join(",")}`,
    `createdAt: ${note.createdAt}`,
    `updatedAt: ${note.updatedAt}`,
    "---",
    note.content,
  ].join("\n");
}

export class HadesNotesStore {
  private constructor(private readonly root: string) {}

  static async open(folder: string): Promise<HadesNotesStore> {
    const root = await realpath(folder);
    const stats = await lstat(root);
    if (!stats.isDirectory()) throw new Error("HADES_SYNC_FOLDER must point to a directory.");
    return new HadesNotesStore(root);
  }

  private async noteFiles(directory = this.root): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    const result: string[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "_hades.json" || entry.isSymbolicLink()) continue;
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) result.push(...(await this.noteFiles(filePath)));
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) result.push(filePath);
    }
    return result;
  }

  private async readFileNote(filePath: string): Promise<HadesNote | null> {
    const resolved = await realpath(filePath);
    if (!inside(this.root, resolved)) throw new Error("Note path escaped the configured Hades sync folder.");
    return parseNote(await readFile(resolved, "utf8"), resolved);
  }

  async list(): Promise<HadesNote[]> {
    const files = await this.noteFiles();
    const notes = await Promise.all(files.map((file) => this.readFileNote(file)));
    return notes.filter((note): note is HadesNote => note !== null).sort((a, b) => a.name.localeCompare(b.name));
  }

  async read(id: string): Promise<HadesNote> {
    const note = (await this.list()).find((item) => item.id === id);
    if (!note) throw new Error(`No Hades note found with id '${id}'.`);
    return note;
  }

  async create(name: string, content: string, tags: string[]): Promise<HadesNote> {
    const now = new Date().toISOString();
    const id = randomUUID().replaceAll("-", "");
    const note: HadesNote = {
      id,
      name: name.trim(),
      parentId: null,
      tags,
      createdAt: now,
      updatedAt: now,
      content,
      path: path.join(this.root, `${safeName(name)}-${id}.md`),
    };
    await writeFile(note.path, serialize(note), { encoding: "utf8", flag: "wx" });
    return note;
  }

  async updateContent(id: string, content: string): Promise<HadesNote> {
    const existing = await this.read(id);
    const updated: HadesNote = { ...existing, content, updatedAt: new Date().toISOString() };
    const resolved = await realpath(existing.path);
    if (!inside(this.root, resolved)) throw new Error("Note path escaped the configured Hades sync folder.");
    const temp = path.join(path.dirname(resolved), `.${path.basename(resolved)}.${randomUUID()}.tmp`);
    try {
      await writeFile(temp, serialize(updated), { encoding: "utf8", flag: "wx" });
      await rename(temp, resolved);
    } catch (error) {
      await import("node:fs/promises").then(({ unlink }) => unlink(temp).catch(() => undefined));
      throw error;
    }
    return updated;
  }
}

export { parseNote, serialize, safeName };
