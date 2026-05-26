import { useEffect, useRef, useState } from "react";
import { EditorView, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { vim } from "@replit/codemirror-vim";
import { useStore } from "../../store/useStore";

interface Props {
  noteId: string;
  content: string;
  onChange: (content: string) => void;
}

export default function Editor({ noteId, content, onChange }: Props) {
  const isVimMode = useStore((s) => s.isVimMode);
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  // Keep a stable ref to the compartment per editor instance
  const vimCompartment = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  const [initError, setInitError] = useState<string | null>(null);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Initialize editor
  useEffect(() => {
    if (!editorRef.current) return;
    setInitError(null);

    try {
      const baseTheme = EditorView.theme({
        // Fill the absolutely-positioned container
        "&": {
          height: "100%",
          width: "100%",
          backgroundColor: "transparent",
          fontSize: "14px",
        },
        ".cm-scroller": {
          height: "100%",
          overflow: "auto",
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          lineHeight: "1.7",
        },
        ".cm-content": {
          padding: "24px 32px",
          minHeight: "100%",
        },
        ".cm-focused": { outline: "none" },
      });

      const updateListener = EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          onChangeRef.current(update.state.doc.toString());
        }
      });

      const state = EditorState.create({
        doc: content,
        extensions: [
          vimCompartment.current.of(isVimMode ? vim() : []),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          markdown({ base: markdownLanguage }),
          syntaxHighlighting(defaultHighlightStyle),
          lineNumbers(),
          highlightActiveLine(),
          EditorView.lineWrapping,
          baseTheme,
          updateListener,
        ],
      });

      const view = new EditorView({ state, parent: editorRef.current });
      viewRef.current = view;
    } catch (err) {
      setInitError(err instanceof Error ? err.message : String(err));
    }

    return () => {
      viewRef.current?.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId]);

  // Hot-swap Vim mode
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    try {
      view.dispatch({
        effects: vimCompartment.current.reconfigure(isVimMode ? vim() : []),
      });
    } catch {
      // Ignore dispatch errors during mode switching
    }
  }, [isVimMode]);

  // Sync content when switching notes
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== content) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: content },
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId]);

  if (initError) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-red-400 p-8">
        Editor failed to initialize: {initError}
      </div>
    );
  }

  // Absolute fill: the parent must be `position: relative` with a defined size.
  return <div ref={editorRef} className="absolute inset-0 overflow-hidden" />;
}
