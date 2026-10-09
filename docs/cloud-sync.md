# Cloud Sync Setup

> Part of the [Hades documentation](README.md). See also: [Notes](notes.md) · [Troubleshooting](troubleshooting.md).

> **Beta.** Cloud Sync is currently in Beta. Please back up your local database/data before enabling or switching to cloud sync. Hades offers a **Back up now** button for this right in the confirmation dialog (see below).

Hades does not talk to any cloud API directly. Instead it writes your notes as `.md` files into a folder on your local disk. Your cloud provider's desktop client then syncs that folder to the cloud in the background. This means:

- **Any cloud storage that syncs a local folder works** — Google Drive, iCloud Drive, Dropbox, Nextcloud, Syncthing, OneDrive, etc.
- Your notes stay in plain Markdown. You can open them in any editor, Obsidian, or a file manager.
- Hades never sees your cloud credentials.

---

## How to enable

1. Open Hades → **Settings** (gear icon, bottom-left)
2. Scroll to **Cloud Sync**
3. Toggle **Enable cloud sync** on. A confirmation dialog repeats the Beta notice. Click **Back up now** to save your notes and app data (API keys are left out) as a JSON file, then **I have a backup — continue**. **Cancel** changes nothing.
4. Click the folder picker and select your sync folder (see provider-specific paths below). Picking a *different* folder later asks for the same confirmation, because Hades merges your notes with whatever is already in that folder.
5. Click **Sync now** for the first full upload

Once enabled, Hades syncs **automatically about every 30 seconds** while it's open — pulling in changes from your other devices *and* pushing your local edits. It also syncs on startup. If you close the app with unsynced changes a small "Saving…" bar appears at the bottom — you can cancel it and quit immediately if needed.
Dropbox is strongly recommended, since it works on almost all Platforms.

### What the status line tells you

Under the folder picker, Settings shows whether Hades is syncing, when it last synced, how many changes are waiting, and — when something is wrong — why and when it will retry.

---

## How conflicts and deletions are handled

- **Two devices edit the same note.** Hades compares each note with the version both sides last agreed on. If only one side changed, that change wins. If both changed and the text differs, the newer edit becomes the note and the other version is **kept as a separate note named "… (conflict copy …)"**. Nothing is silently overwritten — review the copy and delete whichever you don't need.
- **Edits while a sync is running** are never lost. If you type during a sync, Hades notices and syncs those edits on the next pass.
- **Deletions** travel as explicit deletion records. A note that is merely missing from the sync folder is *not* treated as deleted — it may not have finished downloading yet — so Hades re-uploads it instead. Editing a note on one device after it was deleted on another brings it back. Edits you have made but not yet synced are kept too, even if another device deleted the note in the meantime.
- **A note is only ever changed or removed in the sync folder when Hades can match the file to a note it knows.** Files it doesn't recognise, and anything whose name starts with a dot (such as `.hades-bridge`), are left alone.

## If the sync folder is unavailable

If the folder is missing, unmounted, or unreadable — an unplugged drive, a cloud app that isn't running — Hades marks sync as **Offline**, changes nothing on your device, and retries automatically with a growing delay (30 s up to 10 min). **Retry now** tries immediately. Your notes stay safe on your device and sync when the folder is back. If the folder suddenly looks empty although this device has synced to it before, Hades assumes it is unavailable rather than assuming you emptied it, and does not delete anything.

Files are written to a temporary `hades-tmp-*.tmp` file first and then renamed into place, so a crash or a dropped connection never leaves a half-written note.

---

## Dropbox (Recommended)

### Linux

```bash
# Download the official daemon
cd ~ && wget -O - "https://www.dropbox.com/download?plat=lnx.x86_64" | tar xzf -
~/.dropbox-dist/dropboxd &
# Follow the browser link that appears to link your account
```

For a tray icon, install the `dropbox` package from AUR:
```bash
yay -S dropbox
```

Default sync folder: `~/Dropbox/`

### macOS / Windows

