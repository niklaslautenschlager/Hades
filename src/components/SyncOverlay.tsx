import { getCurrentWindow } from "@tauri-apps/api/window";
import { Loader2, CloudOff, AlertCircle } from "lucide-react";
import { useStore } from "../store/useStore";

export default function SyncOverlay() {
  const quitPending = useStore(s => s.quitPending);
  const isSyncing   = useStore(s => s.isSyncing);
  const syncStatus  = useStore(s => s.syncStatus);
  const syncError   = useStore(s => s.syncError);
  const pendingCount = useStore(s => s.pendingCount);

  if (!quitPending) return null;

  async function forceQuit() {
    useStore.getState().setQuitPending(false);
    useStore.getState().setForceQuit(true);
    try {
      await getCurrentWindow().close();
    } catch (e) {
      useStore.getState().setForceQuit(false);
      useStore.getState().setSyncError(e instanceof Error ? e.message : String(e));
    }
  }

  // Closing again re-enters the quit guard, which runs another sync attempt.
  async function retry() {
    try {
      await getCurrentWindow().close();
    } catch (e) {
      useStore.getState().setSyncError(e instanceof Error ? e.message : String(e));
    }
  }

  const failed = !isSyncing && (syncStatus === "offline" || syncStatus === "error" || syncError);

  return (
    <div className="fixed inset-0 z-[200] flex items-end justify-center p-5 pointer-events-none">
      <div className="pointer-events-auto surface shadow-2xl border border-border rounded-xl
                      px-5 py-4 flex items-center gap-4 min-w-[340px] max-w-sm">
        {failed ? (
          <>
            {syncStatus === "offline"
              ? <CloudOff className="w-4 h-4 text-amber-500 flex-shrink-0" />
              : <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">
                {syncStatus === "offline" ? "Sync folder unavailable" : "Sync failed"}
              </p>
              <p className="text-xs text-muted line-clamp-2">{syncError}</p>
              <p className="text-xs text-muted mt-0.5">Your changes are saved on this device and sync next time.</p>
            </div>
            <div className="flex flex-col items-end gap-1 flex-shrink-0">
              <button
                onClick={retry}
                className="text-xs text-foreground-secondary hover:text-foreground transition-colors underline"
              >
                Retry
              </button>
              <button
                onClick={forceQuit}
                className="text-xs text-muted hover:text-foreground transition-colors underline"
              >
                Quit anyway
              </button>
            </div>
          </>
        ) : isSyncing ? (
          <>
            <Loader2 className="w-4 h-4 text-muted flex-shrink-0 animate-spin" />
            <p className="flex-1 text-sm text-foreground">
              {pendingCount > 0
                ? `Saving ${pendingCount} change${pendingCount === 1 ? "" : "s"} to sync folder…`
                : "Saving notes to sync folder…"}
            </p>
            <button
              onClick={forceQuit}
              className="flex-shrink-0 text-xs text-muted hover:text-foreground transition-colors underline"
            >
              Quit anyway
            </button>
          </>
        ) : (
          <>
            <CloudOff className="w-4 h-4 text-muted flex-shrink-0" />
            <p className="flex-1 text-sm text-foreground">Finishing up…</p>
          </>
        )}
      </div>
    </div>
  );
}
