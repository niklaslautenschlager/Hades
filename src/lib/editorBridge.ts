// Tiny bridge so non-editor components (e.g. the Calculator) can insert text at
// the active note's cursor without prop-drilling the CodeMirror view. The Editor
// registers its inserter on mount and clears it on unmount.

type InsertFn = (text: string) => boolean;

let current: InsertFn | null = null;

export function registerEditorInsert(fn: InsertFn | null): void {
  current = fn;
}

/** Insert text at the active editor's cursor. Returns false if no editor is mounted. */
export function insertIntoActiveNote(text: string): boolean {
  if (!current) return false;
  return current(text);
}

export function hasActiveEditor(): boolean {
  return current !== null;
}
