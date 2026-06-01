import { useCallback, useMemo, useState, useRef } from "react";
import {
  Terminal,
  Type,
  Tag,
  X,
  FileDown,
  FileUp,
  FileType,
  BookOpen,
  PanelLeftClose,
  PanelLeftOpen,
  Calculator as CalcIcon,
  MoreHorizontal,
} from "lucide-react";
import { AnimatePresence } from "framer-motion";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../../store/useStore";
import FileTree from "./FileTree";
import Editor from "./Editor";
import PdfViewer from "./PdfViewer";
import Calculator from "./Calculator";
import { exportAsMarkdown, exportAsPdf } from "../../lib/noteExport";
import { importObsidianVault } from "../../lib/noteImport";

export default function NotepadModule() {
  const {
    notes,
    activeNoteId,
    isVimMode,
    toggleVimMode,
    updateNote,
    importNotes,
    showNotepadPdf,
    toggleNotepadPdf,
  } = useStore(
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
  const [tagInput, setTagInput]       = useState("");
  const [showTagInput, setShowTagInput] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const [showCalculator, setShowCalculator] = useState(false);
  const [showOverflow, setShowOverflow] = useState(false);

  const wordCount = useMemo(
    () => activeNote?.content.trim().split(/\s+/).filter(Boolean).length ?? 0,
    [activeNote?.content]
  );

  // ── PDF panel resize ───────────────────────────────────────────────────────
  const [pdfWidth, setPdfWidth] = useState(50);
  const pdfDragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  function onPdfDividerPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pdfDragRef.current = { startX: e.clientX, startWidth: pdfWidth };
  }
  function onPdfDividerPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!pdfDragRef.current) return;
    const container = (e.currentTarget as HTMLElement).parentElement;
    if (!container) return;
    const cw = container.getBoundingClientRect().width;
    const delta = ((e.clientX - pdfDragRef.current.startX) / cw) * 100;
    setPdfWidth(Math.max(20, Math.min(70, pdfDragRef.current.startWidth - delta)));
  }
  function onPdfDividerPointerUp() { pdfDragRef.current = null; }

  // ── Sidebar resize ─────────────────────────────────────────────────────────
  const [sidebarWidth, setSidebarWidth] = useState(224);
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
  function onSidebarDividerPointerUp() { sidebarDragRef.current = null; }

  const handleContentChange = useCallback(
    (c: string) => { if (activeNote) updateNote(activeNote.id, { content: c }); },
    [activeNote, updateNote]
  );

  function addTag() {
    if (!activeNote || !tagInput.trim()) return;
    const tag = tagInput.trim().toLowerCase().replace(/\s+/g, "-");
    if (!activeNote.tags.includes(tag)) {
      updateNote(activeNote.id, { tags: [...activeNote.tags, tag] });
    }
    setTagInput(""); setShowTagInput(false);
  }

  function removeTag(tag: string) {
    if (!activeNote) return;
    updateNote(activeNote.id, { tags: activeNote.tags.filter((t) => t !== tag) });
  }

  async function handleExportMd() {
    if (!activeNote) return;
    await exportAsMarkdown(activeNote.name, activeNote.content);
    setShowExportMenu(false); setShowOverflow(false);
  }

  async function handleExportPdf() {
    if (!activeNote) return;
    await exportAsPdf(activeNote.name, activeNote.content);
    setShowExportMenu(false); setShowOverflow(false);
  }

  async function handleImport() {
    const imported = await importObsidianVault();
    if (imported && imported.length > 0) importNotes(imported);
    setShowOverflow(false);
  }

  return (
    <div className="flex h-full">
      {/* ── Sidebar ─────────────────────────────────────────────────────────── */}
      {showSidebar && (
        <>
          <aside style={{ width: sidebarWidth }} className="flex-shrink-0 border-r border-border min-w-0">
            <FileTree />
          </aside>
          <div
            className="w-[5px] flex-shrink-0 cursor-col-resize hover:bg-surface-hover transition-colors duration-150"
            onPointerDown={onSidebarDividerPointerDown}
            onPointerMove={onSidebarDividerPointerMove}
            onPointerUp={onSidebarDividerPointerUp}
            onPointerCancel={onSidebarDividerPointerUp}
          />
        </>
      )}

      {/* ── Editor area ─────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {activeNote ? (
          <>
            {/* Toolbar */}
            <div className="flex items-center px-4 py-2 border-b border-border flex-shrink-0 gap-1.5 min-w-0">

              {/* Left: sidebar toggle + tags */}
              <div className="flex items-center gap-1.5 flex-1 min-w-0 overflow-hidden">
                <button
                  onClick={() => setShowSidebar((v) => !v)}
                  className="flex-shrink-0 flex items-center justify-center w-7 h-7 rounded-lg
                             text-muted hover:text-foreground-secondary hover:bg-surface-hover transition-all"
                  title={showSidebar ? "Hide file tree" : "Show file tree"}
                >
                  {showSidebar ? <PanelLeftClose className="w-3.5 h-3.5" /> : <PanelLeftOpen className="w-3.5 h-3.5" />}
                </button>

                {/* Tags */}
                <div className="flex items-center gap-1.5 overflow-x-auto min-w-0 flex-1" style={{ scrollbarWidth: "none" }}>
                  {activeNote.tags.map((tag) => (
                    <span key={tag} className="tag flex items-center gap-1 flex-shrink-0">
                      #{tag}
                      <button onClick={() => removeTag(tag)} className="text-muted hover:text-foreground-secondary">
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
                      placeholder="tag"
                      className="text-xs bg-surface-hover border border-border rounded px-1.5 py-0.5
                                 text-foreground-secondary outline-none w-20 font-mono flex-shrink-0"
                    />
                  ) : (
                    <button
                      onClick={() => setShowTagInput(true)}
                      className="tag opacity-50 hover:opacity-100 flex-shrink-0"
                    >
                      <Tag className="w-2.5 h-2.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Word count */}
              <span className="text-xs text-muted flex-shrink-0 hidden sm:block">
                {wordCount} words
              </span>

              {/* Right: primary actions */}
              <div className="flex items-center gap-1 flex-shrink-0">

                {/* Vim toggle */}
                <button
                  onClick={toggleVimMode}
                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-mono font-medium
                               transition-all duration-150
                               ${isVimMode
                                 ? "bg-accent-gradient text-[var(--accent-contrast)]"
                                 : "text-muted hover:text-foreground-secondary hover:bg-surface-hover"
                               }`}
                  title={isVimMode ? "Vim mode on" : "Vim mode off"}
                >
                  {isVimMode ? <Terminal className="w-3 h-3" /> : <Type className="w-3 h-3" />}
                </button>

                {/* PDF viewer toggle */}
                <button
                  onClick={toggleNotepadPdf}
                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium
                               transition-all duration-150
                               ${showNotepadPdf
                                 ? "bg-accent-gradient text-[var(--accent-contrast)]"
                                 : "text-muted hover:text-foreground-secondary hover:bg-surface-hover"
                               }`}
                  title="Toggle PDF viewer"
                >
                  <BookOpen className="w-3.5 h-3.5" />
                </button>

                {/* Calculator toggle */}
                <button
                  onClick={() => setShowCalculator((v) => !v)}
                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium
                               transition-all duration-150
                               ${showCalculator
                                 ? "bg-accent-gradient text-[var(--accent-contrast)]"
                                 : "text-muted hover:text-foreground-secondary hover:bg-surface-hover"
                               }`}
                  title="Calculator"
                >
                  <CalcIcon className="w-3.5 h-3.5" />
                </button>

                {/* Overflow menu (Export, Import) */}
                <div className="relative">
                  <button
                    onClick={() => setShowOverflow((v) => !v)}
                    className="flex items-center justify-center w-7 h-7 rounded-lg text-xs font-medium
                               text-muted hover:text-foreground-secondary hover:bg-surface-hover transition-all"
                    title="More actions"
                  >
                    <MoreHorizontal className="w-3.5 h-3.5" />
                  </button>

                  {showOverflow && (
                    <div className="absolute right-0 top-full mt-1 z-50 surface py-1 min-w-[160px] shadow-xl">
                      {/* Export section */}
                      <div className="px-3 py-1">
                        <span className="text-xs text-muted font-medium uppercase tracking-wider">Export</span>
                      </div>
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
                        PDF (.pdf)
                      </button>

                      <div className="border-t border-border my-1" />

                      {/* Import */}
                      <button
                        onClick={handleImport}
                        className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-foreground-secondary
                                   hover:bg-surface-hover transition-colors"
                      >
                        <FileUp className="w-3 h-3" />
                        Import vault
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Note title */}
            <div className="px-10 pt-6 pb-1 flex-shrink-0">
              <input
                type="text"
                value={activeNote.name}
                onChange={(e) => updateNote(activeNote.id, { name: e.target.value })}
                placeholder="Untitled"
                className="w-full bg-transparent text-2xl font-bold text-foreground outline-none
                           placeholder:text-muted border-none max-w-[800px] mx-auto block"
                style={{ fontFamily: "'Inter', system-ui, sans-serif" }}
              />
            </div>

            {/* WYSIWYG Editor — always visible, no preview/edit toggle */}
            <div className="relative flex-1 min-h-0 overflow-hidden">
              <Editor
                key={activeNote.id}
                noteId={activeNote.id}
                content={activeNote.content}
                onChange={handleContentChange}
              />
            </div>

            {/* Vim status bar */}
            {isVimMode && (
              <div className="flex-shrink-0 h-6 bg-surface-elevated border-t border-border flex items-center px-4">
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

      {/* ── Floating Calculator ──────────────────────────────────────────────── */}
      <AnimatePresence>
        {showCalculator && <Calculator onClose={() => setShowCalculator(false)} />}
      </AnimatePresence>

      {/* ── PDF Viewer (resizable) ───────────────────────────────────────────── */}
      {showNotepadPdf && (
        <>
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
