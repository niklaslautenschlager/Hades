import { useStore } from "../store/useStore";
import { search, type RagSourceType } from "./ragIndex";
import { getActiveNote, getOpenPdfContext } from "./openDocs";
import { fmtLocal, TZ } from "./localTime";

// Hard cap so a large notebook can never blow the model's context window or run
// up token cost. Notes are prioritised (active first, then most recently edited);
// library PDFs contribute title/author only — full-text extraction is a future
// enhancement, not part of the lightweight context-injection design.
const MAX_CHARS = 8000;
const OPEN_DOC_CAP = 6000;

/**
 * Build a plain-text snapshot of the user's study material (notes + PDF library)
 * for injection into the assistant's system prompt. Returns "" when there's
 * nothing to share. Reads the store directly so callers don't need to thread
 * state through.
 */
export function buildStudyContext(opts: { skipNoteIds?: string[] } = {}): string {
  const s = useStore.getState();
  const skip = new Set(opts.skipNoteIds ?? []);

  const notes = s.notes
    .filter((n) => !n.isFolder && n.content.trim().length > 0 && !skip.has(n.id))
    .sort((a, b) => {
      if (a.id === s.activeNoteId) return -1;
      if (b.id === s.activeNoteId) return 1;
      return (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");
    });

  const sections: string[] = [];

  if (s.libraryDocs.length > 0) {
    const list = s.libraryDocs
      .slice(0, 40)
      .map((d) => `- ${d.title}${d.author ? ` — ${d.author}` : ""}`)
      .join("\n");
    sections.push(`PDF library (titles only):\n${list}`);
  }

  let used = sections.join("\n\n").length;
  for (const note of notes) {
    const block = `### Note: ${note.name}\n${note.content.trim()}`;
    if (used + block.length > MAX_CHARS) {
      // Include a truncated tail of this note if there's meaningful room left.
      const remaining = MAX_CHARS - used;
      if (remaining > 400) {
        sections.push(block.slice(0, remaining) + "\n…(truncated)");
      }
      break;
    }
    sections.push(block);
    used += block.length + 2;
  }

  return sections.join("\n\n").trim();
}

const SOURCE_LABEL: Record<RagSourceType, string> = { note: "Note", pdf: "PDF", event: "Event", task: "Task" };

/**
 * Retrieve study context for a query from the on-device index (notes, PDFs,
 * calendar events, tasks). Works with the built-in embedder, so no Ollama is
 * needed; falls back to the keyword/recency snapshot above when the index has
 * nothing relevant. `skipSourceIds` drops sources already shared in full.
 */
export async function retrieveContext(query: string, opts: { skipSourceIds?: string[] } = {}): Promise<string> {
  const skip = new Set(opts.skipSourceIds ?? []);
  try {
    const hits = (await search(query, skip.size > 0 ? 10 : 6)).filter((h) => !skip.has(h.sourceId)).slice(0, 6);
    if (hits.length > 0) {
      const blocks = hits.map((h) => `### ${SOURCE_LABEL[h.sourceType]}: ${h.sourceName}\n${h.text.trim()}`);
      const hasSchedule = hits.some((h) => h.sourceType === "event" || h.sourceType === "task");
      const clock = hasSchedule
        ? `\n\nCurrent local time: ${fmtLocal(new Date().toISOString())} (timezone: ${TZ}). Times in Event and Task entries are already local; report them as given.`
        : "";
      return (
        blocks.join("\n\n") +
        clock +
        `\n\nWhen your answer draws on one of the sources above, cite it inline as [Note: <name>], [PDF: <name>], [Event: <title>] or [Task: <text>] using the exact source name. Only cite sources that actually appear above.`
      );
    }
  } catch {
    /* fall through to the lightweight snapshot */
  }
  return buildStudyContext({ skipNoteIds: opts.skipSourceIds });
}

export interface OpenDocumentContext {
  text: string;
  /** Sources whose full text is already in `text`, so retrieval can skip them. */
  coveredSourceIds: string[];
}

function cap(text: string, max: number): { text: string; truncated: boolean } {
  const t = text.trim();
  return t.length > max ? { text: `${t.slice(0, max)}\n…(truncated)`, truncated: true } : { text: t, truncated: false };
}

/**
 * What the user is looking at right now: the active note and the PDF open in
 * the Notes pane. Shared on every turn (chat and agent mode) so "this note" /
 * "this page" just work. The PDF text is bounded by a short timeout: if it is
 * not ready, the message goes out without it and says so, while extraction
 * carries on for the next turn. Never throws.
 */
export async function buildOpenDocumentContext(opts: { timeoutMs?: number } = {}): Promise<OpenDocumentContext> {
  const sections: string[] = [];
  const covered: string[] = [];

  try {
    const note = getActiveNote();
    if (note) {
      const body = cap(note.content, OPEN_DOC_CAP);
      sections.push(`### Open note: ${note.name || "Untitled note"}\n${body.text || "(this note is empty)"}`);
      if (!body.truncated) covered.push(note.id);
    }
  } catch {
    /* skip the note block */
  }

  try {
    const ctx = await getOpenPdfContext({ maxChars: OPEN_DOC_CAP, timeoutMs: opts.timeoutMs });
    if (ctx) {
      const { pdf } = ctx;
      const where = pdf.currentPage
        ? ` (viewing page ${pdf.currentPage}${pdf.pageCount ? ` of ${pdf.pageCount}` : ""})`
        : "";
      if (ctx.pending) {
        sections.push(
          `### Open PDF: ${pdf.title}${where}\nThe PDF's text is still being extracted, so it is NOT included in this message. It will be available on the next message; say so if the user asks about it.`
        );
      } else if (!pdf.text) {
        sections.push(`### Open PDF: ${pdf.title}${where}\nNo selectable text was found in this PDF (it may be a scan).`);
      } else {
        // Text cached from OCR or from a scan carries no page markers; claiming otherwise
        // would make the model cite page numbers it cannot know.
        const paged = /^\[Page \d+\]/m.test(pdf.text);
        const layout = paged
          ? "Pages are labelled [Page N]; the page the user is on comes first."
          : "This text is not split by page, so do not cite page numbers from it.";
        sections.push(
          `### Open PDF: ${pdf.title}${where}\n${layout}\n${pdf.text}${pdf.truncated ? "\n…(truncated — only part of the document is shown)" : ""}`
        );
        if (pdf.docId && !pdf.truncated) covered.push(pdf.docId);
      }
    }
  } catch {
    /* skip the PDF block */
  }

  if (sections.length === 0) return { text: "", coveredSourceIds: [] };
  return {
    text: `## Currently open in Hades (what the user is looking at right now)\n\n${sections.join("\n\n")}`,
    coveredSourceIds: covered,
  };
}
