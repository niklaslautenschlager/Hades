import { useState } from "react";
import {
  ChevronRight,
  ChevronDown,
  FileText,
  Folder,
  FolderOpen,
  MoreHorizontal,
  Trash2,
  Edit3,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useShallow } from "zustand/react/shallow";
import { useStore, type NoteFile } from "../../store/useStore";

// Check if targetId is a descendant of draggedId (prevents cycles)
function isDescendant(notes: NoteFile[], targetId: string, draggedId: string): boolean {
  let node = notes.find((n) => n.id === targetId);
  while (node?.parentId) {
    if (node.parentId === draggedId) return true;
    node = notes.find((n) => n.id === node!.parentId);
  }
  return false;
}

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

  const [expanded, setExpanded] = useState(true);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(file.name);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const children = allFiles.filter((f) => f.parentId === file.id);
  const isActive = activeNoteId === file.id;

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

  function handleDragStart(e: React.DragEvent) {
    e.dataTransfer.setData("text/plain", file.id);
    e.dataTransfer.effectAllowed = "move";
  }

  function handleDragOver(e: React.DragEvent) {
    if (!file.isFolder) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOver(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    // Only clear if leaving the node entirely (not entering a child)
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOver(false);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    if (!file.isFolder) return;
    const draggedId = e.dataTransfer.getData("text/plain");
    if (draggedId && draggedId !== file.id && !isDescendant(allFiles, file.id, draggedId)) {
      moveNote(draggedId, file.id);
      setExpanded(true);
    }
  }

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onDragOver={file.isFolder ? handleDragOver : undefined}
      onDragLeave={file.isFolder ? handleDragLeave : undefined}
      onDrop={file.isFolder ? handleDrop : undefined}
    >
      <div
        className={`group flex items-center gap-1.5 px-2 py-1 rounded-lg cursor-pointer
                     transition-all duration-100 relative
                     ${dragOver
                       ? "bg-zinc-700/30 ring-1 ring-zinc-600/50"
                       : isActive && !file.isFolder
                       ? "bg-zinc-800/60 text-zinc-100"
                       : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/30"
                     }`}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        onClick={handleClick}
      >
        {/* Expand arrow for folders */}
        {file.isFolder && (
          <span className="flex-shrink-0 text-zinc-600">
            {expanded ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
          </span>
        )}

        {/* Icon */}
        <span className="flex-shrink-0 text-zinc-500">
          {file.isFolder ? (
            expanded ? (
              <FolderOpen className="w-3.5 h-3.5" />
            ) : (
              <Folder className="w-3.5 h-3.5" />
            )
          ) : (
            <FileText className="w-3.5 h-3.5" />
          )}
        </span>

        {/* Name */}
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
            className="flex-1 bg-transparent border-b border-zinc-600 text-zinc-100
                       text-xs outline-none min-w-0"
          />
        ) : (
          <span className="flex-1 text-xs truncate select-none">{file.name}</span>
        )}

        {/* Tags */}
        {!file.isFolder && file.tags.length > 0 && !renaming && (
          <span className="text-xs text-zinc-700 flex-shrink-0">
            #{file.tags[0]}
          </span>
        )}

        {/* Context menu button */}
        {!renaming && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
            className="opacity-0 group-hover:opacity-100 flex-shrink-0 p-0.5 rounded
                       text-zinc-600 hover:text-zinc-300 transition-all"
          >
            <MoreHorizontal className="w-3 h-3" />
          </button>
        )}

        {/* Dropdown menu */}
        <AnimatePresence>
          {menuOpen && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -4 }}
              transition={{ duration: 0.1 }}
              className="absolute right-0 top-full mt-1 z-50 bg-zinc-800 border border-zinc-700/60
                         rounded-lg shadow-xl py-1 min-w-[120px]"
              onClick={(e) => e.stopPropagation()}
              onBlur={() => setMenuOpen(false)}
            >
              <button
                onClick={() => { setRenaming(true); setMenuOpen(false); }}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-zinc-300
                           hover:bg-zinc-700/50 hover:text-zinc-100 transition-colors"
              >
                <Edit3 className="w-3 h-3" />
                Rename
              </button>
              <button
                onClick={() => { deleteNote(file.id); setMenuOpen(false); }}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-zinc-600
                           hover:bg-zinc-700/50 hover:text-red-400 transition-colors"
              >
                <Trash2 className="w-3 h-3" />
                Delete
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Children */}
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

export default function FileTree() {
  const { notes, addNote, addFolder } = useStore(
    useShallow((s) => ({
      notes: s.notes,
      addNote: s.addNote,
      addFolder: s.addFolder,
    }))
  );

  const [rootDragOver, setRootDragOver] = useState(false);

  const rootFiles = notes.filter((f) => f.parentId === null);

  function handleRootDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setRootDragOver(true);
  }

  function handleRootDragLeave(e: React.DragEvent) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setRootDragOver(false);
    }
  }

  function handleRootDrop(e: React.DragEvent) {
    e.preventDefault();
    setRootDragOver(false);
    const draggedId = e.dataTransfer.getData("text/plain");
    if (draggedId) {
      useStore.getState().moveNote(draggedId, null);
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-zinc-800/50 flex-shrink-0">
        <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Files</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => addNote(null)}
            title="New note"
            className="flex items-center justify-center w-6 h-6 rounded text-zinc-500
                       hover:text-zinc-200 hover:bg-zinc-800/60 transition-all"
          >
            <FileText className="w-3 h-3" />
          </button>
          <button
            onClick={() => addFolder(null)}
            title="New folder"
            className="flex items-center justify-center w-6 h-6 rounded text-zinc-500
                       hover:text-zinc-200 hover:bg-zinc-800/60 transition-all"
          >
            <Folder className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* File list — also a drop target for moving to root */}
      <div
        className={`flex-1 overflow-y-auto px-1 py-1 transition-colors duration-100
                    ${rootDragOver ? "bg-zinc-800/20" : ""}`}
        onDragOver={handleRootDragOver}
        onDragLeave={handleRootDragLeave}
        onDrop={handleRootDrop}
      >
        {rootFiles.length === 0 && (
          <p className="text-xs text-zinc-700 text-center py-4">
            No files yet. Create one above.
          </p>
        )}
        {rootFiles.map((file) => (
          <FileNode key={file.id} file={file} depth={0} allFiles={notes} />
        ))}
      </div>
    </div>
  );
}
