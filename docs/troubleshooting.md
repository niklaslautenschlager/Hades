# Troubleshooting

Fixes for the most common problems, grouped by area. If your issue isn't here, see the [escape hatch](#still-stuck) at the bottom.

---

## Installing & launching

### macOS: "Hades cannot be opened" / "is damaged"

Hades is **ad-hoc signed but not notarized by Apple** (it's a free, non-commercial project), so Gatekeeper may block the first launch. Clear the download quarantine **once**:

```bash
xattr -dr com.apple.quarantine /Applications/Hades.app
```

Then open Hades normally. This works on both Apple Silicon and Intel Macs — the release is a universal binary.

### Linux: blank window, white screen, or crash on launch

This is almost always **Wayland** + the WebKit web engine. Launch with the X11 backend and DMA-BUF rendering disabled:

```bash
GDK_BACKEND=x11 WEBKIT_DISABLE_COMPOSITING_MODE=1 WEBKIT_DISABLE_DMABUF_RENDERER=1 ./Hades_*.AppImage
```

The packaged AppImage and its installed desktop entry set these automatically — you only need this if you launch Hades from your own script or command line.

### Linux: AppImage won't run

- Make it executable: `chmod +x Hades_*.AppImage`.
- If you get a FUSE error, your system may lack `libfuse2`. Either install it, or run the AppImage with extraction: `./Hades_*.AppImage --appimage-extract-and-run`.

---

## AI Study Assistant

| Message | Cause & fix |
|---------|-------------|
| **"No API key configured…"** | Add a key for the selected vendor in **Settings → AI Vendor**. |
| **"Invalid API key" (401)** | Key is wrong/expired — re-copy from the provider and re-paste. |
| **"Connection failed (403)"** | Often a **VPN** blocking the provider. Disable it and retry; also re-check the key. |
| **"Rate limit reached" (429)** | You hit the provider's limit. Wait, or switch model/vendor. |
| **"Cannot reach Ollama"** | Start Ollama (`ollama serve`) and confirm it's on port `11434`. |

More detail: [AI Study Assistant → Troubleshooting](ai-assistant.md#troubleshooting).

---

## Cloud Sync

### Notes aren't appearing on my second device

1. Wait for your **cloud client** (Dropbox, Syncthing, etc.) to finish uploading on the first device — check its tray icon.
2. On the second device, open Hades — it syncs on startup. Or click **Sync now** in Settings.
3. Confirm **both** devices point at the **same synced folder**.

### "Sync failed" message

- The sync folder must still **exist** and be **writable**.
- Your cloud client must be **running** and not paused.
- Click **Sync now** to retry.

### Duplicate or stale `.md` files in my sync folder

When you rename or move a note, Hades writes the new file but **does not delete the old one** (to avoid accidental data loss). You can safely delete leftover files in your file manager — Hades identifies notes by the `id` in their frontmatter, not the filename.

Full guide and per-provider setup: **[Cloud Sync Setup](cloud-sync.md)**.

> **Note on timing:** Hades auto-syncs roughly **every 30 seconds** while open (some older text in the app/docs says "5 minutes" — the current behavior is ~30 seconds, bidirectional).

---

## Notes

- **Deleted a note by accident?** There's no in-app undo. If Cloud Sync is on, recover the file from your sync folder. See [Notes](notes.md#organizing-with-folders).
- **A dragged note didn't move** — drop it directly onto a folder row.
- **A PDF URL won't load** — the link must point straight to a `.pdf` and not require a login. Download and drag it in instead. See [Notes → PDF viewer](notes.md#pdf-viewer).

---

## Calendar & Tasks

- **iCal feed not showing** — confirm it's a public, raw `.ics` URL and the feed is enabled. See [Calendar](calendar.md#troubleshooting).
- **Deadline didn't become a task** — enable **Auto-sync deadlines to Tasks** in Settings and toggle **Deadline** on the event.
- **A "cleared" task keeps returning** — it's a calendar-deadline task; remove the deadline on the event. See [Tasks](tasks.md#troubleshooting).

---

## Focus Timer & Statistics

- **Focus time not recorded** — only **completed work sessions** count; breaks and reset/skipped intervals don't.
- **No sound** — check **Settings → Sound** isn't **None** and volume isn't 0%.
- **Streak reset** — a streak needs one completed work session each day.

See [Focus Timer](focus-timer.md#troubleshooting) and [Statistics](statistics.md#troubleshooting).

---

## Updates

- **"Install update" fails on Linux** — only the **AppImage** updates in place. If you installed via a package, update through that.
- **Update offered the wrong file?** It won't — Hades only offers the asset matching your OS. If none exists for a release, it reports "up to date."

See [Settings & Themes → Updates](settings-and-themes.md#updates).

---

## Resetting Hades

If the app gets into a bad state, you can clear its saved data. **This erases your local notes, tasks, events, decks, and stats** — so if Cloud Sync is on, make sure your notes are safely in the sync folder first.

Hades stores its data in your OS's standard application-data location for the app. Removing that data directory resets Hades to a fresh state on next launch.

---

## Still stuck?

- **Search or open an issue:** [GitHub Issues](https://github.com/niklaslautenschlager/Hades/issues). Include your **OS**, the **Hades version** (shown by the update checker / in releases), and the **exact steps** to reproduce.
- **Documentation wrong or outdated?** It lives alongside the code — corrections via pull request are welcome.
- **Remember:** Hades is early software. Back up anything important and don't treat it as your only copy of critical data.
