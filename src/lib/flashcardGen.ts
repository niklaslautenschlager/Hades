import { useStore } from "../store/useStore";
import { completeOnce, extractJson } from "./aiOneShot";

// F1 — turn a note (or any study text) into a flashcard deck in one click.
// Reuses the existing deck/card store actions; SM-2 scheduling kicks in
// automatically because new cards are due immediately.

const SYSTEM = `You create high-quality spaced-repetition flashcards from study material.
Rules:
- Cards test ONE atomic fact or concept each (no multi-part questions).
- Fronts are precise questions; backs are short, complete answers.
- Cover the material's key ideas; skip filler, headers, and metadata.
- Base every card ONLY on the provided material — never invent facts.
- Output ONLY a JSON array: [{"front": "...", "back": "..."}, ...]. No prose.`;

export interface GenerateResult {
  deckName: string;
  added: number;
}

export async function generateFlashcardsFromText(
  sourceTitle: string,
  text: string,
  opts: { deckName?: string; maxCards?: number } = {}
): Promise<GenerateResult> {
  const material = text.trim();
  if (!material) throw new Error("This note is empty — nothing to make cards from.");

  const maxCards = opts.maxCards ?? 12;
  const raw = await completeOnce({
    system: SYSTEM,
    user: `Create up to ${maxCards} flashcards from this material titled "${sourceTitle}":\n\n${material.slice(0, 12000)}`,
    maxTokens: 3072,
  });

  const parsed = extractJson(raw);
  const cards = (Array.isArray(parsed) ? parsed : [])
    .map((c) => ({
      front: typeof c?.front === "string" ? c.front.trim() : "",
      back: typeof c?.back === "string" ? c.back.trim() : "",
    }))
    .filter((c) => c.front && c.back);

  if (cards.length === 0) {
    throw new Error("The model didn't return usable cards. Try again (a larger model helps).");
  }

  const deckName = opts.deckName?.trim() || sourceTitle.trim() || "Generated";
  const st = useStore.getState();
  let deck = st.flashcardDecks.find((d) => d.name.toLowerCase() === deckName.toLowerCase());
  if (!deck) {
    st.addDeck(deckName);
    deck = useStore.getState().flashcardDecks.find(
      (d) => d.name.toLowerCase() === deckName.toLowerCase()
    );
  }
  if (!deck) throw new Error("Could not create the deck.");

  for (const c of cards) {
    useStore.getState().addFlashcard(deck.id, c.front, c.back);
  }
  return { deckName: deck.name, added: cards.length };
}
