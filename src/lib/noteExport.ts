import { marked } from "marked";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile, writeFile } from "@tauri-apps/plugin-fs";
import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";

/**
 * Export a note as a .md file using Tauri's save dialog.
 */
export async function exportAsMarkdown(name: string, content: string): Promise<void> {
  const filePath = await save({
    title: "Export Markdown",
    defaultPath: `${sanitizeFilename(name)}.md`,
    filters: [{ name: "Markdown", extensions: ["md"] }],
  });
  if (!filePath) return;
  await writeTextFile(filePath, content);
}

/**
 * Export a note as a real, multi-page PDF.
 *
 * Renders the markdown into a hidden-but-laid-out DOM node, rasterises it with
 * html2canvas, then slices the bitmap across A4 pages with jsPDF. This is far
 * more reliable inside a WebView than jsPDF's own HTML renderer.
 */
export async function exportAsPdf(name: string, content: string): Promise<void> {
  const filePath = await save({
    title: "Export as PDF",
    defaultPath: `${sanitizeFilename(name)}.pdf`,
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (!filePath) return;

  const html = marked.parse(content || "*Empty note*") as string;

  // Build a visible-but-off-canvas container (must be in layout for html2canvas)
  const wrapper = document.createElement("div");
  wrapper.style.cssText = [
    "position:fixed",
    "left:0",
    "top:0",
    "z-index:-1",
    "width:794px",          // ~A4 width @ 96dpi
    "padding:48px 56px",
    "box-sizing:border-box",
    "background:#ffffff",
    "color:#1c1917",
    "font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
    "font-size:14px",
    "line-height:1.7",
    "opacity:0",
    "pointer-events:none",
  ].join(";");

  wrapper.innerHTML = `
    <style>
      .pdf-root h1 { font-size:1.9em; font-weight:700; margin:0 0 0.5em; padding-bottom:0.2em; border-bottom:1px solid #e5e5e5; }
      .pdf-root h2 { font-size:1.45em; font-weight:600; margin:1em 0 0.4em; padding-bottom:0.2em; border-bottom:1px solid #e5e5e5; }
      .pdf-root h3 { font-size:1.2em; font-weight:600; margin:0.8em 0 0.3em; }
      .pdf-root h4,.pdf-root h5,.pdf-root h6 { font-size:1em; font-weight:600; margin:0.6em 0 0.2em; }
      .pdf-root p { margin:0 0 0.7em; }
      .pdf-root strong { font-weight:700; }
      .pdf-root em { font-style:italic; }
      .pdf-root a { color:#2563eb; text-decoration:underline; }
      .pdf-root ul,.pdf-root ol { margin:0 0 0.7em; padding-left:1.6em; }
      .pdf-root li { margin:0.25em 0; }
      .pdf-root blockquote { margin:0 0 0.7em; padding:0.4em 1em; border-left:3px solid #d4d4d8; color:#57534e; background:#fafaf9; }
      .pdf-root code { font-family:'Courier New',monospace; font-size:0.87em; background:#f5f5f4; padding:1px 5px; border-radius:3px; }
      .pdf-root pre { margin:0 0 0.7em; padding:14px; background:#f5f5f4; border:1px solid #e5e5e5; border-radius:6px; white-space:pre-wrap; word-wrap:break-word; }
      .pdf-root pre code { background:none; padding:0; }
      .pdf-root hr { border:none; border-top:1px solid #e5e5e5; margin:1.2em 0; }
      .pdf-root table { width:100%; border-collapse:collapse; margin:0 0 0.7em; }
      .pdf-root th,.pdf-root td { padding:7px 11px; border:1px solid #e5e5e5; text-align:left; }
      .pdf-root th { font-weight:600; background:#fafaf9; }
      .pdf-root img { max-width:100%; }
    </style>
    <div class="pdf-root"><h1>${escapeHtml(name)}</h1>${html}</div>
  `;
  document.body.appendChild(wrapper);

  try {
    const canvas = await html2canvas(wrapper, {
      scale: 2,
      backgroundColor: "#ffffff",
      useCORS: true,
      logging: false,
    });

    const pdf = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const margin = 36;
    const contentW = pageW - margin * 2;
    const contentH = pageH - margin * 2;

    // Scale the bitmap to the printable content width
    const imgW = contentW;
    const imgH = (canvas.height * imgW) / canvas.width;
    const imgData = canvas.toDataURL("image/jpeg", 0.92);

    let heightLeft = imgH;
    let position = margin;

    pdf.addImage(imgData, "JPEG", margin, position, imgW, imgH);
    heightLeft -= contentH;

    while (heightLeft > 0) {
      position = margin - (imgH - heightLeft);
      pdf.addPage();
      pdf.addImage(imgData, "JPEG", margin, position, imgW, imgH);
      heightLeft -= contentH;
    }

    const bytes = new Uint8Array(pdf.output("arraybuffer"));
    await writeFile(filePath, bytes);
  } finally {
    document.body.removeChild(wrapper);
  }
}

function sanitizeFilename(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, "-").trim() || "untitled";
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
