import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useStore } from "../store/useStore";
import { syncDirtyNotes } from "../lib/noteSync";

export function useQuitGuard() {
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    getCurrentWindow().onCloseRequested(async event => {
      const s = useStore.getState();

      // Let it close if sync is off, no pending changes, or user already force-quit
      if (s.forceQuit || !s.syncEnabled || !s.syncFolder || !s.hasPendingChanges) {
        s.setForceQuit(false);
        return;
      }

      event.preventDefault();
      s.setQuitPending(true);
      s.setIsSyncing(true);
      s.setSyncError(null);

      try {
        const fresh = useStore.getState();
        await syncDirtyNotes(fresh.notes, fresh.syncFolder!, fresh.lastSyncAt);
        useStore.getState().setLastSyncAt(new Date().toISOString());
        useStore.getState().setHasPendingChanges(false);
      } catch (e) {
        useStore.getState().setSyncError(e instanceof Error ? e.message : String(e));
        // Don't auto-close on error — let the user decide via the overlay
        useStore.getState().setIsSyncing(false);
        return;
      }

      useStore.getState().setIsSyncing(false);
      useStore.getState().setQuitPending(false);

      // Set forceQuit so the re-triggered CloseRequested doesn't loop
      useStore.getState().setForceQuit(true);
      await getCurrentWindow().close();
    }).then(fn => { unlisten = fn; });

    return () => { unlisten?.(); };
  }, []);
}
