/**
 * CodeMirror 6 live math rendering. Replaces `$…$` (inline) and `$$…$$`
 * (display) with KaTeX-typeset output when the cursor is not on that line —
 * Obsidian-style live preview that keeps the source editable. Mirrors the
 * pattern in markdownDecorations.ts.
 */

import {
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
  Decoration,
  type DecorationSet,
} from "@codemirror/view";
import { type Range } from "@codemirror/state";
import katex from "katex";

class MathWidget extends WidgetType {
  constructor(readonly tex: string, readonly display: boolean) {
    super();
  }
  eq(other: MathWidget) {
    return other.tex === this.tex && other.display === this.display;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-math";
    try {
      span.innerHTML = katex.renderToString(this.tex, {
        throwOnError: false,
        displayMode: this.display,
      });
    } catch {
      span.textContent = this.display ? `$$${this.tex}$$` : `$${this.tex}$`;
    }
    return span;
  }
  ignoreEvent() {
    return false;
  }
}

function activeLineSet(view: EditorView): Set<number> {
  const set = new Set<number>();
  for (const r of view.state.selection.ranges) {
    const a = view.state.doc.lineAt(r.from).number;
    const b = view.state.doc.lineAt(r.to).number;
    for (let n = a; n <= b; n++) set.add(n);
  }
  return set;
}

// $$…$$ (display) first, then single-line $…$ (inline, no inner newline/$).
const MATH_RE = /\$\$([^\n]+?)\$\$|\$([^$\n]+?)\$/g;

function buildMath(view: EditorView): DecorationSet {
  const { state } = view;
  const active = activeLineSet(view);
  const decos: Range<Decoration>[] = [];

  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = state.doc.lineAt(pos);
      if (!active.has(line.number) && line.text.includes("$")) {
        MATH_RE.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = MATH_RE.exec(line.text)) !== null) {
          const display = m[1] !== undefined;
          const tex = (m[1] ?? m[2] ?? "").trim();
          if (!tex) continue;
          const start = line.from + m.index;
          const end = start + m[0].length;
          decos.push(
            Decoration.replace({ widget: new MathWidget(tex, display) }).range(start, end)
          );
        }
      }
      pos = line.to + 1;
    }
  }
  return Decoration.set(decos, true);
}

export const mathLiveDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildMath(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || u.selectionSet) {
        this.decorations = buildMath(u.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
    provide: (plugin) =>
      EditorView.atomicRanges.of((view) => view.plugin(plugin)?.decorations ?? Decoration.none),
  }
);
