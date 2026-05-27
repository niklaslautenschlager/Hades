import { marked } from "marked";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";

/**
 * Export a note as a .md file using Tauri's save dialog.
 */
export async function exportAsMarkdown(name: string, content: string): Promise<void> {
  const filePath = await save({
    title: "Export Markdown",
    defaultPath: `${sanitizeFilename(name)}.md`,
    filters: [{ name: "Markdown", extensions: ["md"] }],
  });

  if (!filePath) return; // User cancelled

  await writeTextFile(filePath, content);
}

/**
 * Export a note as a styled HTML file (open in browser → print to PDF).
 * Uses Tauri dialog to save as .html which can then be printed to PDF.
 */
export async function exportAsPdf(name: string, content: string): Promise<void> {
  const html = marked.parse(content) as string;

  const doc = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(name)}</title>
  <style>
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      max-width: 680px;
      margin: 40px auto;
      padding: 0 20px;
      color: #1c1917;
      font-size: 14px;
      line-height: 1.7;
    }
    h1 { font-size: 1.75em; font-weight: 700; margin: 0 0 0.6em; border-bottom: 1px solid #e5e5e5; padding-bottom: 0.3em; }
    h2 { font-size: 1.35em; font-weight: 600; margin: 1.2em 0 0.4em; }
    h3 { font-size: 1.15em; font-weight: 600; margin: 1em 0 0.3em; }
    p { margin: 0 0 0.8em; }
    strong { font-weight: 600; }
    a { color: #2563eb; }
    ul, ol { margin: 0 0 0.8em; padding-left: 1.5em; }
    li { margin: 0.2em 0; }
    blockquote { margin: 0 0 0.8em; padding: 0.4em 1em; border-left: 3px solid #d4d4d8; color: #57534e; background: #fafaf9; border-radius: 0 4px 4px 0; }
    code { font-family: 'JetBrains Mono', monospace; font-size: 0.88em; background: #f5f5f4; padding: 2px 6px; border-radius: 4px; }
    pre { margin: 0 0 0.8em; padding: 16px; background: #f5f5f4; border: 1px solid #e5e5e5; border-radius: 8px; overflow-x: auto; }
    pre code { background: none; padding: 0; font-size: 13px; }
    hr { border: none; border-top: 1px solid #e5e5e5; margin: 1.5em 0; }
    table { width: 100%; border-collapse: collapse; margin: 0 0 0.8em; }
    th, td { padding: 8px 12px; border: 1px solid #e5e5e5; text-align: left; }
    th { font-weight: 600; background: #fafaf9; }
    img { max-width: 100%; }
    @media print { body { margin: 0; } }
  </style>
</head>
<body>${html}</body>
</html>`;

  const filePath = await save({
    title: "Export as HTML (Print to PDF)",
    defaultPath: `${sanitizeFilename(name)}.html`,
    filters: [
      { name: "HTML", extensions: ["html"] },
    ],
  });

  if (!filePath) return; // User cancelled

  await writeTextFile(filePath, doc);
}

function sanitizeFilename(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, "-").trim() || "untitled";
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
