import type { GroqModelId } from "../store/useStore";

// Local copy — avoids importing the store at module level
interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const SYSTEM_PROMPT = `You are Socrates — a focused study and productivity assistant embedded in the Hades productivity suite.

Your ONLY permitted domains are:
1. Education & learning (any academic subject, explaining concepts, clarifying material)
2. Study techniques (spaced repetition, active recall, Feynman technique, mind mapping, etc.)
3. Productivity & focus (time management, deep work, note-taking strategies, goal setting)
4. Research methods & academic writing
5. Programming & technical learning (when the user is studying or learning it)
6. Career & skill development advice

If the user asks about anything outside these domains, respond with:
"I'm specialized in education and productivity. Let's keep the focus sharp — how can I help you learn or work more effectively?"

Keep responses concise, practical, and structured. Use markdown when it aids clarity.`;

// Plain constant — no SDK import at module level
export const GROQ_MODELS = [
  { id: "llama-3.3-70b-versatile" as GroqModelId, label: "Llama 3.3 70B" },
  { id: "llama3-8b-8192" as GroqModelId, label: "Llama 3 8B (fast)" },
  { id: "mixtral-8x7b-32768" as GroqModelId, label: "Mixtral 8x7B" },
];

export async function streamChatResponse(
  apiKey: string,
  messages: ChatMessage[],
  model: GroqModelId,
  onDelta: (text: string) => void,
  onDone: () => void,
  onError: (err: string) => void
): Promise<void> {
  if (!apiKey.trim()) {
    onError("No API key configured. Open Settings (⚙) and add your Groq API key.");
    return;
  }

  try {
    // Lazy-load so the SDK never runs at startup — avoids WebKit init crashes
    const { default: Groq } = await import("groq-sdk");
    const client = new Groq({ apiKey, dangerouslyAllowBrowser: true });

    const stream = await client.chat.completions.create({
      model,
      max_tokens: 1024,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
      ],
      stream: true,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? "";
      if (delta) onDelta(delta);
    }

    onDone();
  } catch (err: unknown) {
    onError(err instanceof Error ? err.message : String(err));
  }
}
