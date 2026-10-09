import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { HadesNotesStore } from "../src/storage.js";

async function withFolder(run: (folder: string) => Promise<void>): Promise<void> {
  const folder = await mkdtemp(path.join(os.tmpdir(), "hades-mcp-"));
  try { await run(folder); } finally { await rm(folder, { recursive: true, force: true }); }
}

test("creates Hades-compatible note files and reads their stable metadata", async () => {
  await withFolder(async (folder) => {
    const store = await HadesNotesStore.open(folder);
    const created = await store.create("Course Notes", "# Week 1\nKey ideas", ["course", "week-1"]);
    const disk = await readFile(created.path, "utf8");
    assert.match(disk, /^---\nid: [a-f0-9]{32}\nname: Course Notes\nparentId: \ntags: course,week-1/m);
    assert.equal((await store.read(created.id)).content, "# Week 1\nKey ideas");
    assert.equal((await store.list()).length, 1);
  });
});

test("updates a note atomically and preserves its metadata", async () => {
  await withFolder(async (folder) => {
    const store = await HadesNotesStore.open(folder);
    const created = await store.create("Draft", "old body", ["tag"]);
    const updated = await store.updateContent(created.id, "new body");
    assert.equal(updated.name, "Draft");
    assert.deepEqual(updated.tags, ["tag"]);
    assert.equal(updated.content, "new body");
    assert.ok(updated.updatedAt >= created.updatedAt);
    assert.equal((await readFile(created.path, "utf8")).endsWith("new body"), true);
  });
});

test("ignores symbolic links and hidden sync metadata", async () => {
  await withFolder(async (folder) => {
    const elsewhere = await mkdtemp(path.join(os.tmpdir(), "hades-outside-"));
    try {
      const store = await HadesNotesStore.open(folder);
      await mkdir(path.join(elsewhere, "nested"));
      await store.create("Inside", "safe", []);
      await symlink(elsewhere, path.join(folder, "escape"), "junction");
      await import("node:fs/promises").then(({ writeFile }) => writeFile(path.join(folder, "_hades.json"), "{}"));
      assert.deepEqual((await store.list()).map((note) => note.name), ["Inside"]);
    } finally { await rm(elsewhere, { recursive: true, force: true }); }
  });
});

test("rejects a missing note id", async () => {
  await withFolder(async (folder) => {
    const store = await HadesNotesStore.open(folder);
    await assert.rejects(store.read("missing"), /No Hades note found/);
  });
});
