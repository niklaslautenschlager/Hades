import { describe, it, expect } from "vitest";
import type { Flashcard, ReviewRating } from "../store/useStore";
import { advance, buildQueue, isDue, reviewControls, type SessionState } from "./flashcardSession";

const TODAY = "2026-10-08";

function card(id: string, nextReview: string, over: Partial<Flashcard> = {}): Flashcard {
  return {
    id,
    deckId: "d1",
    front: `front ${id}`,
    back: `back ${id}`,
    interval: 0,
    easeFactor: 2.5,
    repetitions: 0,
    nextReview,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ids = (cards: Flashcard[]) => cards.map((c) => c.id);

describe("isDue", () => {
  it("is true for today and the past, false for the future", () => {
    expect(isDue(card("a", TODAY), TODAY)).toBe(true);
    expect(isDue(card("a", "2026-10-07"), TODAY)).toBe(true);
    expect(isDue(card("a", "2026-10-09"), TODAY)).toBe(false);
  });

  it("treats unreadable scheduling data as due so the card never becomes unreachable", () => {
    const broken = { ...card("a", TODAY), nextReview: undefined as unknown as string };
    expect(isDue(broken, TODAY)).toBe(true);
  });
});

describe("buildQueue", () => {
  const deck = [
    card("due-1", "2026-10-01"),
    card("later", "2026-11-01", { interval: 30, repetitions: 4 }),
    card("due-2", TODAY),
    card("tomorrow", "2026-10-09"),
  ];

  it("due mode keeps only due cards in deck order", () => {
    expect(ids(buildQueue(deck, "due", TODAY))).toEqual(["due-1", "due-2"]);
  });

  it("all mode includes every card, including ones scheduled far in the future", () => {
    expect(ids(buildQueue(deck, "all", TODAY))).toEqual(["due-1", "later", "due-2", "tomorrow"]);
  });

  it("never mutates its input", () => {
    const before = [...deck];
    buildQueue(deck, "all", TODAY, { shuffle: true, rng: mulberry32(1) });
    buildQueue(deck, "due", TODAY);
    expect(deck).toEqual(before);
  });

  it("returns an empty queue for an empty deck in both modes", () => {
    expect(buildQueue([], "due", TODAY)).toEqual([]);
    expect(buildQueue([], "all", TODAY)).toEqual([]);
    expect(buildQueue([], "all", TODAY, { shuffle: true })).toEqual([]);
  });

  it("drills a deck where nothing is due", () => {
    const resting = [card("a", "2026-12-01"), card("b", "2027-01-01")];
    expect(buildQueue(resting, "due", TODAY)).toEqual([]);
    expect(ids(buildQueue(resting, "all", TODAY))).toEqual(["a", "b"]);
  });

  it("shuffle is deterministic for a seeded rng and is a permutation of the deck", () => {
    const many = Array.from({ length: 20 }, (_, i) => card(`c${i}`, "2027-01-01"));
    const first = ids(buildQueue(many, "all", TODAY, { shuffle: true, rng: mulberry32(42) }));
    const again = ids(buildQueue(many, "all", TODAY, { shuffle: true, rng: mulberry32(42) }));
    const other = ids(buildQueue(many, "all", TODAY, { shuffle: true, rng: mulberry32(7) }));

    expect(first).toEqual(again);
    expect(first).not.toEqual(ids(many));
    expect(first).not.toEqual(other);
    expect([...first].sort()).toEqual(ids(many).sort());
  });

  it("shuffle tolerates an rng that returns exactly 1", () => {
    const out = buildQueue(deck, "all", TODAY, { shuffle: true, rng: () => 1 });
    expect([...ids(out)].sort()).toEqual(ids(deck).sort());
  });

  it("does not shuffle unless asked", () => {
    expect(ids(buildQueue(deck, "all", TODAY, { rng: () => 0 }))).toEqual(ids(deck));
  });
});

describe("advance", () => {
  const start = (cards: Flashcard[]): SessionState => ({ queue: cards, index: 0 });

  it("moves to the next card without touching the queue for any rating but Again", () => {
    const s = start([card("a", TODAY), card("b", TODAY)]);
    for (const rating of [2, 3, 5] as ReviewRating[]) {
      const next = advance(s, rating);
      expect(next.queue).toBe(s.queue);
      expect(next.index).toBe(1);
    }
  });

  it("re-queues an Again card at the end of the session", () => {
    const s = start([card("a", TODAY), card("b", TODAY), card("c", TODAY)]);
    const next = advance(s, 0);
    expect(ids(next.queue)).toEqual(["a", "b", "c", "a"]);
    expect(next.index).toBe(1);
    expect(ids(s.queue)).toEqual(["a", "b", "c"]);
  });

  it("keeps re-queuing a card each time it is failed, and ends once it is passed", () => {
    let s = start([card("a", TODAY)]);
    s = advance(s, 0);
    s = advance(s, 0);
    expect(ids(s.queue)).toEqual(["a", "a", "a"]);
    expect(s.index).toBe(2);
    s = advance(s, 3);
    expect(s.index).toBe(s.queue.length);
  });

  it("is a no-op past the end of the queue", () => {
    const s: SessionState = { queue: [card("a", TODAY)], index: 1 };
    expect(advance(s, 0)).toBe(s);
    const empty = start([]);
    expect(advance(empty, 5)).toBe(empty);
  });

  it("walks every card exactly once, in order, even when the live deck changes under it", () => {
    let live = [card("c1", TODAY), card("c2", TODAY), card("c3", TODAY)];
    let s = start(buildQueue(live, "due", TODAY));
    const frozen = ids(s.queue);
    const seen: string[] = [];

    while (s.index < s.queue.length) {
      const current = s.queue[s.index];
      seen.push(current.id);
      // What reviewFlashcard does to the live deck: the rated card is no longer due.
      live = live.map((c) => (c.id === current.id ? { ...c, nextReview: "2026-12-31" } : c));
      s = advance(s, 5);
      expect(ids(s.queue)).toEqual(frozen);
    }

    expect(seen).toEqual(["c1", "c2", "c3"]);
    expect(buildQueue(live, "due", TODAY)).toEqual([]);
    expect(ids(buildQueue(live, "all", TODAY))).toEqual(["c1", "c2", "c3"]);
  });

  it("a queue derived from the live deck would have skipped a card (the bug the frozen queue prevents)", () => {
    let live = [card("c1", TODAY), card("c2", TODAY), card("c3", TODAY)];
    let index = 0;
    const seen: string[] = [];
    while (index < buildQueue(live, "due", TODAY).length) {
      const current = buildQueue(live, "due", TODAY)[index];
      seen.push(current.id);
      live = live.map((c) => (c.id === current.id ? { ...c, nextReview: "2026-12-31" } : c));
      index++;
    }
    expect(seen).not.toEqual(["c1", "c2", "c3"]);
  });
});

describe("reviewControls (what DeckView shows)", () => {
  it("offers nothing for an empty deck", () => {
    expect(reviewControls([], TODAY)).toEqual({ total: 0, due: 0, canReviewDue: false, canDrill: false });
  });

  it("offers Drill, but not Review due, when every card is scheduled for later", () => {
    const c = reviewControls([card("a", "2026-12-01"), card("b", "2027-01-01")], TODAY);
    expect(c).toEqual({ total: 2, due: 0, canReviewDue: false, canDrill: true });
  });

  it("offers both with accurate counts when some cards are due", () => {
    const c = reviewControls([card("a", TODAY), card("b", "2027-01-01"), card("c", "2026-01-01")], TODAY);
    expect(c).toEqual({ total: 3, due: 2, canReviewDue: true, canDrill: true });
  });

  it("keeps offering Drill after every due card has been rated", () => {
    const before = [card("a", TODAY), card("b", TODAY)];
    expect(reviewControls(before, TODAY).canReviewDue).toBe(true);
    const after = before.map((c) => ({ ...c, nextReview: "2026-10-20" }));
    const c = reviewControls(after, TODAY);
    expect(c.canReviewDue).toBe(false);
    expect(c.canDrill).toBe(true);
    expect(c.total).toBe(2);
  });
});
