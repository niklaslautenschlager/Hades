import { create } from "zustand";
import { persist } from "zustand/middleware";
import { playSound } from "../lib/sound";

export type GroqModelId =
  | "llama-3.3-70b-versatile"
  | "llama3-8b-8192"
  | "mixtral-8x7b-32768";

// ─── Types ──────────────────────────────────────────────────────────────────

export type Module = "calendar" | "pomodoro" | "notepad" | "tasks" | "flashcards" | "stats";

export type PomodoroMode = "work" | "break" | "longBreak";

export type Theme = "dark" | "light";

export type SoundType = "bell" | "chime" | "gong" | "digital" | "none";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: string; // ISO string
  end: string;
  color?: string;
  source: "local" | "ical";
  icalFeedId?: string;
  description?: string;
  // Recurrence
  recurrence?: RecurrenceRule;
}

export interface RecurrenceRule {
  frequency: "daily" | "weekly" | "monthly";
  interval: number;        // every N days/weeks/months
  daysOfWeek?: number[];   // 0=Sun, 1=Mon, ..., 6=Sat (for weekly)
  endType: "after" | "until" | "never";
  endAfter?: number;       // occurrences
  endUntil?: string;       // ISO date
}

export interface IcalFeed {
  id: string;
  name: string;
  url: string;
  color: string;
  enabled: boolean;
}

export type CalendarView = "month" | "week" | "day";

export interface NoteFile {
  id: string;
  name: string;
  content: string;
  tags: string[];
  parentId: string | null;
  isFolder: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  text: string;
  completed: boolean;
  createdAt: string;
}

// ─── Flashcard Types ────────────────────────────────────────────────────────

export interface Flashcard {
  id: string;
  deckId: string;
  front: string;
  back: string;
  // Spaced repetition (SM-2 inspired)
  interval: number;     // days until next review
  easeFactor: number;   // starts at 2.5
  repetitions: number;  // consecutive correct
  nextReview: string;   // ISO date
  createdAt: string;
}

export interface FlashcardDeck {
  id: string;
  name: string;
  color: string;
  createdAt: string;
}

export type ReviewRating = 0 | 1 | 2 | 3 | 4 | 5;
// 0=again, 1=hard, 2=hard, 3=good, 4=easy, 5=perfect

// ─── Focus Stats Types ─────────────────────────────────────────────────────

export interface FocusSession {
  date: string;        // ISO date (YYYY-MM-DD)
  duration: number;    // seconds focused
  sessions: number;    // pomodoro sessions completed
}

// ─── Store ───────────────────────────────────────────────────────────────────

interface AppState {
  // Global
  activeModule: Module;
  apiKey: string;
  groqModel: GroqModelId;
  theme: Theme;
  soundType: SoundType;
  soundVolume: number;
  setActiveModule: (m: Module) => void;
  setApiKey: (key: string) => void;
  setGroqModel: (model: GroqModelId) => void;
  setTheme: (t: Theme) => void;
  setSoundType: (s: SoundType) => void;
  setSoundVolume: (v: number) => void;

  // ── Pomodoro ──────────────────────────────────────────────────────────────
  pomodoroMode: PomodoroMode;
  timeLeft: number;
  isRunning: boolean;
  sessionsCompleted: number;
  workDuration: number;
  breakDuration: number;
  longBreakDuration: number;
  sessionsUntilLongBreak: number;
  goal: string;
  chatMessages: ChatMessage[];
  isChatLoading: boolean;
  _intervalId: ReturnType<typeof setInterval> | null;

  // Weekly goal
  weeklyGoalHours: number;
  setWeeklyGoalHours: (h: number) => void;

  startTimer: () => void;
  pauseTimer: () => void;
  resetTimer: () => void;
  skipSession: () => void;
  setPomodoroMode: (mode: PomodoroMode) => void;
  setGoal: (goal: string) => void;
  setPomodoroSettings: (s: {
    workDuration?: number;
    breakDuration?: number;
    longBreakDuration?: number;
    sessionsUntilLongBreak?: number;
  }) => void;
  addChatMessage: (msg: ChatMessage) => void;
  setChatLoading: (v: boolean) => void;
  clearChat: () => void;

  // ── Calendar ──────────────────────────────────────────────────────────────
  calendarEvents: CalendarEvent[];
  icalFeeds: IcalFeed[];
  calendarView: CalendarView;
  calendarDate: string; // ISO date string (current nav date)

