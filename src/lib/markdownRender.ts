import { marked } from "marked";

// Markdown → HTML with footnote support (`[^id]` references + `[^id]: text`
// definitions), which `marked` doesn't handle natively. Used by export and the
// preview so footnotes render as a numbered section with back-links.

export function renderNoteHtml(md: string): string {
  // 1) Collect definitions: lines like "[^id]: some text" (text may wrap onto
  //    indented continuation lines).
  const defs = new Map<string, string>();
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const body: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^\[\^([^\]]+)\]:\s?(.*)$/.exec(lines[i]);
    if (m) {
      let text = m[2];
      // Absorb indented continuation lines.
      while (i + 1 < lines.length && /^\s{2,}\S/.test(lines[i + 1])) {
        text += " " + lines[++i].trim();
      }
      defs.set(m[1], text.trim());
    } else {
      body.push(lines[i]);
    }
  }

  // 2) Replace inline references with superscript anchors, numbered by first
  //    appearance.
  const order: string[] = [];
  const withRefs = body.join("\n").replace(/\[\^([^\]]+)\]/g, (_full, id: string) => {
    if (!defs.has(id)) return `[^${id}]`; // not a real footnote — leave as-is
    let idx = order.indexOf(id);
    if (idx === -1) { order.push(id); idx = order.length - 1; }
    const n = idx + 1;
    return `<sup class="fn-ref" id="fnref-${id}"><a href="#fn-${id}">${n}</a></sup>`;
  });

  let html = marked.parse(withRefs) as string;

  // 3) Append the footnotes section in reference order.
  if (order.length > 0) {
    const items = order
      .map(
        (id) =>
          `<li id="fn-${id}">${marked.parseInline(defs.get(id) ?? "")} <a href="#fnref-${id}" class="fn-back">↩</a></li>`
      )
      .join("");
    html += `<hr class="fn-sep"/><ol class="footnotes">${items}</ol>`;
  }

  return html;
}
