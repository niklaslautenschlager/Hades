import { completeOnce } from "./aiOneShot";

// F5/F7 — editor-side AI assists. All of these return plain markdown text;
// callers apply it through editorBridge so the change lands in the editor's
// undo history.

const TIDY_SYSTEM = `You clean up and format markdown notes.
Rules:
- Fix structure: sensible headings, consistent bullet style, proper code fences, spacing.
- Fix obvious typos and broken markdown syntax.
- PRESERVE the author's content, meaning, wording and language — you are a formatter, not an editor.
- Keep [[wikilinks]], $math$, tags and URLs exactly as they are.
- Output ONLY the cleaned markdown. No commentary, no code fence around the whole document.`;

export async function tidyNote(content: string): Promise<string> {
  const out = await completeOnce({
    system: TIDY_SYSTEM,
    user: content.slice(0, 16000),
    maxTokens: 4096,
  });
  const trimmed = out.trim();
  // Some models wrap the whole answer in a fence despite instructions.
  const fence = /^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/.exec(trimmed);
  return (fence ? fence[1] : trimmed) + "\n";
}

export type AssistAction = "expand" | "condense" | "rephrase" | "continue";

const ASSIST_PROMPTS: Record<AssistAction, string> = {
  expand:
    "Expand the passage with more detail, examples or explanation, keeping the author's voice and language. Return ONLY the expanded replacement text.",
  condense:
    "Condense the passage to its essential points, keeping the author's voice and language. Return ONLY the condensed replacement text.",
  rephrase:
    "Rephrase the passage more clearly, keeping the meaning, voice and language. Return ONLY the rephrased replacement text.",
  continue:
    "Continue writing from where the passage ends, matching its style, tone and language. Return ONLY the continuation (do not repeat the passage).",
};

export async function assistRewrite(
  action: AssistAction,
  selection: string,
  sourceContext?: string
): Promise<string> {
  const ctx = sourceContext?.trim()
    ? `\n\nUse the following source material (from the PDF the user is viewing) as the authority for facts and context. Only use what's relevant:\n"""\n${sourceContext.slice(0, 8000)}\n"""`
    : "";
  const out = await completeOnce({
    system: `You are a precise writing assistant working inside a markdown note. ${ASSIST_PROMPTS[action]} Never add commentary, quotes around the text, or a code fence.${ctx}`,
    user: selection.slice(0, 8000),
    maxTokens: 2048,
  });
  return out.trim();
}

/** Translate the selection into a target language, preserving markdown. */
export async function translateText(selection: string, language: string): Promise<string> {
  const out = await completeOnce({
    system:
      `You are a translator. Translate the user's text into ${language}. ` +
      `Preserve markdown formatting, [[wiki-links]], $math$, code, URLs and structure exactly. ` +
      `Output ONLY the translation — no commentary, quotes, or code fences.`,
    user: selection.slice(0, 8000),
    maxTokens: 2048,
  });
  return out.trim();
}

/** Apply a free-form instruction to the selection and return the replacement. */
export async function askRewrite(selection: string, instruction: string): Promise<string> {
  const out = await completeOnce({
    system:
      `You edit a passage from a markdown note according to the user's instruction. ` +
      `Apply it and return ONLY the resulting replacement text — no commentary, quotes, or code fences. ` +
      `Preserve markdown unless the instruction says otherwise.\n\nINSTRUCTION: ${instruction}`,
    user: selection.slice(0, 8000),
    maxTokens: 2048,
  });
  return out.trim();
}

// Verify a selected passage against the open PDF. Sentinel "__OK__" means the
// passage is accurate/complete and should be left untouched.
const VERIFY_OK = "__OK__";

export async function verifyAgainstSource(selection: string, sourceText: string): Promise<{ ok: boolean; text: string }> {
  const out = (
    await completeOnce({
      system:
        `You fact-check a passage from the user's notes against an authoritative source (a PDF they are reading). Compare the passage to the source:\n` +
        `- If the passage is accurate and complete, reply with EXACTLY "${VERIFY_OK}" and nothing else.\n` +
        `- If it has a factual mistake, reply with the corrected passage only.\n` +
        `- If it's missing important information present in the source, reply with the passage expanded to include it.\n` +
        `- If the source doesn't cover the passage, reply with EXACTLY "${VERIFY_OK}".\n` +
        `Reply with ONLY the replacement passage or the sentinel — no commentary, quotes, or code fences.\n\n` +
        `SOURCE:\n"""\n${sourceText.slice(0, 9000)}\n"""`,
      user: selection.slice(0, 6000),
      maxTokens: 2048,
    })
  ).trim();

  if (!out || out === VERIFY_OK || out.replace(/[`"]/g, "").trim() === VERIFY_OK) {
    return { ok: true, text: selection };
  }
  return { ok: false, text: out };
}
