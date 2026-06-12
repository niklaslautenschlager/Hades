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
import { registerEditorView } from "../../lib/editorBridge";
import { assistRewrite, verifyAgainstSource, translateText, askRewrite, type AssistAction } from "../../lib/noteAssist";
import { libraryDocText } from "../../lib/pdfLibrary";

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

const ASSIST_ACTIONS: { id: AssistAction; label: string }[] = [
  { id: "expand",   label: "Expand" },
  { id: "condense", label: "Condense" },
  { id: "rephrase", label: "Rephrase" },
  { id: "continue", label: "Continue" },
];

export default function Editor({ noteId, content, onChange }: Props) {
  const isVimMode = useStore((s) => s.isVimMode);
  const aiEnabled = useStore((s) => s.aiEnabled);
  const notePdfDocId = useStore((s) => s.notePdfDocId);
  const pdfTextRef = useRef<{ id: string; text: string } | null>(null);

  // Lazily load (and cache) the hidden text of the PDF currently in the viewer.
  async function getOpenPdfText(): Promise<string> {
    const id = notePdfDocId;
    if (!id) return "";
    if (pdfTextRef.current?.id === id) return pdfTextRef.current.text;
    const doc = useStore.getState().libraryDocs.find((d) => d.id === id);
    if (!doc) return "";
    try {
      const text = await libraryDocText(doc);
      pdfTextRef.current = { id, text };
      return text;
    } catch {
      return "";
    }
  }
  const editorRef  = useRef<HTMLDivElement>(null);
  const viewRef    = useRef<EditorView | null>(null);
  const vimCompartment      = useRef(new Compartment());
  const fontSizeCompartment = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  const [initError, setInitError] = useState<string | null>(null);
  const [fontSize, setFontSize] = useState(15);

  // ── Inline writing assist (F7) ─────────────────────────────────────────────
  const [assist, setAssist] = useState<{ from: number; to: number; x: number; y: number } | null>(null);
  const [assistBusy, setAssistBusy] = useState<AssistAction | null>(null);
  const [assistErr, setAssistErr] = useState<string | null>(null);
  // Secondary input row for "Translate" / "Ask AI".
  const [inputMode, setInputMode] = useState<null | "translate" | "ask">(null);
  const [inputValue, setInputValue] = useState("");
  const assistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const assistBusyRef = useRef(false);
  const aiEnabledRef = useRef(aiEnabled);
  useEffect(() => { aiEnabledRef.current = aiEnabled; }, [aiEnabled]);

  function refreshAssistFromSelection() {
    if (assistBusyRef.current) return;
    const view = viewRef.current;
    if (!view || !aiEnabledRef.current) { setAssist(null); return; }
    const sel = view.state.selection.main;
    if (sel.empty || view.state.sliceDoc(sel.from, sel.to).trim().length < 3) {
      setAssist(null);
      setAssistErr(null);
      return;
    }
    const c = view.coordsAtPos(sel.from);
    if (!c) { setAssist(null); return; }
    setAssist({ from: sel.from, to: sel.to, x: c.left, y: c.top });
  }

  async function handleAssist(action: AssistAction) {
    const view = viewRef.current;
    if (!view || !assist || assistBusy) return;
    setAssistBusy(action);
    setAssistErr(null);
    assistBusyRef.current = true;
    try {
      const text = view.state.sliceDoc(assist.from, assist.to);
      // Expand / continue use the open PDF as source context when one is open.
      const ctx = action === "expand" || action === "continue" ? await getOpenPdfText() : "";
      const out = await assistRewrite(action, text, ctx || undefined);
      if (action === "continue") {
        const sep = /\s$/.test(text) ? "" : " ";
        view.dispatch({
          changes: { from: assist.to, insert: sep + out },
          scrollIntoView: true,
        });
      } else {
        view.dispatch({
          changes: { from: assist.from, to: assist.to, insert: out },
          scrollIntoView: true,
        });
      }
      setAssist(null);
    } catch (e) {
      setAssistErr(e instanceof Error ? e.message : String(e));
    } finally {
      setAssistBusy(null);
      assistBusyRef.current = false;
    }
  }

  // Check the selection against the open PDF: correct/expand it, or leave it.
  async function handleVerify() {
    const view = viewRef.current;
    if (!view || !assist || assistBusy) return;
    setAssistBusy("expand"); // reuse busy flag for the spinner
    setAssistErr(null);
    assistBusyRef.current = true;
    try {
      const text = view.state.sliceDoc(assist.from, assist.to);
      const src = await getOpenPdfText();
      if (!src.trim()) {
        setAssistErr("That PDF has no extractable text.");
        return;
      }
      const { ok, text: result } = await verifyAgainstSource(text, src);
      if (!ok && result.trim() && result.trim() !== text.trim()) {
        view.dispatch({ changes: { from: assist.from, to: assist.to, insert: result }, scrollIntoView: true });
        setAssist(null);
      } else {
        setAssistErr("Looks accurate — no changes.");
        setTimeout(() => setAssistErr(null), 2500);
      }
    } catch (e) {
      setAssistErr(e instanceof Error ? e.message : String(e));
    } finally {
      setAssistBusy(null);
      assistBusyRef.current = false;
    }
  }

  // Run a Translate / Ask-AI request from the secondary input row.
  async function runInput() {
    const view = viewRef.current;
    if (!view || !assist || assistBusy || !inputValue.trim() || !inputMode) return;
    setAssistBusy("rephrase"); // reuse busy flag for the spinner
    setAssistErr(null);
    assistBusyRef.current = true;
    try {
      const text = view.state.sliceDoc(assist.from, assist.to);
      const out = inputMode === "translate"
        ? await translateText(text, inputValue.trim())
        : await askRewrite(text, inputValue.trim());
      if (out.trim()) {
        view.dispatch({ changes: { from: assist.from, to: assist.to, insert: out }, scrollIntoView: true });
        setAssist(null);
      }
      setInputMode(null);
      setInputValue("");
    } catch (e) {
      setAssistErr(e instanceof Error ? e.message : String(e));
    } finally {
      setAssistBusy(null);
      assistBusyRef.current = false;
    }
  }

  // Reset the input row whenever the popover target changes/closes.
  useEffect(() => { if (!assist) { setInputMode(null); setInputValue(""); } }, [assist]);

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
        if (update.selectionSet || update.docChanged) {
          // Debounce so the popover appears after the drag settles, not during.
          if (assistTimer.current) clearTimeout(assistTimer.current);
          assistTimer.current = setTimeout(refreshAssistFromSelection, 250);
        }
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

      // Let other components (Calculator, AI assists) read/edit via the bridge.
      registerEditorView(view);

      // Focus the editor on mount
      setTimeout(() => view.focus(), 0);
    } catch (err) {
      setInitError(err instanceof Error ? err.message : String(err));
    }

    return () => {
      registerEditorView(null);
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

  // Ctrl/Cmd + scroll wheel to zoom the note text in/out.
  function handleWheel(e: React.WheelEvent) {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    setFontSize((f) => Math.max(10, Math.min(28, f - Math.sign(e.deltaY))));
  }

  if (initError) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-red-400 p-8">
        Editor failed to initialize: {initError}
      </div>
    );
  }

  return (
    <>
      <div
        ref={editorRef}
        className="absolute inset-0 overflow-hidden"
        onKeyDown={handleKeyDown}
        onWheel={handleWheel}
      />

      {/* Inline writing assist popover (F7) */}
      {assist && aiEnabled && (
        <div
          className="fixed z-50 surface shadow-xl p-1 flex flex-col gap-1"
          style={{
            left: Math.max(8, Math.min(assist.x, window.innerWidth - 380)),
            top: Math.max(8, assist.y - 42),
          }}
        >
          <div className="flex items-center gap-0.5 flex-wrap">
            {ASSIST_ACTIONS.map(({ id, label }) => (
              <button
                key={id}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleAssist(id)}
                disabled={assistBusy !== null}
                className={`px-2 py-1 rounded text-xs font-medium transition-all
                            ${assistBusy === id
                              ? "bg-surface-hover text-foreground"
                              : "text-foreground-secondary hover:text-foreground hover:bg-surface-hover"
                            } disabled:opacity-60`}
              >
                {assistBusy === id ? `${label}…` : label}
              </button>
            ))}
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { setInputMode((m) => (m === "translate" ? null : "translate")); setAssistErr(null); }}
              disabled={assistBusy !== null}
              className={`px-2 py-1 rounded text-xs font-medium transition-all disabled:opacity-60
                          ${inputMode === "translate" ? "bg-surface-hover text-foreground" : "text-foreground-secondary hover:text-foreground hover:bg-surface-hover"}`}
            >
              Translate
            </button>
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { setInputMode((m) => (m === "ask" ? null : "ask")); setAssistErr(null); }}
              disabled={assistBusy !== null}
              className={`px-2 py-1 rounded text-xs font-medium transition-all disabled:opacity-60
                          ${inputMode === "ask" ? "bg-surface-hover text-foreground" : "text-foreground-secondary hover:text-foreground hover:bg-surface-hover"}`}
            >
              Ask AI
            </button>
            {notePdfDocId && (
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={handleVerify}
                disabled={assistBusy !== null}
                title="Check this passage against the open PDF and correct/expand it"
                className="px-2 py-1 rounded text-xs font-medium text-accent hover:bg-surface-hover transition-all disabled:opacity-60"
              >
                Check vs PDF
              </button>
            )}
          </div>

          {inputMode && (
            <div className="flex items-center gap-1 px-0.5 pb-0.5">
              <input
                autoFocus
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); runInput(); }
                  if (e.key === "Escape") { setInputMode(null); setInputValue(""); }
                }}
                placeholder={inputMode === "translate" ? "Language (e.g. German, Spanish, 日本語)…" : "Tell the AI what to do…"}
                className="input-base flex-1 text-xs py-1 w-[260px]"
              />
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={runInput}
                disabled={assistBusy !== null || !inputValue.trim()}
                className="btn-primary text-xs px-2.5 py-1 flex-shrink-0 disabled:opacity-50"
              >
                {assistBusy ? "…" : inputMode === "translate" ? "Go" : "Apply"}
              </button>
            </div>
          )}

          {assistErr && (
            <span className="px-1.5 pb-0.5 text-xs text-red-400 max-w-[320px] truncate" title={assistErr}>
              {assistErr}
            </span>
          )}
        </div>
      )}
    </>
  );
}
