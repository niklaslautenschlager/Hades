import { useState, useRef, useEffect } from "react";
import { Upload, X, FileText } from "lucide-react";
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

  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function loadFromBlob(blob: Blob, name: string) {
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    const url = URL.createObjectURL(blob);
    setNotePdf(url, name);
  }

  useEffect(() => {
    let unlisten: (() => void) | null = null;

    getCurrentWindow()
      .onDragDropEvent((event) => {
        if (event.payload.type === "over") {
          setIsDragOver(true);
        } else if (event.payload.type === "drop") {
          setIsDragOver(false);
          const paths = event.payload.paths;
          const pdfPath = paths.find((p: string) => p.toLowerCase().endsWith(".pdf"));
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
      const blob = new Blob([bytes], { type: "application/pdf" });
      const name = filePath.split("/").pop() ?? filePath.split("\\").pop() ?? "document.pdf";
      loadFromBlob(blob, name);
    } catch (err) {
      console.error("Failed to load PDF:", err);
    }
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file && file.type === "application/pdf") {
      loadFromBlob(file, file.name);
    }
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
        <div className="flex items-center gap-1">
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

      {/* Content */}
      {pdfUrl ? (
        <div className="flex-1 min-h-0">
          <iframe
            key={pdfUrl}
            src={`${pdfUrl}#toolbar=1&navpanes=0&statusbar=0`}
            className="w-full h-full border-none"
            title="PDF Viewer"
            loading="lazy"
          />
        </div>
      ) : (
        <div
          className={`flex-1 flex flex-col items-center justify-center gap-4 p-8
                     transition-colors duration-150
                     ${isDragOver ? "bg-surface-hover" : ""}`}
        >
          <div className={`w-16 h-16 rounded-2xl flex items-center justify-center transition-all
                          ${isDragOver ? "bg-foreground text-surface scale-110" : "bg-surface-hover"}`}>
            <Upload className={`w-7 h-7 ${isDragOver ? "" : "text-muted"}`} />
          </div>
          <div className="text-center">
            <p className="text-sm text-foreground-secondary font-medium">
              {isDragOver ? "Drop PDF here" : "Drag a PDF here"}
            </p>
            <p className="text-xs text-muted mt-1">or</p>
          </div>
          <button
            onClick={() => inputRef.current?.click()}
            className="btn-ghost text-sm border border-border"
          >
            Browse files
          </button>
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
