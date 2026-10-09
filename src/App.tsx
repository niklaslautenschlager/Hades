import { lazy, Suspense, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useStore } from "./store/useStore";
import { THEME_STORAGE_KEY } from "./lib/themes";
import { startAutoIndexing } from "./lib/indexSync";
import Shell from "./components/layout/Shell";
import CalendarModule from "./components/calendar/CalendarModule";
import PomodoroModule from "./components/pomodoro/PomodoroModule";
import TasksModule from "./components/tasks/TasksModule";
import SyncOverlay from "./components/SyncOverlay";
import CommandPalette from "./components/CommandPalette";
import ReminderHost from "./components/ReminderHost";
import Onboarding from "./components/Onboarding";
import ToastHost from "./components/ToastHost";
import { usePomodoroNudge } from "./hooks/usePomodoroNudge";
import { useSyncTimer } from "./hooks/useSyncTimer";
import { useStartupSync } from "./hooks/useStartupSync";
import { useQuitGuard } from "./hooks/useQuitGuard";
import { useUpdateCheck } from "./hooks/useUpdateCheck";
import { useIcalSync } from "./hooks/useIcalSync";
import { startWorkspaceBridge } from "./lib/workspaceBridge";

// Lazy-load heavy modules
const NotepadModule = lazy(() => import("./components/notepad/NotepadModule"));
const FlashcardsModule = lazy(() => import("./components/flashcards/FlashcardsModule"));
const StatsModule = lazy(() => import("./components/stats/StatsModule"));

const pageVariants = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
};

export default function App() {
  const activeModule = useStore((s) => s.activeModule);
  const theme = useStore((s) => s.theme);

  useSyncTimer();
  useStartupSync();
  useQuitGuard();
  useUpdateCheck();
  useIcalSync();
  usePomodoroNudge();

  // Self-gating: does nothing until the user opts in and a sync folder is set.
  useEffect(() => startWorkspaceBridge(), []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    // index.html reads this before first paint so the next launch doesn't flash the default theme.
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      /* storage blocked — the first paint falls back to the default theme */
    }
  }, [theme]);

  // The Pomodoro cycle is per local day; a window left open past midnight must
  // be corrected before the user looks at it or starts a session.
  useEffect(() => {
    const rollover = () => useStore.getState().rolloverIfNewDay();
    const onVisible = () => {
      if (document.visibilityState === "visible") rollover();
    };
    // zustand leaves `persist` off the store when storage is unavailable, in
    // which case there is nothing to wait for.
    const persistApi = useStore.persist as typeof useStore.persist | undefined;
    let stopHydrationWatch: (() => void) | null = null;
    if (!persistApi || persistApi.hasHydrated()) rollover();
    else stopHydrationWatch = persistApi.onFinishHydration(rollover);
    window.addEventListener("focus", rollover);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopHydrationWatch?.();
      window.removeEventListener("focus", rollover);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // Start only once persisted notes/events/tasks are loaded, so the initial
  // reconcile sees real data instead of the empty defaults.
  useEffect(() => {
    const persistApi = useStore.persist as typeof useStore.persist | undefined;
    let stop: (() => void) | null = null;
    let stopHydrationWatch: (() => void) | null = null;
    const start = () => {
      stop = startAutoIndexing();
    };
    if (!persistApi || persistApi.hasHydrated()) start();
    else stopHydrationWatch = persistApi.onFinishHydration(start);
    return () => {
      stopHydrationWatch?.();
      stop?.();
    };
  }, []);

  return (
    <Shell>
      <AnimatePresence mode="wait">
        <motion.div
          key={activeModule}
          variants={pageVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="flex-1 flex flex-col min-h-0 min-w-0"
        >
          {activeModule === "calendar" && <CalendarModule />}
          {activeModule === "pomodoro" && <PomodoroModule />}
          {activeModule === "notepad" && (
            <Suspense fallback={<div className="flex-1" />}>
              <NotepadModule />
            </Suspense>
          )}
          {activeModule === "tasks" && <TasksModule />}
          {activeModule === "flashcards" && (
            <Suspense fallback={<div className="flex-1" />}>
              <FlashcardsModule />
            </Suspense>
          )}
          {activeModule === "stats" && (
            <Suspense fallback={<div className="flex-1" />}>
              <StatsModule />
            </Suspense>
          )}
        </motion.div>
      </AnimatePresence>
      <SyncOverlay />
      <CommandPalette />
      <ReminderHost />
      <Onboarding />
      <ToastHost />
    </Shell>
  );
}
