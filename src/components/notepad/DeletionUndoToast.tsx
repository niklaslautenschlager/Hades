import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Undo2, Trash2 } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../../store/useStore";

// Undo for tree deletions. A toast appears after a note/folder is deleted with
// an Undo button, and Cmd/Ctrl-Z restores it — but only while focus ISN'T in
// the editor (so the editor keeps its own undo).
export default function DeletionUndoToast() {
  const { lastDeletedNotes, restoreLastDeletion, clearDeletionUndo } = useStore(
    useShallow((s) => ({
      lastDeletedNotes: s.lastDeletedNotes,
      restoreLastDeletion: s.restoreLastDeletion,
      clearDeletionUndo: s.clearDeletionUndo,
    }))
  );

  // Auto-dismiss after a while.
  useEffect(() => {
    if (!lastDeletedNotes) return;
    const t = setTimeout(clearDeletionUndo, 9000);
    return () => clearTimeout(t);
  }, [lastDeletedNotes, clearDeletionUndo]);

  // Cmd/Ctrl-Z to undo — skip when typing in the editor or an input.
  useEffect(() => {
    if (!lastDeletedNotes) return;
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z" || e.shiftKey) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.closest(".cm-editor") || el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      e.preventDefault();
      restoreLastDeletion();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [lastDeletedNotes, restoreLastDeletion]);

  const count = lastDeletedNotes?.length ?? 0;
  const folders = lastDeletedNotes?.filter((n) => n.isFolder).length ?? 0;
  const label =
    folders > 0
      ? `Deleted folder${folders === 1 ? "" : "s"} (${count} item${count === 1 ? "" : "s"})`
      : `Deleted ${count} note${count === 1 ? "" : "s"}`;

  return (
    <AnimatePresence>
      {lastDeletedNotes && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[200] surface border border-border
                     rounded-xl shadow-2xl px-3 py-2 flex items-center gap-3"
        >
          <Trash2 className="w-3.5 h-3.5 text-muted flex-shrink-0" />
          <span className="text-xs text-foreground-secondary">{label}</span>
          <button
            onClick={restoreLastDeletion}
            className="flex items-center gap-1.5 text-xs font-medium text-accent hover:underline"
          >
            <Undo2 className="w-3.5 h-3.5" />
            Undo
            <kbd className="text-[10px] text-muted border border-border rounded px-1 ml-0.5">⌘Z</kbd>
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
