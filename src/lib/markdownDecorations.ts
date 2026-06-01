/**
 * CodeMirror 6 extensions for markdown WYSIWYG live preview.
 *
 *  - Conceals syntax markers (#, **, *, `, ~~, >) when the cursor is not on
 *    that line — Obsidian-style "live preview".
 *  - Replaces bullet list markers (-, *, +) with a rigid "•" glyph.
 *  - Indents nested list items with a real visual jump (concealed leading
 *    whitespace replaced by left padding).
 *  - Heading line sizing, blockquote / code-block / HR line styling.
 *  - foldService for collapsing heading sections.
 *  - smartListKeymap for Enter / Tab / Shift-Tab / Backspace list behaviour.
 */

import {
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
  Decoration,
  type DecorationSet,
  type KeyBinding,
} from "@codemirror/view";
import { foldService, syntaxTree } from "@codemirror/language";
import { type Range } from "@codemirror/state";

// ─── Widgets ─────────────────────────────────────────────────────────────────

class BulletWidget extends WidgetType {
  eq() { return true; }
  toDOM() {
    const span = document.createElement("span");
    span.textContent = "•";
    span.className = "cm-md-bullet";
    return span;
  }
  ignoreEvent() { return false; }
}

const bulletDeco = Decoration.replace({ widget: new BulletWidget() });

// ─── Decoration builder ──────────────────────────────────────────────────────

function activeLineSet(view: EditorView): Set<number> {
  const set = new Set<number>();
  for (const r of view.state.selection.ranges) {
    const a = view.state.doc.lineAt(r.from).number;
    const b = view.state.doc.lineAt(r.to).number;
    for (let n = a; n <= b; n++) set.add(n);
  }
  return set;
}

function buildDecorations(view: EditorView): DecorationSet {
  const { state } = view;
  const decos: Range<Decoration>[] = [];
  const active = activeLineSet(view);

  // ── Per-line scan: headings, blockquote, HR, list indent + bullet ──────────
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = state.doc.lineAt(pos);
      const text = line.text;
      const isActive = active.has(line.number);

      // Heading: "# ", "## ", …
      const h = text.match(/^(#{1,6})\s/);
      if (h) {
        const level = h[1].length;
        decos.push(Decoration.line({ class: `cm-md-h${level}` }).range(line.from));
        if (!isActive) {
          // Conceal the "# " prefix
          decos.push(Decoration.replace({}).range(line.from, line.from + h[0].length));
        }
      }

      // Horizontal rule
      else if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(text)) {
        decos.push(Decoration.line({ class: "cm-md-hr-line" }).range(line.from));
      }

      // Blockquote: "> …"
      else if (/^\s*>/.test(text)) {
        decos.push(Decoration.line({ class: "cm-md-blockquote-line" }).range(line.from));
        const q = text.match(/^(\s*>\s?)/);
        if (q && !isActive) {
          decos.push(Decoration.replace({}).range(line.from, line.from + q[1].length));
        }
      }

      // List item: "  - text", "  * text", "  1. text"
      else {
        const li = text.match(/^(\s*)([-*+]|\d+\.)(\s+)/);
        if (li) {
          const indent = li[1].length;
          const marker = li[2];
          const markerStart = line.from + indent;

          // Visual indentation jump (concealed whitespace → padding)
          if (indent > 0) {
            decos.push(
              Decoration.line({
                attributes: { style: `padding-left:${indent * 0.85}em` },
              }).range(line.from)
            );
            // Conceal the raw leading whitespace (always — keeps indent stable)
            decos.push(Decoration.replace({}).range(line.from, markerStart));
          }

          // Bullet markers → rigid "•" glyph (ordered lists keep their number)
          const isBullet = /^[-*+]$/.test(marker);
          if (isBullet && !isActive) {
            decos.push(bulletDeco.range(markerStart, markerStart + 1));
          }
        }
      }

      pos = line.to + 1;
    }
  }

  // ── Syntax-tree scan: inline emphasis / code / strikethrough / fenced code ──
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter(node) {
        // Fenced code block → tint every line
        if (node.name === "FencedCode") {
          const s = state.doc.lineAt(node.from).number;
          const e = state.doc.lineAt(node.to).number;
          for (let n = s; n <= e; n++) {
            decos.push(Decoration.line({ class: "cm-md-fence-line" }).range(state.doc.line(n).from));
          }
          return;
        }

        // Inline markers to conceal: **, *, _, `, ~~
        if (
          node.name === "EmphasisMark" ||
          node.name === "StrikethroughMark" ||
          (node.name === "CodeMark" && node.node.parent?.name === "InlineCode")
        ) {
          const ln = state.doc.lineAt(node.from).number;
          if (!active.has(ln)) {
            decos.push(Decoration.replace({}).range(node.from, node.to));
          }
        }
      },
    });
  }

  // Decoration.set sorts the ranges for us
  return Decoration.set(decos, true);
}

