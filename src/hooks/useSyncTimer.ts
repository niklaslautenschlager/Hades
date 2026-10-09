import { useEffect } from "react";
import { useStore } from "../store/useStore";
import { isSyncRunning, syncNow } from "../lib/noteSync";

// Wake-up granularity only. When a sync actually runs is decided by
// `nextSyncAt`, which the engine sets to 30 s after a success and to the
// exponential backoff delay after a failure, and which "Retry now" resets.
const TICK_MS = 5_000;
const PENDING_DEBOUNCE_MS = 400;

export function useSyncTimer() {
  const syncEnabled = useStore((s) => s.syncEnabled);
  const syncFolder = useStore((s) => s.syncFolder);

  useEffect(() => {
    if (!syncEnabled || !syncFolder) return;
    const id = setInterval(() => {
      const s = useStore.getState();
      if (isSyncRunning() || s.quitPending || Date.now() < s.nextSyncAt) return;
      void syncNow({ trigger: "timer" });
    }, TICK_MS);
    return () => clearInterval(id);
  }, [syncEnabled, syncFolder]);

  useEffect(() => {
    if (!syncEnabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    useStore.getState().refreshPendingCount();
    const unsubscribe = useStore.subscribe((s, prev) => {
      if (s.notes === prev.notes && s.syncBase === prev.syncBase) return;
      clearTimeout(timer);
      timer = setTimeout(() => useStore.getState().refreshPendingCount(), PENDING_DEBOUNCE_MS);
    });
    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, [syncEnabled]);
}
