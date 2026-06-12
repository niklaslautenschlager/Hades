import ICAL from "ical.js";
import { invoke } from "@tauri-apps/api/core";
import type { CalendarEvent, IcalFeed } from "../store/useStore";

// How far around "now" we materialize recurring occurrences. Feeds (class
// timetables, etc.) usually recur weekly; we expand a generous window so the
// calendar and the AI both see the next several months of classes.
const WINDOW_BACK_DAYS = 31;
const WINDOW_FWD_DAYS = 400;
const MAX_OCCURRENCES_PER_EVENT = 800; // guard against runaway / infinite rules

function occurrenceId(uid: string, startIso: string): string {
  return `ical-${uid}-${startIso}`;
}

/** Calendar share links are often `webcal://…` — fetch them over https. */
function normalizeFeedUrl(url: string): string {
  const u = url.trim();
  if (/^webcal:\/\//i.test(u)) return u.replace(/^webcal:\/\//i, "https://");
  return u;
}

export async function fetchAndParseIcal(feed: IcalFeed): Promise<CalendarEvent[]> {
  let raw: string;
  try {
    raw = await invoke<string>("fetch_ical", { url: normalizeFeedUrl(feed.url) });
  } catch (err) {
    const msg = String(err);
    // Give a friendlier hint for the common failure modes.
    const hint = /HTTP 5\d\d/.test(msg)
      ? " The calendar server returned an error — check the URL is a direct .ics link (not a web page) and is publicly accessible."
      : /HTTP 4\d\d/.test(msg)
      ? " The link was rejected (404/403) — it may be private or expired. Re-copy the 'secret'/'iCal' export URL."
      : "";
    throw new Error(`Couldn't load "${feed.name}": ${msg}.${hint}`);
  }

  const jcal = ICAL.parse(raw);
  const comp = new ICAL.Component(jcal);
  const vevents = comp.getAllSubcomponents("vevent");

  const events: CalendarEvent[] = [];
  const now = Date.now();
  const rangeStart = new Date(now - WINDOW_BACK_DAYS * 86400_000);
  const rangeEnd = new Date(now + WINDOW_FWD_DAYS * 86400_000);

  const push = (
    uid: string,
    title: string,
    start: Date,
    end: Date,
    description?: string
  ) => {
    const startIso = start.toISOString();
    events.push({
      id: occurrenceId(uid, startIso),
      title,
      start: startIso,
      end: end.toISOString(),
      color: feed.color,
      source: "ical",
      icalFeedId: feed.id,
      description: description || undefined,
    });
  };

  for (const vevent of vevents) {
    try {
      const event = new ICAL.Event(vevent);
      const title = event.summary || "Untitled";
      const description = event.description || undefined;
      const uid = event.uid || Math.random().toString(36).slice(2);

      if (event.isRecurring()) {
        // Expand the RRULE into individual dated occurrences within our window.
        // ical.js's iterator already skips EXDATEs and applies RECURRENCE-ID
        // overrides.
        const iter = event.iterator();
        let count = 0;
        let nextTime = iter.next();
        while (nextTime && count < MAX_OCCURRENCES_PER_EVENT) {
          count++;
          let details;
          try {
            details = event.getOccurrenceDetails(nextTime);
          } catch {
            nextTime = iter.next();
            continue;
          }
          const start = details.startDate.toJSDate();
          const end = details.endDate
            ? details.endDate.toJSDate()
            : new Date(start.getTime() + 3600_000);

          if (start > rangeEnd) break;               // past the window — stop
          if (end >= rangeStart) push(uid, title, start, end, description); // inside window
          nextTime = iter.next();
        }
      } else {
        const start = event.startDate.toJSDate();
        const end = event.endDate?.toJSDate() ?? new Date(start.getTime() + 3600_000);
        // Single events: include if they end after the window start.
        if (end >= rangeStart && start <= rangeEnd) {
          push(uid, title, start, end, description);
        }
      }
    } catch {
      // Malformed event — skip
    }
  }

  return events;
}
