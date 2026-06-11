import { useStore } from "../store/useStore";
import { streamChatResponse } from "./ai";

// One-shot, non-conversational completion against the configured vendor.
// Used by the "background" AI features (flashcard generation, tidy note,
// writing assist, weekly review) that need a single answer, not a chat.

export async function completeOnce(opts: {
  system: string;
  user: string;
  maxTokens?: number;
}): Promise<string> {
  const s = useStore.getState();
  if (!s.aiEnabled) throw new Error("AI features are disabled. Enable them in Settings → AI.");
  const cfg = s.aiVendorConfigs[s.aiVendor];

  let out = "";
  await new Promise<void>((resolve, reject) => {
    streamChatResponse(
      {
        vendor: s.aiVendor,
        apiKey: cfg.apiKey,
        model: cfg.model,
        baseUrl: cfg.baseUrl,
        messages: [{ role: "user", content: opts.user }],
        unrestricted: false,
        agentSystem: opts.system, // replaces the base system prompt
        maxTokens: opts.maxTokens ?? 2048,
      },
      (delta) => { out += delta; },
      () => resolve(),
      (err) => reject(new Error(err))
    );
  });
  return out;
}

/** Extract the first top-level JSON array/object from model output. */
export function extractJson(text: string): unknown | null {
  const fenced = /```(?:json)?\s*\n?([\s\S]*?)```/.exec(text);
  const candidates = fenced ? [fenced[1], text] : [text];
  for (const src of candidates) {
    for (const opener of ["[", "{"]) {
      const start = src.indexOf(opener);
      if (start === -1) continue;
      // Scan for the matching closer, respecting strings.
      let depth = 0;
      let inStr = false;
      let esc = false;
      for (let i = start; i < src.length; i++) {
        const c = src[i];
        if (inStr) {
          if (esc) esc = false;
          else if (c === "\\") esc = true;
          else if (c === '"') inStr = false;
          continue;
        }
        if (c === '"') inStr = true;
        else if (c === "[" || c === "{") depth++;
        else if (c === "]" || c === "}") {
          depth--;
          if (depth === 0) {
            try {
              return JSON.parse(src.slice(start, i + 1));
            } catch {
              break; // try the next opener/candidate
            }
          }
        }
      }
    }
  }
  return null;
}
