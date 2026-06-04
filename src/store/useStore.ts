import { create } from "zustand";
import { persist } from "zustand/middleware";
import { playSound } from "../lib/sound";

export type GroqModelId =
  | "llama-3.3-70b-versatile"
  | "llama3-8b-8192"
  | "mixtral-8x7b-32768";

// ─── AI Vendor Types ────────────────────────────────────────────────────────

export type AIVendor = "groq" | "openai" | "anthropic" | "deepseek" | "ollama";

export interface AIVendorConfig {
  apiKey: string;
  model: string;
  baseUrl?: string; // override for Ollama / OpenAI-compatible self-hosted
}

// ─── Types ──────────────────────────────────────────────────────────────────

export type Module = "calendar" | "pomodoro" | "notepad" | "tasks" | "flashcards" | "stats";

export type PomodoroMode = "work" | "break" | "longBreak";

export type Theme =
  | "dark"
  | "light"
  | "catppuccin"
  | "gruvbox"
  | "nord"
  | "tokyonight"
  | "dracula"
  | "onedark"
  | "monokai"
  | "rosepine"
  | "solarized"
  | "solarized-light"
  | "everforest"
  | "rosepine-dawn"
  | "ember"
  | "abyss"
  | "synthwave"
  | "matrix";

export type SoundType = "bell" | "chime" | "gong" | "digital" | "none";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  unrestricted: boolean;
  createdAt: string;
  updatedAt: string;
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
  // Deadline marker — synced to to-do list
  isDeadline?: boolean;
  // Linked task ID (for syncing)
  linkedTaskId?: string;
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
  // Deadline support (from calendar deadline events)
  dueDate?: string; // ISO string
  linkedEventId?: string;
  // Pomodoro linking — estimated focus sessions and how many have elapsed
  // while this task was the active focus target.
  estimatedSessions?: number;
  completedSessions?: number;
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

// ─── PDF Library Types ───────────────────────────────────────────────────────

export interface LibraryDoc {
  id: string;
  title: string;          // from PDF metadata, falls back to filename
  author?: string;
  pageCount?: number;
  fileName: string;       // original display filename (e.g. "thesis.pdf")
  sizeBytes?: number;
  addedAt: string;        // ISO
  // The file itself is copied to <appData>/library/<id>.pdf on import.
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

  // AI vendor system
  aiVendor: AIVendor;
  aiVendorConfigs: Record<AIVendor, AIVendorConfig>;
  setAIVendor: (v: AIVendor) => void;
  setAIVendorConfig: (v: AIVendor, patch: Partial<AIVendorConfig>) => void;

  // AI privacy / opt-in — when false, all AI features are hidden/disabled
  aiEnabled: boolean;
  setAiEnabled: (v: boolean) => void;
  // Feed the user's notes + library into the assistant as context
  aiUseStudyContext: boolean;
  setAiUseStudyContext: (v: boolean) => void;
  // Let the assistant act on the app (create tasks, flashcards, events, …)
  agentMode: boolean;
  setAgentMode: (v: boolean) => void;

  setActiveModule: (m: Module) => void;
  setApiKey: (key: string) => void;
  setGroqModel: (model: GroqModelId) => void;
  setTheme: (t: Theme) => void;
  setSoundType: (s: SoundType) => void;
  setSoundVolume: (v: number) => void;

