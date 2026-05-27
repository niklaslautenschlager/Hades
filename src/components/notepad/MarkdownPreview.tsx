import { useMemo, useCallback } from "react";
import { marked } from "marked";
import { useStore } from "../../store/useStore";

marked.setOptions({
  breaks: true,
  gfm: true,
});

interface Props {
  content: string;
  onEdit: () => void;
}

/**
 * Process [[Note Name]] links in markdown content.
 * Converts them to clickable <a> tags with data attributes.
 */
function processNoteLinks(html: string): string {
  // Replace [[Note Name]] with clickable links
  return html.replace(
    /\[\[([^\]]+)\]\]/g,
    '<a class="note-link" data-note-link="$1" href="#">$1</a>'
  );
}

export default function MarkdownPreview({ content, onEdit }: Props) {
  const notes = useStore((s) => s.notes);
  const setActiveNote = useStore((s) => s.setActiveNote);

  const html = useMemo(() => {
    if (!content.trim()) return "";
    const raw = marked.parse(content) as string;
    return processNoteLinks(raw);
  }, [content]);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement;

      // Handle note links
      if (target.classList.contains("note-link")) {
        e.preventDefault();
        e.stopPropagation();
        const noteName = target.getAttribute("data-note-link");
        if (noteName) {
          const note = notes.find(
            (n) => !n.isFolder && n.name.toLowerCase() === noteName.toLowerCase()
          );
          if (note) {
            setActiveNote(note.id);
          }
        }
        return;
      }

      // Regular click → edit mode
      onEdit();
    },
    [notes, setActiveNote, onEdit]
  );

  if (!content.trim()) {
    return (
      <div
        onClick={onEdit}
        className="absolute inset-0 flex items-center justify-center cursor-text"
      >
        <p className="text-sm text-muted">Click to start writing...</p>
      </div>
    );
  }

  return (
    <div
      onClick={handleClick}
      className="absolute inset-0 overflow-auto cursor-text"
    >
      <div
        className="markdown-body px-8 py-6 max-w-none"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
