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

export function hostPlatform(): "linux" | "macos" | "windows" {
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return "windows";
  if (/Mac|Macintosh/i.test(ua)) return "macos";
  return "linux";
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

  const platform = hostPlatform();
  let asset: { name: string; browser_download_url: string } | undefined;

  switch (platform) {
    case "linux":
      asset = data.assets.find(a => a.name.endsWith(".AppImage"));
      break;
    case "macos":
      asset = data.assets.find(a => a.name.endsWith(".dmg"));
      break;
    case "windows":
      asset =
        data.assets.find(a => /[_-]setup\.exe$/i.test(a.name)) ??
        data.assets.find(a => a.name.endsWith(".msi")) ??
        data.assets.find(a => /\.exe$/i.test(a.name));
      break;
  }

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
