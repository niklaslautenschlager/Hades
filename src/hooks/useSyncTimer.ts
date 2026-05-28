import { useEffect } from "react";
import { useStore } from "../store/useStore";
import { syncDirtyNotes } from "../lib/noteSync";

const SYNC_INTERVAL_MS = 5 * 60 * 1000;

export function useSyncTimer() {
  const syncEnabled = useStore(s => s.syncEnabled);
  const syncFolder  = useStore(s => s.syncFolder);

  useEffect(() => {
    if (!syncEnabled || !syncFolder) return;

    const folder = syncFolder; // capture for closure

    const run = async () => {
      // Always read fresh state so we don't close over stale values
      const { hasPendingChanges, isSyncing, notes, lastSyncAt,
              setIsSyncing, setLastSyncAt, setHasPendingChanges, setSyncError } = useStore.getState();

      if (!hasPendingChanges || isSyncing) return;

      setIsSyncing(true);
      setSyncError(null);
      try {
        await syncDirtyNotes(notes, folder, lastSyncAt);
        setLastSyncAt(new Date().toISOString());
        setHasPendingChanges(false);
      } catch (e) {
        setSyncError(e instanceof Error ? e.message : String(e));
      } finally {
        setIsSyncing(false);
      }
    };

    const id = setInterval(run, SYNC_INTERVAL_MS);
    return () => clearInterval(id);
  }, [syncEnabled, syncFolder]);
}
