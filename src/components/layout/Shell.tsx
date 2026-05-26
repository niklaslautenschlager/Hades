import { useState } from "react";
import {
  Calendar,
  Timer,
  FileText,
  CheckSquare,
  Settings,
  Flame,
} from "lucide-react";
import { motion } from "framer-motion";
import { useShallow } from "zustand/react/shallow";
import { useStore, type Module } from "../../store/useStore";
import SettingsModal from "../settings/SettingsModal";

const NAV_ITEMS: { id: Module; icon: React.ElementType; label: string }[] = [
  { id: "calendar", icon: Calendar, label: "Calendar" },
  { id: "pomodoro", icon: Timer, label: "Focus" },
  { id: "notepad", icon: FileText, label: "Notes" },
  { id: "tasks", icon: CheckSquare, label: "Tasks" },
];

interface ShellProps {
  children: React.ReactNode;
}

export default function Shell({ children }: ShellProps) {
  const { activeModule, setActiveModule, isRunning, timeLeft } = useStore(
    useShallow((s) => ({
      activeModule: s.activeModule,
      setActiveModule: s.setActiveModule,
      isRunning: s.isRunning,
      timeLeft: s.timeLeft,
    }))
  );
  const [settingsOpen, setSettingsOpen] = useState(false);

  const mins = String(Math.floor(timeLeft / 60)).padStart(2, "0");
  const secs = String(timeLeft % 60).padStart(2, "0");

  return (
    <div className="flex h-screen bg-zinc-950 overflow-hidden">
      {/* Sidebar */}
      <aside className="flex flex-col w-16 border-r border-zinc-800/50 bg-zinc-950 z-10">
        {/* Logo */}
        <div className="flex items-center justify-center h-16 border-b border-zinc-800/50">
          <div className="relative flex items-center justify-center w-8 h-8">
            <div className="absolute inset-0 rounded-lg bg-zinc-800/60" />
            <Flame className="relative w-4 h-4 text-zinc-100" strokeWidth={2} />
          </div>
        </div>

        {/* Nav */}
        <nav className="flex flex-col items-center gap-1 py-4 flex-1">
          {NAV_ITEMS.map(({ id, icon: Icon, label }) => {
            const active = activeModule === id;
            return (
              <button
                key={id}
                onClick={() => setActiveModule(id)}
                title={label}
                className={`
                  relative group flex items-center justify-center w-10 h-10 rounded-lg
                  transition-all duration-150
                  ${active
                    ? "bg-zinc-100 text-zinc-950"
                    : "text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/60"
                  }
                `}
              >
                <Icon className="w-4.5 h-4.5" strokeWidth={active ? 2.5 : 2} />

                {/* Tooltip */}
                <span className="
                  absolute left-12 px-2 py-1 bg-zinc-800 text-zinc-200 text-xs
                  font-medium rounded-md whitespace-nowrap opacity-0 pointer-events-none
                  group-hover:opacity-100 transition-opacity duration-150
                  border border-zinc-700/40
                ">
                  {label}
                </span>
              </button>
            );
          })}
        </nav>

        {/* Timer pill (visible when running) */}
        {isRunning && activeModule !== "pomodoro" && (
          <motion.button
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            onClick={() => setActiveModule("pomodoro")}
            className="mx-2 mb-2 flex items-center justify-center py-1.5 px-1
                       bg-zinc-800/80 border border-zinc-700/50 rounded-lg
                       text-xs font-mono text-zinc-300 hover:text-zinc-100
                       hover:border-zinc-600/60 transition-all duration-150"
            title="Back to Focus"
          >
            {mins}:{secs}
          </motion.button>
        )}

        {/* Settings */}
        <div className="flex flex-col items-center pb-4">
          <button
            onClick={() => setSettingsOpen(true)}
            title="Settings"
            className="flex items-center justify-center w-10 h-10 rounded-lg
                       text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800/60
                       transition-all duration-150"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col min-w-0 min-h-0">
        {children}
      </main>

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
