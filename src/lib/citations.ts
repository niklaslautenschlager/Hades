import { marked } from "marked";
import { useStore } from "../store/useStore";

// F3 — grounded answers cite their sources as [Note: X] / [PDF: Y]. We turn
// those tokens into clickable chips before markdown rendering, and the chat
// view delegates clicks here to jump to the source.

const CITE_RE = /\[(Note|PDF):\s*([^\]\n]{1,120}?)\s*\]/g;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Markdown → HTML with [Note: X]/[PDF: Y] tokens rendered as citation chips. */
export function renderAssistantHtml(content: string): string {
  const withChips = content.replace(CITE_RE, (_m, kind: string, name: string) => {
    const type = kind.toLowerCase();
    const esc = escapeHtml(name.trim());
    return `<span class="citation" data-cite-type="${type}" data-cite-name="${esc}" title="Open ${esc}">${kind}: ${esc}</span>`;
  });
  return marked.parse(withChips) as string;
}

/** Click-delegation handler: jump to the cited note/PDF. Returns true if handled. */
export function handleCitationClick(target: HTMLElement): boolean {
  const el = target.closest(".citation") as HTMLElement | null;
  if (!el) return false;
  const type = el.dataset.citeType;
  const name = (el.dataset.citeName ?? "").toLowerCase();
  if (!name) return true;

  const s = useStore.getState();
  if (type === "note") {
    const note =
      s.notes.find((n) => !n.isFolder && n.name.toLowerCase() === name) ??
      s.notes.find((n) => !n.isFolder && n.name.toLowerCase().includes(name));
    if (note) {
      s.setActiveNote(note.id);
      s.setActiveModule("notepad");
    }
  } else if (type === "pdf") {
    // The library lives in the Notes module's sidebar — take the user there.
    s.setActiveModule("notepad");
  }
  return true;
}
