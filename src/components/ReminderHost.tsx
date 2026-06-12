import { useEffect, useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bell, X } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store/useStore";

// In-app event reminders. Every 30s we look for events starting within the
// lead window and surface a gentle card (no sound, no OS notification). It
// dismisses on click or after 20s, and each event only fires once per launch.

interface ActiveReminder {
  id: string;
  title: string;
  start: string;
  minutesUntil: number;
}

const CHECK_MS = 30_000;
const AUTO_DISMISS_MS = 20_000;

export default function ReminderHost() {
  const { enabled, leadMinutes, events } = useStore(
    useShallow((s) => ({
      enabled: s.remindersEnabled,
      leadMinutes: s.reminderLeadMinutes,
      events: s.calendarEvents,
    }))
  );

  const [active, setActive] = useState<ActiveReminder[]>([]);
  const firedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!enabled) { setActive([]); return; }

    function check() {
      const now = Date.now();
      const lead = leadMinutes * 60_000;
      for (const e of events) {
        const start = new Date(e.start).getTime();
        if (isNaN(start)) continue;
        const delta = start - now;
        // Fire once when the event is within the lead window but not yet started.
        if (delta > 0 && delta <= lead && !firedRef.current.has(e.id)) {
          firedRef.current.add(e.id);
          const reminder: ActiveReminder = {
            id: e.id,
            title: e.title,
            start: e.start,
            minutesUntil: Math.max(1, Math.round(delta / 60_000)),
          };
          setActive((a) => [...a, reminder]);
          setTimeout(() => {
            setActive((a) => a.filter((r) => r.id !== reminder.id));
          }, AUTO_DISMISS_MS);
        }
      }
    }

    check();
    const id = setInterval(check, CHECK_MS);
    return () => clearInterval(id);
  }, [enabled, leadMinutes, events]);

  function dismiss(id: string) {
    setActive((a) => a.filter((r) => r.id !== id));
  }

  return (
    <div className="fixed top-4 right-4 z-[250] flex flex-col gap-2 items-end pointer-events-none">
      <AnimatePresence>
        {active.map((r) => (
          <motion.div
            key={r.id}
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 24 }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
            onClick={() => dismiss(r.id)}
            className="pointer-events-auto cursor-pointer surface border border-border rounded-xl
                       shadow-2xl px-3.5 py-2.5 w-[min(86vw,320px)] flex items-start gap-2.5"
          >
            <Bell className="w-4 h-4 text-accent flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{r.title}</p>
              <p className="text-xs text-muted mt-0.5">
                in {r.minutesUntil} min ·{" "}
                {new Date(r.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </p>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); dismiss(r.id); }}
              className="text-muted hover:text-foreground transition-colors flex-shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
