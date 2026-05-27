import { useState, useRef, useEffect, useCallback } from "react";
import {
  ChevronRight,
  ChevronDown,
  FileText,
  Folder,
  FolderOpen,
  MoreHorizontal,
  Trash2,
  Edit3,
  Search,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useShallow } from "zustand/react/shallow";
import { useStore, type NoteFile } from "../../store/useStore";

const TAG_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  red:    { bg: "bg-red-950/40",    text: "text-red-400",    border: "border-red-800/40" },
  orange: { bg: "bg-orange-950/40", text: "text-orange-400", border: "border-orange-800/40" },
  amber:  { bg: "bg-amber-950/40",  text: "text-amber-400",  border: "border-amber-800/40" },
  green:  { bg: "bg-green-950/40",  text: "text-green-400",  border: "border-green-800/40" },
  teal:   { bg: "bg-teal-950/40",   text: "text-teal-400",   border: "border-teal-800/40" },
  blue:   { bg: "bg-blue-950/40",   text: "text-blue-400",   border: "border-blue-800/40" },
  purple: { bg: "bg-purple-950/40", text: "text-purple-400", border: "border-purple-800/40" },
  pink:   { bg: "bg-pink-950/40",   text: "text-pink-400",   border: "border-pink-800/40" },
};

const TAG_COLOR_KEYS = Object.keys(TAG_COLORS);

function tagColor(tag: string) {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) hash = tag.charCodeAt(i) + ((hash << 5) - hash);
  return TAG_COLORS[TAG_COLOR_KEYS[Math.abs(hash) % TAG_COLOR_KEYS.length]];
}

function isDescendant(notes: NoteFile[], targetId: string, draggedId: string): boolean {
  let node = notes.find((n) => n.id === targetId);
  while (node?.parentId) {
    if (node.parentId === draggedId) return true;
    node = notes.find((n) => n.id === node!.parentId);
  }
  return false;
}

// ─── Global drag state (shared across all FileNode instances) ────────────────

interface DragState {
  nodeId: string;
  startY: number;
  isDragging: boolean;
  ghostEl: HTMLDivElement | null;
}

let dragState: DragState | null = null;
let dropTargetId: string | null = null;
let setDropTargetFns: Map<string, (v: boolean) => void> = new Map();

function registerDropTarget(id: string, setFn: (v: boolean) => void) {
  setDropTargetFns.set(id, setFn);
}

function unregisterDropTarget(id: string) {
  setDropTargetFns.delete(id);
}

function clearAllDropTargets() {
  setDropTargetFns.forEach((fn) => fn(false));
  dropTargetId = null;
}

// ─── FileNode ────────────────────────────────────────────────────────────────

interface FileNodeProps {
  file: NoteFile;
  depth: number;
  allFiles: NoteFile[];
}

