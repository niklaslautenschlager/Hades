import { useState, useRef, useEffect } from "react";
import {
  Play,
  Pause,
  RotateCcw,
  Target,
  SkipForward,
} from "lucide-react";
import { motion } from "framer-motion";
import { useShallow } from "zustand/react/shallow";
import { useStore, type PomodoroMode } from "../../store/useStore";
import AIAssistant from "./AIAssistant";

const MODE_LABELS: Record<PomodoroMode, string> = {
  work: "Focus",
  break: "Short Break",
  longBreak: "Long Break",
};

export default function PomodoroModule() {
  const {
    pomodoroMode,
    timeLeft,
    isRunning,
    sessionsCompleted,
    workDuration,
    breakDuration,
    longBreakDuration,
    sessionsUntilLongBreak,
    goal,
    startTimer,
    pauseTimer,
    resetTimer,
    skipSession,
    setPomodoroMode,
    setGoal,
  } = useStore(
    useShallow((s) => ({
      pomodoroMode: s.pomodoroMode,
      timeLeft: s.timeLeft,
      isRunning: s.isRunning,
      sessionsCompleted: s.sessionsCompleted,
      workDuration: s.workDuration,
      breakDuration: s.breakDuration,
      longBreakDuration: s.longBreakDuration,
      sessionsUntilLongBreak: s.sessionsUntilLongBreak,
      goal: s.goal,
      startTimer: s.startTimer,
      pauseTimer: s.pauseTimer,
      resetTimer: s.resetTimer,
      skipSession: s.skipSession,
      setPomodoroMode: s.setPomodoroMode,
      setGoal: s.setGoal,
    }))
  );

  const [editingGoal, setEditingGoal] = useState(false);
  const [goalDraft, setGoalDraft] = useState(goal);
  const goalInputRef = useRef<HTMLInputElement>(null);

  // Resizable panel state
  const [panelWidth, setPanelWidth] = useState(420);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    if (editingGoal) goalInputRef.current?.focus();
  }, [editingGoal]);

  const total =
    pomodoroMode === "work"
      ? workDuration * 60
      : pomodoroMode === "break"
      ? breakDuration * 60
      : longBreakDuration * 60;

  const progress = 1 - timeLeft / total;
  const mins = String(Math.floor(timeLeft / 60)).padStart(2, "0");
  const secs = String(timeLeft % 60).padStart(2, "0");

  const RADIUS = 88;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
  const strokeDash = CIRCUMFERENCE * (1 - progress);

  function saveGoal() {
    setGoal(goalDraft.trim());
    setEditingGoal(false);
  }

  const sessionDots = Array.from(
    { length: sessionsUntilLongBreak },
    (_, i) => i < sessionsCompleted % sessionsUntilLongBreak
  );

  function onDividerPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startWidth: panelWidth };
  }

  function onDividerPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return;
    const delta = e.clientX - dragRef.current.startX;
    setPanelWidth(Math.max(300, Math.min(640, dragRef.current.startWidth + delta)));
  }

  function onDividerPointerUp() {
    dragRef.current = null;
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Left: Timer panel ─────────────────────────────────────────── */}
      <div
        style={{ width: panelWidth }}
        className="flex flex-col items-center justify-center flex-shrink-0 px-8 gap-8 overflow-hidden"
      >
        {/* Mode tabs */}
        <div className="flex items-center gap-1 bg-surface-elevated border border-border rounded-xl p-1">
          {(Object.keys(MODE_LABELS) as PomodoroMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setPomodoroMode(mode)}
              className={`relative px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150
                          ${pomodoroMode === mode
                            ? "text-[var(--accent-contrast)]"
                            : "text-muted hover:text-foreground-secondary"
                          }`}
            >
              {pomodoroMode === mode && (
                <motion.span
                  layoutId="mode-pill"
                  className="absolute inset-0 rounded-lg bg-accent-gradient glow-accent-sm"
                  transition={{ type: "spring", stiffness: 480, damping: 32 }}
                />
              )}
              <span className="relative">{MODE_LABELS[mode]}</span>
            </button>
          ))}
        </div>

        {/* Timer ring */}
        <div className="relative flex items-center justify-center">
          <svg width="248" height="248" className="-rotate-90">
            <defs>
              <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style={{ stopColor: "var(--accent)" }} />
                <stop offset="100%" style={{ stopColor: "var(--accent-2)" }} />
              </linearGradient>
            </defs>
            <circle
              cx="124"
              cy="124"
              r={RADIUS}
              fill="none"
              stroke="var(--color-border)"
              strokeWidth="7"
            />
            <motion.circle
              cx="124"
              cy="124"
              r={RADIUS}
              fill="none"
              stroke="url(#ringGrad)"
              strokeWidth="7"
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={strokeDash}
              animate={{ strokeDashoffset: strokeDash }}
              transition={{ duration: 0.5, ease: "easeOut" }}
              style={{ filter: "drop-shadow(0 0 7px var(--accent-glow))" }}
            />
          </svg>

          <div className="absolute flex flex-col items-center">
            <span
              className="text-7xl font-light text-foreground tracking-[-0.03em]"
              style={{ fontFamily: "'Inter', system-ui, sans-serif", fontFeatureSettings: '"tnum"' }}
            >
              {mins}:{secs}
            </span>
            <span className="text-xs font-semibold text-accent mt-1.5 uppercase tracking-[0.2em]">
              {MODE_LABELS[pomodoroMode]}
            </span>
          </div>
        </div>

        {/* Session bars */}
        <div className="flex items-center gap-1.5">
          {sessionDots.map((filled, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                filled ? "w-6 bg-accent-gradient glow-accent-sm" : "w-3 bg-surface-hover"
              }`}
            />
          ))}
          <span className="ml-2 text-xs text-muted">{sessionsCompleted} completed</span>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-4">
          <button
            onClick={resetTimer}
            className="flex items-center justify-center w-11 h-11 rounded-xl border border-border
                       text-muted hover:text-foreground hover:border-border-active hover:bg-surface-hover transition-all"
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          <motion.button
            whileTap={{ scale: 0.94 }}
            onClick={isRunning ? pauseTimer : startTimer}
            className="flex items-center justify-center w-[68px] h-[68px] rounded-2xl
                       bg-accent-gradient text-[var(--accent-contrast)] glow-accent
                       hover:brightness-105 transition-all duration-150"
          >
            {isRunning ? (
              <Pause className="w-7 h-7" fill="currentColor" />
            ) : (
              <Play className="w-7 h-7 ml-0.5" fill="currentColor" />
            )}
          </motion.button>

          <button
            onClick={skipSession}
            className="flex items-center justify-center w-11 h-11 rounded-xl border border-border
                       text-muted hover:text-foreground hover:border-border-active hover:bg-surface-hover transition-all"
            title="Skip to next session"
          >
            <SkipForward className="w-4 h-4" />
          </button>
        </div>

        {/* Goal */}
        <div className="w-full">
          <div className="flex items-center gap-2 mb-2">
            <Target className="w-3.5 h-3.5 text-muted" />
            <span className="text-xs font-medium text-muted uppercase tracking-wider">
              Session Goal
            </span>
          </div>

          {editingGoal ? (
            <div className="flex gap-2">
              <input
                ref={goalInputRef}
                type="text"
                value={goalDraft}
                onChange={(e) => setGoalDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveGoal();
                  if (e.key === "Escape") setEditingGoal(false);
                }}
                placeholder="What do you want to accomplish?"
                className="input-base flex-1 text-sm"
              />
              <button onClick={saveGoal} className="btn-primary text-xs">
                Set
              </button>
            </div>
          ) : (
            <button
              onClick={() => { setGoalDraft(goal); setEditingGoal(true); }}
              className="w-full text-left px-3 py-2.5 bg-surface-elevated border border-border
                         rounded-lg text-sm transition-all duration-150 hover:border-border-active
                         group"
            >
              {goal ? (
                <span className="text-foreground-secondary">{goal}</span>
              ) : (
                <span className="text-muted group-hover:text-foreground-secondary">
                  Click to set a goal for this session...
                </span>
              )}
            </button>
          )}
        </div>
      </div>

      {/* ── Resize handle ────────────────────────────────────────────── */}
      <div
        className="w-[5px] flex-shrink-0 cursor-col-resize border-r border-border
                   hover:border-border-active hover:bg-surface-hover transition-colors duration-150"
        onPointerDown={onDividerPointerDown}
        onPointerMove={onDividerPointerMove}
        onPointerUp={onDividerPointerUp}
        onPointerCancel={onDividerPointerUp}
      />

      {/* ── Right: AI chat ────────────────────────────────────────────── */}
      <AIAssistant goal={goal} />
    </div>
  );
}
