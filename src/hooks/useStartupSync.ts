import { useEffect, useRef } from "react";
import { useStore } from "../store/useStore";
import { initialSync, syncDirtyNotes } from "../lib/noteSync";

export function useStartupSync() {
  const hasRun = useRef(false);

  useEffect(() => {
    if (hasRun.current) return;
    hasRun.current = true;

    const { syncEnabled, syncFolder, notes, setIsSyncing, setLastSyncAt, setSyncError, applyMergedNotes } = useStore.getState();
    if (!syncEnabled || !syncFolder) return;

    setIsSyncing(true);
    setSyncError(null);

    initialSync(syncFolder, notes)
      .then(async ({ mergedNotes, needsUploadCount }) => {
        applyMergedNotes(mergedNotes);
        // Upload local-only and locally-newer notes to disk
        if (needsUploadCount > 0) {
          const { lastSyncAt } = useStore.getState();
          await syncDirtyNotes(mergedNotes, syncFolder, lastSyncAt);
        }
        setLastSyncAt(new Date().toISOString());
      })
      .catch(e => setSyncError(e instanceof Error ? e.message : String(e)))
      .finally(() => setIsSyncing(false));
  }, []);
}
