import { useState, useRef, useEffect } from "react";
import { Upload, X, FileText, Link as LinkIcon, Loader2 } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { readFile } from "@tauri-apps/plugin-fs";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../../store/useStore";

interface Props {
  onClose: () => void;
}

export default function PdfViewer({ onClose }: Props) {
  const { pdfUrl, fileName, setNotePdf } = useStore(
    useShallow((s) => ({
      pdfUrl: s.notePdfUrl,
      fileName: s.notePdfFileName,
      setNotePdf: s.setNotePdf,
    }))
  );

  const [isDragOver, setIsDragOver]   = useState(false);
  const [urlInput, setUrlInput]       = useState("");
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [loadingUrl, setLoadingUrl]   = useState(false);
  const [urlError, setUrlError]       = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);
  // Track whether mouse is over the iframe area so pointer-events work correctly
  const [iframeActive, setIframeActive] = useState(false);

  function loadFromBlob(blob: Blob, name: string) {
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    const url = URL.createObjectURL(blob);
    setNotePdf(url, name);
  }

  // Tauri native drag-drop event (works on all platforms)
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    getCurrentWindow()
      .onDragDropEvent((event) => {
        if (event.payload.type === "over") {
          setIsDragOver(true);
        } else if (event.payload.type === "drop") {
          setIsDragOver(false);
          const pdfPath = (event.payload.paths as string[]).find((p) =>
            p.toLowerCase().endsWith(".pdf")
          );
          if (pdfPath) loadPdfFromPath(pdfPath);
        } else if (event.payload.type === "leave") {
          setIsDragOver(false);
        }
      })
      .then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, []);

  async function loadPdfFromPath(filePath: string) {
    try {
      const bytes = await readFile(filePath);
      const blob  = new Blob([bytes], { type: "application/pdf" });
      const name  = filePath.split(/[/\\]/).pop() ?? "document.pdf";
      loadFromBlob(blob, name);
    } catch (err) {
      console.error("Failed to load PDF:", err);
    }
  }

  async function loadPdfFromUrl() {
    const url = urlInput.trim();
    if (!url) return;
    setLoadingUrl(true);
    setUrlError("");
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const name = url.split("/").pop()?.split("?")[0] || "document.pdf";
      loadFromBlob(blob, name);
      setUrlInput("");
      setShowUrlInput(false);
    } catch (err) {
      setUrlError(String(err));
    } finally {
      setLoadingUrl(false);
    }
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file && file.type === "application/pdf") loadFromBlob(file, file.name);
  }

  function handleClear() {
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    setNotePdf(null, "");
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="w-3.5 h-3.5 text-muted flex-shrink-0" />
          <span className="text-xs font-medium text-foreground-secondary truncate">
            {fileName || "PDF Viewer"}
          </span>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {/* URL input toggle */}
          <button
            onClick={() => { setShowUrlInput((v) => !v); setUrlError(""); }}
            className={`flex items-center justify-center w-7 h-7 rounded-lg transition-all
                        ${showUrlInput ? "bg-surface-hover text-foreground-secondary" : "text-muted hover:text-foreground-secondary hover:bg-surface-hover"}`}
            title="Load from URL"
          >
            <LinkIcon className="w-3.5 h-3.5" />
          </button>
          {pdfUrl && (
            <button
              onClick={handleClear}
              className="text-xs text-muted hover:text-foreground-secondary px-2 py-1 rounded
                         hover:bg-surface-hover transition-all"
            >
              Clear
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1 rounded text-muted hover:text-foreground-secondary hover:bg-surface-hover transition-all"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* URL input bar */}
      {showUrlInput && (
        <div className="px-3 py-2 border-b border-border flex-shrink-0">
          <div className="flex gap-2">
            <input
              ref={urlInputRef}
              autoFocus
              type="url"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") loadPdfFromUrl(); }}
              placeholder="https://example.com/document.pdf"
              className="input-base flex-1 text-xs font-mono py-1.5"
            />
            <button
              onClick={loadPdfFromUrl}
              disabled={loadingUrl || !urlInput.trim()}
              className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5 flex-shrink-0"
            >
              {loadingUrl ? <Loader2 className="w-3 h-3 animate-spin" /> : "Load"}
            </button>
          </div>
          {urlError && <p className="text-xs text-red-400 mt-1">{urlError}</p>}
        </div>
      )}

      {/* Content */}
      {pdfUrl ? (
        <div
          className="flex-1 min-h-0 relative"
          onMouseEnter={() => setIframeActive(true)}
          onMouseLeave={() => setIframeActive(false)}
        >
          <iframe
            key={pdfUrl}
            src={`${pdfUrl}#toolbar=1&navpanes=0&statusbar=0`}
            className="w-full h-full border-none"
            title="PDF Viewer"
            loading="lazy"
            style={{
              // When mouse leaves the PDF panel, disable pointer capture so the
              // editor gets events back immediately (fixes the WebKit sticky-hover bug)
              pointerEvents: iframeActive ? "auto" : "none",
            }}
          />
          {/* Transparent overlay restores pointer events to the editor when not hovering */}
          {!iframeActive && (
            <div className="absolute inset-0 pointer-events-none" />
          )}
        </div>
      ) : (
        <div
          className={`flex-1 flex flex-col items-center justify-center gap-4 p-8
                     transition-colors duration-150
                     ${isDragOver ? "bg-surface-hover" : ""}`}
        >
          <div
            className={`w-16 h-16 rounded-2xl flex items-center justify-center transition-all
                        ${isDragOver ? "bg-accent-gradient text-[var(--accent-contrast)] scale-110" : "bg-surface-hover"}`}
          >
            <Upload className={`w-7 h-7 ${isDragOver ? "" : "text-muted"}`} />
          </div>
          <div className="text-center">
            <p className="text-sm text-foreground-secondary font-medium">
              {isDragOver ? "Drop PDF here" : "Drag a PDF here"}
            </p>
            <p className="text-xs text-muted mt-1">or</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => inputRef.current?.click()}
              className="btn-ghost text-sm border border-border"
            >
              Browse files
            </button>
            <button
              onClick={() => { setShowUrlInput(true); urlInputRef.current?.focus(); }}
              className="btn-ghost text-sm border border-border"
            >
              From URL
            </button>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf"
            onChange={handleFileSelect}
            className="hidden"
          />
        </div>
      )}
    </div>
  );
}
