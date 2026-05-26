import ICAL from "ical.js";
import { invoke } from "@tauri-apps/api/core";
import type { CalendarEvent, IcalFeed } from "../store/useStore";

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export async function fetchAndParseIcal(feed: IcalFeed): Promise<CalendarEvent[]> {
  let raw: string;
  try {
    raw = await invoke<string>("fetch_ical", { url: feed.url });
  } catch (err) {
    throw new Error(`Failed to fetch iCal feed "${feed.name}": ${String(err)}`);
  }

  const jcal = ICAL.parse(raw);
  const comp = new ICAL.Component(jcal);
  const vevents = comp.getAllSubcomponents("vevent");

  const events: CalendarEvent[] = [];

  for (const vevent of vevents) {
    try {
      const event = new ICAL.Event(vevent);
      const summary = event.summary || "Untitled";
      const start = event.startDate.toJSDate();
      const end = event.endDate?.toJSDate() ?? new Date(start.getTime() + 3600000);

      events.push({
        id: uid(),
        title: summary,
        start: start.toISOString(),
        end: end.toISOString(),
        color: feed.color,
        source: "ical",
        icalFeedId: feed.id,
        description: event.description || undefined,
      });
    } catch {
      // Malformed event — skip
    }
  }

  return events;
}
