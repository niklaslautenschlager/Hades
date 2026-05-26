import { lazy, Suspense } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useStore } from "./store/useStore";
import Shell from "./components/layout/Shell";
import CalendarModule from "./components/calendar/CalendarModule";
import PomodoroModule from "./components/pomodoro/PomodoroModule";
import TasksModule from "./components/tasks/TasksModule";

// Lazy-load the notepad so CodeMirror + vim don't run at startup
const NotepadModule = lazy(() => import("./components/notepad/NotepadModule"));

const pageVariants = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
};

export default function App() {
  const activeModule = useStore((s) => s.activeModule);

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
        </motion.div>
      </AnimatePresence>
    </Shell>
  );
}