  addCalendarEvent: (event: Omit<CalendarEvent, "id">) => void;
  updateCalendarEvent: (id: string, patch: Partial<CalendarEvent>) => void;
  deleteCalendarEvent: (id: string) => void;
  clearAllCalendarEvents: () => void;
  addIcalFeed: (feed: Omit<IcalFeed, "id">) => void;
  removeIcalFeed: (id: string) => void;
  toggleIcalFeed: (id: string) => void;
  setCalendarView: (v: CalendarView) => void;
  setCalendarDate: (d: string) => void;
  syncIcalEvents: (feedId: string, events: CalendarEvent[]) => void;

  // ── Notes ─────────────────────────────────────────────────────────────────
  notes: NoteFile[];
  activeNoteId: string | null;
  isVimMode: boolean;
  showNotepadPdf: boolean;
  notePdfUrl: string | null;
  notePdfFileName: string;
  setNotePdf: (url: string | null, fileName: string) => void;

  addNote: (parentId?: string | null) => string;
  addFolder: (parentId?: string | null) => void;
  updateNote: (id: string, patch: Partial<NoteFile>) => void;
  deleteNote: (id: string) => void;
  moveNote: (id: string, newParentId: string | null) => void;
  setActiveNote: (id: string | null) => void;
  toggleVimMode: () => void;
  toggleNotepadPdf: () => void;
  importNotes: (files: { name: string; content: string; parentKey: string | null; selfKey: string | null; isFolder: boolean }[]) => void;

  // ── Tasks ─────────────────────────────────────────────────────────────────
  tasks: Task[];

  addTask: (text: string) => void;
  toggleTask: (id: string) => void;
  deleteTask: (id: string) => void;
  editTask: (id: string, text: string) => void;
  reorderTasks: (from: number, to: number) => void;
  clearCompletedTasks: () => void;

  // ── Flashcards ────────────────────────────────────────────────────────────
  flashcardDecks: FlashcardDeck[];
  flashcards: Flashcard[];

  addDeck: (name: string, color?: string) => void;
  deleteDeck: (id: string) => void;
  renameDeck: (id: string, name: string) => void;
  addFlashcard: (deckId: string, front: string, back: string) => void;
  updateFlashcard: (id: string, patch: Partial<Flashcard>) => void;
  deleteFlashcard: (id: string) => void;
  reviewFlashcard: (id: string, rating: ReviewRating) => void;

