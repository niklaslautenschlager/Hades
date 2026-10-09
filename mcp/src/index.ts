import { McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { realpath } from "node:fs/promises";
import * as z from "zod/v4";
import { BridgeError, HadesBridge, buildSchedule, buildStats, isValidWhen } from "./bridge.js";
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

function bridgeFailureMessage(error: unknown): string {
  console.error(`[hades-mcp] ${error instanceof Error ? error.message : "Unexpected Hades bridge error."}`);
  return error instanceof BridgeError ? error.message : "The Hades workspace bridge operation failed. Check the bridge folder and server diagnostics.";
}

function bridgeFailure(error: unknown) {
  const code = error instanceof BridgeError ? error.code : "HADES_BRIDGE_FAILED";
  return { isError: true as const, content: [{ type: "text" as const, text: asText({ error: { code, message: bridgeFailureMessage(error) } }) }] };
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
  const bridgeDir = process.env.HADES_BRIDGE_DIR?.trim();
  const bridge = HadesBridge.create(await realpath(config.data.HADES_SYNC_FOLDER), bridgeDir ? { bridgeDir } : {});
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

  const whenSchema = z.string().trim().max(40).refine(isValidWhen, "Use an ISO-8601 date (2026-10-12) or datetime (2026-10-12T09:00:00+02:00).");

  server.registerTool("query_schedule", {
    title: "Query the Hades schedule",
    description: "Read calendar events and open tasks from the running Hades app (requires the live workspace bridge). Defaults to events from now to 14 days ahead plus every open task. Dates without a time zone offset use the Hades user's time zone. When 'from' or 'to' is given, tasks are those due inside the window, completed ones included (check each task's 'completed' flag).",
    inputSchema: z.object({
      from: whenSchema.optional().describe("Start of the window (ISO-8601 date or datetime). Default: now."),
      to: whenSchema.optional().describe("End of the window, inclusive; a date covers the whole day. Default: 14 days after 'from'."),
      include: z.array(z.enum(["events", "tasks"])).min(1).max(2).optional().describe("Which lists to return. Default: both."),
      limit: z.number().int().min(1).max(200).default(50),
    }).strict(),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async (args) => {
    try { return { content: [{ type: "text", text: asText(await bridge.querySchedule(args)) }] }; }
    catch (error) { return bridgeFailure(error); }
  });

  server.registerTool("list_open_notes", {
    title: "List open Hades notes",
    description: "List the notes currently open as editor tabs in the running Hades app (requires the live workspace bridge). Returns metadata only.",
    inputSchema: z.object({}).strict(),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async () => {
    try { return { content: [{ type: "text", text: asText(await bridge.listOpenNotes()) }] }; }
    catch (error) { return bridgeFailure(error); }
  });

  server.registerTool("read_open_note", {
    title: "Read an open Hades note",
    description: "Read the text of a note that is open in the running Hades app, as shown in the editor (requires the live workspace bridge). Long notes are truncated. Defaults to the active note.",
    inputSchema: z.object({ id: idSchema.optional().describe("Note id from list_open_notes. Default: the active note.") }).strict(),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ id }) => {
    try { return { content: [{ type: "text", text: asText(await bridge.readOpenNote(id)) }] }; }
    catch (error) { return bridgeFailure(error); }
  });

  server.registerTool("read_open_pdf", {
    title: "Read the open Hades PDF",
    description: "Read extracted text of the PDF open in the Hades Notes PDF pane (requires the live workspace bridge). Returns the current page and the pages after it, up to maxChars. 'page' can only select pages included in the text Hades shared.",
    inputSchema: z.object({
      page: z.number().int().min(1).max(100_000).optional().describe("Page to centre the text on. Default: the page open in Hades."),
      maxChars: z.number().int().min(200).max(50_000).optional().describe("Maximum characters to return. Default: 6000."),
    }).strict(),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async (args) => {
    try { return { content: [{ type: "text", text: asText(await bridge.readOpenPdf(args)) }] }; }
    catch (error) { return bridgeFailure(error); }
  });

  server.registerTool("get_study_stats", {
    title: "Get Hades study stats",
    description: "Read the weekly focus goal, hours focused this week, today's focus seconds, the Pomodoro cycle counter and the current session goal from the running Hades app (requires the live workspace bridge).",
    inputSchema: z.object({}).strict(),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async () => {
    try { return { content: [{ type: "text", text: asText(await bridge.getStudyStats()) }] }; }
    catch (error) { return bridgeFailure(error); }
  });

  server.registerTool("update_study_stats", {
    title: "Update Hades study stats",
    description: "Change the weekly focus goal, log extra focus minutes (adds to today's total and counts as one focus session), or set the current session goal in the running Hades app (requires the live workspace bridge). Nothing is deleted or reduced. Returns the new stats once Hades confirms.",
    inputSchema: z.object({
      weeklyGoalHours: z.number().min(1).max(100).optional(),
      logFocusMinutes: z.number().int().min(1).max(480).optional().describe("Minutes of focus to add to today."),
      goal: z.string().trim().min(1).max(200).optional().describe("Current session goal."),
    }).strict().refine(
      (value) => value.weeklyGoalHours !== undefined || value.logFocusMinutes !== undefined || value.goal !== undefined,
      "Provide at least one of weeklyGoalHours, logFocusMinutes or goal.",
    ),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, async (args) => {
    try {
      const { applied, stats } = await bridge.updateStudyStats(args);
      return { content: [{ type: "text", text: asText({ updated: true, applied, stats }) }] };
    } catch (error) { return bridgeFailure(error); }
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

  server.registerResource("schedule", "hades://schedule", {
    title: "Hades schedule",
    description: "Read-only upcoming events (next 14 days) and open tasks from the running Hades app (requires the live workspace bridge).",
    mimeType: "application/json",
  }, async (uri) => {
    const view = await bridge.readSnapshot().catch((error: unknown) => { throw new Error(bridgeFailureMessage(error)); });
    return { contents: [{ uri: uri.href, mimeType: "application/json", text: asText(buildSchedule(view, { limit: 200 }, Date.now())) }] };
  });

  server.registerResource("stats", "hades://stats", {
    title: "Hades study stats",
    description: "Read-only weekly goal, focus hours and Pomodoro cycle from the running Hades app (requires the live workspace bridge).",
    mimeType: "application/json",
  }, async (uri) => {
    const view = await bridge.readSnapshot().catch((error: unknown) => { throw new Error(bridgeFailureMessage(error)); });
    return { contents: [{ uri: uri.href, mimeType: "application/json", text: asText(buildStats(view)) }] };
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