export const markdownLiveDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || u.selectionSet) {
        this.decorations = buildDecorations(u.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
    // Required so atomic-replace ranges behave (cursor skips concealed text)
    provide: (plugin) =>
      EditorView.atomicRanges.of((view) => view.plugin(plugin)?.decorations ?? Decoration.none),
  }
);

// ─── Heading fold service ────────────────────────────────────────────────────

export const markdownFoldService = foldService.of((state, lineStart) => {
  const line = state.doc.lineAt(lineStart);
  const m = line.text.match(/^(#{1,6})\s/);
  if (!m) return null;

  const level = m[1].length;
  let foldEnd = line.to;

  for (let i = line.number + 1; i <= state.doc.lines; i++) {
    const next = state.doc.line(i);
    const nm = next.text.match(/^(#{1,6})\s/);
    if (nm && nm[1].length <= level) {
      foldEnd = state.doc.line(i - 1).to;
      break;
    }
    if (i === state.doc.lines) foldEnd = next.to;
  }

  return foldEnd > line.to ? { from: line.to, to: foldEnd } : null;
});

// ─── Smart list keymap ───────────────────────────────────────────────────────

interface ListInfo {
  indent: string;
  marker: string;       // raw marker on this line, e.g. "-" or "3."
  nextMarker: string;   // marker to insert on the continued line incl. trailing space
  content: string;
  lineFrom: number;
  lineTo: number;
  cursorHead: number;
}

function getListInfo(view: EditorView): ListInfo | null {
  const { state } = view;
  const sel = state.selection.main;
  if (!sel.empty) return null;

  const line = state.doc.lineAt(sel.head);
  const text = line.text;

  const ul = text.match(/^(\s*)([-*+]) (.*)$/);
  if (ul) {
    return {
      indent: ul[1],
      marker: ul[2],
      nextMarker: `${ul[1]}${ul[2]} `,
      content: ul[3],
      lineFrom: line.from,
      lineTo: line.to,
      cursorHead: sel.head,
    };
  }

  const ol = text.match(/^(\s*)(\d+)\. (.*)$/);
  if (ol) {
    return {
      indent: ol[1],
      marker: `${ol[2]}.`,
      nextMarker: `${ol[1]}${parseInt(ol[2]) + 1}. `,
      content: ol[3],
      lineFrom: line.from,
      lineTo: line.to,
      cursorHead: sel.head,
    };
  }

  return null;
}

const rawListKeymap: KeyBinding[] = [
  {
    key: "Enter",
    run(view) {
      const info = getListInfo(view);
      if (!info) return false;

      // Empty bullet → exit the list (clear the marker, stay on this line)
      if (info.content.trim() === "") {
        view.dispatch({
          changes: { from: info.lineFrom, to: info.lineTo, insert: "" },
          selection: { anchor: info.lineFrom },
          scrollIntoView: true,
        });
        return true;
      }

      // Continue the list on exactly one new line
      const insert = `\n${info.nextMarker}`;
      view.dispatch({
        changes: { from: info.cursorHead, insert },
        selection: { anchor: info.cursorHead + insert.length },
        scrollIntoView: true,
      });
      return true;
    },
  },
  {
    key: "Tab",
    run(view) {
      const info = getListInfo(view);
      if (!info) return false;
      // One indent level = 4 spaces (rendered as a big visual jump)
      view.dispatch({
        changes: { from: info.lineFrom, insert: "    " },
        selection: { anchor: info.cursorHead + 4 },
      });
      return true;
    },
  },
  {
    key: "Shift-Tab",
    run(view) {
      const info = getListInfo(view);
      if (!info || !info.indent) return false;
      const remove = Math.min(4, info.indent.length);
      view.dispatch({
        changes: { from: info.lineFrom, to: info.lineFrom + remove, insert: "" },
        selection: { anchor: Math.max(info.cursorHead - remove, info.lineFrom) },
      });
      return true;
    },
  },
  {
    key: "Backspace",
    run(view) {
      const info = getListInfo(view);
      if (!info || info.content !== "") return false;
      // Cursor sits right after "marker + space" → remove marker, keep indent
      const markerEnd = info.lineFrom + info.indent.length + info.marker.length + 1;
      if (info.cursorHead !== markerEnd) return false;
      const markerStart = info.lineFrom + info.indent.length;
      view.dispatch({
        changes: { from: markerStart, to: markerEnd, insert: "" },
        selection: { anchor: markerStart },
      });
      return true;
    },
  },
];

// Export the bindings so Editor can register them with Prec.highest
export const listBindings = rawListKeymap;