  // Misc settings
  autoSyncDeadlines: boolean;
  setAutoSyncDeadlines: (v: boolean) => void;
  showWeekNumbers: boolean;
  setShowWeekNumbers: (v: boolean) => void;
  weekStartsOn: 0 | 1; // Sunday or Monday
  setWeekStartsOn: (v: 0 | 1) => void;

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
  // AI conversation memory — multiple named, persisted threads. `chatMessages`
  // is a live mirror of the active conversation's messages so the chat UI can
  // read it directly; conversation actions keep both in sync.
  conversations: Conversation[];
  activeConversationId: string | null;
  chatMessages: ChatMessage[];
  isChatLoading: boolean;
  _intervalId: ReturnType<typeof setInterval> | null;
  // Absolute wall-clock deadline (epoch ms) for the running timer. Source of
  // truth while running — makes the countdown immune to re-renders, store
  // writes (e.g. a cloud sync) and app restarts.
  timerEndsAt: number | null;

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
  // Conversation memory actions
  newConversation: () => void;
  switchConversation: (id: string) => void;
  deleteConversation: (id: string) => void;
  renameConversation: (id: string, title: string) => void;
  setConversationUnrestricted: (v: boolean) => void;
  wipeAllAIData: () => void;

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
  openNoteIds: string[]; // notes open as tabs, in tab order
  closeNoteTab: (id: string) => void;
  isVimMode: boolean;
  showNotepadPdf: boolean;
  expandedFolderIds: string[]; // persisted folder tree open/closed state
  setFolderExpanded: (id: string, open: boolean) => void;
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

  addTask: (text: string, opts?: { dueDate?: string; linkedEventId?: string }) => string;
  toggleTask: (id: string) => void;
  deleteTask: (id: string) => void;
  editTask: (id: string, text: string) => void;
  reorderTasks: (from: number, to: number) => void;
  clearCompletedTasks: () => void;
  clearAllTasks: () => void; // Clears all non-deadline-linked tasks
  syncDeadlineTasks: () => void; // Pulls deadline events into task list

  // ── Pomodoro ↔ Tasks linking ───────────────────────────────────────────────
  activeTaskId: string | null;            // task currently linked to the timer
  taskFinishPrompt: string | null;        // task id awaiting "is it finished?" prompt
  setActivePomodoroTask: (id: string | null) => void;
  setTaskEstimate: (id: string, sessions: number) => void;
  setTaskFinishPrompt: (id: string | null) => void;
  onWorkSessionComplete: (wasWork: boolean) => void; // called by the timer on each finished session

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

  // ── PDF Library ─────────────────────────────────────────────────────────────
  libraryDocs: LibraryDoc[];
  addLibraryDoc: (doc: LibraryDoc) => void;
  removeLibraryDoc: (id: string) => void;
  updateLibraryDoc: (id: string, patch: Partial<LibraryDoc>) => void;

  // ── Cloud Sync (persisted) ─────────────────────────────────────────────────
  syncFolder: string | null;
  syncEnabled: boolean;
  lastSyncAt: string | null;
  setSyncFolder: (path: string | null) => void;
  setSyncEnabled: (v: boolean) => void;
  setLastSyncAt: (ts: string | null) => void;

  // ── Sync runtime (ephemeral, not persisted) ────────────────────────────────
  isSyncing: boolean;
  hasPendingChanges: boolean;
  quitPending: boolean;
  forceQuit: boolean;
  syncError: string | null;
  setIsSyncing: (v: boolean) => void;
  setHasPendingChanges: (v: boolean) => void;
  setQuitPending: (v: boolean) => void;
  setForceQuit: (v: boolean) => void;
  setSyncError: (msg: string | null) => void;
  applyMergedNotes: (notes: NoteFile[]) => void;

  // ── Updater (ephemeral, not persisted) ────────────────────────────────────
  updateAvailable: boolean;
  updateVersion: string | null;
  updateChangelog: string | null;
  updateAssetUrl: string | null;
  isUpdating: boolean;
  updateInstalled: boolean;
  updateError: string | null;
  setUpdateInfo: (version: string, changelog: string, assetUrl: string) => void;
  setIsUpdating: (v: boolean) => void;
  setUpdateInstalled: (v: boolean) => void;
  setUpdateError: (msg: string | null) => void;
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

      // ── AI vendors ──────────────────────────────────────────────────────
      aiVendor: "groq",
      aiVendorConfigs: {
        groq:      { apiKey: "", model: "llama-3.3-70b-versatile" },
        openai:    { apiKey: "", model: "gpt-4o-mini" },
        anthropic: { apiKey: "", model: "claude-haiku-4-5-20251001" },
        deepseek:  { apiKey: "", model: "deepseek-chat" },
        ollama:    { apiKey: "", model: "llama3.2", baseUrl: "http://localhost:11434" },
      },
      setAIVendor: (aiVendor) => set({ aiVendor }),
      setAIVendorConfig: (vendor, patch) =>
        set((s) => ({
          aiVendorConfigs: {
            ...s.aiVendorConfigs,
            [vendor]: { ...s.aiVendorConfigs[vendor], ...patch },
          },
        })),

