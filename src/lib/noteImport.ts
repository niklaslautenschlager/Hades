interface ImportedFile {
  name: string;
  content: string;
  parentKey: string | null;  // key reference to parent folder (used for mapping)
  selfKey: string | null;    // this item's own key (only for folders)
  isFolder: boolean;
}

/**
 * Import files from a directory picker (Obsidian vault compatible).
 * Handles folder structure by reading webkitRelativePath.
 *
 * Each folder gets a stable `selfKey` (its path) and notes reference
 * their parent folder via `parentKey`. The store's importNotes function
 * uses these keys to build the correct hierarchy.
 */
export async function importObsidianVault(fileList: FileList): Promise<ImportedFile[]> {
  const result: ImportedFile[] = [];
  const seenFolders = new Set<string>();

  // Sort files so shallow paths come first
  const files = Array.from(fileList).sort((a, b) => {
    const aDepth = (a.webkitRelativePath || a.name).split("/").length;
    const bDepth = (b.webkitRelativePath || b.name).split("/").length;
    return aDepth - bDepth;
  });

  for (const file of files) {
    // Only process markdown and text files
    if (!file.name.endsWith(".md") && !file.name.endsWith(".txt")) continue;
    // Skip hidden files and Obsidian config
    if (file.name.startsWith(".")) continue;

    const relativePath = file.webkitRelativePath || file.name;
    const parts = relativePath.split("/");

    // Skip the root vault folder name
    const pathParts = parts.length > 1 ? parts.slice(1) : parts;
    const folderParts = pathParts.slice(0, -1);

    // Create folder entries for each level in the path
    for (let i = 0; i < folderParts.length; i++) {
      const folderPath = folderParts.slice(0, i + 1).join("/");
      if (!seenFolders.has(folderPath)) {
        seenFolders.add(folderPath);
        const parentPath = i > 0 ? folderParts.slice(0, i).join("/") : null;
        result.push({
          name: folderParts[i],
          content: "",
          parentKey: parentPath, // null for root-level folders
          selfKey: folderPath,   // e.g. "notes", "notes/subfolder"
          isFolder: true,
        });
      }
    }

    // Read file content
    const content = await readFileAsText(file);
    const fileName = pathParts[pathParts.length - 1];
    const noteName = fileName.replace(/\.(md|txt)$/, "");
    const parentPath = folderParts.length > 0 ? folderParts.join("/") : null;

    result.push({
      name: noteName,
      content,
      parentKey: parentPath,
      selfKey: null,
      isFolder: false,
    });
  }

  return result;
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}
