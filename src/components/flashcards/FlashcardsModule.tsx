import { useState, useMemo, useEffect } from "react";
import {
  Plus,
  Trash2,
  Edit3,
  Play,
  ArrowLeft,
  RotateCcw,
  Layers,
  BookOpen,
  X,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useShallow } from "zustand/react/shallow";
import { useStore, type FlashcardDeck, type Flashcard, type ReviewRating } from "../../store/useStore";

const DECK_COLORS = [
  "#3f3f46", "#ef4444", "#f97316", "#eab308",
  "#22c55e", "#06b6d4", "#3b82f6", "#a855f7",
];

function todayStr(): string {
  return new Date().toISOString().split("T")[0];
}

// ─── Review Session ──────────────────────────────────────────────────────────

function ReviewSession({
  deck,
  cards,
  onExit,
}: {
  deck: FlashcardDeck;
  cards: Flashcard[];
  onExit: () => void;
}) {
  const reviewFlashcard = useStore((s) => s.reviewFlashcard);
  const today = todayStr();

  const dueCards = useMemo(
    () => cards.filter((c) => c.nextReview <= today),
    [cards, today]
  );

  const [currentIndex, setCurrentIndex] = useState(0);
  const [showBack, setShowBack] = useState(false);
  const [reviewed, setReviewed] = useState(0);

  const card = dueCards[currentIndex];
  const total = dueCards.length;

  function handleRate(rating: ReviewRating) {
    if (!card) return;
    reviewFlashcard(card.id, rating);
    setShowBack(false);
    setReviewed((v) => v + 1);
    if (currentIndex + 1 < total) {
      setCurrentIndex((v) => v + 1);
    }
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!card) return;
      if (!showBack && (e.key === " " || e.key === "Enter")) {
        e.preventDefault();
        setShowBack(true);
        return;
      }
      if (showBack) {
        if (e.key === "1") handleRate(0 as ReviewRating);
        else if (e.key === "2") handleRate(2 as ReviewRating);
        else if (e.key === "3") handleRate(3 as ReviewRating);
        else if (e.key === "4") handleRate(5 as ReviewRating);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showBack, card]);

  if (!card || reviewed >= total) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-6">
        <div className="w-16 h-16 rounded-2xl bg-surface-hover flex items-center justify-center">
          <BookOpen className="w-7 h-7 text-foreground-secondary" />
        </div>
        <div className="text-center">
          <h2 className="text-lg font-semibold text-foreground">
            {total === 0 ? "No cards due" : "Session complete!"}
          </h2>
          <p className="text-sm text-muted mt-1">
            {total === 0
              ? "All cards in this deck are up to date."
              : `You reviewed ${reviewed} card${reviewed !== 1 ? "s" : ""}.`}
          </p>
        </div>
        <button onClick={onExit} className="btn-primary flex items-center gap-2">
          <ArrowLeft className="w-4 h-4" />
          Back to decks
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
        <button onClick={onExit} className="btn-ghost flex items-center gap-1.5 text-sm">
          <ArrowLeft className="w-3.5 h-3.5" />
          {deck.name}
        </button>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted">
            {currentIndex + 1} / {total}
          </span>
          <div className="w-32 h-1.5 bg-surface-hover rounded-full overflow-hidden">
            <div
              className="h-full bg-foreground rounded-full transition-all duration-300"
              style={{ width: `${((currentIndex + 1) / total) * 100}%` }}
            />
          </div>
        </div>
      </div>

      {/* Card */}
      <div className="flex-1 flex items-center justify-center p-8">
        <motion.div
          key={card.id + (showBack ? "-back" : "-front")}
          initial={{ opacity: 0, rotateY: showBack ? -90 : 0 }}
          animate={{ opacity: 1, rotateY: 0 }}
          transition={{ duration: 0.3 }}
          onClick={() => !showBack && setShowBack(true)}
          className={`w-full max-w-lg min-h-[280px] surface p-8 flex flex-col items-center justify-center
                     text-center cursor-pointer select-none transition-all hover:border-border-active
                     ${!showBack ? "hover:scale-[1.01]" : ""}`}
          style={{ borderLeftColor: deck.color, borderLeftWidth: 4 }}
        >
          <span className="text-xs font-medium text-muted uppercase tracking-wider mb-4">
            {showBack ? "Answer" : "Question"}
          </span>
          <p className="text-lg text-foreground leading-relaxed whitespace-pre-wrap">
            {showBack ? card.back : card.front}
          </p>
          {!showBack && (
            <p className="text-xs text-muted mt-6">Click to reveal · Space</p>
          )}
        </motion.div>
      </div>

      {/* Rating buttons (only visible when answer shown) */}
      <AnimatePresence>
        {showBack && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="flex items-center justify-center gap-3 px-6 py-5 border-t border-border flex-shrink-0"
          >
            <span className="text-xs text-muted mr-2">How well did you know it?</span>
            {([
              { rating: 0 as ReviewRating, label: "Again", key: "1", color: "text-red-400 hover:bg-red-950/40" },
              { rating: 2 as ReviewRating, label: "Hard", key: "2", color: "text-orange-400 hover:bg-orange-950/40" },
              { rating: 3 as ReviewRating, label: "Good", key: "3", color: "text-green-400 hover:bg-green-950/40" },
              { rating: 5 as ReviewRating, label: "Easy", key: "4", color: "text-blue-400 hover:bg-blue-950/40" },
            ]).map(({ rating, label, key, color }) => (
              <button
                key={rating}
                onClick={() => handleRate(rating)}
                className={`px-4 py-2 rounded-lg text-sm font-medium border border-border
                           transition-all duration-150 ${color}`}
              >
                <kbd className="font-mono text-[10px] opacity-60 mr-1">{key}</kbd>
                {label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Add Card Modal ──────────────────────────────────────────────────────────

function AddCardModal({
  deckId,
  onClose,
  initialFront,
  initialBack,
  editCardId,
}: {
  deckId: string;
  onClose: () => void;
  initialFront?: string;
  initialBack?: string;
  editCardId?: string;
}) {
  const { addFlashcard, updateFlashcard } = useStore(
    useShallow((s) => ({ addFlashcard: s.addFlashcard, updateFlashcard: s.updateFlashcard }))
  );
  const [front, setFront] = useState(initialFront ?? "");
  const [back, setBack] = useState(initialBack ?? "");

  const isEdit = Boolean(editCardId);

  function handleSave() {
    if (!front.trim() || !back.trim()) return;
    if (isEdit) {
      updateFlashcard(editCardId!, { front: front.trim(), back: back.trim() });
      onClose();
    } else {
      addFlashcard(deckId, front.trim(), back.trim());
      setFront("");
      setBack("");
    }
  }

  function handleSaveAndClose() {
    if (front.trim() && back.trim()) {
      if (isEdit) {
        updateFlashcard(editCardId!, { front: front.trim(), back: back.trim() });
      } else {
        addFlashcard(deckId, front.trim(), back.trim());
      }
    }
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md surface p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-foreground">
            {isEdit ? "Edit Flashcard" : "Add Flashcard"}
          </h2>
          <button onClick={onClose} className="btn-ghost !p-1.5"><X className="w-4 h-4" /></button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs text-muted mb-1.5">Front (Question)</label>
            <textarea
              autoFocus
              value={front}
              onChange={(e) => setFront(e.target.value)}
              placeholder="What is...?"
              rows={3}
              className="input-base resize-none text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-muted mb-1.5">Back (Answer)</label>
            <textarea
              value={back}
              onChange={(e) => setBack(e.target.value)}
              placeholder="The answer is..."
              rows={3}
              className="input-base resize-none text-sm"
              onKeyDown={(e) => { if (e.key === "Enter" && e.metaKey) handleSave(); }}
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 mt-5 pt-4 border-t border-border">
          {!isEdit && (
            <button onClick={handleSave} className="btn-ghost text-sm" disabled={!front.trim() || !back.trim()}>
              Add & Continue
            </button>
          )}
          <button onClick={handleSaveAndClose} className="btn-primary text-sm">
            {isEdit
              ? "Save & Close"
              : (front.trim() && back.trim() ? "Add & Close" : "Close")}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// ─── Deck View ───────────────────────────────────────────────────────────────

function DeckView({
  deck,
  onBack,
  onReview,
}: {
  deck: FlashcardDeck;
  onBack: () => void;
  onReview: () => void;
}) {
  const { flashcards, deleteFlashcard } = useStore(
    useShallow((s) => ({
      flashcards: s.flashcards,
      deleteFlashcard: s.deleteFlashcard,
    }))
  );

  const cards = flashcards.filter((c) => c.deckId === deck.id);
  const today = todayStr();
  const dueCount = cards.filter((c) => c.nextReview <= today).length;
  const [addModal, setAddModal] = useState(false);
  const [editCard, setEditCard] = useState<Flashcard | null>(null);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="btn-ghost flex items-center gap-1.5 text-sm">
            <ArrowLeft className="w-3.5 h-3.5" />
            Decks
          </button>
          <div className="w-3 h-3 rounded-sm" style={{ background: deck.color }} />
          <h1 className="text-sm font-semibold text-foreground">{deck.name}</h1>
          <span className="text-xs text-muted">{cards.length} cards</span>
        </div>
        <div className="flex items-center gap-2">
          {dueCount > 0 && (
            <button onClick={onReview} className="btn-primary flex items-center gap-1.5 text-sm">
              <Play className="w-3.5 h-3.5" />
              Review ({dueCount})
            </button>
          )}
          <button onClick={() => setAddModal(true)} className="btn-ghost flex items-center gap-1.5 text-sm">
            <Plus className="w-3.5 h-3.5" />
            Add Card
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {cards.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Layers className="w-8 h-8 text-muted" />
            <p className="text-sm text-muted">No cards yet. Add your first one.</p>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto space-y-2">
            {cards.map((card) => (
              <div key={card.id} className="group surface p-4 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{card.front}</p>
                  <p className="text-xs text-muted mt-1 truncate">{card.back}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className={`text-xs px-2 py-0.5 rounded-md ${
                    card.nextReview <= today
                      ? "bg-red-950/30 text-red-400"
                      : "bg-surface-hover text-muted"
                  }`}>
                    {card.nextReview <= today ? "Due" : `${card.interval}d`}
                  </span>
                  <button
                    onClick={() => setEditCard(card)}
                    className="opacity-0 group-hover:opacity-100 text-muted hover:text-foreground-secondary transition-all"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => deleteFlashcard(card.id)}
                    className="opacity-0 group-hover:opacity-100 text-muted hover:text-red-400 transition-all"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {addModal && <AddCardModal deckId={deck.id} onClose={() => setAddModal(false)} />}
      {editCard && (
        <AddCardModal
          deckId={deck.id}
          editCardId={editCard.id}
          initialFront={editCard.front}
          initialBack={editCard.back}
          onClose={() => setEditCard(null)}
        />
      )}
    </div>
  );
}

// ─── Main Module ─────────────────────────────────────────────────────────────

export default function FlashcardsModule() {
  const { flashcardDecks, flashcards, addDeck, deleteDeck, renameDeck } = useStore(
    useShallow((s) => ({
      flashcardDecks: s.flashcardDecks,
      flashcards: s.flashcards,
      addDeck: s.addDeck,
      deleteDeck: s.deleteDeck,
      renameDeck: s.renameDeck,
    }))
  );

  const [activeDeckId, setActiveDeckId] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [newDeckName, setNewDeckName] = useState("");
  const [newDeckColor, setNewDeckColor] = useState(DECK_COLORS[0]);
  const [showNewDeck, setShowNewDeck] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const activeDeck = flashcardDecks.find((d) => d.id === activeDeckId);
  const deckCards = activeDeck ? flashcards.filter((c) => c.deckId === activeDeck.id) : [];
  const today = todayStr();

  if (activeDeck && reviewing) {
    return (
      <ReviewSession
        deck={activeDeck}
        cards={deckCards}
        onExit={() => setReviewing(false)}
      />
    );
  }

  if (activeDeck) {
    return (
      <DeckView
        deck={activeDeck}
        onBack={() => setActiveDeckId(null)}
        onReview={() => setReviewing(true)}
      />
    );
  }

  function handleAddDeck() {
    if (!newDeckName.trim()) return;
    addDeck(newDeckName.trim(), newDeckColor);
    setNewDeckName("");
    setShowNewDeck(false);
  }

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
        <div>
          <h1 className="text-sm font-semibold text-foreground">Flashcards</h1>
          <p className="text-xs text-muted mt-0.5">
            {flashcardDecks.length} deck{flashcardDecks.length !== 1 ? "s" : ""} ·{" "}
            {flashcards.filter((c) => c.nextReview <= today).length} due today
          </p>
        </div>
        <button onClick={() => setShowNewDeck(true)} className="btn-primary flex items-center gap-1.5 text-sm">
          <Plus className="w-3.5 h-3.5" />
          New Deck
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="max-w-2xl mx-auto">
          {/* New deck form */}
          <AnimatePresence>
            {showNewDeck && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="mb-4 overflow-hidden"
              >
                <div className="surface p-4">
                  <div className="flex items-center gap-3 mb-3">
                    <input
                      autoFocus
                      value={newDeckName}
                      onChange={(e) => setNewDeckName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleAddDeck()}
                      placeholder="Deck name..."
                      className="input-base text-sm flex-1"
                    />
                  </div>
                  <div className="flex items-center gap-2 mb-3">
                    {DECK_COLORS.map((c) => (
                      <button
                        key={c}
                        onClick={() => setNewDeckColor(c)}
                        className={`w-5 h-5 rounded-full transition-all ${
                          newDeckColor === c ? "ring-2 ring-offset-2 ring-offset-[var(--color-surface)] ring-foreground" : ""
                        }`}
                        style={{ background: c }}
                      />
                    ))}
                  </div>
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setShowNewDeck(false)} className="btn-ghost text-xs">Cancel</button>
                    <button onClick={handleAddDeck} className="btn-primary text-xs" disabled={!newDeckName.trim()}>Create</button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Deck list */}
          {flashcardDecks.length === 0 && !showNewDeck && (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <div className="w-12 h-12 rounded-2xl bg-surface-hover flex items-center justify-center">
                <Layers className="w-6 h-6 text-muted" />
              </div>
              <p className="text-sm text-muted">No decks yet. Create one to get started.</p>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {flashcardDecks.map((deck) => {
              const cards = flashcards.filter((c) => c.deckId === deck.id);
              const dueCount = cards.filter((c) => c.nextReview <= today).length;

              return (
                <motion.div
                  key={deck.id}
                  whileHover={{ scale: 1.01 }}
                  onClick={() => setActiveDeckId(deck.id)}
                  className="surface p-5 cursor-pointer transition-all hover:border-border-active group"
                  style={{ borderLeftColor: deck.color, borderLeftWidth: 4 }}
                >
                  <div className="flex items-start justify-between mb-3">
                    {editingId === deck.id ? (
                      <input
                        autoFocus
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onBlur={() => {
                          if (editName.trim()) renameDeck(deck.id, editName.trim());
                          setEditingId(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            if (editName.trim()) renameDeck(deck.id, editName.trim());
                            setEditingId(null);
                          }
                          e.stopPropagation();
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="input-base text-sm font-medium"
                      />
                    ) : (
                      <h3 className="text-sm font-semibold text-foreground">{deck.name}</h3>
                    )}
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingId(deck.id);
                          setEditName(deck.name);
                        }}
                        className="p-1 rounded text-muted hover:text-foreground-secondary"
                      >
                        <Edit3 className="w-3 h-3" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteDeck(deck.id);
                        }}
                        className="p-1 rounded text-muted hover:text-red-400"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted">
                    <span>{cards.length} cards</span>
                    {dueCount > 0 && (
                      <span className="text-red-400 font-medium">{dueCount} due</span>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
