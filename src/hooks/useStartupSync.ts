import { useEffect, useRef } from "react";
import { useStore } from "../store/useStore";
import { syncNow } from "../lib/noteSync";

export function useStartupSync() {
  const hasRun = useRef(false);

  useEffect(() => {
    if (hasRun.current) return;
    hasRun.current = true;

    const { syncEnabled, syncFolder } = useStore.getState();
    if (!syncEnabled || !syncFolder) return;
    void syncNow({ trigger: "startup" });
  }, []);
}
