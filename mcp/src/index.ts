import { McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { HadesNotesStore, type HadesNote } from "./storage.js";

const envSchema = z.object({
  HADES_SYNC_FOLDER: z.string().trim().min(1),
}).strict();

const idSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
const noteSummary = (note: HadesNote) => ({
  id: note.id,
  name: note.name,
  tags: note.tags,
  updatedAt: note.updatedAt,
  parentId: note.parentId,
});
const asText = (value: unknown) => JSON.stringify(value, null, 2);

function toolFailure(error: unknown) {
  const detail = error instanceof Error ? error.message : "Unexpected Hades MCP error.";
  console.error(`[hades-mcp] ${detail}`);
  const message = detail.startsWith("No Hades note found")
    ? detail
    : "The Hades notes operation failed. Check the configured sync folder and server diagnostics.";
  const code = detail.startsWith("No Hades note found") ? "NOTE_NOT_FOUND" : "HADES_OPERATION_FAILED";
  return { isError: true as const, content: [{ type: "text" as const, text: asText({ error: { code, message } }) }] };
}

async function readNoteSafely(store: HadesNotesStore, id: string): Promise<HadesNote> {
  try { return await store.read(id); }
  catch (error) {
    const detail = error instanceof Error ? error.message : "Unexpected note read error.";
    console.error(`[hades-mcp] ${detail}`);
    if (detail.startsWith("No Hades note found")) throw new Error(detail);
    throw new Error("The Hades note could not be read from the configured sync folder.");
  }
}

async function main(): Promise<void> {
  const config = envSchema.safeParse({ HADES_SYNC_FOLDER: process.env.HADES_SYNC_FOLDER });
  if (!config.success) {
    console.error("[hades-mcp] Set HADES_SYNC_FOLDER to the Hades cloud-sync folder before starting the server.");
    process.exitCode = 1;
    return;
  }

  const store = await HadesNotesStore.open(config.data.HADES_SYNC_FOLDER);
  const server = new McpServer({ name: "hades", version: "1.0.0" });

  server.registerTool("list_notes", {
    title: "List Hades notes",
    description: "List Markdown notes from Hades' configured cloud-sync folder. Returns metadata, not note bodies.",
    inputSchema: z.object({
      query: z.string().trim().max(200).optional().describe("Optional case-insensitive search across note names, tags, and contents."),
      limit: z.number().int().min(1).max(200).default(50),
    }).strict(),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ query, limit }) => {
    try {
      let notes = await store.list();
      if (query) {
        const needle = query.toLocaleLowerCase();
        notes = notes.filter((note) => `${note.name}\n${note.tags.join(" ")}\n${note.content}`.toLocaleLowerCase().includes(needle));
      }
      return { content: [{ type: "text", text: asText({ notes: notes.slice(0, limit).map(noteSummary), total: notes.length }) }] };
    } catch (error) { return toolFailure(error); }
  });

  server.registerTool("read_note", {
    title: "Read a Hades note",
    description: "Read a Hades Markdown note by its stable Hades note ID.",
    inputSchema: z.object({ id: idSchema }).strict(),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ id }) => {
    try {
      const note = await readNoteSafely(store, id);
      return { content: [{ type: "text", text: asText({ ...noteSummary(note), content: note.content }) }] };
    } catch (error) { return toolFailure(error); }
  });

  server.registerTool("create_note", {
    title: "Create a Hades note",
    description: "Create a root-level Markdown note using Hades' cloud-sync frontmatter format. Hades imports it on its next sync.",
    inputSchema: z.object({
      name: z.string().trim().min(1).max(120).refine((value) => !/[\r\n]/.test(value), "Name must be one line."),
      content: z.string().max(500_000),
      tags: z.array(z.string().trim().min(1).max(40).refine((value) => !/[\r\n,]/.test(value), "Tags cannot contain commas or newlines.")).max(30).default([]),
    }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, async ({ name, content, tags }) => {
    try {
      const note = await store.create(name, content, tags);
      return { content: [{ type: "text", text: asText({ created: true, ...noteSummary(note) }) }] };
    } catch (error) { return toolFailure(error); }
  });

  server.registerTool("update_note_content", {
    title: "Update Hades note content",
    description: "Replace a note's Markdown body while preserving its Hades ID, name, folder, and tags. Hades imports it on its next sync.",
    inputSchema: z.object({ id: idSchema, content: z.string().max(500_000) }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, async ({ id, content }) => {
    try {
      const note = await store.updateContent(id, content);
      return { content: [{ type: "text", text: asText({ updated: true, ...noteSummary(note) }) }] };
    } catch (error) { return toolFailure(error); }
  });

  server.registerResource("notes", "hades://notes", {
    title: "Hades notes index",
    description: "Read-only metadata index for Markdown notes in Hades' cloud-sync folder.",
    mimeType: "application/json",
  }, async (uri) => ({
    contents: [{ uri: uri.href, mimeType: "application/json", text: asText((await store.list()).map(noteSummary)) }],
  }));

  server.registerResource("note", new ResourceTemplate("hades://notes/{noteId}", { list: undefined }), {
    title: "Hades note",
    description: "Read-only Markdown note addressed by its stable Hades note ID.",
    mimeType: "text/markdown",
  }, async (uri, { noteId }) => {
    const note = await readNoteSafely(store, String(noteId));
    return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: note.content }] };
  });

  server.registerPrompt("summarize_note", {
    title: "Summarize a Hades note",
    description: "Create a concise, structured summary of a Hades note.",
    argsSchema: { noteId: idSchema },
  }, async ({ noteId }) => {
    const note = await readNoteSafely(store, noteId);
    return { messages: [{ role: "user", content: { type: "text", text: `Summarize this note. Preserve key facts and open questions.\n\nTitle: ${note.name}\nTags: ${note.tags.join(", ") || "none"}\n\n${note.content}` } }] };
  });

  server.registerPrompt("quiz_note", {
    title: "Quiz me on a Hades note",
    description: "Generate a short study quiz from a Hades note and wait for the learner's answers before revealing solutions.",
    argsSchema: { noteId: idSchema },
  }, async ({ noteId }) => {
    const note = await readNoteSafely(store, noteId);
    return { messages: [{ role: "user", content: { type: "text", text: `Create five varied questions that test understanding of this note. Ask the questions first without answers; provide feedback after I respond.\n\nTitle: ${note.name}\n\n${note.content}` } }] };
  });

  await serveStdio(() => server);
}

main().catch((error: unknown) => {
  console.error(`[hades-mcp] Startup failed: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
});
