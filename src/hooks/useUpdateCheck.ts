import { useEffect, useRef } from "react";
import { useStore } from "../store/useStore";
import { checkForUpdate } from "../lib/updater";

export function useUpdateCheck() {
  const hasRun = useRef(false);

  useEffect(() => {
    if (hasRun.current) return;
    hasRun.current = true;

    checkForUpdate()
      .then(info => {
        if (info) {
          useStore.getState().setUpdateInfo(info.version, info.changelog, info.downloadUrl);
        }
      })
      .catch(() => {
        // Silent — no network / no releases yet is not an error worth surfacing
      });
  }, []);
}
