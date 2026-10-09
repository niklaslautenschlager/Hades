import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useStore } from "../store/useStore";
import { flushPendingForQuit } from "../lib/noteSync";
import { countPending } from "../lib/syncReconcile";

export function useQuitGuard() {
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;

    getCurrentWindow().onCloseRequested(async event => {
      const s = useStore.getState();

      // Let it close if sync is off, nothing is waiting to be pushed, or the user already chose to quit
      if (s.forceQuit || !s.syncEnabled || !s.syncFolder || countPending(s.notes, s.syncBase) === 0) {
        s.setForceQuit(false);
        return;
      }

      event.preventDefault();
      s.setQuitPending(true);

      const outcome = await flushPendingForQuit();
      // On failure the overlay shows the error; the user decides between Retry and Quit anyway
      if (!outcome.ok) return;

      useStore.getState().setQuitPending(false);

      // Set forceQuit so the re-triggered CloseRequested doesn't loop
      useStore.getState().setForceQuit(true);
      try {
        await getCurrentWindow().close();
      } catch (e) {
        useStore.getState().setForceQuit(false);
        useStore.getState().setSyncError(e instanceof Error ? e.message : String(e));
      }
    }).then(fn => {
      if (disposed) fn();
      else unlisten = fn;
    }).catch(() => {});

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
}
