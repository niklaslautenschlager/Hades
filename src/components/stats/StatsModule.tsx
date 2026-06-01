import { useMemo } from "react";
import { Clock, Target, Flame, TrendingUp, Award } from "lucide-react";
import { motion } from "framer-motion";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../../store/useStore";
import type { FocusSession } from "../../store/useStore";

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatHours(seconds: number): string {
  return (seconds / 3600).toFixed(1);
}

function getDayColor(duration: number): string {
  if (duration === 0) return "var(--color-surface-hover)";
  if (duration < 3600) return "var(--heatmap-low, #3f3f46)";
  if (duration < 7200) return "var(--heatmap-mid, #71717a)";
  if (duration < 10800) return "var(--heatmap-high, #a1a1aa)";
  return "var(--heatmap-max, #e4e4e7)";
}

function todayStr(): string {
  return new Date().toISOString().split("T")[0];
}

function getWeekStart(): string {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
  const monday = new Date(d.setDate(diff));
  return monday.toISOString().split("T")[0];
}

function getMonthStart(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function getYearStart(): string {
  return `${new Date().getFullYear()}-01-01`;
}

function getMotivationalQuote(progress: number): string {
  if (progress >= 1.5) {
    return "You're on fire! Way beyond your goal. This is legendary dedication.";
  }
  if (progress >= 1.2) {
    return "Overtime! You've crushed your goal and kept going. True scholar energy.";
  }
  if (progress >= 1.0) {
    return "Goal reached! You showed up and did the work. Take a well-earned rest.";
  }
  if (progress >= 0.75) {
    return "Almost there! Just a few more hours and you've hit your weekly target.";
  }
  if (progress >= 0.5) {
    return "Halfway through! Keep the momentum going, you're building something.";
  }
  if (progress >= 0.25) {
    return "Good start! You've laid the foundation. Now keep stacking those hours.";
  }
  return "Every minute counts. Set a small goal for today and build from there.";
}

export default function StatsModule() {
  const { focusSessions, weeklyGoalHours, setWeeklyGoalHours, sessionsCompleted } = useStore(
    useShallow((s) => ({
      focusSessions: s.focusSessions,
      weeklyGoalHours: s.weeklyGoalHours,
      setWeeklyGoalHours: s.setWeeklyGoalHours,
      sessionsCompleted: s.sessionsCompleted,
    }))
  );

  const today = todayStr();
  const weekStart = getWeekStart();
  const monthStart = getMonthStart();
  const yearStart = getYearStart();

  const stats = useMemo(() => {
    const todaySession = focusSessions.find((f) => f.date === today);
    const weekSessions = focusSessions.filter((f) => f.date >= weekStart);
    const monthSessions = focusSessions.filter((f) => f.date >= monthStart);
    const yearSessions = focusSessions.filter((f) => f.date >= yearStart);

    const sum = (arr: FocusSession[]) => arr.reduce((a, b) => a + b.duration, 0);
    const sessSum = (arr: FocusSession[]) => arr.reduce((a, b) => a + b.sessions, 0);

    return {
      today: { duration: todaySession?.duration ?? 0, sessions: todaySession?.sessions ?? 0 },
      week: { duration: sum(weekSessions), sessions: sessSum(weekSessions) },
      month: { duration: sum(monthSessions), sessions: sessSum(monthSessions) },
      year: { duration: sum(yearSessions), sessions: sessSum(yearSessions) },
      total: { duration: sum(focusSessions), sessions: sessSum(focusSessions) },
      streak: calculateStreak(focusSessions),
    };
  }, [focusSessions, today, weekStart, monthStart, yearStart]);

  // Last 7 days chart data
  const last7Days = useMemo(() => {
    const days: { label: string; duration: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split("T")[0];
      const session = focusSessions.find((f) => f.date === dateStr);
      days.push({
        label: d.toLocaleDateString("en", { weekday: "short" }),
        duration: session?.duration ?? 0,
      });
    }
    return days;
  }, [focusSessions]);

  const maxDuration = Math.max(...last7Days.map((d) => d.duration), 1);

  const heatmapData = useMemo(() => {
    const endDate = new Date();
    endDate.setHours(0, 0, 0, 0);
    const daysUntilSaturday = (6 - endDate.getDay() + 7) % 7;
    endDate.setDate(endDate.getDate() + daysUntilSaturday);

    const days: { dateStr: string; duration: number; label: string }[] = [];
    for (let i = 370; i >= 0; i--) {
      const d = new Date(endDate);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split("T")[0];
      const session = focusSessions.find((f) => f.date === dateStr);
      const label = d.toLocaleDateString("en", { weekday: "short", month: "short", day: "numeric" });
      days.push({ dateStr, duration: session?.duration ?? 0, label });
    }
    return days;
  }, [focusSessions]);

  const monthLabels = useMemo(() => {
    const labels: (string | null)[] = [];
    for (let col = 0; col < 53; col++) {
      const dayIndex = col * 7;
      if (dayIndex >= heatmapData.length) { labels.push(null); continue; }
      const day = heatmapData[dayIndex];
      const d = new Date(day.dateStr + "T00:00:00");
      if (col === 0 || d.getDate() <= 7) {
        labels.push(d.toLocaleDateString("en", { month: "short" }));
      } else {
        labels.push(null);
      }
    }
    return labels;
  }, [heatmapData]);

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
        <div>
          <h1 className="text-sm font-semibold text-foreground">Statistics</h1>
          <p className="text-xs text-muted mt-0.5">Track your focus and study habits</p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-3xl mx-auto space-y-6">

          {/* Weekly Goal — rendered by its own sub-component so the bar
              updates every second during an active session without re-rendering
              the heatmap and stat cards on every tick */}
          <WeeklyGoalProgress
            weekSecs={stats.week.duration}
            weeklyGoalHours={weeklyGoalHours}
            setWeeklyGoalHours={setWeeklyGoalHours}
          />

          {/* Stat cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Today", value: formatDuration(stats.today.duration), sub: `${stats.today.sessions} sessions`, icon: Clock },
              { label: "This Week", value: formatDuration(stats.week.duration), sub: `${stats.week.sessions} sessions`, icon: TrendingUp },
              { label: "This Month", value: formatDuration(stats.month.duration), sub: `${stats.month.sessions} sessions`, icon: Flame },
              { label: "This Year", value: formatDuration(stats.year.duration), sub: `${stats.year.sessions} sessions`, icon: Award },
            ].map(({ label, value, sub, icon: Icon }) => (
              <div key={label} className="surface p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Icon className="w-3.5 h-3.5 text-muted" />
                  <span className="text-xs font-medium text-muted uppercase tracking-wider">{label}</span>
                </div>
                <p className="text-xl font-semibold text-foreground">{value}</p>
                <p className="text-xs text-muted mt-0.5">{sub}</p>
              </div>
            ))}
          </div>

          {/* 7-day chart */}
          <div className="surface p-6">
            <h2 className="text-sm font-semibold text-foreground mb-4">Last 7 Days</h2>
            <div className="flex items-end gap-2 h-32">
              {last7Days.map((day, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <motion.div
                    initial={{ height: 0 }}
                    animate={{ height: `${(day.duration / maxDuration) * 100}%` }}
                    transition={{ duration: 0.5, delay: i * 0.05 }}
                    className={`w-full rounded-t-md min-h-[2px] ${
                      day.duration > 0 ? "bg-foreground" : "bg-surface-hover"
                    }`}
                    style={{ maxHeight: "100%" }}
                    title={formatDuration(day.duration)}
                  />
                  <span className="text-xs text-muted">{day.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Year Overview heatmap */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="surface p-6"
          >
            <h2 className="text-sm font-semibold text-foreground mb-4">Year Overview</h2>
            <div className="overflow-x-auto">
              <div style={{ display: "inline-block" }}>
                {/* Month labels */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(53, 11px)", gap: "2px", marginBottom: "4px" }}>
                  {monthLabels.map((label, col) => (
                    <div key={col} style={{ height: "12px", fontSize: "10px", color: "var(--color-muted)", whiteSpace: "nowrap" }}>
                      {label ?? ""}
                    </div>
                  ))}
                </div>
                {/* Day cells */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateRows: "repeat(7, 11px)",
                    gridAutoFlow: "column",
                    gap: "2px",
                  }}
                >
                  {heatmapData.map((day) => (
                    <div
                      key={day.dateStr}
                      title={day.duration > 0 ? `${formatDuration(day.duration)} on ${day.label}` : day.label}
                      style={{
                        width: "11px",
                        height: "11px",
                        borderRadius: "2px",
                        backgroundColor: getDayColor(day.duration),
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>
          </motion.div>

          {/* Totals */}
          <div className="surface p-6">
            <h2 className="text-sm font-semibold text-foreground mb-2">All Time</h2>
            <div className="flex items-center gap-6">
              <div>
                <p className="text-2xl font-semibold text-foreground">{formatDuration(stats.total.duration)}</p>
                <p className="text-xs text-muted">total focus time</p>
              </div>
              <div>
                <p className="text-2xl font-semibold text-foreground">{stats.total.sessions + sessionsCompleted}</p>
                <p className="text-xs text-muted">sessions completed</p>
              </div>
              <div>
                <p className="text-2xl font-semibold text-foreground">{stats.streak}</p>
                <p className="text-xs text-muted">day streak</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Weekly Goal Bar ──────────────────────────────────────────────────────────
// Isolated component so the 1-second timer tick only re-renders the bar, not
// the heatmap and stat cards in the parent.
function WeeklyGoalProgress({
  weekSecs,
  weeklyGoalHours,
  setWeeklyGoalHours,
}: {
  weekSecs: number;
  weeklyGoalHours: number;
  setWeeklyGoalHours: (h: number) => void;
}) {
  const { timeLeft, isRunning, pomodoroMode, workDuration } = useStore(
    useShallow((s) => ({
      timeLeft:     s.timeLeft,
      isRunning:    s.isRunning,
      pomodoroMode: s.pomodoroMode,
      workDuration: s.workDuration,
    }))
  );

  // Elapsed seconds in the current in-progress work session.
  // recordFocusTime only fires when the session completes; this makes the bar
  // fill live as you study instead of jumping only at session end.
  const liveSeconds = pomodoroMode === "work" && isRunning
    ? Math.max(0, workDuration * 60 - timeLeft)
    : 0;

  const totalSecs = weekSecs + liveSeconds;
  const weeklyProgress = weeklyGoalHours > 0 ? totalSecs / (weeklyGoalHours * 3600) : 0;
  const motivation = getMotivationalQuote(weeklyProgress);

  const barColor =
    weeklyProgress >= 1 ? "bg-green-500"
    : weeklyProgress >= 0.75 ? "bg-amber-500"
    : "bg-foreground";

  return (
    <div className="surface p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Target className="w-4 h-4 text-foreground-secondary" />
          <h2 className="text-sm font-semibold text-foreground">Weekly Goal</h2>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            max={80}
            value={weeklyGoalHours}
            onChange={(e) =>
              setWeeklyGoalHours(Math.max(1, Math.min(80, parseInt(e.target.value) || 20)))
            }
            className="input-base w-16 text-center text-sm font-mono"
          />
          <span className="text-xs text-muted">hours/week</span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="relative h-4 bg-surface-hover rounded-full overflow-hidden mb-3">
        {/* Fill — rounded-l-full so left edge curves with the container; the
            container's overflow-hidden clips the right edge cleanly at any % */}
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${Math.min(weeklyProgress * 100, 100)}%` }}
          transition={{
            duration: isRunning ? 0.95 : 0.8,
            ease:     isRunning ? "linear" : "easeOut",
          }}
          className={`absolute inset-y-0 left-0 rounded-l-full transition-colors duration-300 ${barColor}`}
        />
        {/* Quarter-point reference marks — help gauge progress at a glance */}
        {[25, 50, 75].map((pct) => (
          <div
            key={pct}
            className="absolute inset-y-0 w-px bg-background/25 pointer-events-none"
            style={{ left: `${pct}%` }}
          />
        ))}
        {/* Subtle top-edge highlight for a slight sense of depth */}
        <div className="absolute inset-0 bg-gradient-to-b from-white/8 to-transparent pointer-events-none" />
      </div>

      <div className="flex items-center justify-between mb-4">
        <span className="text-sm text-foreground">
          {formatHours(totalSecs)}h{" "}
          <span className="text-muted">/ {weeklyGoalHours}h</span>
        </span>
        <span className="text-sm font-medium text-foreground-secondary">
          {Math.round(weeklyProgress * 100)}%
        </span>
      </div>

      <div className="p-3 bg-surface-hover rounded-lg">
        <p className="text-sm text-foreground-secondary leading-relaxed">{motivation}</p>
      </div>
    </div>
  );
}

function calculateStreak(sessions: { date: string; duration: number }[]): number {
  if (sessions.length === 0) return 0;

  const sorted = [...sessions].sort((a, b) => b.date.localeCompare(a.date));
  let streak = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = 0; i < 365; i++) {
    const checkDate = new Date(today);
    checkDate.setDate(checkDate.getDate() - i);
    const dateStr = checkDate.toISOString().split("T")[0];
    const found = sorted.find((s) => s.date === dateStr && s.duration > 0);
    if (found) {
      streak++;
    } else if (i === 0) {
      // Today doesn't count if no sessions yet
      continue;
    } else {
      break;
    }
  }
  return streak;
}
