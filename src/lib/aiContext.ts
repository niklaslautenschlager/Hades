import { useStore } from "../store/useStore";
import { search } from "./ragIndex";

// Hard cap so a large notebook can never blow the model's context window or run
// up token cost. Notes are prioritised (active first, then most recently edited);
// library PDFs contribute title/author only — full-text extraction is a future
// enhancement, not part of the lightweight context-injection design.
const MAX_CHARS = 8000;

/**
 * Build a plain-text snapshot of the user's study material (notes + PDF library)
 * for injection into the assistant's system prompt. Returns "" when there's
 * nothing to share. Reads the store directly so callers don't need to thread
 * state through.
 */
export function buildStudyContext(): string {
  const s = useStore.getState();

  const notes = s.notes
    .filter((n) => !n.isFolder && n.content.trim().length > 0)
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

/**
 * Retrieve study context for a query. Prefers semantic RAG retrieval (Ollama
 * embeddings over the on-device index); transparently falls back to the
 * keyword/recency snapshot above when the index is empty or Ollama is down.
 */
export async function retrieveContext(query: string): Promise<string> {
  try {
    const hits = await search(query, 6);
    if (hits.length > 0) {
      const blocks = hits.map(
        (h) => `### ${h.sourceType === "pdf" ? "PDF" : "Note"}: ${h.sourceName}\n${h.text.trim()}`
      );
      return (
        blocks.join("\n\n") +
        `\n\nWhen your answer draws on one of the sources above, cite it inline as [Note: <name>] or [PDF: <name>] using the exact source name. Only cite sources that actually appear above.`
      );
    }
  } catch {
    /* fall through to the lightweight snapshot */
  }
  return buildStudyContext();
}
