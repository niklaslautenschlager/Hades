import { lazy, Suspense, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useStore } from "./store/useStore";
import Shell from "./components/layout/Shell";
import CalendarModule from "./components/calendar/CalendarModule";
import PomodoroModule from "./components/pomodoro/PomodoroModule";
import TasksModule from "./components/tasks/TasksModule";
import SyncOverlay from "./components/SyncOverlay";
import { useSyncTimer } from "./hooks/useSyncTimer";
import { useStartupSync } from "./hooks/useStartupSync";
import { useQuitGuard } from "./hooks/useQuitGuard";
import { useUpdateCheck } from "./hooks/useUpdateCheck";

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

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

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
    </Shell>
  );
}
