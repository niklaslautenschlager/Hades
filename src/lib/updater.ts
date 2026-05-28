import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";

const RELEASES_URL =
  "https://api.github.com/repos/niklaslautenschlager/Hades/releases/latest";

export interface UpdateInfo {
  version: string;   // e.g. "0.2.0"
  changelog: string; // release body (markdown)
  downloadUrl: string;
}

// Simple semver comparison — strips pre-release suffix before comparing
function parseVer(v: string): number[] {
  return v
    .replace(/^v/, "")
    .split("-")[0]
    .split(".")
    .map(n => parseInt(n, 10) || 0);
}

function isNewer(latest: string, current: string): boolean {
  const a = parseVer(latest);
  const b = parseVer(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  const current = await getVersion();

  const res = await fetch(RELEASES_URL, {
    headers: { "User-Agent": "HadesApp/1.0" },
  });
  if (!res.ok) return null;

  const data = (await res.json()) as {
    tag_name: string;
    body: string;
    assets: { name: string; browser_download_url: string }[];
  };

  if (!isNewer(data.tag_name, current)) return null;

  // Prefer a plain Linux binary; fall back to the first asset
  const asset =
    data.assets.find(
      a =>
        a.name.toLowerCase().includes("linux") &&
        !a.name.endsWith(".deb") &&
        !a.name.endsWith(".rpm") &&
        !a.name.endsWith(".AppImage") &&
        !a.name.endsWith(".tar.gz")
    ) ?? data.assets[0];

  if (!asset) return null;

  return {
    version: data.tag_name.replace(/^v/, ""),
    changelog: data.body ?? "",
    downloadUrl: asset.browser_download_url,
  };
}

export async function installUpdate(downloadUrl: string): Promise<void> {
  await invoke("install_update", { downloadUrl });
}

export async function restartApp(): Promise<void> {
  await invoke("restart_app");
}
