import { useState, useEffect, useRef } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Rss,
  Trash2,
  CalendarDays,
  LayoutGrid,
  Rows3,
  AlertCircle,
  Lock,
} from "lucide-react";
import {
  format,
  addMonths,
  subMonths,
  addWeeks,
  subWeeks,
  addDays,
  subDays,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isToday,
  parseISO,
  getISOWeek,
} from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import { useShallow } from "zustand/react/shallow";
import { useStore, type CalendarEvent, type CalendarView } from "../../store/useStore";
import EventModal from "./EventModal";
import IcalModal from "./IcalModal";

function eventsOnDay(events: CalendarEvent[], day: Date): CalendarEvent[] {
  return events.filter((e) => {
    const s = parseISO(e.start);
    const en = parseISO(e.end);
    return day >= new Date(s.setHours(0,0,0,0)) && day <= new Date(en.setHours(23,59,59,999));
  });
}

function useNow(intervalMs = 60_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

const VIEW_LABELS: Record<CalendarView, string> = {
  month: "Month",
  week: "Week",
  day: "Day",
};

export default function CalendarModule() {
  const {
    calendarEvents,
    calendarView,
    calendarDate,
    setCalendarView,
    setCalendarDate,
    clearAllCalendarEvents,
    weekStartsOn,
    showWeekNumbers,
    autoSyncDeadlines,
    syncDeadlineTasks,
  } = useStore(
    useShallow((s) => ({
      calendarEvents: s.calendarEvents,
      calendarView: s.calendarView,
      calendarDate: s.calendarDate,
      setCalendarView: s.setCalendarView,
      setCalendarDate: s.setCalendarDate,
      clearAllCalendarEvents: s.clearAllCalendarEvents,
      weekStartsOn: s.weekStartsOn,
      showWeekNumbers: s.showWeekNumbers,
      autoSyncDeadlines: s.autoSyncDeadlines,
      syncDeadlineTasks: s.syncDeadlineTasks,
    }))
  );

  // Auto-sync deadlines to tasks whenever events change
  useEffect(() => {
    if (autoSyncDeadlines) syncDeadlineTasks();
  }, [calendarEvents, autoSyncDeadlines, syncDeadlineTasks]);

  const currentDate = parseISO(calendarDate);
  const [eventModal, setEventModal] = useState<{
    open: boolean;
    event?: CalendarEvent;
    date?: Date;
    endDate?: Date;
  }>({ open: false });
  const [icalModal, setIcalModal] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  function navigate(dir: "prev" | "next") {
    let next: Date;
    if (calendarView === "month") {
      next = dir === "prev" ? subMonths(currentDate, 1) : addMonths(currentDate, 1);
    } else if (calendarView === "week") {
      next = dir === "prev" ? subWeeks(currentDate, 1) : addWeeks(currentDate, 1);
    } else {
      next = dir === "prev" ? subDays(currentDate, 1) : addDays(currentDate, 1);
    }
    setCalendarDate(next.toISOString());
  }

  function navLabel(): string {
    if (calendarView === "month") return format(currentDate, "MMMM yyyy");
    if (calendarView === "week") {
      const wStart = startOfWeek(currentDate, { weekStartsOn });
      const wEnd = endOfWeek(currentDate, { weekStartsOn });
      return `${format(wStart, "MMM d")} – ${format(wEnd, "MMM d, yyyy")}`;
    }
    return format(currentDate, "EEEE, MMMM d, yyyy");
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <button
              onClick={() => navigate("prev")}
              className="flex items-center justify-center w-7 h-7 rounded-lg
                         text-muted hover:text-foreground hover:bg-surface-hover transition-all duration-150"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => navigate("next")}
              className="flex items-center justify-center w-7 h-7 rounded-lg
                         text-muted hover:text-foreground hover:bg-surface-hover transition-all duration-150"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          <h1 className="text-sm font-semibold text-foreground min-w-[200px]">{navLabel()}</h1>
          <button
            onClick={() => setCalendarDate(new Date().toISOString())}
            className="btn-ghost text-xs"
          >
            Today
          </button>
        </div>

        <div className="flex items-center gap-2">
          {/* View switcher */}
          <div className="flex items-center gap-0.5 bg-surface-elevated border border-border rounded-lg p-0.5">
            {(["month", "week", "day"] as CalendarView[]).map((v) => {
              const Icon = v === "month" ? LayoutGrid : v === "week" ? Rows3 : CalendarDays;
              return (
                <button
                  key={v}
                  onClick={() => setCalendarView(v)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium
                               transition-all duration-150
                               ${calendarView === v
                                 ? "bg-foreground text-surface"
                                 : "text-muted hover:text-foreground-secondary"
                               }`}
                >
                  <Icon className="w-3 h-3" />
                  {VIEW_LABELS[v]}
                </button>
              );
            })}
          </div>

          <button
            onClick={() => setIcalModal(true)}
            className="btn-ghost flex items-center gap-1.5"
          >
            <Rss className="w-3.5 h-3.5" />
            Feeds
          </button>

          {calendarEvents.length > 0 && (
            confirmClear ? (
              <div className="flex items-center gap-1 text-xs">
                <span className="text-muted mr-0.5">Remove all?</span>
                <button
                  onClick={() => { clearAllCalendarEvents(); setConfirmClear(false); }}
                  className="px-2 py-1 rounded-md text-red-400 hover:bg-red-950/40
                             transition-all duration-150 font-medium"
                >
                  Remove
                </button>
                <button
                  onClick={() => setConfirmClear(false)}
                  className="px-2 py-1 rounded-md text-muted hover:text-foreground-secondary
                             hover:bg-surface-hover transition-all duration-150"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmClear(true)}
                className="btn-ghost flex items-center gap-1.5 text-muted hover:text-red-400"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Clear all
              </button>
            )
          )}

          <button
            onClick={() => setEventModal({ open: true, date: currentDate })}
            className="btn-primary flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            New event
          </button>
        </div>
      </header>

      {/* Calendar grid */}
      <div className="flex-1 overflow-hidden">
        {calendarView === "month" && (
          <MonthView
            currentDate={currentDate}
            events={calendarEvents}
            weekStartsOn={weekStartsOn}
            showWeekNumbers={showWeekNumbers}
            onDayClick={(day) => setEventModal({ open: true, date: day })}
            onEventClick={(event) => setEventModal({ open: true, event })}
          />
        )}
        {calendarView === "week" && (
          <WeekView
            currentDate={currentDate}
            events={calendarEvents}
            weekStartsOn={weekStartsOn}
            onSlotClick={(date) => setEventModal({ open: true, date })}
            onSlotDragCreate={(start, end) => setEventModal({ open: true, date: start, endDate: end })}
            onEventClick={(event) => setEventModal({ open: true, event })}
          />
        )}
        {calendarView === "day" && (
          <DayView
            currentDate={currentDate}
            events={calendarEvents}
            onSlotClick={(date) => setEventModal({ open: true, date })}
            onSlotDragCreate={(start, end) => setEventModal({ open: true, date: start, endDate: end })}
            onEventClick={(event) => setEventModal({ open: true, event })}
          />
        )}
      </div>

      {/* Modals */}
      <AnimatePresence>
        {eventModal.open && (
          <EventModal
            event={eventModal.event}
            defaultDate={eventModal.date}
            defaultEndDate={eventModal.endDate}
            onClose={() => setEventModal({ open: false })}
          />
        )}
        {icalModal && <IcalModal onClose={() => setIcalModal(false)} />}
      </AnimatePresence>
    </div>
  );
}

// ─── Now Indicator (single column - used in DayView) ────────────────────────

function NowLineSingle({ hourHeight }: { hourHeight: number }) {
  const now = useNow();
  const top = (now.getHours() + now.getMinutes() / 60) * hourHeight;

  return (
    <div className="absolute left-0 right-0 z-20 pointer-events-none" style={{ top }}>
      <div className="flex items-center">
        <div className="w-2 h-2 rounded-full bg-red-500 -ml-1 flex-shrink-0 shadow-[0_0_6px_rgba(239,68,68,0.6)]" />
        <div className="flex-1 h-[2px] bg-red-500" />
      </div>
    </div>
  );
}

// ─── Now Indicator (entire week — stretches across all days) ────────────────

function NowLineWeek({ hourHeight, todayIndex }: { hourHeight: number; todayIndex: number }) {
  const now = useNow();
  const top = (now.getHours() + now.getMinutes() / 60) * hourHeight;

  return (
    <div className="absolute left-0 right-0 z-20 pointer-events-none" style={{ top }}>
      <div className="flex items-center w-full relative">
        {/* Dot positioned at today's column */}
        {todayIndex >= 0 && (
          <div
            className="absolute w-2.5 h-2.5 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.7)]"
            style={{
              left: `calc(${(todayIndex / 7) * 100}% - 5px)`,
              top: -4,
            }}
          />
        )}
        {/* Line spans the whole week */}
        <div className="flex-1 h-[2px] bg-red-500/80 shadow-[0_0_3px_rgba(239,68,68,0.5)]" />
      </div>
    </div>
  );
}

// ─── Month View ──────────────────────────────────────────────────────────────

interface MonthViewProps {
  currentDate: Date;
  events: CalendarEvent[];
  weekStartsOn: 0 | 1;
  showWeekNumbers: boolean;
  onDayClick: (day: Date) => void;
  onEventClick: (event: CalendarEvent) => void;
}

function MonthView({ currentDate, events, weekStartsOn, showWeekNumbers, onDayClick, onEventClick }: MonthViewProps) {
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const gridStart = startOfWeek(monthStart, { weekStartsOn });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  const DAY_NAMES_MON = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const DAY_NAMES_SUN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dayNames = weekStartsOn === 1 ? DAY_NAMES_MON : DAY_NAMES_SUN;

  // Build week rows for the week-number column
  const weekRows: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) {
    weekRows.push(days.slice(i, i + 7));
  }

  return (
    <div className="flex flex-col h-full">
      <div className="grid border-b border-border" style={{
        gridTemplateColumns: showWeekNumbers ? "40px repeat(7, 1fr)" : "repeat(7, 1fr)",
      }}>
        {showWeekNumbers && (
          <div className="py-2 text-center text-xs font-medium text-muted tracking-wider">W</div>
        )}
        {dayNames.map((d) => (
          <div
            key={d}
            className="py-2 text-center text-xs font-medium text-muted tracking-wider"
          >
            {d}
          </div>
        ))}
      </div>

      <div className="flex-1 grid grid-rows-6 overflow-hidden" style={{
        gridTemplateColumns: showWeekNumbers ? "40px repeat(7, 1fr)" : "repeat(7, 1fr)",
      }}>
        {weekRows.map((row, rowIdx) => (
          <div key={rowIdx} className="contents">
            {showWeekNumbers && (
              <div className="flex items-start justify-center pt-2 border-b border-r border-grid text-xs text-muted font-mono">
                {getISOWeek(row[0])}
              </div>
            )}
            {row.map((day, i) => {
              const dayEvents = eventsOnDay(events, day);
              const inMonth = isSameMonth(day, currentDate);
              const today = isToday(day);

              return (
                <motion.div
                  key={`${rowIdx}-${i}`}
                  whileHover={{ backgroundColor: "var(--color-surface-hover)" }}
                  onClick={() => onDayClick(day)}
                  className={`
                    relative flex flex-col p-2 border-b border-r border-grid
                    cursor-pointer overflow-hidden
                    ${!inMonth ? "opacity-30" : ""}
                  `}
                >
                  <span
                    className={`
                      self-start flex items-center justify-center w-6 h-6 rounded-full
                      text-xs font-medium mb-1 transition-colors
                      ${today
                        ? "bg-foreground text-surface"
                        : "text-foreground-secondary hover:text-foreground"
                      }
                    `}
                  >
                    {format(day, "d")}
                  </span>

                  <div className="flex flex-col gap-0.5">
                    {dayEvents.slice(0, 3).map((event) => (
                      <button
                        key={event.id}
                        onClick={(e) => { e.stopPropagation(); onEventClick(event); }}
                        className="w-full text-left px-1.5 py-0.5 rounded text-xs
                                   text-zinc-200 truncate hover:brightness-110 transition-all
                                   flex items-center gap-1"
                        style={{ backgroundColor: event.color ?? "rgba(128,128,128,0.3)" }}
                        title={event.source === "ical" ? "iCal (read-only)" : event.title}
                      >
                        {event.isDeadline && <AlertCircle className="w-2.5 h-2.5 flex-shrink-0" />}
                        {event.source === "ical" && <Lock className="w-2.5 h-2.5 flex-shrink-0 opacity-60" />}
                        <span className="truncate">{event.title}</span>
                      </button>
                    ))}
                    {dayEvents.length > 3 && (
                      <span className="text-xs text-muted px-1">
                        +{dayEvents.length - 3} more
                      </span>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Week View ───────────────────────────────────────────────────────────────

interface WeekViewProps {
  currentDate: Date;
  events: CalendarEvent[];
  weekStartsOn: 0 | 1;
  onSlotClick: (date: Date) => void;
  onSlotDragCreate: (start: Date, end: Date) => void;
  onEventClick: (event: CalendarEvent) => void;
}

const HOUR_HEIGHT_WEEK = 48;

function WeekView({ currentDate, events, weekStartsOn, onSlotClick, onSlotDragCreate, onEventClick }: WeekViewProps) {
  const weekStart = startOfWeek(currentDate, { weekStartsOn });
  const days = eachDayOfInterval({ start: weekStart, end: addDays(weekStart, 6) });
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridContainerRef = useRef<HTMLDivElement>(null);

  const todayIndex = days.findIndex((d) => isToday(d));

  // Drag-to-create state
  const [dragSel, setDragSel] = useState<{ dayIndex: number; startMin: number; endMin: number } | null>(null);
  const dragRef = useRef<{ dayIndex: number; startMin: number } | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      const currentHour = new Date().getHours();
      scrollRef.current.scrollTop = Math.max(0, (currentHour - 2) * HOUR_HEIGHT_WEEK);
    }
  }, []);

  function minutesFromY(y: number): number {
    // Snap to 15-minute increments
    const raw = (y / HOUR_HEIGHT_WEEK) * 60;
    return Math.max(0, Math.min(24 * 60 - 15, Math.round(raw / 15) * 15));
  }

  function handleColumnPointerDown(e: React.PointerEvent, dayIndex: number) {
    if ((e.target as HTMLElement).closest("[data-event]")) return;
    const col = e.currentTarget as HTMLElement;
    col.setPointerCapture(e.pointerId);
    const rect = col.getBoundingClientRect();
    const startMin = minutesFromY(e.clientY - rect.top);
    dragRef.current = { dayIndex, startMin };
    // No selection on click — only after drag passes threshold
    setDragSel(null);
  }

  function handleColumnPointerMove(e: React.PointerEvent, dayIndex: number) {
    if (!dragRef.current || dragRef.current.dayIndex !== dayIndex) return;
    const col = e.currentTarget as HTMLElement;
    const rect = col.getBoundingClientRect();
    const curMin = minutesFromY(e.clientY - rect.top);
    if (Math.abs(curMin - dragRef.current.startMin) < 15) return; // threshold
    const start = Math.min(dragRef.current.startMin, curMin);
    const end = Math.max(dragRef.current.startMin, curMin);
    setDragSel({ dayIndex, startMin: start, endMin: Math.max(start + 15, end) });
  }

  function handleColumnPointerUp(e: React.PointerEvent, dayIndex: number) {
    if (!dragRef.current || dragRef.current.dayIndex !== dayIndex) {
      dragRef.current = null;
      setDragSel(null);
      return;
    }
    const col = e.currentTarget as HTMLElement;
    const rect = col.getBoundingClientRect();
    const endMin = minutesFromY(e.clientY - rect.top);
    const startMin = dragRef.current.startMin;
    dragRef.current = null;

    const day = days[dayIndex];
    if (Math.abs(endMin - startMin) < 15) {
      // Click — open at clicked time
      const d = new Date(day);
      d.setHours(Math.floor(startMin / 60), startMin % 60, 0, 0);
      onSlotClick(d);
    } else {
      // Drag-create
      const sMin = Math.min(startMin, endMin);
      const eMin = Math.max(startMin, endMin);
      const s = new Date(day);
      s.setHours(Math.floor(sMin / 60), sMin % 60, 0, 0);
      const en = new Date(day);
      en.setHours(Math.floor(eMin / 60), eMin % 60, 0, 0);
      onSlotDragCreate(s, en);
    }
    setDragSel(null);
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex border-b border-border flex-shrink-0">
        <div className="w-14 flex-shrink-0" />
        {days.map((day) => (
          <div
            key={day.toISOString()}
            className="flex-1 py-2.5 text-center border-l border-grid"
          >
            <div className="text-xs font-medium text-muted uppercase tracking-wider">
              {format(day, "EEE")}
            </div>
            <div className={`text-lg font-semibold mt-0.5 ${isToday(day) ? "text-foreground" : "text-foreground-secondary"}`}>
              {format(day, "d")}
            </div>
          </div>
        ))}
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="flex relative" ref={gridContainerRef}>
          <div className="w-14 flex-shrink-0">
            {hours.map((h) => (
              <div key={h} className="h-12 flex items-start justify-end pr-2 pt-0.5">
                <span className="text-xs text-muted font-mono">
                  {h === 0 ? "" : `${String(h).padStart(2, "0")}:00`}
                </span>
              </div>
            ))}
          </div>

          {/* Day columns — wrapped together so the now-line can stretch across them */}
          <div className="flex-1 flex relative">
            {days.map((day, dayIndex) => {
              const dayEvents = eventsOnDay(events, day);
              return (
                <div
                  key={day.toISOString()}
                  className="flex-1 relative border-l border-grid touch-none select-none"
                  onPointerDown={(e) => handleColumnPointerDown(e, dayIndex)}
                  onPointerMove={(e) => handleColumnPointerMove(e, dayIndex)}
                  onPointerUp={(e) => handleColumnPointerUp(e, dayIndex)}
                  onPointerCancel={() => { dragRef.current = null; setDragSel(null); }}
                >
                  {hours.map((h) => (
                    <div
                      key={h}
                      className="h-12 border-b border-grid hover:bg-surface-hover transition-colors"
                    />
                  ))}
                  {dayEvents.map((event) => {
                    const start = parseISO(event.start);
                    const end = parseISO(event.end);
                    const top = (start.getHours() + start.getMinutes() / 60) * HOUR_HEIGHT_WEEK;
                    const height = Math.max(
                      ((end.getTime() - start.getTime()) / 3600000) * HOUR_HEIGHT_WEEK,
                      24
                    );
                    return (
                      <button
                        key={event.id}
                        data-event
                        onClick={(e) => { e.stopPropagation(); onEventClick(event); }}
                        className="absolute left-0.5 right-0.5 rounded-md px-1.5 py-0.5 text-left
                                   text-xs text-zinc-100 hover:brightness-110 transition-all overflow-hidden z-10
                                   flex items-start gap-1"
                        style={{
                          top,
                          height,
                          backgroundColor: event.color ?? "rgba(128,128,128,0.3)",
                        }}
                        title={event.source === "ical" ? `${event.title} (iCal — read-only)` : event.title}
                      >
                        {event.isDeadline && <AlertCircle className="w-3 h-3 flex-shrink-0 mt-0.5" />}
                        {event.source === "ical" && <Lock className="w-3 h-3 flex-shrink-0 mt-0.5 opacity-60" />}
                        <span className="font-medium truncate flex-1">{event.title}</span>
                      </button>
                    );
                  })}
                  {/* Drag selection preview */}
                  {dragSel && dragSel.dayIndex === dayIndex && (
                    <div
                      className="absolute left-0.5 right-0.5 rounded-md bg-accent/30 border border-accent z-15 pointer-events-none"
                      style={{
                        top: (dragSel.startMin / 60) * HOUR_HEIGHT_WEEK,
                        height: ((dragSel.endMin - dragSel.startMin) / 60) * HOUR_HEIGHT_WEEK,
                      }}
                    >
                      <div className="px-1.5 py-0.5 text-xs text-foreground font-medium">
                        {String(Math.floor(dragSel.startMin / 60)).padStart(2, "0")}:{String(dragSel.startMin % 60).padStart(2, "0")} – {String(Math.floor(dragSel.endMin / 60)).padStart(2, "0")}:{String(dragSel.endMin % 60).padStart(2, "0")}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Now-line — spans the whole week */}
            <NowLineWeek hourHeight={HOUR_HEIGHT_WEEK} todayIndex={todayIndex} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Day View ────────────────────────────────────────────────────────────────

interface DayViewProps {
  currentDate: Date;
  events: CalendarEvent[];
  onSlotClick: (date: Date) => void;
  onSlotDragCreate: (start: Date, end: Date) => void;
  onEventClick: (event: CalendarEvent) => void;
}

const HOUR_HEIGHT_DAY = 64;

function DayView({ currentDate, events, onSlotClick, onSlotDragCreate, onEventClick }: DayViewProps) {
  const dayEvents = eventsOnDay(events, currentDate);
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const showNow = isToday(currentDate);
  const scrollRef = useRef<HTMLDivElement>(null);

  const [dragSel, setDragSel] = useState<{ startMin: number; endMin: number } | null>(null);
  const dragRef = useRef<{ startMin: number } | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      const currentHour = new Date().getHours();
      scrollRef.current.scrollTop = Math.max(0, (currentHour - 2) * HOUR_HEIGHT_DAY);
    }
  }, []);

  function minutesFromY(y: number): number {
    const raw = (y / HOUR_HEIGHT_DAY) * 60;
    return Math.max(0, Math.min(24 * 60 - 15, Math.round(raw / 15) * 15));
  }

  function handlePointerDown(e: React.PointerEvent) {
    if ((e.target as HTMLElement).closest("[data-event]")) return;
    const col = e.currentTarget as HTMLElement;
    col.setPointerCapture(e.pointerId);
    const rect = col.getBoundingClientRect();
    const startMin = minutesFromY(e.clientY - rect.top + col.scrollTop);
    dragRef.current = { startMin };
    setDragSel(null);
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!dragRef.current) return;
    const col = e.currentTarget as HTMLElement;
    const rect = col.getBoundingClientRect();
    const curMin = minutesFromY(e.clientY - rect.top + col.scrollTop);
    if (Math.abs(curMin - dragRef.current.startMin) < 15) return;
    const start = Math.min(dragRef.current.startMin, curMin);
    const end = Math.max(dragRef.current.startMin, curMin);
    setDragSel({ startMin: start, endMin: Math.max(start + 15, end) });
  }

  function handlePointerUp(e: React.PointerEvent) {
    if (!dragRef.current) return;
    const col = e.currentTarget as HTMLElement;
    const rect = col.getBoundingClientRect();
    const endMin = minutesFromY(e.clientY - rect.top + col.scrollTop);
    const startMin = dragRef.current.startMin;
    dragRef.current = null;

    if (Math.abs(endMin - startMin) < 15) {
      const d = new Date(currentDate);
      d.setHours(Math.floor(startMin / 60), startMin % 60, 0, 0);
      onSlotClick(d);
    } else {
      const sMin = Math.min(startMin, endMin);
      const eMin = Math.max(startMin, endMin);
      const s = new Date(currentDate);
      s.setHours(Math.floor(sMin / 60), sMin % 60, 0, 0);
      const en = new Date(currentDate);
      en.setHours(Math.floor(eMin / 60), eMin % 60, 0, 0);
      onSlotDragCreate(s, en);
    }
    setDragSel(null);
  }

  return (
    <div className="flex h-full overflow-hidden">
      <div className="w-20 flex-shrink-0 overflow-y-auto border-r border-grid">
        {hours.map((h) => (
          <div key={h} className="h-16 flex items-start justify-end pr-3 pt-1">
            <span className="text-xs text-muted font-mono">
              {h === 0 ? "" : `${String(h).padStart(2, "0")}:00`}
            </span>
          </div>
        ))}
      </div>

      <div
        ref={scrollRef}
        className="flex-1 relative overflow-y-auto touch-none select-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => { dragRef.current = null; setDragSel(null); }}
      >
        {hours.map((h) => (
          <div key={h} className="h-16 border-b border-grid hover:bg-surface-hover transition-colors" />
        ))}
        {showNow && <NowLineSingle hourHeight={HOUR_HEIGHT_DAY} />}
        {dayEvents.map((event) => {
          const start = parseISO(event.start);
          const end = parseISO(event.end);
          const top = (start.getHours() + start.getMinutes() / 60) * HOUR_HEIGHT_DAY;
          const height = Math.max(
            ((end.getTime() - start.getTime()) / 3600000) * HOUR_HEIGHT_DAY,
            32
          );
          return (
            <button
              key={event.id}
              data-event
              onClick={(e) => { e.stopPropagation(); onEventClick(event); }}
              className="absolute left-2 right-2 rounded-lg px-3 py-1.5 text-left
                         hover:brightness-110 transition-all overflow-hidden z-10"
              style={{
                top,
                height,
                backgroundColor: event.color ?? "rgba(128,128,128,0.3)",
              }}
              title={event.source === "ical" ? `${event.title} (iCal — read-only)` : event.title}
            >
              <div className="text-sm font-medium text-zinc-100 truncate flex items-center gap-1.5">
                {event.isDeadline && <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />}
                {event.source === "ical" && <Lock className="w-3.5 h-3.5 flex-shrink-0 opacity-60" />}
                <span className="truncate">{event.title}</span>
              </div>
              <div className="text-xs text-zinc-300/70">
                {format(start, "HH:mm")} – {format(end, "HH:mm")}
              </div>
            </button>
          );
        })}
        {/* Drag selection preview */}
        {dragSel && (
          <div
            className="absolute left-2 right-2 rounded-lg bg-accent/30 border border-accent z-15 pointer-events-none"
            style={{
              top: (dragSel.startMin / 60) * HOUR_HEIGHT_DAY,
              height: ((dragSel.endMin - dragSel.startMin) / 60) * HOUR_HEIGHT_DAY,
            }}
          >
            <div className="px-3 py-1 text-xs text-foreground font-medium">
              {String(Math.floor(dragSel.startMin / 60)).padStart(2, "0")}:{String(dragSel.startMin % 60).padStart(2, "0")} – {String(Math.floor(dragSel.endMin / 60)).padStart(2, "0")}:{String(dragSel.endMin % 60).padStart(2, "0")}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
