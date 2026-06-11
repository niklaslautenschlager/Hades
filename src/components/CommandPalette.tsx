import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search, Calendar, Timer, FileText, CheckSquare, Layers, BarChart3,
  Plus, Play, Pause, Sparkles, CornerDownLeft, type LucideIcon,
} from "lucide-react";
import { useStore, type Module } from "../store/useStore";

// F16 — Cmd/Ctrl-K command palette. A single "do anything" surface backed by
// the store: jump between modules, run quick actions, or hand a free-text
// request to the AI assistant.

interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: LucideIcon;
  keywords?: string;
  run: () => void;
}

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Global hotkey.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSel(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const s = useStore.getState();
    const go = (m: Module) => () => { s.setActiveModule(m); setOpen(false); };
    const nav: { m: Module; label: string; icon: LucideIcon }[] = [
      { m: "pomodoro", label: "Focus Timer", icon: Timer },
      { m: "calendar", label: "Calendar", icon: Calendar },
      { m: "notepad", label: "Notes", icon: FileText },
      { m: "tasks", label: "Tasks", icon: CheckSquare },
      { m: "flashcards", label: "Flashcards", icon: Layers },
      { m: "stats", label: "Statistics", icon: BarChart3 },
    ];

    const list: Command[] = nav.map((n) => ({
      id: `go-${n.m}`,
      label: `Go to ${n.label}`,
      hint: "Navigate",
      icon: n.icon,
      keywords: n.m,
      run: go(n.m),
    }));

    list.push(
      {
        id: "new-note",
        label: "New note",
        hint: "Notes",
        icon: Plus,
        keywords: "create note",
        run: () => { const id = s.addNote(null); s.setActiveNote(id); s.setActiveModule("notepad"); setOpen(false); },
      },
      {
        id: "new-task",
        label: "New task…",
        hint: "Tasks",
        icon: Plus,
        keywords: "create todo",
        run: () => { s.setActiveModule("tasks"); setOpen(false); },
      },
      s.isRunning
        ? { id: "timer-pause", label: "Pause focus timer", hint: "Timer", icon: Pause, keywords: "stop", run: () => { s.pauseTimer(); setOpen(false); } }
        : { id: "timer-start", label: "Start focus timer", hint: "Timer", icon: Play, keywords: "begin", run: () => { s.startTimer(); s.setActiveModule("pomodoro"); setOpen(false); } },
    );

    return list;
  }, [open]);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return commands;
    return commands.filter((c) => (c.label + " " + (c.hint ?? "") + " " + (c.keywords ?? "")).toLowerCase().includes(q));
  }, [commands, q]);

  const aiEnabled = useStore((s) => s.aiEnabled);
  const showAskAi = aiEnabled && q.length > 0;
  const total = filtered.length + (showAskAi ? 1 : 0);

  function runIndex(i: number) {
    if (showAskAi && i === filtered.length) {
      // Hand the free text to the assistant.
      useStore.getState().seedAssistant(query.trim());
      setOpen(false);
      return;
    }
    filtered[i]?.run();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => (s + 1) % Math.max(total, 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => (s - 1 + Math.max(total, 1)) % Math.max(total, 1)); }
    else if (e.key === "Enter") { e.preventDefault(); runIndex(sel); }
  }

  useEffect(() => { setSel(0); }, [query]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[300] flex items-start justify-center pt-[15vh] bg-black/50 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <motion.div
            initial={{ scale: 0.97, y: -8 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.97, y: -8 }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
            className="w-[min(92vw,560px)] surface border border-border rounded-2xl shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
              <Search className="w-4 h-4 text-muted flex-shrink-0" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Search actions or ask the AI…"
                className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted outline-none"
              />
              <kbd className="text-[10px] text-muted border border-border rounded px-1.5 py-0.5">esc</kbd>
            </div>

            <div className="max-h-[50vh] overflow-y-auto py-1.5">
              {filtered.map((c, i) => {
                const Icon = c.icon;
                return (
                  <button
                    key={c.id}
                    onMouseEnter={() => setSel(i)}
                    onClick={() => runIndex(i)}
                    className={`flex items-center gap-3 w-full px-4 py-2 text-left transition-colors
                                ${sel === i ? "bg-surface-hover" : ""}`}
                  >
                    <Icon className="w-3.5 h-3.5 text-muted flex-shrink-0" />
                    <span className="flex-1 text-sm text-foreground">{c.label}</span>
                    {c.hint && <span className="text-[11px] text-muted">{c.hint}</span>}
                    {sel === i && <CornerDownLeft className="w-3 h-3 text-muted" />}
                  </button>
                );
              })}

              {showAskAi && (
                <button
                  onMouseEnter={() => setSel(filtered.length)}
                  onClick={() => runIndex(filtered.length)}
                  className={`flex items-center gap-3 w-full px-4 py-2 text-left transition-colors
                              ${sel === filtered.length ? "bg-surface-hover" : ""}`}
                >
                  <Sparkles className="w-3.5 h-3.5 text-accent flex-shrink-0" />
                  <span className="flex-1 text-sm text-foreground truncate">
                    Ask AI: <span className="text-foreground-secondary">"{query.trim()}"</span>
                  </span>
                  {sel === filtered.length && <CornerDownLeft className="w-3 h-3 text-muted" />}
                </button>
              )}

              {total === 0 && (
                <p className="px-4 py-6 text-center text-xs text-muted">No matching actions.</p>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
