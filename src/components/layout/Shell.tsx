import { useState } from "react";
import {
  Calendar,
  Timer,
  FileText,
  CheckSquare,
  Settings,
  Flame,
  Layers,
  BarChart3,
  Palette,
} from "lucide-react";
import { motion } from "framer-motion";
import { useShallow } from "zustand/react/shallow";
import { useStore, type Module, type Theme } from "../../store/useStore";

const THEME_CYCLE: Theme[] = ["dark", "light", "catppuccin", "gruvbox", "nord"];
const THEME_LABELS: Record<Theme, string> = {
  dark: "Dark",
  light: "Paper",
  catppuccin: "Catppuccin",
  gruvbox: "Gruvbox",
  nord: "Nord",
};
import SettingsModal from "../settings/SettingsModal";

const NAV_ITEMS: { id: Module; icon: React.ElementType; label: string }[] = [
  { id: "pomodoro", icon: Timer, label: "Focus" },
  { id: "calendar", icon: Calendar, label: "Calendar" },
  { id: "notepad", icon: FileText, label: "Notes" },
  { id: "tasks", icon: CheckSquare, label: "Tasks" },
  { id: "flashcards", icon: Layers, label: "Flashcards" },
  { id: "stats", icon: BarChart3, label: "Statistics" },
];

interface ShellProps {
  children: React.ReactNode;
}

export default function Shell({ children }: ShellProps) {
  const { activeModule, setActiveModule, isRunning, timeLeft, theme, setTheme } = useStore(
    useShallow((s) => ({
      activeModule: s.activeModule,
      setActiveModule: s.setActiveModule,
      isRunning: s.isRunning,
      timeLeft: s.timeLeft,
      theme: s.theme,
      setTheme: s.setTheme,
    }))
  );
  const [settingsOpen, setSettingsOpen] = useState(false);

  const mins = String(Math.floor(timeLeft / 60)).padStart(2, "0");
  const secs = String(timeLeft % 60).padStart(2, "0");

  return (
    <div className="flex h-screen bg-surface overflow-hidden">
      {/* Sidebar */}
      <aside className="flex flex-col w-16 border-r border-border bg-surface z-10">
        {/* Logo */}
        <div className="flex items-center justify-center h-16 border-b border-border">
          <div className="relative flex items-center justify-center w-8 h-8">
            <div className="absolute inset-0 rounded-lg bg-surface-hover" />
            <Flame className="relative w-4 h-4 text-foreground" strokeWidth={2} />
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
                    ? "bg-foreground text-surface"
                    : "text-muted hover:text-foreground hover:bg-surface-hover"
                  }
                `}
              >
                <Icon className="w-4.5 h-4.5" strokeWidth={active ? 2.5 : 2} />

                {/* Tooltip */}
                <span className="
                  absolute left-12 px-2 py-1 bg-surface-elevated text-foreground text-xs
                  font-medium rounded-md whitespace-nowrap opacity-0 pointer-events-none
                  group-hover:opacity-100 transition-opacity duration-150
                  border border-border
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
                       bg-surface-hover border border-border rounded-lg
                       text-xs font-mono text-foreground-secondary hover:text-foreground
                       hover:border-border-active transition-all duration-150"
            title="Back to Focus"
          >
            {mins}:{secs}
          </motion.button>
        )}

        {/* Theme cycler */}
        <div className="flex flex-col items-center pb-2">
          <button
            onClick={() => {
              const idx = THEME_CYCLE.indexOf(theme);
              const next = THEME_CYCLE[(idx + 1) % THEME_CYCLE.length];
              setTheme(next);
            }}
            title={`Theme: ${THEME_LABELS[theme]} — click to cycle`}
            className="flex items-center justify-center w-10 h-10 rounded-lg
                       text-muted hover:text-foreground hover:bg-surface-hover
                       transition-all duration-150"
          >
            <Palette className="w-4 h-4" />
          </button>
        </div>

        {/* Settings */}
        <div className="flex flex-col items-center pb-4">
          <button
            onClick={() => setSettingsOpen(true)}
            title="Settings"
            className="flex items-center justify-center w-10 h-10 rounded-lg
                       text-muted hover:text-foreground hover:bg-surface-hover
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
