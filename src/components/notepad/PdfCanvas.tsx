import { useEffect, useRef, useState, useCallback } from "react";
import { Loader2, Plus, Minus } from "lucide-react";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { useStore } from "../../store/useStore";

// PDF.js-based renderer (replaces the native iframe) so we control the page and
// can remember it across tab/module switches. Pages render lazily to canvas as
// they scroll near the viewport. The current page is persisted per-PDF.

interface Props {
  url: string;       // blob: URL for the PDF bytes
  storageKey: string; // doc id or filename — where to remember the page
}

export default function PdfCanvas({ url, storageKey }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const rendered = useRef<Set<number>>(new Set());
  const [numPages, setNumPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(() => useStore.getState().pdfZoom[storageKey] ?? 1);
  const zoomRef = useRef(zoom);
  const restoredRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Render one page into its placeholder canvas at the container's width × zoom.
  const renderPage = useCallback(async (pageNum: number) => {
    const doc = docRef.current;
    const container = scrollRef.current;
    if (!doc || !container || rendered.current.has(pageNum)) return;
    const holder = container.querySelector<HTMLDivElement>(`[data-page="${pageNum}"]`);
    if (!holder) return;
    rendered.current.add(pageNum);
    try {
      const pdfPage = await doc.getPage(pageNum);
      const unscaled = pdfPage.getViewport({ scale: 1 });
      const targetW = Math.max(200, (container.clientWidth - 24) * zoomRef.current);
      const scale = (targetW / unscaled.width) * (window.devicePixelRatio || 1);
      const viewport = pdfPage.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = "100%";
      canvas.style.height = "auto";
      canvas.style.display = "block";
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      await pdfPage.render({ canvasContext: ctx, viewport }).promise;
      holder.replaceChildren(canvas);
    } catch {
      rendered.current.delete(pageNum); // allow a retry
    }
  }, []);

  // Load the document.
  useEffect(() => {
    let cancelled = false;
    restoredRef.current = false;
    rendered.current = new Set();
    setLoading(true);
    setError(null);
    setNumPages(0);

    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        const doc = await pdfjs.getDocument({ url }).promise;
        if (cancelled) { await doc.destroy(); return; }
        docRef.current = doc;
        setNumPages(doc.numPages);
        setLoading(false);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      docRef.current?.destroy().catch(() => {});
      docRef.current = null;
    };
  }, [url]);

  // After pages mount, render the first few and restore the saved page.
  useEffect(() => {
    if (numPages === 0) return;
    // Render initial pages.
    for (let p = 1; p <= Math.min(3, numPages); p++) void renderPage(p);

    if (!restoredRef.current) {
      restoredRef.current = true;
      const saved = useStore.getState().pdfPages[storageKey];
      if (saved && saved > 1 && saved <= numPages) {
        // Wait a tick for placeholders to lay out, then jump.
        setTimeout(() => {
          const holder = scrollRef.current?.querySelector<HTMLElement>(`[data-page="${saved}"]`);
          holder?.scrollIntoView({ block: "start" });
          for (let p = saved; p < Math.min(saved + 2, numPages + 1); p++) void renderPage(p);
          setPage(saved);
        }, 60);
      }
    }
  }, [numPages, renderPage, storageKey]);

  function onScroll() {
    const container = scrollRef.current;
    if (!container) return;
    const holders = container.querySelectorAll<HTMLElement>("[data-page]");
    const top = container.scrollTop;
    let current = 1;
    for (const h of holders) {
      const pageNum = Number(h.dataset.page);
      // Lazy-render pages within ~1.5 viewports of the scroll position.
      if (Math.abs(h.offsetTop - top) < container.clientHeight * 1.5) void renderPage(pageNum);
      if (h.offsetTop - 12 <= top) current = pageNum;
    }
    if (current !== page) setPage(current);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      useStore.getState().setPdfPage(storageKey, current);
    }, 400);
  }

  // ── Zoom (§3.1) ────────────────────────────────────────────────────────────
  // Re-render visible pages whenever the zoom factor changes, keeping the
  // current page anchored, and persist the chosen zoom per document.
  useEffect(() => {
    zoomRef.current = zoom;
    if (numPages === 0) return;
    const container = scrollRef.current;
    const anchor = page;
    rendered.current = new Set(); // force re-render at the new scale
    const top = container?.scrollTop ?? 0;
    void Promise.resolve().then(async () => {
      for (let p = Math.max(1, anchor - 1); p <= Math.min(numPages, anchor + 2); p++) {
        await renderPage(p);
      }
      // Keep the page the user was on roughly in view after re-layout.
      const holder = container?.querySelector<HTMLElement>(`[data-page="${anchor}"]`);
      if (holder && top > 0) holder.scrollIntoView({ block: "start" });
    });
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => useStore.getState().setPdfZoom(storageKey, zoom), 400);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, numPages]);

  function adjustZoom(delta: number) {
    setZoom((z) => Math.max(0.5, Math.min(3, Math.round((z + delta) * 100) / 100)));
  }

  function onWheel(e: React.WheelEvent) {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    adjustZoom(e.deltaY < 0 ? 0.1 : -0.1);
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 text-center">
        <p className="text-xs text-red-400">Couldn't render this PDF: {error}</p>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 relative">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="w-5 h-5 text-muted animate-spin" />
        </div>
      )}
      {numPages > 0 && (
        <div className="absolute top-2 right-3 z-10 flex items-center gap-1">
          <div className="flex items-center rounded-md bg-surface-elevated/95 border border-border overflow-hidden">
            <button
              onClick={() => adjustZoom(-0.1)}
              title="Zoom out"
              className="px-1.5 py-0.5 text-foreground-secondary hover:bg-surface-hover transition-colors"
            >
              <Minus className="w-3 h-3" />
            </button>
            <button
              onClick={() => setZoom(1)}
              title="Reset zoom"
              className="px-1.5 py-0.5 text-[11px] text-foreground-secondary hover:bg-surface-hover transition-colors tabular-nums min-w-[34px]"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              onClick={() => adjustZoom(0.1)}
              title="Zoom in"
              className="px-1.5 py-0.5 text-foreground-secondary hover:bg-surface-hover transition-colors"
            >
              <Plus className="w-3 h-3" />
            </button>
          </div>
          <div className="px-2 py-0.5 rounded-md bg-surface-elevated/95 border border-border text-[11px] text-foreground-secondary tabular-nums">
            {page} / {numPages}
          </div>
        </div>
      )}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        onWheel={onWheel}
        className="h-full overflow-auto px-3 py-3 bg-surface-elevated"
      >
        {Array.from({ length: numPages }, (_, i) => (
          <div
            key={i}
            data-page={i + 1}
            className="mx-auto mb-3 bg-white rounded shadow-sm min-h-[200px]"
            style={{ width: `${100 * zoom}%`, maxWidth: `${900 * zoom}px` }}
          />
        ))}
      </div>
    </div>
  );
}
