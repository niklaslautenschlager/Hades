import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { PenLine } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../../store/useStore";

// F12 — after a focus session ends, a non-blocking card slides up asking what
// you got done. One line, then it's logged to focusReflections (feeding the
// weekly review). Dismissable and easy to ignore.

export default function ReflectionPrompt() {
  const { pending, goal, addReflection, dismissReflection } = useStore(
    useShallow((s) => ({
      pending: s.reflectionPending,
      goal: s.goal,
      addReflection: s.addReflection,
      dismissReflection: s.dismissReflection,
    }))
  );

  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (pending) {
      setText("");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [pending]);

  function save() {
    addReflection(text);
    setText("");
  }

  return (
    <AnimatePresence>
      {pending && (
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          transition={{ type: "spring", stiffness: 380, damping: 30 }}
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[200] w-[min(92vw,440px)]
                     surface border border-border rounded-2xl p-4 shadow-2xl"
        >
          <div className="flex items-center gap-2 mb-2">
            <PenLine className="w-4 h-4 text-accent" />
            <h3 className="text-sm font-semibold text-foreground">Session done — what did you get done?</h3>
          </div>
          {goal && <p className="text-xs text-muted mb-2 truncate">Goal: {goal}</p>}
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") dismissReflection();
            }}
            placeholder="e.g. Finished the integrals worksheet…"
            className="input-base w-full text-sm mb-3"
          />
          <div className="flex gap-2">
            <button onClick={save} disabled={!text.trim()} className="btn-primary flex-1 text-sm disabled:opacity-50">
              Log it
            </button>
            <button onClick={dismissReflection} className="btn-ghost flex-1 text-sm border border-border">
              Skip
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
