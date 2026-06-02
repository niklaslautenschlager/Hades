import { useEffect } from "react";
import { useStore } from "../store/useStore";
import { initialSync, syncDirtyNotes } from "../lib/noteSync";
import type { NoteFile } from "../store/useStore";

// Pull remote changes and push local changes on this cadence. Cloud providers
// (Dropbox, iCloud, …) take their own time to land files on disk, so a tighter
// interval mostly just reduces the window before we notice a landed change.
const SYNC_INTERVAL_MS = 30 * 1000;

// Cheap signature so we only re-render the tree when something actually changed.
function signature(notes: NoteFile[]): string {
  return notes
    .map((n) => `${n.id}:${n.updatedAt}:${n.parentId ?? ""}:${n.name}`)
    .sort()
    .join("|");
}

export function useSyncTimer() {
  const syncEnabled = useStore((s) => s.syncEnabled);
  const syncFolder = useStore((s) => s.syncFolder);

  useEffect(() => {
    if (!syncEnabled || !syncFolder) return;
    const folder = syncFolder; // capture for closure

    const run = async () => {
      const st = useStore.getState();
      if (st.isSyncing) return;

      st.setIsSyncing(true);
      st.setSyncError(null);
      try {
        // 1) PULL: merge anything new/changed on disk (other devices) into state
        const { mergedNotes } = await initialSync(folder, st.notes);
        if (signature(mergedNotes) !== signature(st.notes)) {
          st.applyMergedNotes(mergedNotes);
        }

        // 2) PUSH: write out locally-changed notes
        const cur = useStore.getState();
        if (cur.hasPendingChanges) {
          await syncDirtyNotes(cur.notes, folder, cur.lastSyncAt);
          cur.setHasPendingChanges(false);
        }

        useStore.getState().setLastSyncAt(new Date().toISOString());
      } catch (e) {
        useStore.getState().setSyncError(e instanceof Error ? e.message : String(e));
      } finally {
        useStore.getState().setIsSyncing(false);
      }
    };

    const id = setInterval(run, SYNC_INTERVAL_MS);
    return () => clearInterval(id);
  }, [syncEnabled, syncFolder]);
}
