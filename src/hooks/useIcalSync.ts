import { useEffect, useRef } from "react";
import { useStore } from "../store/useStore";
import { fetchAndParseIcal } from "../lib/ical";

// Refresh enabled iCal feeds on launch, then on a slow interval. Previously
// feeds only updated when the user manually hit "sync" in the feed modal, so
// recurring classes and newly-added term events never showed up (and the AI's
// read_schedule saw nothing). Best-effort: a failing feed is left as-is.
const REFRESH_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

async function refreshAll() {
  const { icalFeeds, syncIcalEvents } = useStore.getState();
  for (const feed of icalFeeds) {
    if (!feed.enabled) continue;
    try {
      const events = await fetchAndParseIcal(feed);
      syncIcalEvents(feed.id, events);
    } catch {
      // Offline or feed error — keep whatever we already have.
    }
  }
}

export function useIcalSync() {
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    // Slight delay so it doesn't contend with first paint / startup sync.
    const kickoff = setTimeout(() => { void refreshAll(); }, 1500);
    const interval = setInterval(() => { void refreshAll(); }, REFRESH_INTERVAL_MS);

    return () => {
      clearTimeout(kickoff);
      clearInterval(interval);
    };
  }, []);
}
