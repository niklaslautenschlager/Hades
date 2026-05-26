import { useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Rss,
  Trash2,
  CalendarDays,
  LayoutGrid,
  Rows3,
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
  isSameDay,
  isToday,
  parseISO,
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

const VIEW_LABELS: Record<CalendarView, string> = {
  month: "Month",
  week: "Week",
  day: "Day",
};

export default function CalendarModule() {
  const { calendarEvents, calendarView, calendarDate, setCalendarView, setCalendarDate, clearAllCalendarEvents } = useStore(
    useShallow((s) => ({
      calendarEvents: s.calendarEvents,
      calendarView: s.calendarView,
      calendarDate: s.calendarDate,
      setCalendarView: s.setCalendarView,
      setCalendarDate: s.setCalendarDate,
      clearAllCalendarEvents: s.clearAllCalendarEvents,
    }))
  );

  const currentDate = parseISO(calendarDate);
  const [eventModal, setEventModal] = useState<{
    open: boolean;
    event?: CalendarEvent;
    date?: Date;
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
      const wStart = startOfWeek(currentDate, { weekStartsOn: 1 });
      const wEnd = endOfWeek(currentDate, { weekStartsOn: 1 });
      return `${format(wStart, "MMM d")} – ${format(wEnd, "MMM d, yyyy")}`;
    }
    return format(currentDate, "EEEE, MMMM d, yyyy");
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/50 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <button
              onClick={() => navigate("prev")}
              className="flex items-center justify-center w-7 h-7 rounded-lg
                         text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/60 transition-all duration-150"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => navigate("next")}
              className="flex items-center justify-center w-7 h-7 rounded-lg
                         text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/60 transition-all duration-150"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          <h1 className="text-sm font-semibold text-zinc-100 min-w-[200px]">{navLabel()}</h1>
          <button
            onClick={() => setCalendarDate(new Date().toISOString())}
            className="btn-ghost text-xs"
          >
            Today
          </button>
        </div>

        <div className="flex items-center gap-2">
          {/* View switcher */}
          <div className="flex items-center gap-0.5 bg-zinc-900 border border-zinc-800/60 rounded-lg p-0.5">
            {(["month", "week", "day"] as CalendarView[]).map((v) => {
              const Icon = v === "month" ? LayoutGrid : v === "week" ? Rows3 : CalendarDays;
              return (
                <button
                  key={v}
                  onClick={() => setCalendarView(v)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium
                               transition-all duration-150
                               ${calendarView === v
                                 ? "bg-zinc-100 text-zinc-950"
                                 : "text-zinc-500 hover:text-zinc-300"
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

          {/* Clear all with inline confirmation */}
          {calendarEvents.length > 0 && (
            confirmClear ? (
              <div className="flex items-center gap-1 text-xs">
                <span className="text-zinc-500 mr-0.5">Remove all?</span>
                <button
                  onClick={() => { clearAllCalendarEvents(); setConfirmClear(false); }}
                  className="px-2 py-1 rounded-md text-red-400 hover:bg-red-950/40
                             transition-all duration-150 font-medium"
                >
                  Remove
                </button>
                <button
                  onClick={() => setConfirmClear(false)}
                  className="px-2 py-1 rounded-md text-zinc-500 hover:text-zinc-300
                             hover:bg-zinc-800/60 transition-all duration-150"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmClear(true)}
                className="btn-ghost flex items-center gap-1.5 text-zinc-600 hover:text-red-400"
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
            onDayClick={(day) => setEventModal({ open: true, date: day })}
            onEventClick={(event) => setEventModal({ open: true, event })}
          />
        )}
        {calendarView === "week" && (
          <WeekView
            currentDate={currentDate}
            events={calendarEvents}
            onSlotClick={(date) => setEventModal({ open: true, date })}
            onEventClick={(event) => setEventModal({ open: true, event })}
          />
        )}
        {calendarView === "day" && (
          <DayView
            currentDate={currentDate}
            events={calendarEvents}
            onSlotClick={(date) => setEventModal({ open: true, date })}
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
            onClose={() => setEventModal({ open: false })}
          />
        )}
        {icalModal && <IcalModal onClose={() => setIcalModal(false)} />}
      </AnimatePresence>
    </div>
  );
}

// ─── Month View ──────────────────────────────────────────────────────────────

interface MonthViewProps {
  currentDate: Date;
  events: CalendarEvent[];
  onDayClick: (day: Date) => void;
  onEventClick: (event: CalendarEvent) => void;
}

function MonthView({ currentDate, events, onDayClick, onEventClick }: MonthViewProps) {
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  return (
    <div className="flex flex-col h-full">
      {/* Day headers */}
      <div className="grid grid-cols-7 border-b border-zinc-800/50">
        {DAY_NAMES.map((d) => (
          <div
            key={d}
            className="py-2 text-center text-xs font-medium text-zinc-500 tracking-wider"
          >
            {d}
          </div>
        ))}
      </div>

      {/* Grid */}
      <div className="flex-1 grid grid-cols-7 grid-rows-6 overflow-hidden">
        {days.map((day, i) => {
          const dayEvents = eventsOnDay(events, day);
          const inMonth = isSameMonth(day, currentDate);
          const today = isToday(day);

          return (
            <motion.div
              key={i}
              whileHover={{ backgroundColor: "rgba(255,255,255,0.015)" }}
              onClick={() => onDayClick(day)}
              className={`
                relative flex flex-col p-2 border-b border-r border-zinc-800/30
                cursor-pointer overflow-hidden
                ${!inMonth ? "opacity-30" : ""}
              `}
            >
              {/* Day number */}
              <span
                className={`
                  self-start flex items-center justify-center w-6 h-6 rounded-full
                  text-xs font-medium mb-1 transition-colors
                  ${today
                    ? "bg-zinc-100 text-zinc-950"
                    : "text-zinc-400 hover:text-zinc-200"
                  }
                `}
              >
                {format(day, "d")}
              </span>

              {/* Events */}
              <div className="flex flex-col gap-0.5">
                {dayEvents.slice(0, 3).map((event) => (
                  <button
                    key={event.id}
                    onClick={(e) => { e.stopPropagation(); onEventClick(event); }}
                    className="w-full text-left px-1.5 py-0.5 rounded text-xs
                               text-zinc-200 truncate hover:brightness-110 transition-all"
                    style={{ backgroundColor: event.color ?? "rgba(255,255,255,0.1)" }}
                  >
                    {event.title}
                  </button>
                ))}
                {dayEvents.length > 3 && (
                  <span className="text-xs text-zinc-500 px-1">
                    +{dayEvents.length - 3} more
                  </span>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Week View ───────────────────────────────────────────────────────────────

interface WeekViewProps {
  currentDate: Date;
  events: CalendarEvent[];
  onSlotClick: (date: Date) => void;
  onEventClick: (event: CalendarEvent) => void;
}

function WeekView({ currentDate, events, onSlotClick, onEventClick }: WeekViewProps) {
  const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: weekStart, end: addDays(weekStart, 6) });
  const hours = Array.from({ length: 24 }, (_, i) => i);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Day headers */}
      <div className="flex border-b border-zinc-800/50 flex-shrink-0">
        <div className="w-14 flex-shrink-0" />
        {days.map((day) => (
          <div
            key={day.toISOString()}
            className="flex-1 py-2.5 text-center border-l border-zinc-800/30"
          >
            <div className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
              {format(day, "EEE")}
            </div>
            <div className={`text-lg font-semibold mt-0.5 ${isToday(day) ? "text-zinc-100" : "text-zinc-400"}`}>
              {format(day, "d")}
            </div>
          </div>
        ))}
      </div>

      {/* Time grid */}
      <div className="flex-1 overflow-y-auto">
        <div className="flex">
          {/* Hours column */}
          <div className="w-14 flex-shrink-0">
            {hours.map((h) => (
              <div key={h} className="h-12 flex items-start justify-end pr-2 pt-0.5">
                <span className="text-xs text-zinc-600 font-mono">
                  {h === 0 ? "" : `${String(h).padStart(2, "0")}:00`}
                </span>
              </div>
            ))}
          </div>

          {/* Day columns */}
          {days.map((day) => {
            const dayEvents = eventsOnDay(events, day);
            return (
              <div key={day.toISOString()} className="flex-1 relative border-l border-zinc-800/30">
                {hours.map((h) => (
                  <div
                    key={h}
                    onClick={() => {
                      const d = new Date(day);
                      d.setHours(h, 0, 0, 0);
                      onSlotClick(d);
                    }}
                    className="h-12 border-b border-zinc-800/20 hover:bg-zinc-800/20 cursor-pointer transition-colors"
                  />
                ))}
                {dayEvents.map((event) => {
                  const start = parseISO(event.start);
                  const end = parseISO(event.end);
                  const top = (start.getHours() + start.getMinutes() / 60) * 48;
                  const height = Math.max(
                    ((end.getTime() - start.getTime()) / 3600000) * 48,
                    24
                  );
                  return (
                    <button
                      key={event.id}
                      onClick={() => onEventClick(event)}
                      className="absolute left-0.5 right-0.5 rounded-md px-1.5 py-0.5 text-left
                                 text-xs text-zinc-100 hover:brightness-110 transition-all overflow-hidden"
                      style={{
                        top,
                        height,
                        backgroundColor: event.color ?? "rgba(255,255,255,0.15)",
                      }}
                    >
                      <span className="font-medium truncate">{event.title}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
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
  onEventClick: (event: CalendarEvent) => void;
}

function DayView({ currentDate, events, onSlotClick, onEventClick }: DayViewProps) {
  const dayEvents = eventsOnDay(events, currentDate);
  const hours = Array.from({ length: 24 }, (_, i) => i);

  return (
    <div className="flex h-full overflow-hidden">
      {/* Time column */}
      <div className="w-20 flex-shrink-0 overflow-y-auto border-r border-zinc-800/50">
        {hours.map((h) => (
          <div key={h} className="h-16 flex items-start justify-end pr-3 pt-1">
            <span className="text-xs text-zinc-600 font-mono">
              {h === 0 ? "" : `${String(h).padStart(2, "0")}:00`}
            </span>
          </div>
        ))}
      </div>

      {/* Event column */}
      <div className="flex-1 relative overflow-y-auto">
        {hours.map((h) => (
          <div
            key={h}
            onClick={() => {
              const d = new Date(currentDate);
              d.setHours(h, 0, 0, 0);
              onSlotClick(d);
            }}
            className="h-16 border-b border-zinc-800/20 hover:bg-zinc-800/15 cursor-pointer transition-colors"
          />
        ))}
        {dayEvents.map((event) => {
          const start = parseISO(event.start);
          const end = parseISO(event.end);
          const top = (start.getHours() + start.getMinutes() / 60) * 64;
          const height = Math.max(
            ((end.getTime() - start.getTime()) / 3600000) * 64,
            32
          );
          return (
            <button
              key={event.id}
              onClick={() => onEventClick(event)}
              className="absolute left-2 right-2 rounded-lg px-3 py-1.5 text-left
                         hover:brightness-110 transition-all overflow-hidden"
              style={{
                top,
                height,
                backgroundColor: event.color ?? "rgba(255,255,255,0.15)",
              }}
            >
              <div className="text-sm font-medium text-zinc-100 truncate">{event.title}</div>
              <div className="text-xs text-zinc-300/70">
                {format(start, "HH:mm")} – {format(end, "HH:mm")}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
