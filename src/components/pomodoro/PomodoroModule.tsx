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

const MODE_COLORS: Record<PomodoroMode, string> = {
  work: "rgba(244,244,245,0.9)",
  break: "rgba(161,161,170,0.7)",
  longBreak: "rgba(113,113,122,0.6)",
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
        <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800/60 rounded-xl p-1">
          {(Object.keys(MODE_LABELS) as PomodoroMode[]).map((mode) => (
            <button
              key={mode}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150
                          ${pomodoroMode === mode
                            ? "bg-zinc-100 text-zinc-950"
                            : "text-zinc-500 hover:text-zinc-300"
                          }`}
            >
              {MODE_LABELS[mode]}
            </button>
          ))}
        </div>

        {/* Timer ring */}
        <div className="relative flex items-center justify-center">
          <svg width="224" height="224" className="-rotate-90">
            <circle
              cx="112"
              cy="112"
              r={RADIUS}
              fill="none"
              stroke="rgba(255,255,255,0.05)"
              strokeWidth="6"
            />
            <motion.circle
              cx="112"
              cy="112"
              r={RADIUS}
              fill="none"
              stroke={MODE_COLORS[pomodoroMode]}
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={strokeDash}
              animate={{ strokeDashoffset: strokeDash }}
              transition={{ duration: 0.5, ease: "easeOut" }}
            />
          </svg>

          <div className="absolute flex flex-col items-center">
            <span className="font-mono text-5xl font-semibold text-zinc-100 tracking-tight tabular-nums">
              {mins}:{secs}
            </span>
            <span className="text-xs font-medium text-zinc-500 mt-1 uppercase tracking-widest">
              {MODE_LABELS[pomodoroMode]}
            </span>
          </div>
        </div>

        {/* Session dots */}
        <div className="flex items-center gap-2">
          {sessionDots.map((filled, i) => (
            <div
              key={i}
              className={`w-1.5 h-1.5 rounded-full transition-all duration-300 ${
                filled ? "bg-zinc-200" : "bg-zinc-700"
              }`}
            />
          ))}
          <span className="ml-2 text-xs text-zinc-600">
            {sessionsCompleted} completed
          </span>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3">
          <button
            onClick={resetTimer}
            className="flex items-center justify-center w-10 h-10 rounded-xl
                       text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800/60 transition-all"
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          <motion.button
            whileTap={{ scale: 0.94 }}
            onClick={isRunning ? pauseTimer : startTimer}
            className="flex items-center justify-center w-16 h-16 rounded-2xl
                       bg-zinc-100 hover:bg-white text-zinc-950 transition-all duration-150
                       shadow-glow"
          >
            {isRunning ? (
              <Pause className="w-6 h-6" fill="currentColor" />
            ) : (
              <Play className="w-6 h-6 ml-0.5" fill="currentColor" />
            )}
          </motion.button>

          <button
            onClick={() => { pauseTimer(); resetTimer(); }}
            className="flex items-center justify-center w-10 h-10 rounded-xl
                       text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800/60 transition-all"
            title="Skip"
          >
            <SkipForward className="w-4 h-4" />
          </button>
        </div>

        {/* Goal */}
        <div className="w-full">
          <div className="flex items-center gap-2 mb-2">
            <Target className="w-3.5 h-3.5 text-zinc-500" />
            <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
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
              className="w-full text-left px-3 py-2.5 bg-zinc-900 border border-zinc-800/50
                         rounded-lg text-sm transition-all duration-150 hover:border-zinc-700/60
                         group"
            >
              {goal ? (
                <span className="text-zinc-300">{goal}</span>
              ) : (
                <span className="text-zinc-600 group-hover:text-zinc-500">
                  Click to set a goal for this session...
                </span>
              )}
            </button>
          )}
        </div>
      </div>

      {/* ── Resize handle ────────────────────────────────────────────── */}
      <div
        className="w-[5px] flex-shrink-0 cursor-col-resize border-r border-zinc-800/50
                   hover:border-zinc-600/60 hover:bg-zinc-800/20 transition-colors duration-150"
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
