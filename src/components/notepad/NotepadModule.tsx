import { useCallback, useMemo, useState, useRef } from "react";
import {
  Terminal,
  Type,
  Tag,
  X,
  Eye,
  Pencil,
  FileDown,
  FileUp,
  FileType,
  BookOpen,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../../store/useStore";
import FileTree from "./FileTree";
import Editor from "./Editor";
import MarkdownPreview from "./MarkdownPreview";
import PdfViewer from "./PdfViewer";
import { exportAsMarkdown, exportAsPdf } from "../../lib/noteExport";
import { importObsidianVault } from "../../lib/noteImport";

export default function NotepadModule() {
  const { notes, activeNoteId, isVimMode, toggleVimMode, updateNote, importNotes, showNotepadPdf, toggleNotepadPdf } = useStore(
    useShallow((s) => ({
      notes: s.notes,
      activeNoteId: s.activeNoteId,
      isVimMode: s.isVimMode,
      toggleVimMode: s.toggleVimMode,
      updateNote: s.updateNote,
      importNotes: s.importNotes,
      showNotepadPdf: s.showNotepadPdf,
      toggleNotepadPdf: s.toggleNotepadPdf,
    }))
  );

  const activeNote = notes.find((n) => n.id === activeNoteId && !n.isFolder);
  const [tagInput, setTagInput] = useState("");
  const [showTagInput, setShowTagInput] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const importRef = useRef<HTMLInputElement>(null);

  const wordCount = useMemo(
    () => activeNote?.content.trim().split(/\s+/).filter(Boolean).length ?? 0,
    [activeNote?.content]
  );

  // ── PDF panel resizable state ──────────────────────────────────────────────
  const [pdfWidth, setPdfWidth] = useState(50); // percentage
  const pdfDragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  function onPdfDividerPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pdfDragRef.current = { startX: e.clientX, startWidth: pdfWidth };
  }

  function onPdfDividerPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!pdfDragRef.current) return;
    const container = (e.currentTarget as HTMLElement).parentElement;
    if (!container) return;
    const containerWidth = container.getBoundingClientRect().width;
    const deltaPx = e.clientX - pdfDragRef.current.startX;
    const deltaPct = (deltaPx / containerWidth) * 100;
    // PDF is on the right, so moving right = smaller pdf
    const newWidth = Math.max(20, Math.min(70, pdfDragRef.current.startWidth - deltaPct));
    setPdfWidth(newWidth);
  }

  function onPdfDividerPointerUp() {
    pdfDragRef.current = null;
  }

  // ── Sidebar resizable state ────────────────────────────────────────────────
  const [sidebarWidth, setSidebarWidth] = useState(224); // 14rem = 224px
  const sidebarDragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  function onSidebarDividerPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    sidebarDragRef.current = { startX: e.clientX, startWidth: sidebarWidth };
  }

  function onSidebarDividerPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!sidebarDragRef.current) return;
    const delta = e.clientX - sidebarDragRef.current.startX;
    setSidebarWidth(Math.max(160, Math.min(400, sidebarDragRef.current.startWidth + delta)));
  }

  function onSidebarDividerPointerUp() {
    sidebarDragRef.current = null;
  }

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

  async function handleExportMd() {
    if (!activeNote) return;
    await exportAsMarkdown(activeNote.name, activeNote.content);
    setShowExportMenu(false);
  }

  async function handleExportPdf() {
    if (!activeNote) return;
    await exportAsPdf(activeNote.name, activeNote.content);
    setShowExportMenu(false);
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const imported = await importObsidianVault(files);
    if (imported.length > 0) {
      importNotes(imported);
    }
    // Reset input
    if (importRef.current) importRef.current.value = "";
  }

  return (
    <div className="flex h-full">
      {/* File tree sidebar — collapsible */}
      {showSidebar && (
        <>
          <aside style={{ width: sidebarWidth }} className="flex-shrink-0 border-r border-border min-w-0">
            <FileTree />
          </aside>
          {/* Sidebar resize handle */}
          <div
            className="w-[5px] flex-shrink-0 cursor-col-resize hover:bg-surface-hover transition-colors duration-150"
            onPointerDown={onSidebarDividerPointerDown}
            onPointerMove={onSidebarDividerPointerMove}
            onPointerUp={onSidebarDividerPointerUp}
            onPointerCancel={onSidebarDividerPointerUp}
          />
        </>
      )}

      {/* Editor area */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {activeNote ? (
          <>
            {/* Editor toolbar */}
            <div className="flex items-center justify-between px-5 py-2.5 border-b border-border flex-shrink-0">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                {/* Sidebar toggle */}
                <button
                  onClick={() => setShowSidebar((v) => !v)}
                  className="flex items-center justify-center w-7 h-7 rounded-lg
                             text-muted hover:text-foreground-secondary hover:bg-surface-hover
                             transition-all flex-shrink-0"
                  title={showSidebar ? "Hide file tree" : "Show file tree"}
                >
                  {showSidebar ? (
                    <PanelLeftClose className="w-3.5 h-3.5" />
                  ) : (
                    <PanelLeftOpen className="w-3.5 h-3.5" />
                  )}
                </button>

                {/* Tags */}
                <div className="flex items-center gap-1.5 overflow-x-auto min-w-0 flex-shrink">
                  {activeNote.tags.map((tag) => (
                    <span key={tag} className="tag flex items-center gap-1 flex-shrink-0">
                      #{tag}
                      <button
                        onClick={() => removeTag(tag)}
                        className="text-muted hover:text-foreground-secondary transition-colors"
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
                      className="text-xs bg-surface-hover border border-border rounded px-1.5 py-0.5
                                 text-foreground-secondary outline-none w-24 font-mono flex-shrink-0"
                    />
                  ) : (
                    <button
                      onClick={() => setShowTagInput(true)}
                      className="tag opacity-60 hover:opacity-100 cursor-pointer flex-shrink-0"
                    >
                      <Tag className="w-2.5 h-2.5" />
                      <span>tag</span>
                    </button>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                {/* Word count */}
                {wordCount > 0 && (
                  <span className="text-xs text-muted">{wordCount} words</span>
                )}

                {/* PDF viewer toggle */}
                <button
                  onClick={toggleNotepadPdf}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                               transition-all duration-150
                               ${showNotepadPdf
                                 ? "bg-foreground text-surface"
                                 : "text-muted hover:text-foreground-secondary hover:bg-surface-hover"
                               }`}
                  title={showNotepadPdf ? "Close PDF viewer" : "Open PDF viewer"}
                >
                  <BookOpen className="w-3.5 h-3.5" />
                  PDF
                </button>

                {/* Export dropdown */}
                <div className="relative">
                  <button
                    onClick={() => setShowExportMenu((v) => !v)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                               text-muted hover:text-foreground-secondary hover:bg-surface-hover transition-all"
                    title="Export note"
                  >
                    <FileDown className="w-3.5 h-3.5" />
                    Export
                  </button>
                  {showExportMenu && (
                    <div className="absolute right-0 top-full mt-1 z-50 surface py-1 min-w-[140px] shadow-xl">
                      <button
                        onClick={handleExportMd}
                        className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-foreground-secondary
                                   hover:bg-surface-hover transition-colors"
                      >
                        <FileType className="w-3 h-3" />
                        Markdown (.md)
                      </button>
                      <button
                        onClick={handleExportPdf}
                        className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-foreground-secondary
                                   hover:bg-surface-hover transition-colors"
                      >
                        <FileDown className="w-3 h-3" />
                        HTML (.html)
                      </button>
                    </div>
                  )}
                </div>

                {/* Import */}
                <button
                  onClick={() => importRef.current?.click()}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                             text-muted hover:text-foreground-secondary hover:bg-surface-hover transition-all"
                  title="Import notes (Obsidian compatible)"
                >
                  <FileUp className="w-3.5 h-3.5" />
                  Import
                </button>
                <input
                  ref={importRef}
                  type="file"
                  multiple
                  accept=".md,.txt"
                  onChange={handleImport}
                  className="hidden"
                  {...({ webkitdirectory: "", directory: "" } as any)}
                />

                {/* Preview / Edit toggle */}
                <button
                  onClick={() => setEditing((v) => !v)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                               transition-all duration-150
                               ${editing
                                 ? "text-muted hover:text-foreground-secondary hover:bg-surface-hover"
                                 : "bg-surface-hover text-foreground-secondary"
                               }`}
                  title={editing ? "Switch to preview" : "Switch to editor"}
                >
                  {editing ? (
                    <>
                      <Eye className="w-3.5 h-3.5" />
                      Preview
                    </>
                  ) : (
                    <>
                      <Pencil className="w-3.5 h-3.5" />
                      Edit
                    </>
                  )}
                </button>

                {/* Vim toggle (only in edit mode) */}
                {editing && (
                  <button
                    onClick={toggleVimMode}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono
                                 font-medium transition-all duration-150
                                 ${isVimMode
                                   ? "bg-foreground text-surface"
                                   : "text-muted hover:text-foreground-secondary hover:bg-surface-hover"
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
                )}
              </div>
            </div>

            {/* Note header */}
            <div className="px-8 pt-6 pb-2 flex-shrink-0">
              <input
                type="text"
                value={activeNote.name}
                onChange={(e) => updateNote(activeNote.id, { name: e.target.value })}
                placeholder="Untitled"
                className="w-full bg-transparent text-2xl font-semibold text-foreground outline-none
                           placeholder:text-muted border-none"
              />
            </div>

            {/* Editor or Preview */}
            <div className="relative flex-1 min-h-0 overflow-hidden">
              {editing ? (
                <Editor
                  key={activeNote.id}
                  noteId={activeNote.id}
                  content={activeNote.content}
                  onChange={handleContentChange}
                />
              ) : (
                <MarkdownPreview
                  content={activeNote.content}
                  onEdit={() => setEditing(true)}
                />
              )}
            </div>

            {/* Vim status bar (only visible when editing in vim mode) */}
            {editing && isVimMode && (
              <div className="flex-shrink-0 h-6 bg-surface-elevated border-t border-border
                             flex items-center px-4">
                <span className="text-xs font-mono text-muted">-- VIM MODE --</span>
              </div>
            )}
          </>
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              {!showSidebar && (
                <button
                  onClick={() => setShowSidebar(true)}
                  className="mb-4 flex items-center gap-2 mx-auto px-3 py-2 rounded-lg
                             text-muted hover:text-foreground-secondary hover:bg-surface-hover transition-all"
                >
                  <PanelLeftOpen className="w-4 h-4" />
                  <span className="text-sm">Show file tree</span>
                </button>
              )}
              <p className="text-sm text-muted">Select a note to start editing</p>
              <p className="text-xs text-muted mt-1">or create a new one in the file tree</p>
            </div>
          </div>
        )}
      </div>

      {/* PDF Viewer panel — resizable */}
      {showNotepadPdf && (
        <>
          {/* PDF resize handle */}
          <div
            className="w-[5px] flex-shrink-0 cursor-col-resize border-l border-border
                       hover:border-border-active hover:bg-surface-hover transition-colors duration-150"
            onPointerDown={onPdfDividerPointerDown}
            onPointerMove={onPdfDividerPointerMove}
            onPointerUp={onPdfDividerPointerUp}
            onPointerCancel={onPdfDividerPointerUp}
          />
          <div style={{ width: `${pdfWidth}%` }} className="flex-shrink-0 min-w-0 min-h-0 overflow-hidden">
            <PdfViewer onClose={toggleNotepadPdf} />
          </div>
        </>
      )}
    </div>
  );
}
