# What's New in Hades 0.8.0

This release focuses on **trustworthy PDF grounding** for AI, plus a batch of
view-state and quality-of-life improvements.

## PDF extraction cascade + OCR fallback
- PDFs now go through a **cascade**: text-layer extraction → a **quality gate** →
  **OCR fallback** (Tesseract) when a PDF is scanned or slide-based and has no
  usable text layer.
- OCR rasterizes pages locally and only runs as a fallback — never on PDFs that
  already have good text.
- Every OCR fallback is **counted and logged** (Settings → AI), so if many of
  your PDFs need OCR you can see it.
- This fixes the AI being unable to read scanned library PDFs, and makes the
  verify-against-PDF check run against real content.

> OCR uses a **Tesseract** binary. If you have it installed it's used
> automatically; bundling a copy with the app ships separately.

## Verify-against-PDF: honest states
Selecting text and checking it against the open PDF now shows three distinct,
non-misleading states:
- **✓ Verified — accurate**
- a **suggested correction** (shown in the popover with **Accept / Dismiss** —
  never written into your note automatically)
- **⚠ Couldn't verify** (no readable text) — which can no longer be mistaken for
  "accurate".

## PDF viewer & view-state
- **Zoom** controls (and Ctrl/Cmd-scroll) in the PDF viewer, remembered per
  document.
- The viewer **remembers your page** across tab/module switches.
- Notes **remember their zoom level** per note.

## Selection actions
Select text in a note to **Expand / Condense / Rephrase / Continue**,
**Translate** into any language, or **Ask AI** to do anything with it. With a PDF
open, **Check vs PDF** verifies the passage against it.

## Notifications & nudges
- A single shared, gentle notification component (click- or timeout-dismiss).
- A non-naggy **Pomodoro nudge** if you're writing without a focus session.

## Privacy & boundaries
- Anything the AI "remembers" stays local. AI suggestions are ephemeral —
  nothing is written into a `.md` file without you explicitly accepting it.

See also [0.7.1](whats-new-0.7.1.md).
