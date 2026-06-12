import { useState } from "react";
import { Plus, Trash2, BookOpen, Loader2, FileText, MessageSquare } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { useShallow } from "zustand/react/shallow";
import { useStore, type LibraryDoc } from "../../store/useStore";
import {
  importPdfFromPath,
  libraryDocBlobUrl,
  deleteLibraryFile,
  formatBytes,
} from "../../lib/pdfLibrary";
import { indexLibraryDoc, removeFromIndex } from "../../lib/ragIndex";

export default function LibraryPanel() {
  const {
    libraryDocs,
    addLibraryDoc,
    removeLibraryDoc,
    setNotePdf,
    showNotepadPdf,
    toggleNotepadPdf,
    notePdfUrl,
    aiEnabled,
    seedAssistant,
  } = useStore(
    useShallow((s) => ({
      libraryDocs: s.libraryDocs,
      addLibraryDoc: s.addLibraryDoc,
      removeLibraryDoc: s.removeLibraryDoc,
      setNotePdf: s.setNotePdf,
      showNotepadPdf: s.showNotepadPdf,
      toggleNotepadPdf: s.toggleNotepadPdf,
      notePdfUrl: s.notePdfUrl,
      aiEnabled: s.aiEnabled,
      seedAssistant: s.seedAssistant,
    }))
  );

  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleImport() {
    setError(null);
    const selected = await open({
      multiple: true,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    setImporting(true);
    try {
      for (const p of paths) {
        const doc = await importPdfFromPath(p);
        addLibraryDoc(doc);
        // Best-effort: fold the new PDF into the study index if one exists.
        void indexLibraryDoc(doc);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  }

  async function handleOpen(doc: LibraryDoc) {
    setError(null);
    try {
      // Free the previously-open blob before replacing it.
      if (notePdfUrl) URL.revokeObjectURL(notePdfUrl);
      const url = await libraryDocBlobUrl(doc);
      setNotePdf(url, doc.title, doc.id);
      if (!showNotepadPdf) toggleNotepadPdf();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleDelete(doc: LibraryDoc) {
    await deleteLibraryFile(doc);
    removeLibraryDoc(doc.id);
    void removeFromIndex(doc.id);
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border flex-shrink-0">
        <span className="text-xs font-medium text-muted uppercase tracking-wider">Library</span>
        <button
          onClick={handleImport}
          disabled={importing}
          title="Import PDF"
          className="flex items-center justify-center w-6 h-6 rounded text-muted
                     hover:text-foreground hover:bg-surface-hover transition-all disabled:opacity-50"
        >
          {importing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
        </button>
      </div>

      {error && (
        <p className="text-xs text-red-400 px-3 py-2 border-b border-border flex-shrink-0">{error}</p>
      )}

      {/* List */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1.5">
        {libraryDocs.length === 0 ? (
          <div className="flex flex-col items-center text-center gap-2 py-8 px-3">
            <BookOpen className="w-6 h-6 text-muted" />
            <p className="text-xs text-muted">No PDFs yet.</p>
            <button
              onClick={handleImport}
              disabled={importing}
              className="btn-ghost text-xs border border-border mt-1"
            >
              Import a PDF
            </button>
          </div>
        ) : (
          libraryDocs.map((doc) => (
            <div
              key={doc.id}
              onClick={() => handleOpen(doc)}
              className="group flex items-start gap-2 px-2 py-2 rounded-lg cursor-pointer
                         text-foreground-secondary hover:text-foreground hover:bg-surface-hover transition-all"
              title={`Open "${doc.title}"`}
            >
              <FileText className="w-3.5 h-3.5 text-muted flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium truncate">{doc.title}</div>
                {doc.author && (
                  <div className="text-[11px] text-muted truncate">{doc.author}</div>
                )}
                <div className="text-[10px] text-muted mt-0.5 flex items-center gap-2">
                  {doc.pageCount ? <span>{doc.pageCount} pages</span> : null}
                  {doc.sizeBytes ? <span>{formatBytes(doc.sizeBytes)}</span> : null}
                </div>
              </div>
              <div className="flex items-center gap-0.5 flex-shrink-0">
                {aiEnabled && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      seedAssistant(`Using my PDF "${doc.title}", `);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-0.5 rounded
                               text-muted hover:text-foreground transition-all"
                    title={`Chat with "${doc.title}"`}
                  >
                    <MessageSquare className="w-3 h-3" />
                  </button>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(doc); }}
                  className="opacity-0 group-hover:opacity-100 p-0.5 rounded
                             text-muted hover:text-red-400 transition-all"
                  title="Remove from library"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