  // ── Focus Stats ───────────────────────────────────────────────────────────
  focusSessions: FocusSession[];
  recordFocusTime: (seconds: number) => void;
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function todayStr(): string {
  return new Date().toISOString().split("T")[0];
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      // ── Global ──────────────────────────────────────────────────────────
      activeModule: "pomodoro",
      apiKey: "",
      groqModel: "llama-3.3-70b-versatile" as GroqModelId,
      theme: "dark" as Theme,
      soundType: "chime" as SoundType,
      soundVolume: 0.45,
      setActiveModule: (activeModule) => set({ activeModule }),
      setApiKey: (apiKey) => set({ apiKey }),
      setGroqModel: (groqModel) => set({ groqModel }),
      setTheme: (theme) => set({ theme }),
      setSoundType: (soundType) => set({ soundType }),
      setSoundVolume: (soundVolume) => set({ soundVolume }),

      // ── Pomodoro ────────────────────────────────────────────────────────
      pomodoroMode: "work",
      timeLeft: 25 * 60,
      isRunning: false,
      sessionsCompleted: 0,
      workDuration: 25,
      breakDuration: 5,
      longBreakDuration: 15,
      sessionsUntilLongBreak: 4,
      goal: "",
      chatMessages: [],
      isChatLoading: false,
      _intervalId: null,

      weeklyGoalHours: 20,
      setWeeklyGoalHours: (weeklyGoalHours) => set({ weeklyGoalHours }),

      startTimer: () => {
        const state = get();
        if (state.isRunning) return;

        const id = setInterval(() => {
          const s = get();
          if (!s.isRunning) {
            clearInterval(id);
            return;
          }

          if (s.timeLeft <= 1) {
            clearInterval(id);

            // Record focus time
            if (s.pomodoroMode === "work") {
              s.recordFocusTime(s.workDuration * 60);
            }

            playSound(s.soundType, s.soundVolume);

            const sessions =
              s.pomodoroMode === "work"
                ? s.sessionsCompleted + 1
                : s.sessionsCompleted;

            let nextMode: PomodoroMode = "break";
            if (s.pomodoroMode === "work") {
              nextMode =
                sessions % s.sessionsUntilLongBreak === 0
                  ? "longBreak"
                  : "break";
            } else {
              nextMode = "work";
            }

            set({
              isRunning: false,
              _intervalId: null,
              pomodoroMode: nextMode,
              sessionsCompleted: sessions,
              timeLeft:
                nextMode === "work"
                  ? s.workDuration * 60
                  : nextMode === "break"
                  ? s.breakDuration * 60
                  : s.longBreakDuration * 60,
            });
          } else {
            set({ timeLeft: s.timeLeft - 1 });
          }
        }, 1000);

        set({ isRunning: true, _intervalId: id });
      },

      pauseTimer: () => {
        const { _intervalId } = get();
        if (_intervalId) clearInterval(_intervalId);
        set({ isRunning: false, _intervalId: null });
      },

      resetTimer: () => {
        const { _intervalId, pomodoroMode, workDuration, breakDuration, longBreakDuration } = get();
        if (_intervalId) clearInterval(_intervalId);
        const total =
          pomodoroMode === "work"
            ? workDuration * 60
            : pomodoroMode === "break"
            ? breakDuration * 60
            : longBreakDuration * 60;
        set({ isRunning: false, _intervalId: null, timeLeft: total });
      },

      skipSession: () => {
        const s = get();
        if (s._intervalId) clearInterval(s._intervalId);

        const sessions =
          s.pomodoroMode === "work" ? s.sessionsCompleted + 1 : s.sessionsCompleted;

        let nextMode: PomodoroMode = "break";
        if (s.pomodoroMode === "work") {
          nextMode =
            sessions % s.sessionsUntilLongBreak === 0 ? "longBreak" : "break";
        } else {
          nextMode = "work";
        }

        set({
          isRunning: false,
          _intervalId: null,
          pomodoroMode: nextMode,
          sessionsCompleted: sessions,
          timeLeft:
            nextMode === "work"
              ? s.workDuration * 60
              : nextMode === "break"
              ? s.breakDuration * 60
              : s.longBreakDuration * 60,
        });
      },

      setPomodoroMode: (mode) => {
        const { _intervalId, workDuration, breakDuration, longBreakDuration } = get();
        if (_intervalId) clearInterval(_intervalId);
        set({
          pomodoroMode: mode,
          isRunning: false,
          _intervalId: null,
          timeLeft:
            mode === "work"
              ? workDuration * 60
              : mode === "break"
              ? breakDuration * 60
              : longBreakDuration * 60,
        });
      },

      setGoal: (goal) => set({ goal }),

      setPomodoroSettings: ({ workDuration, breakDuration, longBreakDuration, sessionsUntilLongBreak }) => {
        const s = get();
        if (s._intervalId) clearInterval(s._intervalId);
        const wd = workDuration ?? s.workDuration;
        const bd = breakDuration ?? s.breakDuration;
        const lbd = longBreakDuration ?? s.longBreakDuration;
        set({
          workDuration: wd,
          breakDuration: bd,
          longBreakDuration: lbd,
          sessionsUntilLongBreak: sessionsUntilLongBreak ?? s.sessionsUntilLongBreak,
          isRunning: false,
          _intervalId: null,
          timeLeft:
            s.pomodoroMode === "work"
              ? wd * 60
              : s.pomodoroMode === "break"
              ? bd * 60
              : lbd * 60,
        });
      },

      addChatMessage: (msg) =>
        set((s) => ({ chatMessages: [...s.chatMessages, msg] })),
      setChatLoading: (isChatLoading) => set({ isChatLoading }),
      clearChat: () => set({ chatMessages: [] }),

      // ── Calendar ────────────────────────────────────────────────────────
      calendarEvents: [],
      icalFeeds: [],
      calendarView: "month",
      calendarDate: new Date().toISOString(),

      addCalendarEvent: (event) =>
        set((s) => ({
          calendarEvents: [...s.calendarEvents, { ...event, id: uid() }],
        })),
      updateCalendarEvent: (id, patch) =>
        set((s) => ({
          calendarEvents: s.calendarEvents.map((e) =>
            e.id === id ? { ...e, ...patch } : e
          ),
        })),
      deleteCalendarEvent: (id) =>
        set((s) => ({
          calendarEvents: s.calendarEvents.filter((e) => e.id !== id),
        })),
      clearAllCalendarEvents: () => set({ calendarEvents: [] }),
      addIcalFeed: (feed) =>
        set((s) => ({
          icalFeeds: [...s.icalFeeds, { ...feed, id: uid() }],
        })),
      removeIcalFeed: (id) =>
        set((s) => ({
          icalFeeds: s.icalFeeds.filter((f) => f.id !== id),
          calendarEvents: s.calendarEvents.filter((e) => e.icalFeedId !== id),
        })),
      toggleIcalFeed: (id) =>
        set((s) => ({
          icalFeeds: s.icalFeeds.map((f) =>
            f.id === id ? { ...f, enabled: !f.enabled } : f
          ),
        })),
      setCalendarView: (calendarView) => set({ calendarView }),
      setCalendarDate: (calendarDate) => set({ calendarDate }),
      syncIcalEvents: (feedId, events) =>
        set((s) => ({
          calendarEvents: [
            ...s.calendarEvents.filter((e) => e.icalFeedId !== feedId),
            ...events,
          ],
        })),

      // ── Notes ───────────────────────────────────────────────────────────
      notePdfUrl: null,
      notePdfFileName: "",
      setNotePdf: (url, fileName) => set({ notePdfUrl: url, notePdfFileName: fileName }),

      notes: [
        {
          id: "welcome",
          name: "Welcome to Hades",
          content:
            "# Welcome to Hades\n\nThis is your note editor. It supports **Markdown** and _Vim_ bindings.\n\n## Features\n\n- Toggle between Normal and **Vim** mode in the toolbar\n- Organize notes in folders\n- Tag notes for quick search\n- Link notes with [[Note Name]] syntax\n\n```js\nconsole.log('Hello, Hades');\n```\n",
          tags: ["welcome"],
          parentId: null,
          isFolder: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      activeNoteId: "welcome",
      isVimMode: false,
      showNotepadPdf: false,

      addNote: (parentId = null) => {
        const id = uid();
        set((s) => ({
          notes: [
            ...s.notes,
            {
              id,
              name: "Untitled",
              content: "",
              tags: [],
              parentId: parentId ?? null,
              isFolder: false,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
          activeNoteId: id,
        }));
        return id;
      },
      addFolder: (parentId = null) => {
        const id = uid();
        set((s) => ({
          notes: [
            ...s.notes,
            {
              id,
              name: "New Folder",
              content: "",
              tags: [],
              parentId: parentId ?? null,
              isFolder: true,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
        }));
      },
      updateNote: (id, patch) =>
        set((s) => ({
          notes: s.notes.map((n) =>
            n.id === id
              ? { ...n, ...patch, updatedAt: new Date().toISOString() }
              : n
          ),
        })),
      deleteNote: (id) =>
        set((s) => {
          const toDelete = new Set<string>();
          const collectIds = (nodeId: string) => {
            toDelete.add(nodeId);
            s.notes
              .filter((n) => n.parentId === nodeId)
              .forEach((n) => collectIds(n.id));
          };
          collectIds(id);
          return {
            notes: s.notes.filter((n) => !toDelete.has(n.id)),
            activeNoteId:
              s.activeNoteId && toDelete.has(s.activeNoteId)
                ? null
                : s.activeNoteId,
          };
        }),
      moveNote: (id, newParentId) =>
        set((s) => ({
          notes: s.notes.map((n) =>
            n.id === id ? { ...n, parentId: newParentId } : n
          ),
        })),
      setActiveNote: (activeNoteId) => set({ activeNoteId }),
      toggleVimMode: () => set((s) => ({ isVimMode: !s.isVimMode })),
      toggleNotepadPdf: () => set((s) => ({ showNotepadPdf: !s.showNotepadPdf })),

      importNotes: (files) => {
        set((s) => {
          // Map from selfKey → generated id (for folder parent resolution)
          const keyToId = new Map<string, string>();
          const newNotes: NoteFile[] = [];

          // First pass: create IDs for all folders so children can reference them
          for (const f of files) {
            if (f.isFolder && f.selfKey) {
              keyToId.set(f.selfKey, uid());
            }
          }

          // Second pass: create folder NoteFile entries
          for (const f of files) {
            if (f.isFolder && f.selfKey) {
              const id = keyToId.get(f.selfKey)!;
              const parentId = f.parentKey ? keyToId.get(f.parentKey) ?? null : null;
              newNotes.push({
                id,
                name: f.name,
                content: "",
                tags: [],
                parentId,
                isFolder: true,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              });
            }
          }

          // Third pass: create note entries
          for (const f of files) {
            if (!f.isFolder) {
              const id = uid();
              const parentId = f.parentKey ? keyToId.get(f.parentKey) ?? null : null;
              newNotes.push({
                id,
                name: f.name,
                content: f.content,
                tags: [],
                parentId,
                isFolder: false,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              });
            }
          }

          return { notes: [...s.notes, ...newNotes] };
        });
      },

      // ── Tasks ───────────────────────────────────────────────────────────
      tasks: [],

      addTask: (text) =>
        set((s) => ({
          tasks: [
            ...s.tasks,
            {
              id: uid(),
              text,
              completed: false,
              createdAt: new Date().toISOString(),
            },
          ],
        })),
      toggleTask: (id) => {
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === id ? { ...t, completed: !t.completed } : t
          ),
        }));
        const task = get().tasks.find((t) => t.id === id);
        if (task?.completed) playSound(get().soundType, get().soundVolume * 0.7);
      },
      deleteTask: (id) =>
        set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) })),
      editTask: (id, text) =>
        set((s) => ({
          tasks: s.tasks.map((t) => (t.id === id ? { ...t, text } : t)),
        })),
      reorderTasks: (from, to) =>
        set((s) => {
          const tasks = [...s.tasks];
          const [item] = tasks.splice(from, 1);
          tasks.splice(to, 0, item);
          return { tasks };
        }),
      clearCompletedTasks: () =>
        set((s) => ({ tasks: s.tasks.filter((t) => !t.completed) })),

      // ── Flashcards ────────────────────────────────────────────────────────
      flashcardDecks: [],
      flashcards: [],

      addDeck: (name, color) => {
        const id = uid();
        set((s) => ({
          flashcardDecks: [
            ...s.flashcardDecks,
            {
              id,
              name,
              color: color ?? "#3f3f46",
              createdAt: new Date().toISOString(),
            },
          ],
        }));
      },
      deleteDeck: (id) =>
        set((s) => ({
          flashcardDecks: s.flashcardDecks.filter((d) => d.id !== id),
          flashcards: s.flashcards.filter((c) => c.deckId !== id),
        })),
      renameDeck: (id, name) =>
        set((s) => ({
          flashcardDecks: s.flashcardDecks.map((d) =>
            d.id === id ? { ...d, name } : d
          ),
        })),
      addFlashcard: (deckId, front, back) => {
        const id = uid();
        set((s) => ({
          flashcards: [
            ...s.flashcards,
            {
              id,
              deckId,
              front,
              back,
              interval: 0,
              easeFactor: 2.5,
              repetitions: 0,
              nextReview: todayStr(),
              createdAt: new Date().toISOString(),
            },
          ],
        }));
      },
      updateFlashcard: (id, patch) =>
        set((s) => ({
          flashcards: s.flashcards.map((c) =>
            c.id === id ? { ...c, ...patch } : c
          ),
        })),
      deleteFlashcard: (id) =>
        set((s) => ({ flashcards: s.flashcards.filter((c) => c.id !== id) })),

      reviewFlashcard: (id, rating) => {
        set((s) => {
          const card = s.flashcards.find((c) => c.id === id);
          if (!card) return s;

          let { interval, easeFactor, repetitions } = card;

          if (rating < 3) {
            // Failed — reset
            repetitions = 0;
            interval = 0;
          } else {
            repetitions += 1;
            if (repetitions === 1) {
              interval = 1;
            } else if (repetitions === 2) {
              interval = 6;
            } else {
              interval = Math.round(interval * easeFactor);
            }
          }

          // Adjust ease factor (SM-2)
          easeFactor = Math.max(
            1.3,
            easeFactor + (0.1 - (5 - rating) * (0.08 + (5 - rating) * 0.02))
          );

          const nextDate = new Date();
          nextDate.setDate(nextDate.getDate() + Math.max(interval, 1));

          return {
            flashcards: s.flashcards.map((c) =>
              c.id === id
                ? {
                    ...c,
                    interval,
                    easeFactor,
                    repetitions,
                    nextReview: nextDate.toISOString().split("T")[0],
                  }
                : c
            ),
          };
        });
      },

      // ── Focus Stats ───────────────────────────────────────────────────────
      focusSessions: [],

      recordFocusTime: (seconds) => {
        const today = todayStr();
        set((s) => {
          const existing = s.focusSessions.find((f) => f.date === today);
          if (existing) {
            return {
              focusSessions: s.focusSessions.map((f) =>
                f.date === today
                  ? { ...f, duration: f.duration + seconds, sessions: f.sessions + 1 }
                  : f
              ),
            };
          }
          return {
            focusSessions: [
              ...s.focusSessions,
              { date: today, duration: seconds, sessions: 1 },
            ],
          };
        });
      },
    }),
    {
      name: "hades-store",
      // Don't persist the running interval or loading state
      partialize: (s) => ({
        ...s,
        isRunning: false,
        _intervalId: null,
        isChatLoading: false,
        notePdfUrl: null,
        notePdfFileName: "",
      }),
    }
  )
);
