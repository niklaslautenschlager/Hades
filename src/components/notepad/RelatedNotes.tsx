import { useEffect, useState } from "react";
import { Link2, ArrowUpRight } from "lucide-react";
import { useStore } from "../../store/useStore";
import { search } from "../../lib/ragIndex";
import { insertIntoActiveNote } from "../../lib/editorBridge";

// F6 — RAG-backed related-note suggestions. A slim strip under the editor that
// surfaces semantically similar notes while you write: click a chip to insert a
// [[wikilink]] at the cursor, or the arrow to open that note. Uses the hybrid
// index (semantic when Ollama is up, keyword otherwise) — fully on-device.

interface Suggestion {
  id: string;
  name: string;
}

export default function RelatedNotes({ noteId, content }: { noteId: string; content: string }) {
  const aiEnabled = useStore((s) => s.aiEnabled);
  const setActiveNote = useStore((s) => s.setActiveNote);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);

  useEffect(() => {
    if (!aiEnabled) { setSuggestions([]); return; }
    const text = content.trim();
    if (text.length < 60) { setSuggestions([]); return; }

    const t = setTimeout(async () => {
      try {
        const hits = await search(text.slice(0, 1200), 8);
        const seen = new Set<string>();
        const top: Suggestion[] = [];
        for (const h of hits) {
          if (h.sourceType !== "note" || h.sourceId === noteId || seen.has(h.sourceId)) continue;
          seen.add(h.sourceId);
          top.push({ id: h.sourceId, name: h.sourceName });
          if (top.length >= 4) break;
        }
        setSuggestions(top);
      } catch {
        setSuggestions([]);
      }
    }, 2500);
    return () => clearTimeout(t);
  }, [noteId, content, aiEnabled]);

  if (suggestions.length === 0) return null;

  return (
    <div className="flex-shrink-0 flex items-center gap-1.5 px-4 py-1.5 border-t border-border overflow-x-auto"
         style={{ scrollbarWidth: "none" }}>
      <Link2 className="w-3 h-3 text-muted flex-shrink-0" />
      <span className="text-xs text-muted flex-shrink-0">Related:</span>
      {suggestions.map((s) => (
        <span key={s.id} className="flex items-center flex-shrink-0 rounded-md border border-border bg-surface-hover">
          <button
            onClick={() => insertIntoActiveNote(`[[${s.name}]]`)}
            title={`Insert [[${s.name}]] at the cursor`}
            className="px-2 py-0.5 text-xs text-foreground-secondary hover:text-foreground transition-colors max-w-[180px] truncate"
          >
            [[{s.name}]]
          </button>
          <button
            onClick={() => setActiveNote(s.id)}
            title={`Open "${s.name}"`}
            className="pr-1.5 pl-0.5 text-muted hover:text-foreground transition-colors"
          >
            <ArrowUpRight className="w-3 h-3" />
          </button>
        </span>
      ))}
    </div>
  );
}
