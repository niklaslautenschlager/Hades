// Calendar data is stored as UTC ISO strings. Models are unreliable at timezone
// math, so everything handed to them (tool observations, index text) is
// formatted in the user's LOCAL zone here — never converted by the model.

export const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || "local time";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const pad2 = (n: number) => String(n).padStart(2, "0");

export function fmtLocal(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    weekday: "short", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

export function fmtLocalTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function clock(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function dayLabel(d: Date, now: Date): string {
  const year = d.getFullYear() === now.getFullYear() ? "" : ` ${d.getFullYear()}`;
  return `${DAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${d.getDate()}${year}`;
}

/** "Wed Oct 14, 14:00–15:30" (or both dates when it spans days), in local time. */
export function fmtRangeLocal(startIso: string, endIso: string, now: Date = new Date()): string {
  const s = new Date(startIso);
  if (isNaN(s.getTime())) return startIso;
  const e = new Date(endIso);
  if (isNaN(e.getTime())) return `${dayLabel(s, now)}, ${clock(s)}`;
  if (s.toDateString() === e.toDateString()) {
    return `${dayLabel(s, now)}, ${clock(s)}–${clock(e)}`;
  }
  return `${dayLabel(s, now)}, ${clock(s)} – ${dayLabel(e, now)}, ${clock(e)}`;
}

/** "Wed Oct 14, 14:00" in local time. */
export function fmtPointLocal(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return `${dayLabel(d, now)}, ${clock(d)}`;
}