Download from [dropbox.com/install](https://www.dropbox.com/install).

| Platform | Default sync folder |
|----------|-------------------|
| macOS    | `~/Dropbox/` |
| Windows  | `C:\Users\<you>\Dropbox\` |

**Path to use in Hades:** `~/Dropbox/HadesNotes`

---

## Google Drive

### Linux

Google Drive has no official Linux desktop client. The recommended approach is **rclone**.

**Install rclone:**
```bash
# Arch / CachyOS
sudo pacman -S rclone

# Debian / Ubuntu
sudo apt install rclone
```

**Configure:**
```bash
rclone config
# → New remote → name it "gdrive" → type: drive → follow OAuth prompts
```

**Mount at startup (systemd user service):**
```bash
mkdir -p ~/GoogleDrive
# Create ~/.config/systemd/user/rclone-gdrive.service
```

```ini
[Unit]
Description=rclone Google Drive mount
After=network-online.target

[Service]
Type=notify
ExecStart=rclone mount gdrive: %h/GoogleDrive \
  --vfs-cache-mode writes \
  --vfs-cache-max-size 512M \
  --dir-cache-time 1h
ExecStop=/bin/fusermount -u %h/GoogleDrive
Restart=on-failure

[Install]
WantedBy=default.target
```

```bash
systemctl --user enable --now rclone-gdrive.service
```

**Path to use in Hades:** `~/GoogleDrive/HadesNotes`

---

### macOS

Install [Google Drive for Desktop](https://www.google.com/drive/download/).

After signing in, your Drive appears at:
```
/Users/<you>/Library/CloudStorage/GoogleDrive-<your@email.com>/My Drive/
```

> On older versions of the app the path is `~/Google Drive/My Drive/`.

**Path to use in Hades:** `~/Library/CloudStorage/GoogleDrive-<your@email>/My Drive/HadesNotes`

---

### Windows

Install [Google Drive for Desktop](https://www.google.com/drive/download/).

After signing in it mounts as a drive letter (default **G:**):
```
G:\My Drive\
```

**Path to use in Hades:** `G:\My Drive\HadesNotes`

---

## iCloud Drive

### Linux

Apple provides no official Linux client. The recommended tool is **rclone** with iCloud support (added in rclone v1.67+).

```bash
rclone config
# → New remote → type: iclouddrive → follow the prompts
# You will need your Apple ID and an app-specific password
# (generate at appleid.apple.com → Security → App-Specific Passwords)
```

```bash
mkdir -p ~/iCloudDrive
# Add to your rclone systemd service (same pattern as Google Drive above)
# ExecStart=rclone mount icloud: %h/iCloudDrive --vfs-cache-mode writes
```

**Path to use in Hades:** `~/iCloudDrive/HadesNotes`

---

### macOS

iCloud Drive is built in. No installation needed.

The actual filesystem path (usable in Hades' folder picker) is:
```
~/Library/Mobile Documents/com~apple~CloudDocs/
```

> In Finder this shows as **iCloud Drive**. You can navigate there with `⌘+Shift+G` and paste the path above.

**Path to use in Hades:** `~/Library/Mobile Documents/com~apple~CloudDocs/HadesNotes`

---

### Windows

Install [iCloud for Windows](https://apps.microsoft.com/detail/9PKTQ5699M62) from the Microsoft Store.

After signing in, iCloud Drive appears at:
```
C:\Users\<you>\iCloudDrive\
```

**Path to use in Hades:** `C:\Users\<you>\iCloudDrive\HadesNotes`

---

## Nextcloud

Nextcloud works identically on all platforms — install the desktop client and it creates a local sync folder.

### All platforms

1. Download the [Nextcloud Desktop Client](https://nextcloud.com/install/#install-clients)
2. Sign in to your Nextcloud server
3. Choose a local sync folder (default shown below) or keep the default

| Platform | Default sync folder |
|----------|-------------------|
| Linux    | `~/Nextcloud/` |
| macOS    | `~/Nextcloud/` |
| Windows  | `C:\Users\<you>\Nextcloud\` |

**Linux install (Arch / CachyOS):**
```bash
sudo pacman -S nextcloud-client
# or via Flatpak:
flatpak install flathub com.nextcloud.desktopclient.nextcloud
```

**Path to use in Hades:** `~/Nextcloud/HadesNotes` (or equivalent for Windows)

---

## Syncthing

Syncthing is peer-to-peer (no cloud server needed) and is especially well-suited to Linux. You define the sync folder yourself.

### Linux

```bash
# Arch / CachyOS
sudo pacman -S syncthing

# Enable as a user service
systemctl --user enable --now syncthing

# Open web UI
xdg-open http://127.0.0.1:8384
```

In the web UI:
1. **Add Folder** → set **Folder Path** to e.g. `~/Sync/HadesNotes`
2. Add your other devices and share the folder with them

**Path to use in Hades:** whatever you set as the Folder Path (e.g. `~/Sync/HadesNotes`)

### macOS

```bash
brew install syncthing
brew services start syncthing
# Open http://127.0.0.1:8384
```

### Windows

Download the installer from [syncthing.net/downloads](https://syncthing.net/downloads/) or install [SyncTrayzor](https://github.com/canton7/SyncTrayzor/releases) for a tray-based GUI.

---


## OneDrive

### Linux

Use [onedrive](https://github.com/abraunegg/onedrive) (the unofficial open-source client):

```bash
# Arch / CachyOS
sudo pacman -S onedrive-abraunegg

# Authenticate
onedrive --synchronize
# Then run as a service
systemctl --user enable --now onedrive
```

Default sync folder: `~/OneDrive/`

### macOS / Windows

OneDrive is pre-installed on Windows and available on macOS from the [Mac App Store](https://apps.apple.com/app/onedrive/id823766827).

| Platform | Default sync folder |
|----------|-------------------|
| macOS    | `~/OneDrive/` |
| Windows  | `C:\Users\<you>\OneDrive\` |

**Path to use in Hades:** `~/OneDrive/HadesNotes`

---

## Troubleshooting

**"Sync failed" in the save overlay**
- Check that the sync folder still exists and is writable
- Make sure your cloud client is running and not paused
- Click **Sync now** in Settings to retry manually

**Notes not appearing on the second device**
- Wait for the cloud client to finish uploading (check its tray icon)
- Open Hades on the second device — startup sync runs automatically
- If notes still don't appear, click **Sync now** in Settings

**"Offline: sync folder unavailable"**
- Check that the drive is connected and your cloud client is running and not paused
- Hades retries on its own; click **Retry now** to try immediately

**Stale / duplicate files in the sync folder**
When a note is renamed or moved, Hades writes the file to its new path and removes the superseded copy it recognises by `id`. Files it can't attribute to a note are never touched, so you can safely delete any leftovers in your file manager — Hades identifies notes by the `id` field in their frontmatter, not by filename.

**A "(conflict copy …)" note appeared**
Two devices changed the same note at the same time. Compare the two notes, keep what you need, and delete the other.

**File format**
Each note is a plain `.md` file with a small YAML header:
```markdown
---
id: abc123
name: Ownership in Rust
parentId:
tags: rust,programming
createdAt: 2024-01-15T10:30:00.000Z
updatedAt: 2024-01-20T14:22:00.000Z
device: 3f9a1c
---

Your note content here.
```
You can open, edit, and read these files with any text editor or Obsidian — they are fully compatible.
