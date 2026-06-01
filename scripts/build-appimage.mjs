#!/usr/bin/env node
// Builds a self-contained AppImage on Linux without requiring fuse2.
//
// Why this exists:
//   Tauri's AppImage bundler spawns linuxdeploy (itself an AppImage) without
//   setting APPIMAGE_EXTRACT_AND_RUN=1. On systems without libfuse2 (e.g.
//   CachyOS, Arch), that fails immediately. This script drives linuxdeploy
//   directly with the correct flags via wrapper scripts in ~/.cache/tauri/.
//
// Prerequisites (auto-created by `tauri build` at least once):
//   ~/.cache/tauri/linuxdeploy-x86_64.real.AppImage
//   ~/.cache/tauri/linuxdeploy-plugin-appimage.real.AppImage
//
// If the .real.AppImage files are missing, run:
//   npm run tauri build -- --bundles appimage   (it will fail, but it downloads
//   the tools; then run this script)

import { spawnSync } from "child_process";
import { existsSync, mkdirSync, symlinkSync, unlinkSync, readFileSync } from "fs";
import { tmpdir, homedir } from "os";
import { join, resolve } from "path";
import { fileURLToPath } from "url";

const ROOT    = resolve(fileURLToPath(import.meta.url), "../../");
const version = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
const APPDIR  = join(ROOT, "src-tauri/target/release/bundle/appimage/Hades.AppDir");
const OUTPUT  = join(ROOT, `src-tauri/target/release/bundle/appimage/Hades_${version}_amd64.AppImage`);
const CACHE  = join(homedir(), ".cache/tauri");

const linuxdeploy = join(CACHE, "linuxdeploy-x86_64.real.AppImage");
const plugin      = join(CACHE, "linuxdeploy-plugin-appimage.real.AppImage");

for (const f of [linuxdeploy, plugin]) {
  if (!existsSync(f)) {
    console.error(`Missing: ${f}`);
    console.error("Run: npm run tauri build -- --bundles appimage (it will fail but downloads tools)");
    process.exit(1);
  }
}

if (!existsSync(APPDIR)) {
  console.error(`AppDir not found: ${APPDIR}`);
  console.error("Run: npm run tauri build -- --bundles none  first");
  process.exit(1);
}

// Add lowercase hades.png symlink that appimagetool requires
const lcIcon = join(APPDIR, "hades.png");
const ucIcon = join(APPDIR, "Hades.png");
if (!existsSync(lcIcon) && existsSync(ucIcon)) {
  symlinkSync(ucIcon, lcIcon);
}

// Put plugin on PATH under the name linuxdeploy expects (no .AppImage extension)
const pluginDir = join(tmpdir(), `hades-appimage-plugin-${process.pid}`);
mkdirSync(pluginDir, { recursive: true });
const pluginLink = join(pluginDir, "linuxdeploy-plugin-appimage");
symlinkSync(plugin, pluginLink);

const env = {
  ...process.env,
  APPIMAGE_EXTRACT_AND_RUN: "1",
  NO_STRIP: "1",
  OUTPUT,
  PATH: `${pluginDir}:${process.env.PATH}`,
};

console.log("Running linuxdeploy…");
const result = spawnSync(linuxdeploy, ["--appdir", APPDIR, "--output", "appimage"], {
  env,
  stdio: "inherit",
});

// Cleanup
try { unlinkSync(pluginLink); } catch {}
try { require("fs").rmdirSync(pluginDir); } catch {}

if (result.status !== 0) {
  console.error("linuxdeploy failed");
  process.exit(result.status ?? 1);
}

console.log(`\nAppImage: ${OUTPUT}`);
