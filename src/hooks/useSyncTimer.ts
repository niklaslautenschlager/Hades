import { useEffect, useRef } from "react";
import { useStore } from "../store/useStore";
import { syncDirtyNotes } from "../lib/noteSync";

const SYNC_INTERVAL_MS = 5 * 60 * 1000;

export function useSyncTimer() {
  const syncEnabled = useStore(s => s.syncEnabled);
  const syncFolder  = useStore(s => s.syncFolder);

  // Use refs so the interval callback always sees fresh state without re-registering
  const stateRef = useRef({
    notes:             useStore.getState().notes,
    lastSyncAt:        useStore.getState().lastSyncAt,
    isSyncing:         useStore.getState().isSyncing,
    hasPendingChanges: useStore.getState().hasPendingChanges,
  });

  useEffect(() => {
    return useStore.subscribe(s => {
      stateRef.current = {
        notes:             s.notes,
        lastSyncAt:        s.lastSyncAt,
        isSyncing:         s.isSyncing,
        hasPendingChanges: s.hasPendingChanges,
      };
    });
  }, []);

  useEffect(() => {
    if (!syncEnabled || !syncFolder) return;

    const run = async () => {
      const { notes, lastSyncAt, isSyncing, hasPendingChanges } = stateRef.current;
      if (!hasPendingChanges || isSyncing) return;

      const { setIsSyncing, setLastSyncAt, setHasPendingChanges, setSyncError } = useStore.getState();
      setIsSyncing(true);
      setSyncError(null);
      try {
        await syncDirtyNotes(notes, syncFolder, lastSyncAt);
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
