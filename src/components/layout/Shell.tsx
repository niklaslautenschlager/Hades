import { useState, useEffect, useRef } from "react";
import {
  Calendar,
  Timer,
  FileText,
  CheckSquare,
  Settings,
  Layers,
  BarChart3,
  Palette,
  Check,
  ChevronDown,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useShallow } from "zustand/react/shallow";
import { useStore, type Module } from "../../store/useStore";
import { THEMES, THEME_GROUPS, themeMeta } from "../../lib/themes";
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
  const updateAvailable = useStore((s) => s.updateAvailable);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const themeWrapRef = useRef<HTMLDivElement>(null);

  const mins = String(Math.floor(timeLeft / 60)).padStart(2, "0");
  const secs = String(timeLeft % 60).padStart(2, "0");

  // Close theme popover on outside click / Escape
  useEffect(() => {
    if (!themeOpen) return;
    function onDown(e: MouseEvent) {
      if (themeWrapRef.current && !themeWrapRef.current.contains(e.target as Node)) {
        setThemeOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setThemeOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [themeOpen]);

  return (
    <div className="flex h-screen bg-surface overflow-hidden">
      {/* Sidebar */}
      <aside className="relative flex flex-col w-16 border-r border-border bg-surface z-20">
        {/* Logo */}
        <div className="flex items-center justify-center h-16 border-b border-border">
          <div className="relative flex items-center justify-center w-9 h-9 rounded-xl glow-accent-sm">
            <div className="absolute inset-0 rounded-xl bg-accent-gradient opacity-20" />
            <img
              src="/app-icon.png"
              alt="Hades"
              className="relative w-6 h-6 object-contain rounded-sm"
              draggable={false}
            />
          </div>
        </div>

        {/* Nav */}
        <nav className="flex flex-col items-center gap-1.5 py-4 flex-1">
          {NAV_ITEMS.map(({ id, icon: Icon, label }) => {
            const active = activeModule === id;
            return (
              <button
                key={id}
                onClick={() => setActiveModule(id)}
                title={label}
                className={`relative group flex items-center justify-center w-10 h-10 rounded-xl
                  transition-all duration-200
                  ${active
                    ? "text-[var(--accent-contrast)]"
                    : "text-muted hover:text-foreground hover:bg-surface-hover"
                  }`}
              >
                {/* Active gradient pill + glow (animated between items) */}
                {active && (
                  <motion.span
                    layoutId="nav-active"
                    className="absolute inset-0 rounded-xl bg-accent-gradient glow-accent-sm"
                    transition={{ type: "spring", stiffness: 500, damping: 34 }}
                  />
                )}

                <Icon className="relative w-[18px] h-[18px]" strokeWidth={active ? 2.5 : 2} />

                {/* Tooltip */}
                <span className="absolute left-12 px-2 py-1 bg-surface-elevated text-foreground text-xs
                  font-medium rounded-md whitespace-nowrap opacity-0 pointer-events-none
                  group-hover:opacity-100 transition-opacity duration-150 border border-border z-30">
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
                       border border-accent rounded-lg bg-accent-soft
                       text-xs font-mono text-accent glow-accent-sm
                       transition-all duration-150"
            title="Back to Focus"
          >
            {mins}:{secs}
          </motion.button>
        )}

        {/* Theme picker */}
        <div ref={themeWrapRef} className="flex flex-col items-center pb-2">
          <button
            onClick={() => setThemeOpen((v) => !v)}
            title="Themes"
            className={`flex items-center justify-center w-10 h-10 rounded-xl transition-all duration-150
              ${themeOpen
                ? "text-accent bg-accent-soft"
                : "text-muted hover:text-foreground hover:bg-surface-hover"
              }`}
          >
            <Palette className="w-4 h-4" />
          </button>

          <AnimatePresence>
            {themeOpen && (
              <ThemePicker
                current={theme}
                onPick={(id) => setTheme(id)}
                onClose={() => setThemeOpen(false)}
              />
            )}
          </AnimatePresence>
        </div>

        {/* Settings */}
        <div className="flex flex-col items-center pb-4">
          <button
            onClick={() => setSettingsOpen(true)}
            title={updateAvailable ? "Settings (update available)" : "Settings"}
            className="relative flex items-center justify-center w-10 h-10 rounded-xl
                       text-muted hover:text-foreground hover:bg-surface-hover
                       transition-all duration-150"
          >
            <Settings className="w-4 h-4" />
            {updateAvailable && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-accent-gradient glow-accent-sm" />
            )}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col min-w-0 min-h-0">{children}</main>

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

function ThemePicker({
  current,
  onPick,
  onClose,
}: {
  current: string;
  onPick: (id: any) => void;
  onClose: () => void;
}) {
  const active = themeMeta(current as any);
  // Open only the group holding the current theme — keeps the panel compact.
  const [openGroup, setOpenGroup] = useState<string>(active.group);

  return (
    <motion.div
      initial={{ opacity: 0, x: -8, scale: 0.97 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: -8, scale: 0.97 }}
      transition={{ type: "spring", stiffness: 420, damping: 30 }}
      className="fixed left-[4.75rem] bottom-16 z-40 w-60 max-h-[72vh] overflow-y-auto
                 surface p-2 shadow-2xl glow-accent-sm"
    >
      <div className="flex items-center gap-2 px-1.5 pt-1 pb-2">
        <Palette className="w-3.5 h-3.5 text-accent" />
        <span className="text-xs font-semibold uppercase tracking-wider text-foreground-secondary">
          Theme
        </span>
        <span className="ml-auto text-[10px] text-muted truncate max-w-[88px]">{active.label}</span>
      </div>

      <div className="flex flex-col gap-0.5">
        {THEME_GROUPS.map((group) => {
          const expanded = openGroup === group;
          const items = THEMES.filter((t) => t.group === group);
          const groupActive = items.some((t) => t.id === current);
          return (
            <div key={group}>
              {/* Group header (accordion toggle) */}
              <button
                onClick={() => setOpenGroup(expanded ? "" : group)}
                className={`flex items-center gap-2 w-full px-2 py-1.5 rounded-lg text-left transition-all duration-150
                  ${expanded ? "text-foreground" : "text-foreground-secondary hover:text-foreground hover:bg-surface-hover"}`}
              >
                {/* group swatch cluster */}
                <span className="flex -space-x-1 flex-shrink-0">
                  {items.slice(0, 3).map((t) => (
                    <span
                      key={t.id}
                      className="w-3 h-3 rounded-full border border-[var(--color-card)]"
                      style={{ background: `linear-gradient(135deg, ${t.swatch[1]}, ${t.swatch[2]})` }}
                    />
                  ))}
                </span>
                <span className="flex-1 text-xs font-medium truncate">{group}</span>
                {groupActive && !expanded && (
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-gradient flex-shrink-0" />
                )}
                <ChevronDown
                  className={`w-3.5 h-3.5 text-muted flex-shrink-0 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
                />
              </button>

              {/* Group items */}
              <AnimatePresence initial={false}>
                {expanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.18, ease: "easeOut" }}
                    className="overflow-hidden"
                  >
                    <div className="flex flex-col gap-0.5 pl-1.5 pb-1 pt-0.5">
                      {items.map((t) => {
                        const selected = t.id === current;
                        return (
                          <button
                            key={t.id}
                            onClick={() => {
                              onPick(t.id);
                              onClose();
                            }}
                            className={`flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left transition-all duration-150
                              ${selected
                                ? "bg-accent-soft text-foreground"
                                : "text-foreground-secondary hover:text-foreground hover:bg-surface-hover"
                              }`}
                          >
                            <span
                              className="flex-shrink-0 w-6 h-6 rounded-md border border-border overflow-hidden relative"
                              style={{ background: t.swatch[0] }}
                            >
                              <span
                                className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-tl-md"
                                style={{ background: `linear-gradient(135deg, ${t.swatch[1]}, ${t.swatch[2]})` }}
                              />
                            </span>
                            <span className="flex-1 text-xs font-medium truncate">{t.label}</span>
                            {selected && <Check className="w-3.5 h-3.5 text-accent flex-shrink-0" />}
                          </button>
                        );
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}