function FileNode({ file, depth, allFiles }: FileNodeProps) {
  const { activeNoteId, setActiveNote, updateNote, deleteNote, moveNote } = useStore(
    useShallow((s) => ({
      activeNoteId: s.activeNoteId,
      setActiveNote: s.setActiveNote,
      updateNote: s.updateNote,
      deleteNote: s.deleteNote,
      moveNote: s.moveNote,
    }))
  );

  const [expanded, setExpanded] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(file.name);
  const [menuOpen, setMenuOpen] = useState(false);
  const [isDropTarget, setIsDropTarget] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);

  const children = allFiles.filter((f) => f.parentId === file.id);
  const isActive = activeNoteId === file.id;

  const firstTag = !file.isFolder && file.tags.length > 0 ? file.tags[0] : null;
  const color = firstTag ? tagColor(firstTag) : null;

  // Register this folder as a drop target
  useEffect(() => {
    if (file.isFolder) {
      registerDropTarget(file.id, setIsDropTarget);
      return () => unregisterDropTarget(file.id);
    }
  }, [file.id, file.isFolder]);

  function handleClick() {
    if (file.isFolder) {
      setExpanded((v) => !v);
    } else {
      setActiveNote(file.id);
    }
  }

  function handleRename() {
    const trimmed = nameDraft.trim();
    if (trimmed && trimmed !== file.name) {
      updateNote(file.id, { name: trimmed });
    }
    setRenaming(false);
    setMenuOpen(false);
  }

  // ── Pointer-based drag ────────────────────────────────────────────────────

  const DRAG_THRESHOLD = 5; // pixels before drag activates

  function handlePointerDown(e: React.PointerEvent) {
    if (renaming || e.button !== 0) return;
    // Don't start drag from context menu button
    if ((e.target as HTMLElement).closest("button")) return;

    dragState = {
      nodeId: file.id,
      startY: e.clientY,
      isDragging: false,
      ghostEl: null,
    };

    // Capture pointer on the row element
    rowRef.current?.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!dragState || dragState.nodeId !== file.id) return;

    // Check if we've crossed the drag threshold
    if (!dragState.isDragging) {
      if (Math.abs(e.clientY - dragState.startY) < DRAG_THRESHOLD) return;
      dragState.isDragging = true;

      // Create ghost element
      const ghost = document.createElement("div");
      ghost.className = "fixed z-[100] px-3 py-1.5 rounded-lg bg-surface-elevated border border-border-active text-xs text-foreground shadow-lg pointer-events-none flex items-center gap-2";
      ghost.innerHTML = `<span>${file.isFolder ? "📁" : "📄"}</span><span>${file.name}</span>`;
      document.body.appendChild(ghost);
      dragState.ghostEl = ghost;
    }

    // Move ghost
    if (dragState.ghostEl) {
      dragState.ghostEl.style.left = `${e.clientX + 12}px`;
      dragState.ghostEl.style.top = `${e.clientY - 12}px`;
    }

    // Hit-test which element we're hovering over
    // We need to temporarily hide the ghost so elementFromPoint doesn't hit it
    if (dragState.ghostEl) dragState.ghostEl.style.display = "none";
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (dragState.ghostEl) dragState.ghostEl.style.display = "";

    const targetRow = el?.closest("[data-tree-id]") as HTMLElement | null;
    const targetId = targetRow?.dataset.treeId ?? null;

    // Clear previous highlight
    clearAllDropTargets();

    if (targetId && targetId !== file.id) {
      const targetFile = allFiles.find((f) => f.id === targetId);
      if (targetFile?.isFolder && !isDescendant(allFiles, targetId, file.id)) {
        const setFn = setDropTargetFns.get(targetId);
        if (setFn) setFn(true);
        dropTargetId = targetId;
      }
    }
  }

  function handlePointerUp(e: React.PointerEvent) {
    if (!dragState || dragState.nodeId !== file.id) return;

    const wasDragging = dragState.isDragging;

    // Clean up ghost
    if (dragState.ghostEl) {
      dragState.ghostEl.remove();
    }

    // Perform drop
    if (wasDragging && dropTargetId) {
      moveNote(file.id, dropTargetId);
      // Expand the target folder
      // We use a small trick: dispatch a custom event that the target folder can listen to
      const targetRow = document.querySelector(`[data-tree-id="${dropTargetId}"]`);
      if (targetRow) {
        targetRow.dispatchEvent(new CustomEvent("expand-folder", { bubbles: false }));
      }
    }

    clearAllDropTargets();
    dragState = null;
    dropTargetId = null;

    try {
      rowRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      // Ignore if capture was already released
    }
  }

  // Listen for expand-folder custom event on this folder
  useEffect(() => {
    if (!file.isFolder || !rowRef.current) return;
    const el = rowRef.current;
    const handler = () => setExpanded(true);
    el.addEventListener("expand-folder", handler);
    return () => el.removeEventListener("expand-folder", handler);
  }, [file.isFolder]);

  return (
    <div>
      <div
        ref={rowRef}
        data-tree-id={file.id}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        className={`group flex items-center gap-1.5 px-2 py-1 rounded-lg cursor-pointer
                     transition-all duration-100 relative select-none
                     ${isDropTarget
                       ? "bg-surface-hover ring-1 ring-border-active"
                       : isActive && !file.isFolder
                       ? `${color ? `${color.bg} ${color.border} border` : "bg-surface-hover"} text-foreground`
                       : "text-foreground-secondary hover:text-foreground hover:bg-surface-hover"
                     }`}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        onClick={handleClick}
      >
        {file.isFolder && (
          <span className="flex-shrink-0 text-muted">
            {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </span>
        )}

        <span className="flex-shrink-0 text-muted">
          {file.isFolder ? (
            expanded ? <FolderOpen className="w-3.5 h-3.5" /> : <Folder className="w-3.5 h-3.5" />
          ) : (
            <FileText className="w-3.5 h-3.5" />
          )}
        </span>

        {renaming ? (
          <input
            autoFocus
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={handleRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRename();
              if (e.key === "Escape") setRenaming(false);
              e.stopPropagation();
            }}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 bg-transparent border-b border-border-active text-foreground
                       text-xs outline-none min-w-0"
          />
        ) : (
          <span className="flex-1 text-xs truncate">{file.name}</span>
        )}

        {firstTag && !renaming && (
          <span className={`text-xs flex-shrink-0 ${color?.text ?? "text-muted"}`}>
            #{firstTag}
          </span>
        )}

        {!renaming && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
            className="opacity-0 group-hover:opacity-100 flex-shrink-0 p-0.5 rounded
                       text-muted hover:text-foreground-secondary transition-all"
          >
            <MoreHorizontal className="w-3 h-3" />
          </button>
        )}

        <AnimatePresence>
          {menuOpen && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -4 }}
              transition={{ duration: 0.1 }}
              className="absolute right-0 top-full mt-1 z-50 surface
                         shadow-xl py-1 min-w-[120px]"
              onClick={(e) => e.stopPropagation()}
              onBlur={() => setMenuOpen(false)}
            >
              <button
                onClick={() => { setRenaming(true); setMenuOpen(false); }}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-foreground-secondary
                           hover:bg-surface-hover hover:text-foreground transition-colors"
              >
                <Edit3 className="w-3 h-3" />
                Rename
              </button>
              <button
                onClick={() => { deleteNote(file.id); setMenuOpen(false); }}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-muted
                           hover:bg-surface-hover hover:text-red-400 transition-colors"
              >
                <Trash2 className="w-3 h-3" />
                Delete
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {file.isFolder && expanded && children.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.15 }}
          >
            {children.map((child) => (
              <FileNode key={child.id} file={child} depth={depth + 1} allFiles={allFiles} />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Root drop area for moving items to root ─────────────────────────────────

function RootDropZone() {
  const [isOver, setIsOver] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    registerDropTarget("__root__", setIsOver);
    return () => unregisterDropTarget("__root__");
  }, []);

  return (
    <div
      ref={ref}
      data-tree-id="__root__"
      className={`h-8 rounded-lg mx-1 my-1 transition-all duration-100 flex items-center justify-center
                  ${isOver ? "bg-surface-hover ring-1 ring-border-active" : ""}`}
    >
      {isOver && <span className="text-xs text-muted">Move to root</span>}
    </div>
  );
}

// ─── FileTree (main export) ──────────────────────────────────────────────────

export default function FileTree() {
  const { notes, addNote, addFolder, moveNote } = useStore(
    useShallow((s) => ({
      notes: s.notes,
      addNote: s.addNote,
      addFolder: s.addFolder,
      moveNote: s.moveNote,
    }))
  );

  const [search, setSearch] = useState("");

  const searchLower = search.toLowerCase().trim();
  const isSearching = searchLower.length > 0;

  const matchingNotes = isSearching
    ? notes.filter(
        (n) =>
          !n.isFolder &&
          (n.name.toLowerCase().includes(searchLower) ||
            n.tags.some((t) => t.toLowerCase().includes(searchLower)))
      )
    : [];

  const tagGroups = isSearching
    ? (() => {
        const groups: Record<string, NoteFile[]> = {};
        for (const note of matchingNotes) {
          const matchingTag = note.tags.find((t) => t.toLowerCase().includes(searchLower));
          const key = matchingTag ?? "__name__";
          if (!groups[key]) groups[key] = [];
          groups[key].push(note);
        }
        return groups;
      })()
    : {};

  const rootFiles = notes.filter((f) => f.parentId === null);

  // Handle pointer-based root drop (items dragged to empty area → move to root)
  function handleRootPointerUp(e: React.PointerEvent) {
    if (!dragState) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const targetRow = el?.closest("[data-tree-id]") as HTMLElement | null;

    // If we're not over any tree item, or over the root zone, move to root
    if (!targetRow || targetRow.dataset.treeId === "__root__") {
      if (dragState.isDragging) {
        moveNote(dragState.nodeId, null);
      }
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border flex-shrink-0">
        <span className="text-xs font-medium text-muted uppercase tracking-wider">Files</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => addNote(null)}
            title="New note"
            className="flex items-center justify-center w-6 h-6 rounded text-muted
                       hover:text-foreground hover:bg-surface-hover transition-all"
          >
            <FileText className="w-3 h-3" />
          </button>
          <button
            onClick={() => addFolder(null)}
            title="New folder"
            className="flex items-center justify-center w-6 h-6 rounded text-muted
                       hover:text-foreground hover:bg-surface-hover transition-all"
          >
            <Folder className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Search bar */}
      <div className="px-2 py-2 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-1.5 bg-surface-elevated border border-border rounded-lg px-2 py-1.5
                        focus-within:border-border-active transition-colors">
          <Search className="w-3 h-3 text-muted flex-shrink-0" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search notes or #tags..."
            className="bg-transparent text-xs text-foreground placeholder:text-muted outline-none flex-1 min-w-0"
          />
          {search && (
            <button onClick={() => setSearch("")} className="text-muted hover:text-foreground-secondary">
              <span className="text-xs">&times;</span>
            </button>
          )}
        </div>
      </div>

      {/* File list or search results */}
      {isSearching ? (
        <div className="flex-1 overflow-y-auto px-2 py-2 space-y-3">
          {matchingNotes.length === 0 && (
            <p className="text-xs text-muted text-center py-4">No matches found.</p>
          )}
          {Object.entries(tagGroups).map(([tag, groupNotes]) => (
            <div key={tag}>
              {tag !== "__name__" && (
                <div className="flex items-center gap-1.5 px-1 mb-1">
                  <span className={`text-xs font-medium ${tagColor(tag).text}`}>#{tag}</span>
                  <span className="text-xs text-muted">{groupNotes.length}</span>
                </div>
              )}
              {tag === "__name__" && (
                <div className="px-1 mb-1">
                  <span className="text-xs font-medium text-muted">By name</span>
                </div>
              )}
              {groupNotes.map((note) => {
                const color = note.tags[0] ? tagColor(note.tags[0]) : null;
                return (
                  <button
                    key={note.id}
                    onClick={() => {
                      useStore.getState().setActiveNote(note.id);
                      setSearch("");
                    }}
                    className={`flex items-center gap-2 w-full px-2 py-1.5 rounded-lg text-left
                               text-xs text-foreground-secondary hover:bg-surface-hover transition-colors
                               ${color ? `${color.bg} ${color.border} border` : ""}`}
                  >
                    <FileText className="w-3 h-3 text-muted flex-shrink-0" />
                    <span className="truncate">{note.name}</span>
                    {note.tags.length > 0 && (
                      <span className={`ml-auto text-xs flex-shrink-0 ${tagColor(note.tags[0]).text}`}>
                        #{note.tags[0]}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      ) : (
        <div
          className="flex-1 overflow-y-auto px-1 py-1"
          onPointerUp={handleRootPointerUp}
        >
          {rootFiles.length === 0 && (
            <p className="text-xs text-muted text-center py-4">
              No files yet. Create one above.
            </p>
          )}
          {rootFiles.map((file) => (
            <FileNode key={file.id} file={file} depth={0} allFiles={notes} />
          ))}
          <RootDropZone />
        </div>
      )}
    </div>
  );
}
