import { open } from "@tauri-apps/plugin-dialog";
import { readDir, readTextFile } from "@tauri-apps/plugin-fs";

interface ImportedFile {
  name: string;
  content: string;
  parentKey: string | null;
  selfKey: string | null;
  isFolder: boolean;
}

/**
 * Opens a native folder picker and recursively imports all .md/.txt files.
 * Returns null if the user cancelled.
 */
export async function importObsidianVault(): Promise<ImportedFile[] | null> {
  const selected = await open({ directory: true, multiple: false });
  if (!selected || typeof selected !== "string") return null;

  const result: ImportedFile[] = [];
  await collectEntries(selected, selected, null, result);
  return result.length > 0 ? result : null;
}

async function collectEntries(
  rootPath: string,
  dirPath: string,
  parentKey: string | null,
  result: ImportedFile[]
): Promise<void> {
  const entries = await readDir(dirPath);

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;

    const fullPath = `${dirPath}/${entry.name}`;

    if (entry.isDirectory) {
      // Stable key relative to vault root
      const selfKey = fullPath.slice(rootPath.length + 1);
      result.push({
        name: entry.name,
        content: "",
        parentKey,
        selfKey,
        isFolder: true,
      });
      await collectEntries(rootPath, fullPath, selfKey, result);
    } else if (
      entry.isFile &&
      (entry.name.endsWith(".md") || entry.name.endsWith(".txt"))
    ) {
      const content = await readTextFile(fullPath);
      const noteName = entry.name.replace(/\.(md|txt)$/, "");
      result.push({
        name: noteName,
        content,
        parentKey,
        selfKey: null,
        isFolder: false,
      });
    }
  }
}