      // Privacy-first: AI is opt-in. The v5 migration flips this on for existing
      // users who already configured a key or have chat history.
      aiEnabled: false,
      setAiEnabled: (aiEnabled) => set({ aiEnabled }),
      aiUseStudyContext: false,
      setAiUseStudyContext: (aiUseStudyContext) => set({ aiUseStudyContext }),
      agentMode: false,
      setAgentMode: (agentMode) => set({ agentMode }),

      setActiveModule: (activeModule) => set({ activeModule }),
      setApiKey: (apiKey) =>
        set((s) => ({
          apiKey,
          aiVendorConfigs: {
            ...s.aiVendorConfigs,
            groq: { ...s.aiVendorConfigs.groq, apiKey },
          },
        })),
      setGroqModel: (groqModel) =>
        set((s) => ({
          groqModel,
          aiVendorConfigs: {
            ...s.aiVendorConfigs,
            groq: { ...s.aiVendorConfigs.groq, model: groqModel },
          },
        })),
      setTheme: (theme) => set({ theme }),
      setSoundType: (soundType) => set({ soundType }),
      setSoundVolume: (soundVolume) => set({ soundVolume }),

      // ── Misc settings ───────────────────────────────────────────────────
      autoSyncDeadlines: true,
      setAutoSyncDeadlines: (autoSyncDeadlines) => set({ autoSyncDeadlines }),
      showWeekNumbers: false,
      setShowWeekNumbers: (showWeekNumbers) => set({ showWeekNumbers }),
      weekStartsOn: 1,
      setWeekStartsOn: (weekStartsOn) => set({ weekStartsOn }),

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
      conversations: [],
      activeConversationId: null,
      chatMessages: [],
      isChatLoading: false,
      _intervalId: null,
      timerEndsAt: null,

      weeklyGoalHours: 20,
      setWeeklyGoalHours: (weeklyGoalHours) => set({ weeklyGoalHours }),

      startTimer: () => {
        const state = get();
        if (state.isRunning) return;

        const endsAt = Date.now() + state.timeLeft * 1000;

        const id = setInterval(() => {
          const s = get();
          if (!s.isRunning) {
            clearInterval(id);
            return;
          }

          // Derive remaining time from the absolute deadline rather than
          // blind decrement, so a stray set() (cloud sync, re-render) can never
          // shorten or reset the timer — the next tick self-corrects.
          const deadline = s.timerEndsAt ?? Date.now();
          const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));

          if (remaining <= 0) {
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
              timerEndsAt: null,
              pomodoroMode: nextMode,
              sessionsCompleted: sessions,
              timeLeft:
                nextMode === "work"
                  ? s.workDuration * 60
                  : nextMode === "break"
                  ? s.breakDuration * 60
                  : s.longBreakDuration * 60,
            });

