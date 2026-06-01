# CLAUDE.md — Hades Project Rules

Rules for every AI agent, automated tool, or contributor working on this codebase.

---

## 1. Version Control — NEVER commit or push without explicit user approval

**You must not run `git commit`, `git push`, or open / merge pull requests unless the user has explicitly said "commit this" or "push this" in the current session.**

- Preparing a commit message and showing a diff is fine.
- Staging files is fine.
- Actually committing or pushing is NOT fine without approval.

Why: The user reviews every change before it becomes part of the permanent record.

---

## 2. Multi-Platform Compatibility — NON-NEGOTIABLE

Hades ships on **Linux (AppImage)**, **macOS (DMG)**, and **Windows (MSI/EXE)**. Every change must be safe on all three platforms. A feature that works only on Linux is a bug.

### Rust — platform guards

All platform-specific code must use compile-time guards:

```rust
#[cfg(target_os = "linux")]   { /* Linux-only */ }
#[cfg(target_os = "macos")]   { /* macOS-only */ }
#[cfg(target_os = "windows")] { /* Windows-only */ }
```

Never use Linux-only syscalls, macOS-only APIs, or Windows registry calls outside their cfg block. Before adding a crate, verify it has no unsupported platforms.

### TypeScript — runtime detection

Use `hostPlatform()` from `src/lib/updater.ts` for runtime platform detection. Never hardcode platform-specific paths (`/home/`, `~/Library/`, `%APPDATA%`) or assume a file extension.

### The updater — three code paths, always maintained

`src/lib/updater.ts` + `src-tauri/src/lib.rs` each have three separate code paths. **All three must stay working after every change.**

| Platform | Asset selected | Install method |
|---|---|---|
| Linux | `.AppImage` | APPIMAGE env var → atomic rename in-place |
| macOS | `.dmg` | Write to temp dir → `open` command |
| Windows | `*-setup.exe` / `.msi` | Write to temp dir → spawn installer |

Rules for the updater specifically:
- `checkForUpdate()` must return `null` when no platform-matching asset exists. It must never fall through and return an asset for the wrong platform.
- `install_update` on Linux must check `APPIMAGE` env var first. `current_exe()` resolves into the read-only squashfs mount when running as AppImage and will fail.
- The post-install UI in `SettingsModal.tsx` is platform-aware: Linux shows "Restart to apply", macOS/Windows show a message guiding the user through the native installer.

### Linux display environment — do not remove

The following env vars are set in **both** `src-tauri/src/main.rs` (top of `main()`) and `src-tauri/src/lib.rs` (`run()` fallback). Do not remove either location.

```
GDK_BACKEND=x11
WEBKIT_DISABLE_COMPOSITING_MODE=1
WEBKIT_DISABLE_DMABUF_RENDERER=1
```

Why: Wayland support in WebKit2GTK is incomplete. Removing these causes blank windows or crashes on Wayland systems (including CachyOS, Ubuntu with Wayland, etc.). They must be set before GTK initialises, which is why `main.rs` sets them before calling `hades_lib::run()`.

### CI/CD — all three platforms must build

`.github/workflows/build.yml` runs builds on Linux, macOS, and Windows. Do not disable or remove any platform from the matrix. PRs run type-check + `cargo check`. Tag pushes produce release artifacts via `tauri-apps/tauri-action`.

---

## 3. Stability Rules

1. Every `#[tauri::command]` must return `Result<_, String>` and map all errors. Never panic inside a command.
2. Every `invoke()` call in React must be wrapped in try/catch; surface the error in the UI.
3. External calls (AI APIs, iCal feeds, GitHub releases API) must not block the UI indefinitely — always handle network failures gracefully (return `null`, show an error state, do not hang).
4. The Zustand store is persisted via `tauri-plugin-store`. Always handle missing or corrupt stored state gracefully at startup (use defaults, not panics or unhandled rejections).
5. React render errors are caught by the `ErrorBoundary` in `src/main.tsx` — do not remove it.

---

## 4. Code Quality

- No comments explaining WHAT the code does — only WHY for non-obvious invariants, hidden constraints, or workarounds (like the GTK env vars above).
- No features, refactors, or abstractions beyond what the task requires.
- Prefer editing existing files to creating new ones.
- No backwards-compatibility shims for code that was removed.
- No `console.log` or `eprintln!` left in production paths.

---

## 5. AppImage Build Workarounds (CachyOS / Arch / no fuse2)

`tauri build --bundles appimage` fails on systems without `libfuse2` because linuxdeploy is itself an AppImage that needs FUSE to run. The fix is applied via wrapper scripts:

- `~/.cache/tauri/linuxdeploy-x86_64.AppImage` — wrapper that sets `APPIMAGE_EXTRACT_AND_RUN=1 NO_STRIP=1` and calls `linuxdeploy-x86_64.real.AppImage`
- `~/.cache/tauri/linuxdeploy-plugin-appimage.AppImage` — wrapper that sets `APPIMAGE_EXTRACT_AND_RUN=1` and calls `linuxdeploy-plugin-appimage.real.AppImage`

`NO_STRIP=1` is required because the bundled `strip` in linuxdeploy is too old to handle Arch's `.relr.dyn` (RELR) ELF sections.

**To build the AppImage after `tauri build` at least once (which downloads the tools):**
```
npm run build:appimage
```
This runs `scripts/build-appimage.mjs` which drives linuxdeploy directly with the correct env vars and plugin setup.

**To install a local build to wofi:**
```
npm run build:install   # builds binary + deb/rpm, copies binary to ~/.local/bin/hades
```

**The desktop entry** (`~/.local/share/applications/hades.desktop`) already exists and sets the display env vars in the `Exec=` line. The icon is at `~/.local/share/icons/hicolor/128x128/apps/hades.png`.

---

## 6. Before Marking Any Task Complete

1. `cargo check` (in `src-tauri/`) passes without errors.
2. `npm run build` (TypeScript + Vite) passes without errors.
3. For UI changes: start the dev server (`npm run dev:app`) and confirm the feature works visually.
4. State explicitly which platforms were **tested** and which were only **code-reviewed**.
5. If the task touches the updater, the window/display setup, or any `#[cfg]` block — explicitly verify all three platform branches are intact and correct.
