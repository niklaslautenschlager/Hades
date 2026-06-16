# What's New in Hades 0.7.1

A polish release: a batch of fixes and several requested features on top of the
0.7.0 sync/calendar/AI work.

## Fixes
- **PDF export** no longer produces blank pages.
- **iCal** "500 on refresh" — `webcal://` links are handled, errors are clearer,
  and a feed now refreshes the moment you add it.
- **Stats** "Last 7 days" bars now reflect real values (they were all the same
  height).
- **Command glow** no longer jitters/bounces.
- Synced note names no longer show an id to the recipient.

## Notes & PDF
- **PDF viewer remembers your page** per document (switch tabs/modules and come
  back where you left off). Now rendered with PDF.js.
- **Hidden PDF text extraction** — every imported PDF is extracted to text so the
  AI is accurate and cheap. With a PDF open, selecting text gives **Check vs PDF**
  (correct / expand / leave it) and **Expand/Continue** pull context from it.
- **Footnotes** (`[^1]` / `[^1]:`) render on export; an **Insert** menu adds
  tables, code blocks, quotes, dividers and task lists.
- **Ctrl/Cmd + scroll** to zoom note text; **Ctrl/Cmd + Z** undoes a note/folder
  deletion in the tree.

## Selection actions
Select text in a note to **Expand / Condense / Rephrase / Continue**, **Translate**
into any language, or **Ask AI** to do anything with it.

## Focus & calendar
- **In-app event reminders** before things start (settable lead time, dismiss by
  click or timeout).
- **Session reflections** after a focus session, feeding an AI **Weekly Review**
  in Stats.

## Onboarding & misc
- A **skippable first-launch tutorial** (replay it from Settings → Advanced).
- **⌘K command palette**; the AI agent can tell you **what's new**.

See also [0.7.0](whats-new-0.7.0.md).
