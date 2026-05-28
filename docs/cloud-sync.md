# Cloud Sync Setup

Hades does not talk to any cloud API directly. Instead it writes your notes as `.md` files into a folder on your local disk. Your cloud provider's desktop client then syncs that folder to the cloud in the background. This means:

- **Any cloud storage that syncs a local folder works** — Google Drive, iCloud Drive, Dropbox, Nextcloud, Syncthing, OneDrive, etc.
- Your notes stay in plain Markdown. You can open them in any editor, Obsidian, or a file manager.
- Hades never sees your cloud credentials.

---

## How to enable

1. Open Hades → **Settings** (gear icon, bottom-left)
2. Scroll to **Cloud Sync**
3. Toggle **Enable cloud sync** on
4. Click the folder picker and select your sync folder (see provider-specific paths below)
5. Click **Sync now** for the first full upload

Hades will auto-save every **5 minutes** when changes exist. If you close the app with unsaved changes a small "Saving…" bar appears at the bottom — you can cancel it and quit immediately if needed.

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

## Dropbox

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

**Stale / duplicate files in the sync folder**
When a note is renamed or moved, Hades writes the file to the new path but leaves the old file in place (no deletions, to prevent accidental data loss). You can safely delete old files from the sync folder in your file manager — Hades identifies notes by the `id` field in their frontmatter, not by filename.

**File format**
Each note is a plain `.md` file with a small YAML header:
```markdown
---
id: abc123
tags: rust,programming
createdAt: 2024-01-15T10:30:00.000Z
updatedAt: 2024-01-20T14:22:00.000Z
---

Your note content here.
```
You can open, edit, and read these files with any text editor or Obsidian — they are fully compatible.
