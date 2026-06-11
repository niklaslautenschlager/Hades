import { useEffect, useRef } from "react";
import { useStore } from "../store/useStore";
import { fullSync } from "../lib/noteSync";

export function useStartupSync() {
  const hasRun = useRef(false);

  useEffect(() => {
    if (hasRun.current) return;
    hasRun.current = true;

    const { syncEnabled, syncFolder, notes, setIsSyncing, setLastSyncAt, setSyncError, applyMergedNotes } = useStore.getState();
    if (!syncEnabled || !syncFolder) return;

    setIsSyncing(true);
    setSyncError(null);

    fullSync(syncFolder, notes)
      .then(({ mergedNotes }) => {
        applyMergedNotes(mergedNotes);
        useStore.getState().setHasPendingChanges(false);
        setLastSyncAt(new Date().toISOString());
      })
      .catch(e => setSyncError(e instanceof Error ? e.message : String(e)))
      .finally(() => setIsSyncing(false));
  }, []);
}
