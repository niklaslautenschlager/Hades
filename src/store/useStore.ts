import { create } from "zustand";
import { persist } from "zustand/middleware";
import { playChime } from "../lib/sound";

export type GroqModelId =
  | "llama-3.3-70b-versatile"
  | "llama3-8b-8192"
  | "mixtral-8x7b-32768";

// ─── Types ──────────────────────────────────────────────────────────────────

export type Module = "calendar" | "pomodoro" | "notepad" | "tasks";

export type PomodoroMode = "work" | "break" | "longBreak";

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

// ─── Store ───────────────────────────────────────────────────────────────────

interface AppState {
  // Global
  activeModule: Module;
  apiKey: string;
  groqModel: GroqModelId;
  setActiveModule: (m: Module) => void;
  setApiKey: (key: string) => void;
  setGroqModel: (model: GroqModelId) => void;

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

  startTimer: () => void;
  pauseTimer: () => void;
  resetTimer: () => void;
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

  addNote: (parentId?: string | null) => void;
  addFolder: (parentId?: string | null) => void;
  updateNote: (id: string, patch: Partial<NoteFile>) => void;
  deleteNote: (id: string) => void;
  moveNote: (id: string, newParentId: string | null) => void;
  setActiveNote: (id: string | null) => void;
  toggleVimMode: () => void;

  // ── Tasks ─────────────────────────────────────────────────────────────────
  tasks: Task[];

  addTask: (text: string) => void;
  toggleTask: (id: string) => void;
  deleteTask: (id: string) => void;
  reorderTasks: (from: number, to: number) => void;
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function modeTotal(state: AppState): number {
  if (state.pomodoroMode === "work") return state.workDuration * 60;
  if (state.pomodoroMode === "break") return state.breakDuration * 60;
  return state.longBreakDuration * 60;
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      // ── Global ──────────────────────────────────────────────────────────
      activeModule: "pomodoro",
      apiKey: "",
      groqModel: "llama-3.3-70b-versatile" as GroqModelId,
      setActiveModule: (activeModule) => set({ activeModule }),
      setApiKey: (apiKey) => set({ apiKey }),
      setGroqModel: (groqModel) => set({ groqModel }),

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
            playChime();

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
      notes: [
        {
          id: "welcome",
          name: "Welcome to Hades",
          content:
            "# Welcome to Hades\n\nThis is your note editor. It supports **Markdown** and _Vim_ bindings.\n\n## Features\n\n- Toggle between Normal and **Vim** mode in the toolbar\n- Organize notes in folders\n- Tag notes for quick search\n\n```js\nconsole.log('Hello, Hades');\n```\n",
          tags: ["welcome"],
          parentId: null,
          isFolder: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      activeNoteId: "welcome",
      isVimMode: false,

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
        if (task?.completed) playChime(0.35);
      },
      deleteTask: (id) =>
        set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) })),
      reorderTasks: (from, to) =>
        set((s) => {
          const tasks = [...s.tasks];
          const [item] = tasks.splice(from, 1);
          tasks.splice(to, 0, item);
          return { tasks };
        }),
    }),
    {
      name: "hades-store",
      // Don't persist the running interval or loading state
      partialize: (s) => ({
        ...s,
        isRunning: false,
        _intervalId: null,
        isChatLoading: false,
      }),
    }
  )
);
