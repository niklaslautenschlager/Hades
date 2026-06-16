import { useEffect, useRef } from "react";
import { useStore } from "../store/useStore";

// §6.2 — if the user is working in a note without an active focus session, offer
// a gentle, one-shot nudge to start one. Deliberately un-naggy: it fires at most
// once per app launch, only after a few minutes of editing, and not while a
// session is already running.

const EDIT_GRACE_MS = 4 * 60 * 1000; // editing for ~4 min without a session

export function usePomodoroNudge() {
  const shown = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function schedule() {
      if (timer.current || shown.current) return;
      timer.current = setTimeout(() => {
        timer.current = null;
        const s = useStore.getState();
        if (shown.current || s.isRunning || s.activeModule !== "notepad") return;
        shown.current = true;
        s.pushToast({
          message: "Working without a focus session? Start one to track it.",
          icon: "timer",
          actionLabel: "Start",
          durationMs: 12_000,
          onAction: () => {
            const st = useStore.getState();
            if (!st.isRunning) st.startTimer();
          },
        });
      }, EDIT_GRACE_MS);
    }

    // Subscribe to note edits while in the notepad with no running timer.
    const unsub = useStore.subscribe((state, prev) => {
      if (shown.current) return;
      const startedRunning = state.isRunning && !prev.isRunning;
      if (startedRunning) {
        // They started a session — cancel any pending nudge and never nag.
        if (timer.current) { clearTimeout(timer.current); timer.current = null; }
        shown.current = true;
        return;
      }
      const editingInNotes =
        state.activeModule === "notepad" && !state.isRunning && state.notes !== prev.notes;
      if (editingInNotes) schedule();
    });

    return () => {
      unsub();
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
}
