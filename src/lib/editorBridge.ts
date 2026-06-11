// Tiny bridge so non-editor components (Calculator, AI assists, the command
// palette) can read/replace the active note's selection without prop-drilling
// the CodeMirror view. The Editor registers its view on mount and clears it on
// unmount. All edits go through view.dispatch, so they participate in the
// editor's undo history.

import type { EditorView } from "@codemirror/view";

let view: EditorView | null = null;

export function registerEditorView(v: EditorView | null): void {
  view = v;
}

export function hasActiveEditor(): boolean {
  return view !== null;
}

/** Insert text at the active editor's cursor (replacing any selection). */
export function insertIntoActiveNote(text: string): boolean {
  if (!view) return false;
  const sel = view.state.selection.main;
  view.dispatch({
    changes: { from: sel.from, to: sel.to, insert: text },
    selection: { anchor: sel.from + text.length },
    scrollIntoView: true,
  });
  view.focus();
  return true;
}

export interface EditorSelection {
  text: string;
  from: number;
  to: number;
}

/** Current selection in the active editor (null when no editor / no selection). */
export function getSelection(): EditorSelection | null {
  if (!view) return null;
  const sel = view.state.selection.main;
  if (sel.empty) return null;
  return { text: view.state.sliceDoc(sel.from, sel.to), from: sel.from, to: sel.to };
}

/** Replace a specific range (e.g. a selection captured earlier). Undoable. */
export function replaceRange(from: number, to: number, text: string): boolean {
  if (!view) return false;
  const max = view.state.doc.length;
  const f = Math.max(0, Math.min(from, max));
  const t = Math.max(f, Math.min(to, max));
  view.dispatch({
    changes: { from: f, to: t, insert: text },
    selection: { anchor: f + text.length },
    scrollIntoView: true,
  });
  view.focus();
  return true;
}

/** Replace the whole document (undoable — used by "tidy note"). */
export function replaceAll(text: string): boolean {
  if (!view) return false;
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
    scrollIntoView: true,
  });
  view.focus();
  return true;
}

/** Screen position of a doc offset, for anchoring popovers near the selection. */
export function coordsAt(pos: number): { left: number; top: number; bottom: number } | null {
  if (!view) return null;
  const c = view.coordsAtPos(pos);
  return c ? { left: c.left, top: c.top, bottom: c.bottom } : null;
}
