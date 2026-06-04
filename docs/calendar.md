# Calendar

**What it does:** A month/week/day calendar for your own events plus read-only subscriptions to external calendars (via iCal/`.ics` feeds). Events you mark as **deadlines** automatically appear in your [Tasks](tasks.md) list.

**Why use it:** See your schedule next to your focus tools, and turn deadlines into to-dos without double-entry.

It's the **Calendar** icon in the sidebar.

---

## Views and navigation

Switch between **Month**, **Week**, and **Day** views from the view selector.

- The calendar **opens on today** every time you launch Hades, with the current day **highlighted**.
- In Week and Day views, a **current-time line** marks the present moment.
- Navigate forward/back with the arrows; jump home with the **Today** control.

**Calendar display options** (in [Settings → Calendar & Tasks](settings-and-themes.md#calendar--tasks)):

- **Week starts on Monday** (default) or Sunday.
- **Show ISO week numbers**.

---

## Create and edit events

**Create an event:**

- **Click a day** (Month view) or **drag across a time range** (Week/Day view) to start a new event, **or** use the add-event control.

**In the event editor you can set:**

- **Title**
- **Start / end** date and time
- **Color** — pick from the base palette, or click **"more colors"** to reveal the full set.
- **Description**
- **Recurrence** (see below)
- **Deadline** toggle (see below)

**Edit or delete:** click an existing event to reopen the editor. Use **Clear all events** to wipe local events (your iCal subscriptions are separate).

---

## Recurring events

**Why:** Set up a weekly lecture or a monthly review once, instead of copying it.

In the event editor, choose a recurrence:

- **Frequency:** daily, weekly, or monthly.
- **Interval:** every *N* days/weeks/months (e.g. every **2** weeks).
- **Days of week** (for weekly): pick which weekdays it lands on.
- **End condition:**
  - **Never** — repeats indefinitely
  - **After N occurrences**
  - **Until a date**

---

## Deadlines → Tasks

**What it does:** Mark an event as a **deadline**, and Hades creates a matching item in your [Tasks](tasks.md) list with the event's title and date.

**Why:** Your "essay due Friday" lives on the calendar *and* shows up where you track to-dos.

**How it behaves:**

- Toggle **Deadline** on an event → a linked task appears.
- **Rename or reschedule** the event → the linked task updates to match.
- **Remove the deadline** flag, or delete the event → the linked task is removed.
- These linked tasks are **protected** from "Clear all tasks" (the calendar owns them).

> This auto-sync is on by default. Turn it off with **Auto-sync deadlines to Tasks** in [Settings → Calendar & Tasks](settings-and-themes.md#calendar--tasks).

---

## Subscribe to an external calendar (iCal / `.ics`)

**Why:** Pull in your university timetable, a shared team calendar, or holidays — kept up to date automatically and shown alongside your own events.

1. Open the **iCal feeds** manager in the Calendar module.
2. Paste the feed's **`.ics` URL**, give it a **name** and **color**.
3. Add it. Its events appear in your calendar.

**Managing feeds:**

- **Toggle** a feed on/off to show or hide its events without deleting it.
- **Remove** a feed to delete it and all of its events from your calendar.

**Where to find an `.ics` URL:** In most calendar apps, look for "Subscribe," "Export," or "Secret address in iCal format." Google Calendar, university portals, and most scheduling tools provide one.

---

## Troubleshooting

**My iCal events aren't showing up.**
- Confirm the URL points to a raw **`.ics`** feed (it should start with `http(s)://` and the calendar app labels it as "iCal format").
- Make sure the feed is **enabled** (toggle it on).
- Some feeds require the URL to be public; private/login-only links won't work.

**A deadline didn't create a task.**
Check that **Auto-sync deadlines to Tasks** is enabled in Settings, and that the event's **Deadline** toggle is on.

**Recurring event shows on the wrong days.**
For weekly recurrence, verify the selected **days of week**. Remember the week-start setting (Mon/Sun) affects how the grid is laid out, not which dates the rule produces.
