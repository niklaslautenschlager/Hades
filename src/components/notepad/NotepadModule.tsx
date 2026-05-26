import { useCallback, useState } from "react";
import { Terminal, Type, Tag, X, Plus } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../../store/useStore";
import FileTree from "./FileTree";
import Editor from "./Editor";

export default function NotepadModule() {
  const { notes, activeNoteId, isVimMode, toggleVimMode, updateNote } = useStore(
    useShallow((s) => ({
      notes: s.notes,
      activeNoteId: s.activeNoteId,
      isVimMode: s.isVimMode,
      toggleVimMode: s.toggleVimMode,
      updateNote: s.updateNote,
    }))
  );

  const activeNote = notes.find((n) => n.id === activeNoteId && !n.isFolder);
  const [tagInput, setTagInput] = useState("");
  const [showTagInput, setShowTagInput] = useState(false);

  const handleContentChange = useCallback(
    (content: string) => {
      if (activeNote) {
        updateNote(activeNote.id, { content });
      }
    },
    [activeNote, updateNote]
  );

  function addTag() {
    if (!activeNote || !tagInput.trim()) return;
    const tag = tagInput.trim().toLowerCase().replace(/\s+/g, "-");
    if (!activeNote.tags.includes(tag)) {
      updateNote(activeNote.id, { tags: [...activeNote.tags, tag] });
    }
    setTagInput("");
    setShowTagInput(false);
  }

  function removeTag(tag: string) {
    if (!activeNote) return;
    updateNote(activeNote.id, { tags: activeNote.tags.filter((t) => t !== tag) });
  }

  return (
    <div className="flex h-full">
      {/* File tree sidebar */}
      <aside className="w-56 flex-shrink-0 border-r border-zinc-800/50">
        <FileTree />
      </aside>

      {/* Editor area */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {activeNote ? (
          <>
            {/* Editor toolbar */}
            <div className="flex items-center justify-between px-5 py-2.5 border-b border-zinc-800/50 flex-shrink-0">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                {/* Title */}
                <input
                  type="text"
                  value={activeNote.name}
                  onChange={(e) =>
                    updateNote(activeNote.id, { name: e.target.value })
                  }
                  className="bg-transparent text-sm font-medium text-zinc-200 outline-none
                             border-b border-transparent hover:border-zinc-700/60 focus:border-zinc-600
                             transition-colors pb-0.5 min-w-0 max-w-[280px]"
                />

                {/* Tags */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  {activeNote.tags.map((tag) => (
                    <span key={tag} className="tag flex items-center gap-1">
                      #{tag}
                      <button
                        onClick={() => removeTag(tag)}
                        className="text-zinc-600 hover:text-zinc-400 transition-colors"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </span>
                  ))}

                  {showTagInput ? (
                    <input
                      autoFocus
                      type="text"
                      value={tagInput}
                      onChange={(e) => setTagInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") addTag();
                        if (e.key === "Escape") setShowTagInput(false);
                      }}
                      onBlur={() => setShowTagInput(false)}
                      placeholder="tag-name"
                      className="text-xs bg-zinc-800/60 border border-zinc-700/50 rounded px-1.5 py-0.5
                                 text-zinc-300 outline-none w-24 font-mono"
                    />
                  ) : (
                    <button
                      onClick={() => setShowTagInput(true)}
                      className="tag opacity-60 hover:opacity-100 cursor-pointer"
                    >
                      <Tag className="w-2.5 h-2.5" />
                      <span>tag</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Vim toggle */}
              <button
                onClick={toggleVimMode}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono
                             font-medium transition-all duration-150
                             ${isVimMode
                               ? "bg-zinc-100 text-zinc-950"
                               : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/60"
                             }`}
                title={isVimMode ? "Switch to Normal mode" : "Switch to Vim mode"}
              >
                {isVimMode ? (
                  <>
                    <Terminal className="w-3.5 h-3.5" />
                    VIM
                  </>
                ) : (
                  <>
                    <Type className="w-3.5 h-3.5" />
                    Normal
                  </>
                )}
              </button>
            </div>

            {/* Editor — relative container so the absolute-fill child works */}
            <div className="relative flex-1 min-h-0 overflow-hidden">
              <Editor
                key={activeNote.id}
                noteId={activeNote.id}
                content={activeNote.content}
                onChange={handleContentChange}
              />
            </div>

            {/* Vim status bar (only visible when active) */}
            {isVimMode && (
              <div className="flex-shrink-0 h-6 bg-zinc-900/80 border-t border-zinc-800/50
                             flex items-center px-4">
                <span className="text-xs font-mono text-zinc-600">-- VIM MODE --</span>
              </div>
            )}
          </>
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <p className="text-sm text-zinc-600">Select a note to start editing</p>
              <p className="text-xs text-zinc-700 mt-1">or create a new one in the file tree</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
