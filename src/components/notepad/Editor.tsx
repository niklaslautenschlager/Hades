import { useEffect, useRef, useState } from "react";
import {
  EditorView,
  keymap,
  lineNumbers,
  drawSelection,
  highlightActiveLine,
} from "@codemirror/view";
import { EditorState, Compartment, Prec } from "@codemirror/state";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import {
  HighlightStyle,
  syntaxHighlighting,
  indentUnit,
  codeFolding,
  foldGutter,
  foldKeymap,
} from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { vim } from "@replit/codemirror-vim";
import "katex/dist/katex.min.css";
import { useStore } from "../../store/useStore";
import {
  markdownLiveDecorations,
  markdownFoldService,
  listBindings,
} from "../../lib/markdownDecorations";
import { mathLiveDecorations } from "../../lib/mathDecorations";
import { registerEditorInsert } from "../../lib/editorBridge";

interface Props {
  noteId: string;
  content: string;
  onChange: (content: string) => void;
}

// ─── Custom highlight style for WYSIWYG inline rendering ────────────────────

// NOTE: heading SIZES are handled by line-level CSS (.cm-md-h1…h6) to avoid
// em compounding. Here we only style inline tokens (bold, italic, code, …).
const mdHighlightStyle = HighlightStyle.define([
  // Bold / italic
  { tag: tags.strong,   fontWeight: "700",  color: "var(--color-foreground)" },
  { tag: tags.emphasis, fontStyle: "italic", color: "var(--color-foreground)" },
  // Inline code
  { tag: tags.monospace,
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
    fontSize: "0.88em",
    background: "var(--color-surface-hover)",
    borderRadius: "3px",
    padding: "1px 4px",
  },
  // Blockquote text
  { tag: tags.quote, color: "var(--color-foreground-secondary)" },
  // List marker glyphs (when raw, on active line)
  { tag: tags.list, color: "var(--color-foreground-secondary)", fontWeight: "600" },
  // Links & URLs
  { tag: tags.link, color: "var(--color-foreground-secondary)", textDecoration: "underline", textUnderlineOffset: "2px" },
  { tag: tags.url,  color: "var(--color-muted)", fontSize: "0.9em" },
  // Syntax punctuation that we DON'T conceal (e.g. on the active line)
  { tag: tags.processingInstruction, color: "var(--color-muted)" },
]);

