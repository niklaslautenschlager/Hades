# Tasks

**What it does:** A fast, no-friction to-do list. Add tasks, check them off, reorder them, and clear them out. Tasks can come from [calendar deadlines](calendar.md#deadlines--tasks) and can be linked to the [Focus timer](focus-timer.md#link-a-task-to-the-timer).

**Why use it:** Capture what you need to do in seconds, then knock items out — with the timer and calendar wired in so nothing falls through the cracks.

It's the **Tasks** icon (checkbox) in the sidebar.

---

## Adding and editing tasks

| Action | How |
|--------|-----|
| **Add a task** | Type in the input box and press **Enter**. |
| **Rename a task** | **Double-click** it, edit, press **Enter** (or **Escape** to cancel). |
| **Complete a task** | Click its **checkbox**. It animates a strike-through and moves to the completed section. A soft sound plays. |
| **Reorder** | Drag a task to a new position. |
| **Delete** | Use the delete control on the task. |

Tasks are split into **Pending** and **Completed** sections so your active list stays clean.

---

## Clearing tasks

- **Clear completed** — removes everything you've already checked off.
- **Clear all** — removes all tasks **except** those linked to a calendar deadline (those are owned by the [Calendar](calendar.md) and stay).

> ⚠️ Clearing is immediate and can't be undone. Deadline-linked tasks are deliberately protected from "Clear all."

---

## Deadlines from the calendar

Tasks marked as deadlines on the [Calendar](calendar.md) show up here automatically, carrying their **due date**.

- Editing the event's title or date updates the task.
- Removing the deadline or deleting the event removes the task.
- You generally **manage these from the Calendar**, not here.

Turn this behavior on/off with **Auto-sync deadlines to Tasks** in [Settings](settings-and-themes.md#calendar--tasks).

---

## Link a task to the Focus timer

**Why:** Estimate how many Pomodoro sessions a task needs, then let Hades check it off (or ask you to) when you hit that number.

**Quick version:**

1. Send a task to the timer (use the timer action on the task).
2. Set an estimate — e.g. **3** sessions.
3. Run the [Focus timer](focus-timer.md). Completed **work** sessions count toward the task.
4. When you reach the estimate, Hades asks **"Is this task finished?"** once.

Full details, including how the prompt behaves, are in **[Focus Timer → Link a task to the timer](focus-timer.md#link-a-task-to-the-timer)**.

---

## Troubleshooting

**A task I cleared came back.**
It's almost certainly a **calendar deadline** task — it reappears because the deadline event still exists. Remove the deadline on the event in the [Calendar](calendar.md) to get rid of it.

**Double-click isn't letting me rename.**
Double-click directly on the **task text**, not the checkbox or the controls beside it.

**My timer-linked task didn't get checked off.**
The "finished?" prompt appears once, when completed **work** sessions first equal your estimate. If you dismissed it, the task stays open — check it off manually, or re-link and adjust the estimate.
