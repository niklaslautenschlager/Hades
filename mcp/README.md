# Hades MCP server

This stdio MCP server exposes Hades notes through the app's existing cloud-sync format. It reads and writes Markdown files in the folder selected in **Hades → Settings → Cloud Sync**; Hades imports changes during its next sync. It does not connect to a made-up HTTP API or inspect browser storage.

## Requirements

- Node.js 20 or later
- Hades Cloud Sync enabled and configured to an existing local folder
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

- `list_notes`: list note metadata, with optional text search and a bounded result count.
- `read_note`: read the note body by stable Hades note ID.
- `create_note`: create a root-level note with Hades-compatible frontmatter.
- `update_note_content`: replace a note body while preserving its ID, name, folder, and tags.

### Resources

- `hades://notes`: read-only metadata index.
- `hades://notes/{noteId}`: read-only Markdown body for one note.

### Prompts

- `summarize_note`: prepare a note for concise summarization.
- `quiz_note`: prepare a five-question study quiz.

Inputs use strict Zod schemas. Files are constrained to the configured sync folder; symbolic links and Hades' `_hades.json` manifest are excluded from traversal. Note writes use Hades' stable IDs and frontmatter fields. There is intentionally no delete operation because Hades propagates deletion using tombstones managed by its own store.

## Scope and limitations

Hades currently stores tasks, calendar events, flashcards, and focus data in the Tauri webview's persisted Zustand store. It has no external API for those features, so this server does not claim to read or change them. The MCP process is a file-backed notes bridge: it requires the same cloud-sync directory configured in Hades, and Hades must be open with sync enabled to import MCP edits into its in-app state. Hades' sync reconciliation decides conflict resolution using note timestamps. Back up important notes before enabling automated edits.

No Hades AI credentials are needed or read by this server; it does not call any AI provider.
