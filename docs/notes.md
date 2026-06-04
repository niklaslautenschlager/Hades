# Notes

**What it does:** The Notes module is a full Markdown editor with folders, tags, note-to-note links, a side-by-side PDF viewer, a built-in calculator, and import/export. Your notes are saved automatically and can be mirrored to the cloud.

**Why use it:** Keep your study notes right next to your timer and tasks — no second app, no browser tabs. Notes are plain Markdown, so they stay readable and portable forever.

It's the **Notes** icon (document) in the sidebar.

---

## Layout

- **Left:** a collapsible **file tree** of your folders and notes.
- **Center:** the **editor** for the selected note.
- **Right (optional):** a **PDF viewer** and a **Markdown preview**, which you can toggle on and off.

A starter note, **"Welcome to Hades,"** is there the first time you open the app.

The sidebar has two tabs at the top:

- **Files** — your folder/note tree (the default).
- **Library** — your imported PDFs and books (see [PDF Library](#pdf-library)).

---

## Note tabs

**Why:** Keep several notes open at once and jump between them — like browser tabs — instead of losing your place every time you open another note.

- **Open a note** from the file tree → it opens in a tab and becomes active.
- **Switch** notes by clicking their tab.
- **Close a tab** with the **×** on the tab (hover to reveal it on inactive tabs). Closing the active tab moves you to a neighbouring one.
- **Your open tabs are remembered** across restarts.

> Closing a tab **never** collapses folders you've opened in the file tree — the tree's expanded/collapsed state is independent of your tabs.

---

## Writing notes

Hades uses **Markdown** — plain text with light formatting marks. A quick cheat sheet:

```markdown
# Heading 1
## Heading 2

**bold**   *italic*   `inline code`

- bullet list
1. numbered list

> a blockquote

[link text](https://example.com)

​```js
console.log("fenced code block");
​```
```

### Live Markdown preview

Toggle the **preview panel** from the toolbar to see your note rendered as formatted text next to the raw Markdown. Useful for checking tables, headings, and links.

### Vim mode

Prefer Vim keybindings? Toggle **Vim mode** in the editor toolbar. You get Normal/Insert modes and the usual motions, powered by CodeMirror. Toggle it off to return to standard editing.

### Zoom the editor text

| Shortcut | Action |
|----------|--------|
| **Ctrl/Cmd + =** (or **+**) | Zoom in |
| **Ctrl/Cmd + −** | Zoom out |
| **Ctrl/Cmd + 0** | Reset zoom |

---

## Organizing with folders

**Create a note or folder** from the file-tree controls at the top of the sidebar.

> **Smart nesting:** New notes and folders are created **inside the folder you're currently working in**, not dumped at the root. If you're editing a note inside *Biology*, a new note lands in *Biology* too.

**Other folder actions:**

- **Rename:** double-click a name, type, press **Enter** (or **Escape** to cancel).
- **Move:** drag a note or folder onto another folder.
- **Expand/collapse:** click a folder. **Your open/closed folders are remembered across restarts.**
- **Delete:** deleting a folder also deletes everything inside it.

> ⚠️ **Deleting is permanent.** There is no trash/undo for deleted notes. If you use [Cloud Sync](cloud-sync.md), the matching file in your sync folder is **not** auto-deleted — you can recover content from there.

---

## Tags

**Why:** Tags let you group notes across folders — e.g. tag both a lecture note and a lab note with `exam-prep`.

- **Add a tag:** use the tag input on a note, type a tag, press **Enter**.
- **Search by tag:** tags are color-coded and searchable, so clicking or searching a tag surfaces every note that carries it.

---

## Linking notes together

Connect related notes with double-bracket syntax:

```markdown
See also [[Cellular Respiration]] for the energy cycle.
```

`[[Note Name]]` creates a link to the note with that name — the same idea as a wiki or Obsidian vault. Great for building a connected web of study notes.

---

## PDF viewer

**Why:** Read a lecture PDF or paper side-by-side with your notes, without leaving Hades.

1. Toggle the **PDF panel** from the toolbar.
2. Load a PDF in either way:
   - **Drag and drop** a PDF file onto the panel, **or**
   - **Paste a URL** to a PDF and load it from the web.
3. **Resize** the panel by dragging its divider.

---

## PDF Library

**What it does:** A dedicated shelf for your PDFs and books, separate from your notes. Hades reads each PDF's metadata (title, author, page count) on import and keeps your own copy of the file, so the library stays intact even if you move or delete the original.

**Why:** Keep your reading material organized in one place and open any item straight into the [PDF viewer](#pdf-viewer) for side-by-side study.

### Add PDFs

1. In the Notes sidebar, switch to the **Library** tab.
2. Click the **+** button and pick one or more `.pdf` files.
3. Hades copies each file into its own storage and pulls out the **title, author, and page count** automatically.

> **Where files live:** Imported PDFs are copied into Hades' app-data folder, so the library is self-contained. Removing the original file from your Downloads (etc.) won't break the library entry.

### Read and manage

- **Open** — click any item to load it into the [PDF viewer](#pdf-viewer) on the right.
- **Remove** — hover an item and click the trash icon. This deletes Hades' stored copy (your original file, if any, is untouched).

> **Metadata is best-effort.** If a PDF has no embedded title/author (many scanned files don't), Hades falls back to a cleaned-up version of the filename and simply omits the fields it can't read.

---

## The calculator

A **scientific calculator** is built into the Notes toolbar (the calculator icon) — handy for quick math while studying.

- Supports `+ − × ÷`, parentheses, powers (`x²`, `xʸ`), square root (`√`), and constants **π** and **e**.
- Functions: `sin`, `cos`, `tan` (plus `asin/acos/atan`, hyperbolics), `ln`, `log`, `sqrt`, `cbrt`.
- **`ans`** reuses your previous answer.
- Press **Enter** to evaluate, **Escape** to close.

**Example:** `sqrt(2) * sin(pi/4)` → `1`

---

## Import and export

### Import an Obsidian vault (or any folder of Markdown)

**Why:** Bring your existing notes into Hades without retyping them.

1. Use the **import** action in the Notes toolbar.
2. Pick the folder (e.g. your Obsidian vault) in the native file picker.
3. Hades imports the `.md` files **and preserves your folder structure**.

### Export your notes

Export the current note to:

- **Markdown (`.md`)** — portable plain text, opens anywhere.
- **HTML** — a formatted, self-contained web page.

You'll choose a save location in the native dialog.

---

## Saving and syncing

- **Local save is automatic** — keep typing; Hades persists your work continuously.
- **Cloud sync is optional.** Turn it on to mirror notes as `.md` files into a folder synced by Dropbox, iCloud, Google Drive, Syncthing, etc. — and read them on another computer. Full guide: **[Cloud Sync Setup](cloud-sync.md)**.

---

## Troubleshooting

**My folder collapsed/expanded state reset.**
Open/closed state is saved per folder. If it resets, the stored state may have been cleared — re-expand and it'll stick again.

**A dragged note didn't move.**
Drop it directly **onto a folder** row. Dropping into empty space doesn't re-parent it.

**Imported notes lost their tags.**
Import brings in note **content and folder structure**; inline tags inside the text are preserved as text, but Hades' tag field starts empty for imported notes. Re-tag as needed.

**A PDF from a URL won't load.**
The link must point **directly** to a `.pdf` file and be reachable without a login. Pages that require sign-in or that wrap the PDF in a viewer won't load — download the file and drag it in instead.
