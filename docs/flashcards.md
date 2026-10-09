# Flashcards

**What it does:** Create decks of question/answer cards and review them with **spaced repetition** — Hades schedules each card to come back right before you'd forget it. The algorithm is SM-2, the same family Anki uses.

**Why use it:** Spaced repetition is one of the most effective ways to move facts into long-term memory. Instead of re-reading everything, you review the cards that are due, at increasing intervals as you master them — and drill the rest of the deck whenever you want extra practice.

It's the **Flashcards** icon (layers) in the sidebar.

---

## How spaced repetition works (the short version)

Each time you review a card, you rate how well you knew it. Based on that rating, Hades sets the **next review date**:

- Knew it well → it comes back **further in the future** (1 day → 6 days → weeks → months…).
- Struggled or blanked → it comes back **soon** (resets to short intervals).

Cards that are **due today** are surfaced automatically, so you just open the module and review what's scheduled. Nothing is ever hidden or deleted by reviewing: cards that aren't due are simply not in the "due" queue, and you can drill them whenever you like.

---

## Create a deck and add cards

1. **Add a deck** — give it a name (and a color, to tell decks apart).
2. **Add cards** to the deck — each card has a **Front** (the prompt/question) and a **Back** (the answer).

> **Tip:** Press **⌘ + Enter** (Cmd+Enter) to save a card you're editing.

**Manage decks:** rename a deck, or delete it (deleting a deck removes its cards too).

---

## Reviewing and drilling cards

Open a deck. The header always shows the deck's **total card count** and how many are due, and offers two ways to study:

| Button | What it studies | Effect on scheduling |
|--------|-----------------|----------------------|
| **Review due (n)** | Only the cards due today (shown only when n > 0) | Every rating updates the card's schedule (SM-2) |
| **Drill all (N)** | Every card in the deck, shuffled (always available while the deck has cards) | Only cards that are **due** are rescheduled; cards that are not due yet keep their schedule |

**Cards are never removed, hidden or archived by studying.** Rating a card "Easy" gives it a long interval (it won't be *due* for a while), but it stays in the deck, in the card list, and in every future drill — you can re-test anything, any time.

For each card:

1. Read the **front**.
2. **Reveal the answer:** press **Space** or **Enter** (or click the card).
3. **Rate how it went.**

### Rating buttons and shortcuts

| Key | Rating | Meaning | Effect |
|-----|--------|---------|--------|
| **1** | **Again** | You didn't know it | Resets — card returns very soon, and comes back **at the end of this session** |
| **2** | **Hard** | Recalled with difficulty | Counts as a lapse: card returns tomorrow |
| **3** | **Good** | Recalled correctly | Normal interval growth |
| **4** | **Easy** | Knew it instantly | Longer interval |

> You can rate with the **number keys 1–4** once the answer is showing, or click the buttons.

### How ratings affect the schedule

- **Due cards** follow SM-2: a rating below *Good* resets the card (next review tomorrow); *Good*/*Easy* grow the interval 1 day → 6 days → previous interval × ease factor. Easy raises the ease factor, so the card's gaps grow faster.
- **Cards that are not due yet** (only possible in **Drill all**, or when an *Again* card comes back later in the same session) are marked "Not due · rating won't change its schedule". Your rating only moves you through the session; it never inflates or shortens the card's interval. Self-directed re-testing therefore can't distort your spaced-repetition schedule.
- **Again** always re-queues the card at the end of the current session, so you see it once more before the session ends. Only the first rating of a due card changes its schedule; the repeat is practice.
- The list of cards in a deck always shows **every** card. A red **Due** badge means due today; otherwise the badge shows the card's current interval.

### When a session ends

The session-complete screen never removes anything — it tells you how many cards were in the session and how many remain in the deck, and offers:

- **Drill all cards** / **Drill again** — go through the whole deck again (shuffled).
- **Review due** — if any cards are due.
- **Back to deck**.

---

## Tips for effective decks

- **One fact per card.** "What year did X happen?" beats "List everything about X."
- **Make the front a real question**, not just a keyword.
- **Be honest with ratings.** Marking everything "Easy" defeats the scheduling — rate by how hard recall *actually* was.
- **Review daily, briefly.** A few minutes a day beats a long cram session; due cards stay manageable.

---

## Troubleshooting

**No cards are due.**
That's normal — it means nothing is **due** in that deck today. Spaced repetition deliberately spaces reviews out. The cards are all still there: use **Drill all** to practise the whole deck anyway (it won't change the schedule of cards that aren't due), add new cards, or come back when cards are due.

**I rated a card "Easy" and it disappeared from Review.**
It isn't gone — it's scheduled further out, so it no longer counts as *due*. It stays in the deck's card list and in **Drill all**, and returns to **Review due** when its date arrives.

**A card keeps coming back every day.**
You're likely rating it **Again/Hard** repeatedly, which keeps the interval short. That's the system working — but consider rewriting the card to be simpler if it's genuinely too hard.

**I rated a card by accident.**
There's no undo for a rating. The next scheduled review will self-correct as you rate it accurately going forward.
