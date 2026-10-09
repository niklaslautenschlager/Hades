import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useStore, type Flashcard, type ReviewRating } from "../store/useStore";
import { advance, buildQueue, reviewControls, type SessionState } from "./flashcardSession";

// zustand's persist middleware reads window.localStorage and warns on every write when it is missing (plain Node).
vi.hoisted(() => {
  const mem = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    },
  });
});

const TODAY = "2026-10-08";
const ALL_RATINGS: ReviewRating[] = [0, 1, 2, 3, 4, 5];

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

const live = () => useStore.getState().flashcards;
const byId = (id: string) => live().find((c) => c.id === id)!;
const deckCards = (deckId = "d1") => live().filter((c) => c.deckId === deckId);
const rate = (id: string, rating: ReviewRating) => useStore.getState().reviewFlashcard(id, rating);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`));
  useStore.setState({ flashcardDecks: [], flashcards: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("reviewFlashcard keeps every card", () => {
  it("never removes a card, whatever the rating", () => {
    for (const rating of ALL_RATINGS) {
      useStore.setState({ flashcards: [card("a", TODAY), card("b", TODAY)] });
      rate("a", rating);
      expect(live().map((c) => c.id)).toEqual(["a", "b"]);
      expect(byId("a").front).toBe("front a");
    }
  });

  it("Easy gives a future nextReview but the card stays in the deck list and in drill queues", () => {
    useStore.setState({ flashcards: [card("easy", TODAY), card("other", TODAY)] });
    rate("easy", 5);

    const easy = byId("easy");
    expect(easy.nextReview > TODAY).toBe(true);
    expect(easy.interval).toBe(1);
    expect(deckCards().map((c) => c.id)).toContain("easy");
    expect(buildQueue(deckCards(), "all", TODAY).map((c) => c.id)).toContain("easy");
    expect(buildQueue(deckCards(), "due", TODAY).map((c) => c.id)).toEqual(["other"]);
  });

  it("leaves the deck drillable after every due card has been rated Easy", () => {
    useStore.setState({ flashcards: [card("a", TODAY), card("b", TODAY), card("c", TODAY)] });
    for (const c of buildQueue(deckCards(), "due", TODAY)) rate(c.id, 5);

    const controls = reviewControls(deckCards(), TODAY);
    expect(controls).toEqual({ total: 3, due: 0, canReviewDue: false, canDrill: true });
    expect(buildQueue(deckCards(), "all", TODAY)).toHaveLength(3);
  });

  it("ignores an unknown card id", () => {
    useStore.setState({ flashcards: [card("a", TODAY)] });
    const before = live();
    expect(() => rate("missing", 3)).not.toThrow();
    expect(live()).toEqual(before);
  });
});

describe("SM-2 on due cards", () => {
  it("failing a card (rating < 3) resets its progress", () => {
    for (const rating of [0, 1, 2] as ReviewRating[]) {
      useStore.setState({
        flashcards: [card("a", TODAY, { interval: 15, repetitions: 4, easeFactor: 2.4 })],
      });
      rate("a", rating);
      const a = byId("a");
      expect(a.repetitions).toBe(0);
      expect(a.interval).toBe(0);
      expect(a.nextReview > TODAY).toBe(true);
      expect(a.easeFactor).toBeLessThan(2.4);
      expect(a.easeFactor).toBeGreaterThanOrEqual(1.3);
    }
  });

  it("passing grows the interval 1 -> 6 -> round(previous * ease)", () => {
    useStore.setState({ flashcards: [card("a", TODAY)] });

    rate("a", 3);
    expect(byId("a")).toMatchObject({ repetitions: 1, interval: 1, nextReview: "2026-10-09" });

    useStore.getState().updateFlashcard("a", { nextReview: TODAY });
    rate("a", 3);
    expect(byId("a")).toMatchObject({ repetitions: 2, interval: 6, nextReview: "2026-10-14" });

    useStore.getState().updateFlashcard("a", { nextReview: TODAY });
    const easeBefore = byId("a").easeFactor;
    rate("a", 3);
    expect(byId("a").repetitions).toBe(3);
    expect(byId("a").interval).toBe(Math.round(6 * easeBefore));
  });

  it("Easy raises the ease factor and keeps growing intervals while the card stays listed", () => {
    useStore.setState({ flashcards: [card("a", TODAY)] });
    let previous = 0;
    for (let i = 0; i < 5; i++) {
      useStore.getState().updateFlashcard("a", { nextReview: TODAY });
      rate("a", 5);
      expect(byId("a").interval).toBeGreaterThanOrEqual(previous);
      previous = byId("a").interval;
      expect(live()).toHaveLength(1);
    }
    expect(byId("a").easeFactor).toBeGreaterThan(2.5);
    expect(previous).toBeGreaterThan(6);
  });
});

describe("drill ratings on cards that are not due", () => {
  const resting = () =>
    card("rest", "2026-10-14", { interval: 6, repetitions: 2, easeFactor: 2.3 });

  it("leave interval, easeFactor, repetitions and nextReview untouched for every rating", () => {
    for (const rating of ALL_RATINGS) {
      useStore.setState({ flashcards: [resting()] });
      rate("rest", rating);
      expect(byId("rest")).toEqual(resting());
    }
  });

  it("a card due tomorrow is not yet due either", () => {
    useStore.setState({ flashcards: [card("t", "2026-10-09", { interval: 1, repetitions: 1 })] });
    rate("t", 5);
    expect(byId("t")).toEqual(card("t", "2026-10-09", { interval: 1, repetitions: 1 }));
  });

  it("in a mixed drill only the due card is rescheduled", () => {
    useStore.setState({
      flashcards: [card("due", TODAY), resting(), card("far", "2027-03-01", { interval: 90, repetitions: 6 })],
    });
    const snapshot = { rest: resting(), far: byId("far") };

    for (const c of buildQueue(deckCards(), "all", TODAY)) rate(c.id, 3);

    expect(byId("due")).toMatchObject({ repetitions: 1, interval: 1, nextReview: "2026-10-09" });
    expect(byId("rest")).toEqual(snapshot.rest);
    expect(byId("far")).toEqual(snapshot.far);
    expect(live()).toHaveLength(3);
  });

  it("rating a just-failed card again in the same session does not compound its reset", () => {
    useStore.setState({ flashcards: [card("a", TODAY, { interval: 6, repetitions: 2 })] });
    rate("a", 0);
    const afterFail = byId("a");
    rate("a", 5);
    expect(byId("a")).toEqual(afterFail);
  });
});

describe("a running session against the real store", () => {
  it("due session: every due card is shown once in order and none is skipped as ratings land", () => {
    useStore.setState({
      flashcards: [card("c1", TODAY), card("c2", "2026-10-01"), card("c3", TODAY), card("skip", "2027-01-01")],
    });
    let s: SessionState = { queue: buildQueue(deckCards(), "due", TODAY), index: 0 };
    const frozen = s.queue.map((c) => c.id);
    const shown: string[] = [];
    const ratings: ReviewRating[] = [5, 3, 5];

    while (s.index < s.queue.length) {
      const current = s.queue[s.index];
      shown.push(current.id);
      const rating = ratings[shown.length - 1];
      rate(current.id, rating);
      s = advance(s, rating);
      expect(s.queue.map((c) => c.id)).toEqual(frozen);
      expect(live()).toHaveLength(4);
    }

    expect(shown).toEqual(["c1", "c2", "c3"]);
    expect(buildQueue(deckCards(), "due", TODAY)).toEqual([]);
    expect(buildQueue(deckCards(), "all", TODAY).map((c) => c.id).sort()).toEqual(["c1", "c2", "c3", "skip"]);
  });

  it("Again re-queues the card and the session still shows every card", () => {
    useStore.setState({ flashcards: [card("a", TODAY), card("b", TODAY)] });
    let s: SessionState = { queue: buildQueue(deckCards(), "due", TODAY), index: 0 };
    const shown: string[] = [];
    const script: ReviewRating[] = [0, 5, 3];

    while (s.index < s.queue.length) {
      const current = s.queue[s.index];
      shown.push(current.id);
      const rating = script[shown.length - 1];
      rate(current.id, rating);
      s = advance(s, rating);
    }

    expect(shown).toEqual(["a", "b", "a"]);
    expect(live()).toHaveLength(2);
    expect(byId("a").repetitions).toBe(0);
    expect(byId("b").repetitions).toBe(1);
  });

  it("drill session after everything is rated still covers the whole deck without moving any schedule", () => {
    useStore.setState({ flashcards: [card("a", TODAY), card("b", TODAY), card("c", TODAY)] });
    for (const c of buildQueue(deckCards(), "due", TODAY)) rate(c.id, 5);
    const scheduled = live();

    let s: SessionState = {
      queue: buildQueue(deckCards(), "all", TODAY, { shuffle: true, rng: () => 0.3 }),
      index: 0,
    };
    expect(s.queue).toHaveLength(3);
    const shown: string[] = [];
    while (s.index < s.queue.length && shown.length < 20) {
      const current = s.queue[s.index];
      shown.push(current.id);
      const rating: ReviewRating = shown.length === 1 ? 0 : 5;
      rate(current.id, rating);
      s = advance(s, rating);
    }

    expect([...new Set(shown)].sort()).toEqual(["a", "b", "c"]);
    expect(shown).toHaveLength(4);
    expect(live()).toEqual(scheduled);
  });

  it("an empty deck builds empty queues and offers no review controls", () => {
    expect(buildQueue(deckCards(), "all", TODAY)).toEqual([]);
    expect(buildQueue(deckCards(), "due", TODAY)).toEqual([]);
    expect(reviewControls(deckCards(), TODAY).canDrill).toBe(false);
  });
});
