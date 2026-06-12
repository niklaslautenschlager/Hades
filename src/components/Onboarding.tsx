import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Flame, Timer, Calendar, FileText, CheckSquare, Layers, BarChart3, Bot,
  ArrowRight, ArrowLeft, X, type LucideIcon,
} from "lucide-react";
import { useStore } from "../store/useStore";

interface Step {
  icon: LucideIcon;
  title: string;
  body: string;
}

const STEPS: Step[] = [
  { icon: Flame, title: "Welcome to Hades", body: "A focused, all-in-one study workspace: a Pomodoro timer, notes, calendar, tasks, flashcards, stats — and an AI study assistant. Here's a 30-second tour." },
  { icon: Timer, title: "Focus Timer", body: "Run Pomodoro work/break cycles, set a session goal, and link a task to estimate how many sessions it'll take. Your focus time feeds your stats." },
  { icon: Calendar, title: "Calendar", body: "Month/week/day views, recurring events, and subscribe to iCal feeds (your class timetable). Get a gentle reminder before things start." },
  { icon: FileText, title: "Notes", body: "A markdown editor with live preview, folders, tags, [[wiki-links]], a PDF reader pane, and one-click flashcard generation. Cloud-sync to any folder." },
  { icon: CheckSquare, title: "Tasks", body: "Quick to-dos with due dates. Calendar deadlines flow in automatically, and you can send a task to the focus timer." },
  { icon: Layers, title: "Flashcards", body: "Anki-style spaced repetition (SM-2). Make decks by hand or let the AI generate cards from a note." },
  { icon: BarChart3, title: "Statistics", body: "Track focus time by day/week/month, set a weekly goal, and get an AI weekly review of what you accomplished." },
  { icon: Bot, title: "AI Assistant (optional)", body: "Off by default for privacy. Turn it on in Settings → AI to chat, plan your week, and have it act on the app. Use a cloud key or fully-local Ollama." },
];

export default function Onboarding() {
  const seen = useStore((s) => s.onboardingSeen);
  const setSeen = useStore((s) => s.setOnboardingSeen);
  const [i, setI] = useState(0);

  if (seen) return null;

  const step = STEPS[i];
  const Icon = step.icon;
  const last = i === STEPS.length - 1;

  function finish() { setSeen(true); }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[400] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      >
        <motion.div
          initial={{ scale: 0.96, y: 10 }}
          animate={{ scale: 1, y: 0 }}
          className="w-[min(94vw,460px)] surface border border-border rounded-2xl shadow-2xl overflow-hidden"
        >
          {/* Skip */}
          <div className="flex justify-end p-2">
            <button
              onClick={finish}
              className="flex items-center gap-1 text-xs text-muted hover:text-foreground-secondary transition-colors px-2 py-1"
            >
              Skip <X className="w-3 h-3" />
            </button>
          </div>

          <div className="px-7 pb-2 text-center">
            <AnimatePresence mode="wait">
              <motion.div
                key={i}
                initial={{ opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -24 }}
                transition={{ duration: 0.22 }}
              >
                <div className="mx-auto mb-4 w-14 h-14 rounded-2xl bg-accent-gradient flex items-center justify-center">
                  <Icon className="w-7 h-7 text-[var(--accent-contrast)]" />
                </div>
                <h2 className="text-lg font-semibold text-foreground mb-2">{step.title}</h2>
                <p className="text-sm text-foreground-secondary leading-relaxed min-h-[72px]">{step.body}</p>
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Dots */}
          <div className="flex items-center justify-center gap-1.5 py-4">
            {STEPS.map((_, idx) => (
              <button
                key={idx}
                onClick={() => setI(idx)}
                className={`h-1.5 rounded-full transition-all ${idx === i ? "w-5 bg-accent" : "w-1.5 bg-surface-hover"}`}
              />
            ))}
          </div>

          {/* Nav */}
          <div className="flex items-center justify-between gap-2 px-5 pb-5">
            <button
              onClick={() => setI((v) => Math.max(0, v - 1))}
              disabled={i === 0}
              className="btn-ghost text-sm border border-border flex items-center gap-1.5 disabled:opacity-40"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Back
            </button>
            {last ? (
              <button onClick={finish} className="btn-primary text-sm flex-1 ml-2">Get started</button>
            ) : (
              <button
                onClick={() => setI((v) => Math.min(STEPS.length - 1, v + 1))}
                className="btn-primary text-sm flex items-center gap-1.5"
              >
                Next <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
