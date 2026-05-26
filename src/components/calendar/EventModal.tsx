import { useState, useRef } from "react";
import { X, Trash2, ChevronUp, ChevronDown } from "lucide-react";
import { motion } from "framer-motion";
import { format, parseISO, addHours } from "date-fns";
import { useShallow } from "zustand/react/shallow";
import { useStore, type CalendarEvent } from "../../store/useStore";

interface Props {
  event?: CalendarEvent;
  defaultDate?: Date;
  onClose: () => void;
}

const COLORS = [
  "#3f3f46", "#6b7280", "#9ca3af", "#d1d5db", "#374151", "#1f2937",
];

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
      <ChevronUp className="w-3 h-3 text-zinc-700 group-hover/seg:text-zinc-400 transition-colors" />
      <span className="font-mono text-sm text-zinc-200 w-6 text-center leading-snug py-px">
        {String(value).padStart(2, "0")}
      </span>
      <ChevronDown className="w-3 h-3 text-zinc-700 group-hover/seg:text-zinc-400 transition-colors" />
    </div>
  );
}

// Parses "yyyy-MM-ddTHH:mm" into parts
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
      <label className="block text-xs text-zinc-500 mb-1.5">{label}</label>
      <div className="flex items-center gap-2 bg-zinc-950 border border-zinc-800/70 rounded-lg
                      px-3 py-1.5 focus-within:border-zinc-700/60 transition-colors">
        <input
          type="date"
          value={date}
          onChange={(e) => onChange(buildDT(e.target.value, h, m))}
          className="bg-transparent text-xs text-zinc-300 outline-none [color-scheme:dark] flex-1 min-w-0"
        />
        <span className="text-zinc-700 text-xs select-none">|</span>
        <DragSegment value={h} max={23} onChange={(v) => onChange(buildDT(date, v, m))} />
        <span className="text-zinc-600 font-mono text-xs select-none">:</span>
        <DragSegment value={m} max={55} step={5} onChange={(v) => onChange(buildDT(date, h, v))} />
      </div>
      <p className="text-xs text-zinc-700 mt-1">Drag ↕ on hour or minute to change</p>
    </div>
  );
}

export default function EventModal({ event, defaultDate, onClose }: Props) {
  const { addCalendarEvent, updateCalendarEvent, deleteCalendarEvent } = useStore(
    useShallow((s) => ({
      addCalendarEvent: s.addCalendarEvent,
      updateCalendarEvent: s.updateCalendarEvent,
      deleteCalendarEvent: s.deleteCalendarEvent,
    }))
  );

  const defaultStart = defaultDate ?? new Date();
  const defaultEnd = addHours(defaultStart, 1);

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
  const [color, setColor] = useState(event?.color ?? COLORS[0]);
  const [description, setDescription] = useState(event?.description ?? "");

  function handleSubmit() {
    if (!title.trim()) return;
    const payload = {
      title: title.trim(),
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
      color,
      description,
      source: "local" as const,
    };
    if (event) {
      updateCalendarEvent(event.id, payload);
    } else {
      addCalendarEvent(payload);
    }
    onClose();
  }

  function handleDelete() {
    if (event) {
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
        className="w-full max-w-md bg-zinc-900 border border-zinc-800/60 rounded-2xl shadow-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-zinc-100">
            {event ? "Edit event" : "New event"}
          </h2>
          <button onClick={onClose} className="btn-ghost !p-1.5">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <input
              autoFocus
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Event title"
              className="input-base text-base font-medium"
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            />
          </div>

          <DateTimePicker value={start} onChange={setStart} label="Start" />
          <DateTimePicker value={end} onChange={setEnd} label="End" />

          <div>
            <label className="block text-xs text-zinc-500 mb-2">Color</label>
            <div className="flex items-center gap-2">
              {COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={`w-6 h-6 rounded-full transition-all duration-150
                              ${color === c
                                ? "ring-2 ring-offset-2 ring-offset-zinc-900 ring-zinc-300"
                                : ""
                              }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs text-zinc-500 mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional notes..."
              rows={3}
              className="input-base resize-none text-sm"
            />
          </div>
        </div>

        <div className="flex items-center justify-between mt-5 pt-4 border-t border-zinc-800/50">
          <div>
            {event && (
              <button
                onClick={handleDelete}
                className="flex items-center gap-1.5 btn-ghost text-zinc-600 hover:text-red-400"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete
              </button>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button onClick={onClose} className="btn-ghost">Cancel</button>
            <button
              onClick={handleSubmit}
              disabled={!title.trim()}
              className="btn-primary"
            >
              {event ? "Update" : "Create"}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
