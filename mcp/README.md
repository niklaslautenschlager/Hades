# Hades MCP server

This stdio MCP server connects an MCP client to Hades in two ways, both through the folder selected in **Hades → Settings → Sync**:

- **Notes**: it reads and writes Markdown files in the app's existing cloud-sync format; Hades imports changes during its next sync. This always works once sync is set up.
- **Live workspace (opt-in)**: when you turn on **Settings → Advanced → Share live workspace with MCP server**, the running app publishes a snapshot of your schedule, open notes, open PDF text and study stats into a hidden `.hades-bridge` folder inside the sync folder, and accepts one small whitelisted command (`update_study_stats`) from the server. See [Live workspace bridge](#live-workspace-bridge).

It does not connect to a made-up HTTP API or inspect browser storage.

## Requirements

- Node.js 20 or later
- Hades Cloud Sync enabled and configured to an existing local folder (the live workspace bridge only needs the folder to be set)
- An MCP client that supports a local stdio server

From this directory, install and build the server:

```sh
npm install
npm test
```

Configure your MCP client to launch `node` with the absolute path to `mcp/dist/src/index.js`, and set `HADES_SYNC_FOLDER` to the exact folder selected in Hades. Example configuration:

```json
{
  "mcpServers": {
    "hades": {
      "command": "node",
      "args": ["/absolute/path/to/Hades/mcp/dist/src/index.js"],
      "env": {
        "HADES_SYNC_FOLDER": "/absolute/path/to/your/HadesNotes"
      }
    }
  }
}
```

On Windows, use absolute paths with escaped backslashes, for example `C:\\Users\\you\\Dropbox\\HadesNotes`. Restart the MCP client after changing its configuration. The server writes protocol traffic only to stdout; startup and operation diagnostics go to stderr.

## Capabilities

### Tools

Notes (work from the sync folder alone):

- `list_notes`: list note metadata, with optional text search and a bounded result count.
- `read_note`: read the note body by stable Hades note ID.
- `create_note`: create a root-level note with Hades-compatible frontmatter.
- `update_note_content`: replace a note body while preserving its ID, name, folder, and tags.

Live workspace (need the bridge toggle on and the app open):

- `query_schedule` `{ from?, to?, include?, limit? }`: calendar events and open tasks. `from`/`to` are ISO-8601 dates or datetimes (a date-only `to` covers the whole day; values without an offset use Hades' time zone). Default window: now to 14 days ahead, plus every open task (no completed ones). With an explicit `from`/`to`, tasks are those due in the window, completed ones included, each with a `completed` flag. Tasks are sorted by due date, undated last. `include` is `["events"]`, `["tasks"]` or both; `limit` is 1-200 (default 50). Events carry ISO and local-time strings.
- `list_open_notes` `{}`: the notes open as editor tabs (id, name, active flag, updatedAt, length). No bodies.
- `read_open_note` `{ id? }`: the text of an open note as shown in the editor, default the active one. Notes are shared up to 20,000 characters each (`truncated` says so) and at most 20 notes.
- `read_open_pdf` `{ page?, maxChars? }`: extracted text of the PDF in the Notes PDF pane (`title`, `docId`, `currentPage`, `pageCount`, `text`, `truncated`). The text starts at the current page (or `page`) and continues until `maxChars` (200-50,000, default 6,000). Hades shares about 40,000 characters around the current page, so `page` can only pick pages inside that text; other pages return a `PAGE_NOT_AVAILABLE` error listing what is available. Scanned PDFs without a text layer return an empty `text` and a note.
- `get_study_stats` `{}`: weekly goal hours, hours focused this week, today's focus seconds, the Pomodoro cycle counter (`completedInCycle` of `cycleLength`, plus `sessionsToday`) and the current session goal. Day and week boundaries match the Statistics screen.
- `update_study_stats` `{ weeklyGoalHours?, logFocusMinutes?, goal? }`: set the weekly goal (1-100 hours), add 1-480 minutes of focus to today (counts as one focus session in the statistics), and/or set the session goal (up to 200 characters). It only adds or changes settings; nothing is deleted. Hades re-validates and clamps the values, applies them and acknowledges with the new stats.

All read tools return a `bridge` object with `generatedAt`, `ageSeconds` and `stale`.

### Resources

- `hades://notes`: read-only metadata index.
- `hades://notes/{noteId}`: read-only Markdown body for one note.
- `hades://schedule`: read-only upcoming events (next 14 days) and open tasks (live workspace bridge).
- `hades://stats`: read-only study stats (live workspace bridge).

### Prompts

- `summarize_note`: prepare a note for concise summarization.
- `quiz_note`: prepare a five-question study quiz.

Inputs use strict Zod schemas. Files are constrained to the configured sync folder; symbolic links and Hades' `_hades.json` manifest are excluded from traversal. Note writes use Hades' stable IDs and frontmatter fields. There is intentionally no delete operation because Hades propagates deletion using tombstones managed by its own store.

## Live workspace bridge

Hades keeps tasks, calendar events, open tabs, the PDF viewer and focus data in the app's own persisted state, which another process cannot read. The bridge is a small file protocol inside the sync folder that you opt into:

```
<sync folder>/.hades-bridge/
  state.json         snapshot written by Hades (schema version 1), replaced atomically
  inbox/<id>.json    commands written by this server, applied by Hades
  acks/<id>.json     results written by Hades, deleted by this server once read
```

The folder is dot-prefixed, so both Hades' note sync and this server's notes store ignore it.

**Turning it on.** In Hades open **Settings → Advanced → Share live workspace with MCP server (opt-in)**. It is off by default and unavailable until a sync folder is set. Turning it off, or changing the sync folder, deletes `state.json` from the old location. The setting shows the last update time or the error if Hades cannot write the folder.

**Privacy.** While enabled, Hades writes into the sync folder: events from the last 7 to the next 60 days (titles and times, no descriptions), open tasks and tasks completed in that range, the text of notes open as tabs, the extracted text of the open PDF, and your study stats. A cloud provider that syncs the folder may upload those files and share them with your other devices. Anyone who can write to that folder can also queue the one whitelisted command, which can only change the weekly goal, add focus minutes or set the session goal. Leave the toggle off if that is not acceptable. After quitting Hades the last snapshot stays on disk (and is reported as stale) until you turn the toggle off.

**Staleness.** Hades refreshes the snapshot within about 2 seconds of a change and at least every minute. If `state.json` is missing the tools fail with `BRIDGE_NOT_RUNNING` ("Hades bridge is not enabled or not running"). If `generatedAt` is more than 2 minutes old the data is still returned, but with `stale: true`, `ageSeconds` and a warning, because Hades may be closed. A malformed or wrong-version snapshot fails with `BRIDGE_SNAPSHOT_INVALID`.

**Updates.** `update_study_stats` writes a command that expires after 2 minutes and waits up to 10 seconds for Hades to acknowledge it. If nothing answers, the command is withdrawn and the tool fails with `BRIDGE_TIMEOUT` ("Hades did not acknowledge the update ..."). In the rare case that Hades applied it just as it was withdrawn, check `get_study_stats` before retrying. Hades polls the inbox every few seconds, so a successful call normally takes under 6 seconds.

**Configuration.** The bridge folder is `<HADES_SYNC_FOLDER>/.hades-bridge`. Set `HADES_BRIDGE_DIR` to an absolute path to use a different location (Hades only ever uses the sync folder, so this is for testing).

**Safety.** The server only opens files inside the bridge folder, refuses it if it, `inbox`, `acks` or `state.json` is a symbolic link, validates ids against `^[a-zA-Z0-9_-]{1,128}$`, caps file sizes and validates the snapshot against a strict schema. Error messages never contain file system paths.

## Scope and limitations

- Flashcards, decks and the full task and calendar history are not exposed, and the bridge never deletes anything. The only write is `update_study_stats`.
- Notes tools work from the sync folder only: Hades must be open with sync enabled to import MCP note edits into its in-app state, and Hades' sync reconciliation decides conflicts using note timestamps. Back up important notes before enabling automated edits.
- Live workspace tools need the toggle on and the app running. The snapshot is a point-in-time copy (see staleness above) and cloud providers may delay or conflict files, so prefer a local folder (for example Syncthing) over a slow remote drive.
- The snapshot omits calendar events outside -7/+60 days, caps events and tasks at 300 each and open notes at 20, and truncates long text as described above.
- Tested on Linux only so far. Paths use `node:path` and Hades' file plugin, but macOS and Windows behaviour is unverified.

No Hades AI credentials are needed or read by this server; it does not call any AI provider.