export default function Editor({ noteId, content, onChange }: Props) {
  const isVimMode = useStore((s) => s.isVimMode);
  const editorRef  = useRef<HTMLDivElement>(null);
  const viewRef    = useRef<EditorView | null>(null);
  const vimCompartment      = useRef(new Compartment());
  const fontSizeCompartment = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  const [initError, setInitError] = useState<string | null>(null);
  const [fontSize, setFontSize] = useState(15);

  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  // Rebuild font-size theme when fontSize changes
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: fontSizeCompartment.current.reconfigure(
        EditorView.theme({
          "&":           { fontSize: `${fontSize}px` },
          ".cm-scroller": { fontSize: `${fontSize}px` },
        })
      ),
    });
  }, [fontSize]);

  // Hot-swap Vim mode
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    try {
      view.dispatch({ effects: vimCompartment.current.reconfigure(isVimMode ? vim() : []) });
    } catch { /* ignore */ }
  }, [isVimMode]);

  // Sync content when switching notes (do NOT re-init the editor)
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== content) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId]);

  // Initialize editor once per note ID
  useEffect(() => {
    if (!editorRef.current) return;
    setInitError(null);

    try {
      const baseTheme = EditorView.theme({
        "&": {
          height: "100%",
          width: "100%",
          backgroundColor: "transparent",
        },
        ".cm-scroller": {
          fontFamily: "'Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', sans-serif",
          lineHeight: "1.75",
          overflowX: "auto",
        },
        ".cm-content": {
          padding: "28px 40px 120px",
          minHeight: "100%",
          caretColor: "var(--color-foreground)",
          maxWidth: "800px",
          marginLeft: "auto",
          marginRight: "auto",
        },
        ".cm-cursor, .cm-dropCursor": {
          borderLeftColor: "var(--color-foreground)",
          borderLeftWidth: "2px",
        },
        ".cm-focused": { outline: "none" },

        // Fold gutter
        ".cm-foldGutter": {
          width: "14px",
          color: "var(--color-muted)",
        },
        ".cm-foldGutter .cm-gutterElement": {
          cursor: "pointer",
          fontSize: "10px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          paddingTop: "2px",
          userSelect: "none",
        },
        ".cm-foldGutter .cm-gutterElement:hover": {
          color: "var(--color-foreground-secondary)",
        },

        // Gutter background
        ".cm-gutters": {
          background: "transparent !important",
          border: "none !important",
          paddingRight: "4px",
        },
      });

      const updateListener = EditorView.updateListener.of((update) => {
        if (update.docChanged) onChangeRef.current(update.state.doc.toString());
      });

      const state = EditorState.create({
        doc: content,
        extensions: [
          // Core
          vimCompartment.current.of(isVimMode ? vim() : []),
          fontSizeCompartment.current.of(
            EditorView.theme({
              "&":           { fontSize: `${fontSize}px` },
              ".cm-scroller": { fontSize: `${fontSize}px` },
            })
          ),
          history(),
          closeBrackets(),
          drawSelection(),

          // Smart list handling — highest priority so it beats the default Enter/Tab
          Prec.highest(keymap.of(listBindings)),

          // Remaining keymaps
          keymap.of([
            indentWithTab,
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...historyKeymap,
            ...foldKeymap,
          ]),

          // Indentation: 4 spaces
          indentUnit.of("    "),

          // Language + WYSIWYG highlighting
          markdown({ base: markdownLanguage }),
          syntaxHighlighting(mdHighlightStyle),

          // Live-preview decorations (conceal markers, bullets, headings, etc.)
          markdownLiveDecorations,
          // Live KaTeX rendering of $…$ / $$…$$
          mathLiveDecorations,

          // Line numbers
          lineNumbers(),

          // Header folding
          markdownFoldService,
          codeFolding(),
          foldGutter({
            markerDOM(open: boolean) {
              const span = document.createElement("span");
              span.textContent = open ? "▾" : "▸";
              span.style.fontSize = "11px";
              span.style.opacity = "0.6";
              span.style.transition = "opacity 0.15s";
              return span;
            },
          }),

          // UX
          highlightActiveLine(),
          EditorView.lineWrapping,
          baseTheme,
          updateListener,
        ],
      });

      const view = new EditorView({ state, parent: editorRef.current });
      viewRef.current = view;

      // Let other components (e.g. the Calculator) insert at the cursor.
      registerEditorInsert((text: string) => {
        const sel = view.state.selection.main;
        view.dispatch({
          changes: { from: sel.from, to: sel.to, insert: text },
          selection: { anchor: sel.from + text.length },
          scrollIntoView: true,
        });
        view.focus();
        return true;
      });

      // Focus the editor on mount
      setTimeout(() => view.focus(), 0);
    } catch (err) {
      setInitError(err instanceof Error ? err.message : String(err));
    }

    return () => {
      registerEditorInsert(null);
      viewRef.current?.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId]);

  // Font size keyboard shortcut (Ctrl/Cmd + = to increase, - to decrease)
  function handleKeyDown(e: React.KeyboardEvent) {
    if (!(e.ctrlKey || e.metaKey)) return;
    if (e.key === "=" || e.key === "+") {
      e.preventDefault();
      setFontSize((f) => Math.min(f + 1, 28));
    } else if (e.key === "-") {
      e.preventDefault();
      setFontSize((f) => Math.max(f - 1, 10));
    } else if (e.key === "0") {
      e.preventDefault();
      setFontSize(15);
    }
  }

  if (initError) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-red-400 p-8">
        Editor failed to initialize: {initError}
      </div>
    );
  }

  return (
    <div
      ref={editorRef}
      className="absolute inset-0 overflow-hidden"
      onKeyDown={handleKeyDown}
    />
  );
}
