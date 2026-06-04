# Focus Timer (Pomodoro)

**What it does:** The Focus module is a Pomodoro timer. It breaks your work into focused work intervals separated by short breaks, with a longer break after several rounds. This rhythm helps you start more easily and avoid burnout.

**Why use it:** Instead of vaguely "studying for a while," you commit to one focused block at a time. Hades tracks every completed work session and feeds it into your [Statistics](statistics.md).

It's the **Focus** icon (clock) at the top of the sidebar — and the screen Hades opens to by default.

---

## The basics

The Focus screen shows a large **progress ring** with the time remaining in the center, the current mode (Work / Break / Long break), and your session count.

| Button | What it does |
|--------|--------------|
| **Start** | Begins the countdown. |
| **Pause** | Stops the countdown, keeping the time remaining. |
| **Reset** | Restores the current interval to its full length. |
| **Skip** | Jumps to the next interval (counts as completing the current work session). |

### How the cycle works

1. **Work** interval (default **25 min**) → when it ends, a sound plays.
2. **Short break** (default **5 min**).
3. Repeat. After every **4** work sessions (configurable), you get a **Long break** (default **15 min**) instead of a short one.

You can change all of these in **[Settings → Timer Intervals](settings-and-themes.md#timer-intervals)**.

> **The timer is accurate even if you leave.** Hades tracks the timer against your computer's clock, so the countdown stays correct across re-renders, background syncs, and even brief app hiccups. The remaining time you see is always derived from a real end-time, never a value that can silently drift.

---

## Set a session goal

**Why:** A one-line goal ("Finish chapter 5", "Draft the intro") keeps each session pointed at something concrete.

1. Click the **goal field** near the top of the Focus screen.
2. Type your goal and press **Enter** to save (or **Escape** to cancel).

You can also set it from the AI assistant with the `/goal` command — for example, `/goal Finish chapter 5`. See [AI Study Assistant](ai-assistant.md).

---

## Sound alerts

When an interval ends, Hades plays a sound so you don't have to watch the clock.

Choose the sound and volume in **[Settings → Sound](settings-and-themes.md#sound)**. Options: **Chime** (default), **Bell**, **Gong**, **Digital**, or **None**. Click the small ▶ next to any option to preview it.

> Completing a **task** also plays a softer version of the same sound.

---

## Link a task to the timer

**What it does:** You can attach one [task](tasks.md) to the timer, estimate how many focus sessions it will take, and let Hades nudge you when you hit that estimate.

**Why:** It turns "I'll work on this for a bit" into "this is a 3-session job" — and gives you a clean moment to decide whether you're actually done.

### How to use it

1. Go to the **Tasks** module and send a task to the timer (look for the timer/play action on the task).
2. Set an **estimate** — how many work sessions you think it needs (e.g. `3`).
3. Run the Focus timer normally. Each completed **work** session counts toward that task.
4. When your completed sessions **reach your estimate**, Hades shows a one-time **"Is this task finished?"** prompt.
   - Confirm → the task is checked off.
   - Dismiss → keep working; you won't be nagged again for that task.

**Good to know:**

- Only **work** sessions count toward the estimate — breaks don't.
- The "finished?" prompt appears **exactly once**, the moment you first hit the estimate. Going over your estimate is fine and silent.
- Deleting the task, or completing it, clears the link automatically.

---

## The AI study assistant lives here

The Focus screen also hosts the **AI Study Assistant** — a chat panel for explanations, quizzes, summaries, and motivation, with slash commands like `/explain` and `/quiz`.

It's covered in its own guide: **[AI Study Assistant](ai-assistant.md)**.

---

## Troubleshooting

**The timer "jumped" or reset unexpectedly.**
This was an issue in older versions. Current versions anchor the timer to your system clock, so it shouldn't happen. If it does, note your exact steps and [report it](https://github.com/niklaslautenschlager/Hades/issues).

**No sound when an interval ends.**
- Check **Settings → Sound** isn't set to **None**, and the volume slider isn't at 0%.
- Click the ▶ preview button to confirm your system audio works.

**My focus time isn't showing in Statistics.**
Only **completed work sessions** are recorded. If you reset or switch modes before a work interval finishes, that time isn't counted. See [Statistics](statistics.md).
