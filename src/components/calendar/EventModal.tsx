import { useState, useRef } from "react";
import { X, Trash2, ChevronUp, ChevronDown, Repeat, AlertCircle, Lock, Plus } from "lucide-react";
import { motion } from "framer-motion";
import { format, parseISO, addHours, addDays, addWeeks, addMonths } from "date-fns";
import { useShallow } from "zustand/react/shallow";
import { useStore, type CalendarEvent, type RecurrenceRule } from "../../store/useStore";
import Dropdown from "../ui/Dropdown";

interface Props {
  event?: CalendarEvent;
  defaultDate?: Date;
  defaultEndDate?: Date;
  onClose: () => void;
}

// Original base palette shown by default; the rest expand downward on demand.
const BASE_COLORS = ["#3f3f46", "#6b7280", "#9ca3af", "#d1d5db", "#374151", "#1f2937"];
const MORE_COLORS = [
  "#ef4444", "#f97316", "#f59e0b", "#eab308",
  "#22c55e", "#10b981", "#14b8a6", "#06b6d4",
  "#3b82f6", "#6366f1", "#8b5cf6", "#a855f7",
  "#ec4899", "#f43f5e",
];

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Single draggable number field (hours or minutes)
function DragSegment({
  value,
  max,
  step = 1,
  onChange,
}: {
  value: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  const startRef = useRef<{ y: number; val: number } | null>(null);

  return (
    <div
      className="flex flex-col items-center select-none cursor-ns-resize group/seg touch-none"
      onPointerDown={(e) => {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        startRef.current = { y: e.clientY, val: value };
      }}
      onPointerMove={(e) => {
        if (!startRef.current) return;
        const steps = Math.round((startRef.current.y - e.clientY) / 6);
        const range = Math.floor(max / step) + 1;
        const idx = Math.round(startRef.current.val / step);
        const newIdx = ((idx + steps) % range + range) % range;
        onChange(newIdx * step);
      }}
      onPointerUp={() => { startRef.current = null; }}
      onPointerCancel={() => { startRef.current = null; }}
    >
      <ChevronUp className="w-3 h-3 text-muted group-hover/seg:text-foreground-secondary transition-colors" />
      <span className="font-mono text-sm text-foreground w-6 text-center leading-snug py-px">
        {String(value).padStart(2, "0")}
      </span>
      <ChevronDown className="w-3 h-3 text-muted group-hover/seg:text-foreground-secondary transition-colors" />
    </div>
  );
}

function parseDT(s: string) {
  const [date, time] = s.split("T");
  const [h, m] = (time ?? "00:00").split(":").map(Number);
  return { date: date ?? "", h: h || 0, m: m || 0 };
}

function buildDT(date: string, h: number, m: number) {
  return `${date}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function DateTimePicker({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
}) {
  const { date, h, m } = parseDT(value);

  return (
    <div>
      <label className="block text-xs text-muted mb-1.5">{label}</label>
      <div className="flex items-center gap-2 bg-input border border-input-border rounded-lg
                      px-3 py-1.5 focus-within:border-border-active transition-colors">
        <input
          type="date"
          value={date}
          onChange={(e) => onChange(buildDT(e.target.value, h, m))}
          className="bg-transparent text-xs text-foreground-secondary outline-none flex-1 min-w-0"
        />
        <span className="text-muted text-xs select-none">|</span>
        <DragSegment value={h} max={23} onChange={(v) => onChange(buildDT(date, v, m))} />
        <span className="text-muted font-mono text-xs select-none">:</span>
        <DragSegment value={m} max={55} step={5} onChange={(v) => onChange(buildDT(date, h, v))} />
      </div>
      <p className="text-xs text-muted mt-1">Drag on hour or minute to change</p>
    </div>
  );
}

// ─── Recurrence Editor ───────────────────────────────────────────────────────

function RecurrenceEditor({
  rule,
  onChange,
  onRemove,
}: {
  rule: RecurrenceRule;
  onChange: (r: RecurrenceRule) => void;
  onRemove: () => void;
}) {
  return (
    <div className="space-y-3 p-3 bg-surface-hover rounded-lg border border-border">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-foreground-secondary flex items-center gap-1.5">
          <Repeat className="w-3 h-3" />
          Repeat
        </span>
        <button onClick={onRemove} className="text-xs text-muted hover:text-red-400 transition-colors">
          Remove
        </button>
      </div>

      {/* Frequency + interval */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted">Every</span>
        <input
          type="number"
          min={1}
          max={52}
          value={rule.interval}
          onChange={(e) => onChange({ ...rule, interval: Math.max(1, parseInt(e.target.value) || 1) })}
          className="input-base w-14 text-center text-xs"
        />
        <Dropdown
          className="w-32 text-xs"
          value={rule.frequency}
          onChange={(frequency) => onChange({ ...rule, frequency })}
          options={[
            { value: "daily", label: "day(s)" },
            { value: "weekly", label: "week(s)" },
            { value: "monthly", label: "month(s)" },
          ]}
        />
      </div>

      {/* Days of week (for weekly) */}
      {rule.frequency === "weekly" && (
        <div className="flex items-center gap-1">
          {DAY_NAMES.map((name, i) => {
            const active = rule.daysOfWeek?.includes(i);
            return (
              <button
                key={i}
                onClick={() => {
                  const days = new Set(rule.daysOfWeek ?? []);
                  if (active) days.delete(i);
                  else days.add(i);
                  onChange({ ...rule, daysOfWeek: Array.from(days).sort() });
                }}
                className={`w-8 h-8 rounded-md text-xs font-medium transition-all
                           ${active
                             ? "bg-accent-gradient text-[var(--accent-contrast)]"
                             : "bg-surface-hover text-muted hover:text-foreground-secondary"
                           }`}
              >
                {name.slice(0, 2)}
              </button>
            );
          })}
        </div>
      )}

      {/* End condition */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted">Ends</span>
        <Dropdown
          className="w-48 text-xs"
          value={rule.endType}
          onChange={(endType) => onChange({ ...rule, endType })}
          options={[
            { value: "never", label: "Never" },
            { value: "after", label: "After N occurrences" },
            { value: "until", label: "Until date" },
          ]}
        />
      </div>

      {rule.endType === "after" && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted">After</span>
          <input
            type="number"
            min={1}
            max={365}
            value={rule.endAfter ?? 4}
            onChange={(e) => onChange({ ...rule, endAfter: Math.max(1, parseInt(e.target.value) || 4) })}
            className="input-base w-16 text-center text-xs"
          />
          <span className="text-xs text-muted">times</span>
        </div>
      )}

      {rule.endType === "until" && (
        <input
          type="date"
          value={rule.endUntil ?? ""}
          onChange={(e) => onChange({ ...rule, endUntil: e.target.value })}
          className="input-base text-xs"
        />
      )}
    </div>
  );
}

// ─── Main Modal ──────────────────────────────────────────────────────────────

export default function EventModal({ event, defaultDate, defaultEndDate, onClose }: Props) {
  const { addCalendarEvent, updateCalendarEvent, deleteCalendarEvent } = useStore(
    useShallow((s) => ({
      addCalendarEvent: s.addCalendarEvent,
      updateCalendarEvent: s.updateCalendarEvent,
      deleteCalendarEvent: s.deleteCalendarEvent,
    }))
  );

  const isReadOnly = event?.source === "ical";

  const defaultStart = defaultDate ?? new Date();
  const defaultEnd = defaultEndDate ?? addHours(defaultStart, 1);

  const [title, setTitle] = useState(event?.title ?? "");
  const [start, setStart] = useState(
    event
      ? format(parseISO(event.start), "yyyy-MM-dd'T'HH:mm")
      : format(defaultStart, "yyyy-MM-dd'T'HH:mm")
  );
  const [end, setEnd] = useState(
    event
      ? format(parseISO(event.end), "yyyy-MM-dd'T'HH:mm")
      : format(defaultEnd, "yyyy-MM-dd'T'HH:mm")
  );
  const [color, setColor] = useState(event?.color ?? BASE_COLORS[0]);
  const [description, setDescription] = useState(event?.description ?? "");
  const [recurrence, setRecurrence] = useState<RecurrenceRule | null>(event?.recurrence ?? null);
  const [isDeadline, setIsDeadline] = useState(event?.isDeadline ?? false);
  // Auto-expand the extra colors if the event already uses one of them.
  const [showMoreColors, setShowMoreColors] = useState(MORE_COLORS.includes(event?.color ?? ""));

  function generateRecurringEvents(basePayload: Omit<CalendarEvent, "id">, rule: RecurrenceRule) {
    const events: Omit<CalendarEvent, "id">[] = [];
    const startDate = new Date(basePayload.start);
    const endDate = new Date(basePayload.end);
    const duration = endDate.getTime() - startDate.getTime();

    let maxOccurrences = rule.endType === "after" ? (rule.endAfter ?? 4) : 100;
    const untilDate = rule.endType === "until" && rule.endUntil ? new Date(rule.endUntil) : null;

    let current = new Date(startDate);
    let count = 0;

    while (count < maxOccurrences) {
      if (untilDate && current > untilDate) break;

      // For weekly with specific days
      if (rule.frequency === "weekly" && rule.daysOfWeek && rule.daysOfWeek.length > 0) {
        const weekStart = new Date(current);
        for (const dayOfWeek of rule.daysOfWeek) {
          const candidate = new Date(weekStart);
          const diff = dayOfWeek - candidate.getDay();
          candidate.setDate(candidate.getDate() + diff);
          if (candidate >= startDate && (!untilDate || candidate <= untilDate) && count < maxOccurrences) {
            const eventEnd = new Date(candidate.getTime() + duration);
            events.push({
              ...basePayload,
              start: candidate.toISOString(),
              end: eventEnd.toISOString(),
            });
            count++;
          }
        }
        // Move to next interval
        current = addWeeks(current, rule.interval);
      } else {
        const eventEnd = new Date(current.getTime() + duration);
        events.push({
          ...basePayload,
          start: current.toISOString(),
          end: eventEnd.toISOString(),
        });
        count++;

        // Advance
        switch (rule.frequency) {
          case "daily":
            current = addDays(current, rule.interval);
            break;
          case "weekly":
            current = addWeeks(current, rule.interval);
            break;
          case "monthly":
            current = addMonths(current, rule.interval);
            break;
        }
      }
    }

    return events;
  }

  function handleSubmit() {
    if (isReadOnly) {
      onClose();
      return;
    }
    if (!title.trim()) return;
    const basePayload = {
      title: title.trim(),
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
      color,
      description,
      source: "local" as const,
      recurrence: recurrence ?? undefined,
      isDeadline,
    };

    if (event) {
      updateCalendarEvent(event.id, basePayload);
    } else if (recurrence) {
      // Generate recurring events
      const events = generateRecurringEvents(basePayload, recurrence);
      events.forEach((ev) => addCalendarEvent(ev));
    } else {
      addCalendarEvent(basePayload);
    }
    onClose();
  }

  function handleDelete() {
    if (event && !isReadOnly) {
      deleteCalendarEvent(event.id);
      onClose();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={{ type: "spring", stiffness: 400, damping: 30 }}
        className="w-full max-w-md surface p-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
            {isReadOnly ? (
              <>
                <Lock className="w-4 h-4 text-muted" />
                iCal Event (read-only)
              </>
            ) : (
              event ? "Edit event" : "New event"
            )}
          </h2>
          <button onClick={onClose} className="btn-ghost !p-1.5">
            <X className="w-4 h-4" />
          </button>
        </div>

        {isReadOnly && (
          <div className="mb-4 px-3 py-2 rounded-lg bg-surface-hover border border-border text-xs text-muted">
            This event is synced from an iCal feed. Edit it in the source calendar — changes here would be overwritten on the next sync.
          </div>
        )}

        <div className="space-y-4">
          <div>
            <input
              autoFocus={!isReadOnly}
              readOnly={isReadOnly}
              disabled={isReadOnly}
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Event title"
              className="input-base text-base font-medium disabled:opacity-70 disabled:cursor-not-allowed"
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            />
          </div>

          <fieldset disabled={isReadOnly} className={isReadOnly ? "opacity-70 pointer-events-none" : ""}>
            <div className="space-y-4">
              <DateTimePicker value={start} onChange={setStart} label="Start" />
              <DateTimePicker value={end} onChange={setEnd} label="End" />

              <div>
                <label className="block text-xs text-muted mb-2">Color</label>
                <div className="flex flex-wrap items-center gap-2">
                  {BASE_COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => setColor(c)}
                      className={`w-6 h-6 rounded-full transition-all duration-150
                                  ${color === c
                                    ? "ring-2 ring-offset-2 ring-offset-[var(--color-surface)] ring-foreground"
                                    : ""
                                  }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                  <button
                    type="button"
                    onClick={() => setShowMoreColors((v) => !v)}
                    className="w-6 h-6 rounded-full flex items-center justify-center border border-border
                               text-muted hover:text-foreground hover:border-border-active transition-all duration-150"
                    title={showMoreColors ? "Fewer colors" : "More colors"}
                  >
                    {showMoreColors ? <ChevronUp className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                  </button>
                </div>
                {showMoreColors && (
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    {MORE_COLORS.map((c) => (
                      <button
                        key={c}
                        onClick={() => setColor(c)}
                        className={`w-6 h-6 rounded-full transition-all duration-150
                                    ${color === c
                                      ? "ring-2 ring-offset-2 ring-offset-[var(--color-surface)] ring-foreground"
                                      : ""
                                    }`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Deadline toggle */}
              <button
                onClick={() => setIsDeadline((v) => !v)}
                className={`flex items-center justify-between gap-3 w-full px-3 py-2 rounded-lg border
                           text-left transition-all duration-150
                           ${isDeadline
                             ? "bg-red-950/30 border-red-900/40 text-foreground"
                             : "border-border hover:border-border-active text-foreground-secondary"
                           }`}
              >
                <div className="flex items-center gap-2">
                  <AlertCircle className={`w-4 h-4 ${isDeadline ? "text-red-400" : "text-muted"}`} />
                  <div>
                    <div className="text-sm font-medium">Deadline</div>
                    <div className="text-xs text-muted">Adds this to your to-do list automatically</div>
                  </div>
                </div>
                <div
                  className={`w-9 h-5 rounded-full relative transition-colors flex-shrink-0
                              ${isDeadline ? "bg-red-500" : "bg-surface-hover"}`}
                >
                  <div
                    className={`absolute top-0.5 w-4 h-4 rounded-full transition-all
                                ${isDeadline ? "left-[18px] bg-white" : "left-0.5 bg-muted"}`}
                  />
                </div>
              </button>

              {/* Recurrence */}
              {recurrence ? (
                <RecurrenceEditor
                  rule={recurrence}
                  onChange={setRecurrence}
                  onRemove={() => setRecurrence(null)}
                />
              ) : (
                <button
                  onClick={() =>
                    setRecurrence({
                      frequency: "weekly",
                      interval: 1,
                      daysOfWeek: [new Date(start).getDay()],
                      endType: "after",
                      endAfter: 4,
                    })
                  }
                  className="flex items-center gap-2 w-full px-3 py-2.5 rounded-lg border border-dashed border-border
                             text-sm text-muted hover:text-foreground-secondary hover:border-border-active transition-all"
                >
                  <Repeat className="w-3.5 h-3.5" />
                  Add recurrence
                </button>
              )}

              <div>
                <label className="block text-xs text-muted mb-1">Description</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Optional notes..."
                  rows={3}
                  className="input-base resize-none text-sm"
                />
              </div>
            </div>
          </fieldset>
        </div>

        <div className="flex items-center justify-between mt-5 pt-4 border-t border-border">
          <div>
            {event && !isReadOnly && (
              <button
                onClick={handleDelete}
                className="flex items-center gap-1.5 btn-ghost text-muted hover:text-red-400"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete
              </button>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button onClick={onClose} className="btn-ghost">{isReadOnly ? "Close" : "Cancel"}</button>
            {!isReadOnly && (
              <button
                onClick={handleSubmit}
                disabled={!title.trim()}
                className="btn-primary"
              >
                {event ? "Update" : recurrence ? "Create All" : "Create"}
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