            get().onWorkSessionComplete(s.pomodoroMode === "work");
          } else {
            set({ timeLeft: remaining });
          }
        }, 1000);

        set({ isRunning: true, _intervalId: id, timerEndsAt: endsAt });
      },

      pauseTimer: () => {
        const { _intervalId, timerEndsAt, timeLeft } = get();
        if (_intervalId) clearInterval(_intervalId);
        const remaining = timerEndsAt
          ? Math.max(0, Math.ceil((timerEndsAt - Date.now()) / 1000))
          : timeLeft;
        set({ isRunning: false, _intervalId: null, timerEndsAt: null, timeLeft: remaining });
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
        set({ isRunning: false, _intervalId: null, timerEndsAt: null, timeLeft: total });
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
          timerEndsAt: null,
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
          timerEndsAt: null,
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
          timerEndsAt: null,
          timeLeft:
            s.pomodoroMode === "work"
              ? wd * 60
              : s.pomodoroMode === "break"
              ? bd * 60
              : lbd * 60,
        });
      },

      addChatMessage: (msg) =>
        set((s) => {
          const now = new Date().toISOString();
          // Ensure there is an active conversation to append to.
          let conversations = s.conversations;
          let activeId = s.activeConversationId;
          if (!activeId || !conversations.some((c) => c.id === activeId)) {
            const fresh: Conversation = {
              id: uid(),
              title: "New chat",
              messages: [],
              unrestricted: false,
              createdAt: now,
              updatedAt: now,
            };
            conversations = [fresh, ...conversations];
            activeId = fresh.id;
          }
          const messages = [
            ...(conversations.find((c) => c.id === activeId)?.messages ?? []),
            msg,
          ];
          conversations = conversations.map((c) =>
            c.id === activeId
              ? {
                  ...c,
                  messages,
                  updatedAt: now,
                  // Title from the first user message of an untitled thread.
                  title:
                    c.title === "New chat" && msg.role === "user"
                      ? msg.content.replace(/\s+/g, " ").trim().slice(0, 40) || "New chat"
                      : c.title,
                }
              : c
          );
          return { conversations, activeConversationId: activeId, chatMessages: messages };
        }),
      setChatLoading: (isChatLoading) => set({ isChatLoading }),
      clearChat: () =>
        set((s) => {
          const activeId = s.activeConversationId;
          if (!activeId) return { chatMessages: [] };
          return {
            chatMessages: [],
            conversations: s.conversations.map((c) =>
              c.id === activeId
                ? { ...c, messages: [], title: "New chat", updatedAt: new Date().toISOString() }
                : c
            ),
          };
        }),

      newConversation: () =>
        set((s) => {
          const now = new Date().toISOString();
          const fresh: Conversation = {
            id: uid(),
            title: "New chat",
            messages: [],
            unrestricted: false,
            createdAt: now,
            updatedAt: now,
          };
          return {
            conversations: [fresh, ...s.conversations],
            activeConversationId: fresh.id,
            chatMessages: [],
          };
        }),
      switchConversation: (id) =>
        set((s) => {
          const conv = s.conversations.find((c) => c.id === id);
          if (!conv) return {};
          return { activeConversationId: id, chatMessages: conv.messages };
        }),
      deleteConversation: (id) =>
        set((s) => {
          const remaining = s.conversations.filter((c) => c.id !== id);
          if (s.activeConversationId !== id) {
            return { conversations: remaining };
          }
          const next = remaining[0] ?? null;
          return {
            conversations: remaining,
            activeConversationId: next?.id ?? null,
            chatMessages: next?.messages ?? [],
          };
        }),
      renameConversation: (id, title) =>
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === id ? { ...c, title: title.trim() || c.title } : c
          ),
        })),
      setConversationUnrestricted: (v) =>
        set((s) => {
          const activeId = s.activeConversationId;
          if (!activeId) return {};
          return {
            conversations: s.conversations.map((c) =>
              c.id === activeId ? { ...c, unrestricted: v } : c
            ),
          };
        }),
      wipeAllAIData: () =>
        set({ conversations: [], activeConversationId: null, chatMessages: [], isChatLoading: false }),

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
      openNoteIds: ["welcome"],
      isVimMode: false,
      showNotepadPdf: false,
      expandedFolderIds: [],
      setFolderExpanded: (id, open) =>
        set((s) => ({
          expandedFolderIds: open
            ? Array.from(new Set([...s.expandedFolderIds, id]))
            : s.expandedFolderIds.filter((f) => f !== id),
        })),

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
          openNoteIds: [...s.openNoteIds, id],
          hasPendingChanges: s.syncEnabled ? true : s.hasPendingChanges,
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
          hasPendingChanges: s.syncEnabled ? true : s.hasPendingChanges,
        }));
      },
      updateNote: (id, patch) =>
        set((s) => ({
          notes: s.notes.map((n) =>
            n.id === id
              ? { ...n, ...patch, updatedAt: new Date().toISOString() }
              : n
          ),
          hasPendingChanges: s.syncEnabled ? true : s.hasPendingChanges,
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

          // Prune closed/deleted notes from the open tabs.
          const openNoteIds = s.openNoteIds.filter((t) => !toDelete.has(t));
          // If the active note was deleted, fall back to a neighbouring tab.
          let activeNoteId = s.activeNoteId;
          if (activeNoteId && toDelete.has(activeNoteId)) {
            const prevIdx = s.openNoteIds.indexOf(activeNoteId);
            activeNoteId =
              openNoteIds[prevIdx] ?? openNoteIds[prevIdx - 1] ?? openNoteIds[openNoteIds.length - 1] ?? null;
          }

          return {
            notes: s.notes.filter((n) => !toDelete.has(n.id)),
            openNoteIds,
            activeNoteId,
          };
        }),
      moveNote: (id, newParentId) =>
        set((s) => ({
          notes: s.notes.map((n) =>
            n.id === id ? { ...n, parentId: newParentId, updatedAt: new Date().toISOString() } : n
          ),
          hasPendingChanges: s.syncEnabled ? true : s.hasPendingChanges,
        })),
      setActiveNote: (id) =>
        set((s) => {
          if (id == null) return { activeNoteId: null };
          // Open a tab for real notes (folders are never tabs).
          const isNote = s.notes.some((n) => n.id === id && !n.isFolder);
          return {
            activeNoteId: id,
            openNoteIds:
              isNote && !s.openNoteIds.includes(id)
                ? [...s.openNoteIds, id]
                : s.openNoteIds,
          };
        }),
      closeNoteTab: (id) =>
        set((s) => {
          const openNoteIds = s.openNoteIds.filter((t) => t !== id);
          let activeNoteId = s.activeNoteId;
          if (activeNoteId === id) {
            const prevIdx = s.openNoteIds.indexOf(id);
            activeNoteId =
              openNoteIds[prevIdx] ?? openNoteIds[prevIdx - 1] ?? openNoteIds[openNoteIds.length - 1] ?? null;
          }
          // NOTE: deliberately does not touch expandedFolderIds — closing a tab
          // must never collapse folders the user has opened in the tree.
          return { openNoteIds, activeNoteId };
        }),
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

      addTask: (text, opts) => {
        const id = uid();
        set((s) => ({
          tasks: [
            ...s.tasks,
            {
              id,
              text,
              completed: false,
              createdAt: new Date().toISOString(),
              dueDate: opts?.dueDate,
              linkedEventId: opts?.linkedEventId,
            },
          ],
        }));
        return id;
      },
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
        set((s) => ({
          tasks: s.tasks.filter((t) => t.id !== id),
          activeTaskId: s.activeTaskId === id ? null : s.activeTaskId,
          taskFinishPrompt: s.taskFinishPrompt === id ? null : s.taskFinishPrompt,
        })),
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
      clearAllTasks: () =>
        set((s) => ({
          // Keep deadline-linked tasks — those are owned by the calendar.
          tasks: s.tasks.filter((t) => !!t.linkedEventId),
          activeTaskId: null,
          taskFinishPrompt: null,
        })),

      // ── Pomodoro ↔ Tasks linking ──────────────────────────────────────────
      activeTaskId: null,
      taskFinishPrompt: null,
      setActivePomodoroTask: (activeTaskId) => set({ activeTaskId }),
      setTaskEstimate: (id, sessions) =>
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === id
              ? { ...t, estimatedSessions: sessions > 0 ? sessions : undefined }
              : t
          ),
        })),
      setTaskFinishPrompt: (taskFinishPrompt) => set({ taskFinishPrompt }),
      onWorkSessionComplete: (wasWork) => {
        if (!wasWork) return;
        const s = get();
        const id = s.activeTaskId;
        if (!id) return;
        const task = s.tasks.find((t) => t.id === id);
        if (!task || task.completed) return;

        const completed = (task.completedSessions ?? 0) + 1;
        set((st) => ({
          tasks: st.tasks.map((t) =>
            t.id === id ? { ...t, completedSessions: completed } : t
          ),
        }));

        // Prompt exactly once, when the estimate is first reached. If the user
        // keeps going past it, they won't be nagged again.
        if (task.estimatedSessions && completed === task.estimatedSessions) {
          set({ taskFinishPrompt: id });
        }
      },

      syncDeadlineTasks: () => {
        const s = get();
        if (!s.autoSyncDeadlines) return;

        // Collect existing deadline-linked tasks
        const linkedTaskByEvent = new Map<string, Task>();
        for (const t of s.tasks) {
          if (t.linkedEventId) linkedTaskByEvent.set(t.linkedEventId, t);
        }

        const updatedTasks: Task[] = [...s.tasks];
        const deadlineEventIds = new Set<string>();

        for (const e of s.calendarEvents) {
          if (!e.isDeadline) continue;
          deadlineEventIds.add(e.id);
          const existing = linkedTaskByEvent.get(e.id);
          if (existing) {
            // Update title/dueDate if changed
            if (existing.text !== e.title || existing.dueDate !== e.start) {
              const idx = updatedTasks.findIndex((t) => t.id === existing.id);
              if (idx >= 0) {
                updatedTasks[idx] = { ...existing, text: e.title, dueDate: e.start };
              }
            }
          } else {
            // Create new task
            updatedTasks.push({
              id: uid(),
              text: e.title,
              completed: false,
              createdAt: new Date().toISOString(),
              dueDate: e.start,
              linkedEventId: e.id,
            });
          }
        }

        // Remove tasks linked to events that are no longer deadlines or were deleted
        const filtered = updatedTasks.filter(
          (t) => !t.linkedEventId || deadlineEventIds.has(t.linkedEventId)
        );

        set({ tasks: filtered });
      },

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

      // ── PDF Library ────────────────────────────────────────────────────────
      libraryDocs: [],
      addLibraryDoc: (doc) =>
        set((s) => ({ libraryDocs: [doc, ...s.libraryDocs] })),
      removeLibraryDoc: (id) =>
        set((s) => ({ libraryDocs: s.libraryDocs.filter((d) => d.id !== id) })),
      updateLibraryDoc: (id, patch) =>
        set((s) => ({
          libraryDocs: s.libraryDocs.map((d) => (d.id === id ? { ...d, ...patch } : d)),
        })),

      // ── Cloud Sync ───────────────────────────────────────────────────────
      syncFolder: null,
      syncEnabled: false,
      lastSyncAt: null,
      setSyncFolder: (syncFolder) => set({ syncFolder }),
      setSyncEnabled: (syncEnabled) => set({ syncEnabled }),
      setLastSyncAt: (lastSyncAt) => set({ lastSyncAt }),

      isSyncing: false,
      hasPendingChanges: false,
      quitPending: false,
      forceQuit: false,
      syncError: null,
      setIsSyncing: (isSyncing) => set({ isSyncing }),
      setHasPendingChanges: (hasPendingChanges) => set({ hasPendingChanges }),
      setQuitPending: (quitPending) => set({ quitPending }),
      setForceQuit: (forceQuit) => set({ forceQuit }),
      setSyncError: (syncError) => set({ syncError }),
      applyMergedNotes: (notes) => set({ notes }),

      // ── Updater ──────────────────────────────────────────────────────────
      updateAvailable:  false,
      updateVersion:    null,
      updateChangelog:  null,
      updateAssetUrl:   null,
      isUpdating:       false,
      updateInstalled:  false,
      updateError:      null,
      setUpdateInfo: (version, changelog, assetUrl) =>
        set({ updateAvailable: true, updateVersion: version, updateChangelog: changelog, updateAssetUrl: assetUrl }),
      setIsUpdating:    (isUpdating)    => set({ isUpdating }),
      setUpdateInstalled: (updateInstalled) => set({ updateInstalled }),
      setUpdateError:   (updateError)   => set({ updateError }),
    }),
    {
      name: "hades-store",
      version: 5,
      migrate: (persisted: any, version) => {
        if (!persisted) return persisted;
        if (version < 2) {
          const legacyKey = persisted.apiKey ?? "";
          const legacyModel = persisted.groqModel ?? "llama-3.3-70b-versatile";
          if (!persisted.aiVendorConfigs) {
            persisted.aiVendorConfigs = {
              groq:      { apiKey: legacyKey, model: legacyModel },
              openai:    { apiKey: "", model: "gpt-4o-mini" },
              anthropic: { apiKey: "", model: "claude-haiku-4-5-20251001" },
              ollama:    { apiKey: "", model: "llama3.2", baseUrl: "http://localhost:11434" },
            };
          }
          if (!persisted.aiVendor) persisted.aiVendor = "groq";
        }
        if (version < 3) {
          if (!("syncFolder"  in persisted)) persisted.syncFolder  = null;
          if (!("syncEnabled" in persisted)) persisted.syncEnabled = false;
          if (!("lastSyncAt"  in persisted)) persisted.lastSyncAt  = null;
        }
        if (version < 4) {
          // Seed note tabs from the previously-active note so existing users
          // don't open to an empty tab strip.
          if (!Array.isArray(persisted.openNoteIds)) {
            persisted.openNoteIds = persisted.activeNoteId ? [persisted.activeNoteId] : [];
          }
          if (!Array.isArray(persisted.libraryDocs)) persisted.libraryDocs = [];
        }
        if (version < 5) {
          // New DeepSeek vendor config.
          if (persisted.aiVendorConfigs && !persisted.aiVendorConfigs.deepseek) {
            persisted.aiVendorConfigs.deepseek = { apiKey: "", model: "deepseek-chat" };
          }
          // Wrap the legacy single thread into the new conversation model.
          if (!Array.isArray(persisted.conversations)) {
            const legacy: ChatMessage[] = Array.isArray(persisted.chatMessages)
              ? persisted.chatMessages
              : [];
            if (legacy.length > 0) {
              const now = new Date().toISOString();
              const firstUser = legacy.find((m) => m.role === "user");
              const conv = {
                id: Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
                title:
                  firstUser?.content.replace(/\s+/g, " ").trim().slice(0, 40) || "Previous chat",
                messages: legacy,
                unrestricted: false,
                createdAt: now,
                updatedAt: now,
              };
              persisted.conversations = [conv];
              persisted.activeConversationId = conv.id;
            } else {
              persisted.conversations = [];
              persisted.activeConversationId = null;
            }
          }
          // Privacy opt-in: don't regress users who already use AI.
          if (!("aiEnabled" in persisted)) {
            const cfgs = persisted.aiVendorConfigs ?? {};
            const hasKey = Object.values(cfgs).some(
              (c: any) => typeof c?.apiKey === "string" && c.apiKey.trim().length > 0
            );
            const hasHistory =
              (Array.isArray(persisted.conversations) && persisted.conversations.length > 0) ||
              (Array.isArray(persisted.chatMessages) && persisted.chatMessages.length > 0);
            persisted.aiEnabled = hasKey || hasHistory;
          }
          if (!("aiUseStudyContext" in persisted)) persisted.aiUseStudyContext = false;
        }
        return persisted;
      },
      partialize: (s) => ({
        ...s,
        isRunning: false,
        _intervalId: null,
        timerEndsAt: null,
        taskFinishPrompt: null,
        isChatLoading: false,
        notePdfUrl: null,
        notePdfFileName: "",
        // Ephemeral sync runtime — always reset on start
        isSyncing: false,
        hasPendingChanges: false,
        quitPending: false,
        forceQuit: false,
        syncError: null,
        // Ephemeral updater state
        updateAvailable:  false,
        updateVersion:    null,
        updateChangelog:  null,
        updateAssetUrl:   null,
        isUpdating:       false,
        updateInstalled:  false,
        updateError:      null,
      }),
    }
  )
);
