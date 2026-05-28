import { getCurrentWindow } from "@tauri-apps/api/window";
import { Loader2, CloudOff, AlertCircle } from "lucide-react";
import { useStore } from "../store/useStore";

export default function SyncOverlay() {
  const { quitPending, isSyncing, syncError } = useStore(s => ({
    quitPending: s.quitPending,
    isSyncing:   s.isSyncing,
    syncError:   s.syncError,
  }));

  if (!quitPending) return null;

  async function forceQuit() {
    useStore.getState().setQuitPending(false);
    useStore.getState().setForceQuit(true);
    await getCurrentWindow().close();
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-end justify-center p-5 pointer-events-none">
      <div className="pointer-events-auto surface shadow-2xl border border-border rounded-xl
                      px-5 py-4 flex items-center gap-4 min-w-[340px] max-w-sm">
        {syncError ? (
          <>
            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">Sync failed</p>
              <p className="text-xs text-muted truncate">{syncError}</p>
            </div>
            <button
              onClick={forceQuit}
              className="flex-shrink-0 text-xs text-muted hover:text-foreground transition-colors underline"
            >
              Quit anyway
            </button>
          </>
        ) : isSyncing ? (
          <>
            <Loader2 className="w-4 h-4 text-muted flex-shrink-0 animate-spin" />
            <p className="flex-1 text-sm text-foreground">Saving notes to sync folder…</p>
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
