import type { Flashcard, ReviewRating } from "../store/useStore";

export type SessionMode = "due" | "all";

export interface SessionState {
  queue: Flashcard[];
  index: number;
}

export interface ReviewControls {
  total: number;
  due: number;
  canReviewDue: boolean;
  canDrill: boolean;
}

const AGAIN: ReviewRating = 0;

export function isDue(card: Pick<Flashcard, "nextReview">, today: string): boolean {
  // A card with unreadable scheduling data must stay reviewable rather than vanish from the due queue.
  return typeof card.nextReview !== "string" || card.nextReview <= today;
}

function shuffled<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(rng() * (i + 1)));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function buildQueue(
  cards: readonly Flashcard[],
  mode: SessionMode,
  today: string,
  opts: { shuffle?: boolean; rng?: () => number } = {}
): Flashcard[] {
  const picked = mode === "due" ? cards.filter((c) => isDue(c, today)) : [...cards];
  return opts.shuffle ? shuffled(picked, opts.rng ?? Math.random) : picked;
}

export function advance(state: SessionState, rating: ReviewRating): SessionState {
  const card = state.queue[state.index];
  if (!card) return state;
  return {
    queue: rating === AGAIN ? [...state.queue, card] : state.queue,
    index: state.index + 1,
  };
}

export function reviewControls(cards: readonly Flashcard[], today: string): ReviewControls {
  const due = cards.filter((c) => isDue(c, today)).length;
  return {
    total: cards.length,
    due,
    canReviewDue: due > 0,
    canDrill: cards.length > 0,
  };
}
