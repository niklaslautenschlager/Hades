import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { makeSnapshot, simulateApp, withTempDir, writeSnapshot } from "./fixtures.js";

const serverEntry = fileURLToPath(new URL("../src/index.js", import.meta.url));

class Client {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, (message: any) => void>();
  private buffer = "";
  private nextId = 1;

  constructor(env: Record<string, string>) {
    this.child = spawn(process.execPath, [serverEntry], { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"] });
    this.child.stderr.resume();
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => {
      this.buffer += chunk;
      for (let newline = this.buffer.indexOf("\n"); newline >= 0; newline = this.buffer.indexOf("\n")) {
        const line = this.buffer.slice(0, newline);
        this.buffer = this.buffer.slice(newline + 1);
        if (!line.trim()) continue;
        const message = JSON.parse(line);
        this.pending.get(message.id)?.(message);
      }
    });
  }

  request(method: string, params?: unknown): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${method}`)), 8_000);
      this.pending.set(id, (message) => { clearTimeout(timer); this.pending.delete(id); resolve(message); });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  async start(): Promise<void> {
    const init = await this.request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } });
    assert.equal(init.result.serverInfo.name, "hades");
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  }

  async call(name: string, args: unknown): Promise<{ isError?: boolean; text: string }> {
    const reply = await this.request("tools/call", { name, arguments: args });
    return { isError: reply.result.isError, text: reply.result.content[0].text };
  }

  async close(): Promise<void> {
    const exited = new Promise<void>((resolve) => this.child.once("exit", () => resolve()));
    this.child.stdin.end();
    this.child.kill();
    await exited;
  }
}

async function withServer(run: (client: Client, bridgeDir: string) => Promise<void>): Promise<void> {
  await withTempDir(async (root) => {
    const bridgeDir = path.join(root, ".hades-bridge");
    await writeSnapshot(bridgeDir, makeSnapshot({}, new Date().toISOString()));
    const client = new Client({ HADES_SYNC_FOLDER: root });
    try {
      await client.start();
      await run(client, bridgeDir);
    } finally { await client.close(); }
  });
}

test("advertises the workspace tools with strict schemas and honest annotations", async () => {
  await withServer(async (client) => {
    const { result } = await client.request("tools/list");
    const tools = new Map<string, any>(result.tools.map((tool: any) => [tool.name, tool]));
    for (const existing of ["list_notes", "read_note", "create_note", "update_note_content"]) assert.ok(tools.has(existing), existing);

    const readOnly = ["query_schedule", "list_open_notes", "read_open_note", "read_open_pdf", "get_study_stats"];
    for (const name of readOnly) {
      assert.deepEqual(tools.get(name).annotations, { readOnlyHint: true, openWorldHint: false }, name);
      assert.equal(tools.get(name).inputSchema.additionalProperties, false, name);
    }
    assert.deepEqual(tools.get("update_study_stats").annotations, { readOnlyHint: false, destructiveHint: false, openWorldHint: false });
    assert.equal(tools.get("update_study_stats").inputSchema.additionalProperties, false);
    assert.deepEqual(Object.keys(tools.get("update_study_stats").inputSchema.properties).sort(), ["goal", "logFocusMinutes", "weeklyGoalHours"]);
    assert.deepEqual(Object.keys(tools.get("query_schedule").inputSchema.properties).sort(), ["from", "include", "limit", "to"]);
    assert.deepEqual(Object.keys(tools.get("read_open_pdf").inputSchema.properties).sort(), ["maxChars", "page"]);

    const resources = await client.request("resources/list");
    const uris = resources.result.resources.map((resource: any) => resource.uri);
    assert.ok(uris.includes("hades://schedule") && uris.includes("hades://stats") && uris.includes("hades://notes"));
  });
});

test("serves snapshot data through the tools and resources", async () => {
  await withServer(async (client) => {
    const stats = JSON.parse((await client.call("get_study_stats", {})).text);
    assert.equal(stats.weeklyGoalHours, 20);
    assert.equal(stats.bridge.stale, false);

    const notes = JSON.parse((await client.call("list_open_notes", {})).text);
    assert.deepEqual(notes.notes.map((note: any) => note.id), ["n1", "n2"]);

    const note = JSON.parse((await client.call("read_open_note", {})).text);
    assert.equal(note.name, "Physics");

    const pdf = JSON.parse((await client.call("read_open_pdf", { page: 6, maxChars: 400 })).text);
    assert.ok(pdf.text.includes("[Page 6]"));

    const resource = await client.request("resources/read", { uri: "hades://stats" });
    assert.equal(JSON.parse(resource.result.contents[0].text).goal, "Finish chapter 3");
  });
});

test("rejects invalid tool arguments before touching the bridge", async () => {
  await withServer(async (client, bridgeDir) => {
    const bad: [string, unknown][] = [
      ["update_study_stats", {}],
      ["update_study_stats", { logFocusMinutes: 0 }],
      ["update_study_stats", { logFocusMinutes: 481 }],
      ["update_study_stats", { logFocusMinutes: 1.5 }],
      ["update_study_stats", { weeklyGoalHours: 0 }],
      ["update_study_stats", { weeklyGoalHours: 101 }],
      ["update_study_stats", { goal: "x".repeat(201) }],
      ["update_study_stats", { goal: "   " }],
      ["update_study_stats", { goal: "ok", delete: true }],
      ["query_schedule", { from: "yesterday" }],
      ["query_schedule", { limit: 201 }],
      ["query_schedule", { include: [] }],
      ["query_schedule", { include: ["flashcards"] }],
      ["read_open_note", { id: "../../etc/passwd" }],
      ["read_open_pdf", { page: 0 }],
      ["get_study_stats", { extra: 1 }],
    ];
    for (const [name, args] of bad) {
      const reply = await client.call(name, args);
      assert.equal(reply.isError, true, `${name} ${JSON.stringify(args)}`);
    }
    const { readdir } = await import("node:fs/promises");
    await assert.rejects(readdir(path.join(bridgeDir, "inbox")), { code: "ENOENT" });
  });
});

test("update_study_stats works end to end against a simulated Hades app", async () => {
  await withServer(async (client, bridgeDir) => {
    const stats = { ...makeSnapshot().stats, weeklyGoalHours: 12, goal: "Chapter 4" };
    const app = simulateApp(bridgeDir, () => ({ ok: true, applied: { weeklyGoalHours: 12, goal: "Chapter 4" }, stats }));
    try {
      const reply = await client.call("update_study_stats", { weeklyGoalHours: 12, goal: "  Chapter 4  " });
      assert.equal(reply.isError, undefined);
      const body = JSON.parse(reply.text);
      assert.equal(body.updated, true);
      assert.equal(body.stats.weeklyGoalHours, 12);
    } finally { await app.stop(); }
    assert.deepEqual(app.seen[0].args, { weeklyGoalHours: 12, goal: "Chapter 4" }, "the goal is trimmed before it is queued");
  });
});

test("reports a missing bridge as a tool error without leaking the folder", async () => {
  await withTempDir(async (root) => {
    const client = new Client({ HADES_SYNC_FOLDER: root });
    try {
      await client.start();
      const reply = await client.call("query_schedule", {});
      assert.equal(reply.isError, true);
      assert.match(reply.text, /BRIDGE_NOT_RUNNING/);
      assert.ok(!reply.text.includes(root));
    } finally { await client.close(); }
  });
});
