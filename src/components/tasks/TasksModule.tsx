import { useState, useRef } from "react";
import { Plus, Trash2, AlertCircle, Calendar as CalIcon, Timer, Minus } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { format, parseISO, isBefore, isToday, isTomorrow } from "date-fns";
import { useShallow } from "zustand/react/shallow";
import { useStore, type Task } from "../../store/useStore";

function formatDueDate(iso: string): string {
  const d = parseISO(iso);
  if (isToday(d)) return `Today ${format(d, "HH:mm")}`;
  if (isTomorrow(d)) return `Tomorrow ${format(d, "HH:mm")}`;
  return format(d, "MMM d, HH:mm");
}

interface TaskItemProps {
  task: Task;
}

function TaskItem({ task }: TaskItemProps) {
  const { toggleTask, deleteTask, editTask, activeTaskId, setActivePomodoroTask, setTaskEstimate } = useStore(
    useShallow((s) => ({
      toggleTask: s.toggleTask,
      deleteTask: s.deleteTask,
      editTask: s.editTask,
      activeTaskId: s.activeTaskId,
      setActivePomodoroTask: s.setActivePomodoroTask,
      setTaskEstimate: s.setTaskEstimate,
    }))
  );

  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(task.text);

  const isFocused = activeTaskId === task.id;
  const estimate = task.estimatedSessions ?? 0;
  const doneSessions = task.completedSessions ?? 0;

  function commitEdit() {
    if (editText.trim()) {
      editTask(task.id, editText.trim());
    }
    setIsEditing(false);
  }

  const isLinkedDeadline = !!task.linkedEventId;
  const overdue = task.dueDate && !task.completed && isBefore(parseISO(task.dueDate), new Date());

  return (
    <div className={`group flex items-center gap-3 px-4 py-3.5 surface
                    cursor-default select-none hover:border-border-active transition-all duration-150
                    ${overdue ? "border-red-900/50" : ""}
                    ${isFocused ? "border-accent glow-accent-sm" : ""}`}>
      {/* Checkbox */}
      <button
        onClick={() => toggleTask(task.id)}
        className={`flex-shrink-0 w-5 h-5 rounded-md border-2 flex items-center justify-center
                     transition-all duration-200
                     ${task.completed
                       ? "bg-accent-gradient border-accent"
                       : "border-muted hover:border-foreground-secondary"
                     }`}
      >
        <AnimatePresence>
          {task.completed && (
            <motion.svg
              key="check"
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{ duration: 0.15, type: "spring", stiffness: 500 }}
              className="w-3 h-3 text-[var(--accent-contrast)]"
              viewBox="0 0 12 12"
              fill="none"
            >
              <path
                d="M2 6l3 3 5-5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </motion.svg>
          )}
        </AnimatePresence>
      </button>

      {/* Task text with animated strike-through */}
      <div className="flex-1 relative">
        {isEditing ? (
          <input
            autoFocus
            type="text"
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitEdit();
              if (e.key === "Escape") setIsEditing(false);
            }}
            className="text-sm bg-transparent border-none outline-none flex-1 w-full text-foreground"
          />
        ) : (
          <>
            <div className="flex items-center gap-2">
              {isLinkedDeadline && (
                <AlertCircle
                  className={`w-3.5 h-3.5 flex-shrink-0 ${overdue ? "text-red-400" : "text-orange-400"}`}
                />
              )}
              <span
                onDoubleClick={() => { setEditText(task.text); setIsEditing(true); }}
                className={`text-sm transition-colors duration-300 ${
                  task.completed ? "text-muted" : "text-foreground"
                }`}
              >
                {task.text}
              </span>
            </div>
            <div className="flex items-center gap-3 mt-0.5">
              {task.dueDate && (
                <div className={`flex items-center gap-1 text-xs
                                ${overdue ? "text-red-400" : "text-muted"}`}>
                  <CalIcon className="w-3 h-3" />
                  {formatDueDate(task.dueDate)}
                  {overdue && <span className="ml-1 font-medium">overdue</span>}
                </div>
              )}
              {estimate > 0 && !task.completed && (
                <div className={`flex items-center gap-1 text-xs ${isFocused ? "text-accent" : "text-muted"}`}
                     title="Focus sessions completed / estimated">
                  <Timer className="w-3 h-3" />
                  <span className="tabular-nums">{doneSessions}/{estimate}</span>
                </div>
              )}
            </div>

            <motion.div
              className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-px bg-muted"
              initial={false}
              animate={{ scaleX: task.completed ? 1 : 0, originX: 0 }}
              transition={{ duration: 0.3, ease: "easeInOut" }}
            />
          </>
        )}
      </div>

      {/* Estimate stepper + focus + delete */}
      {!task.completed && (
        <div className={`flex-shrink-0 flex items-center gap-0.5 mr-1 transition-all
                         ${estimate > 0 ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
          <button
            onClick={() => setTaskEstimate(task.id, Math.max(0, estimate - 1))}
            className="flex items-center justify-center w-5 h-6 rounded text-muted hover:text-foreground-secondary hover:bg-surface-hover transition-all"
            title="Fewer estimated sessions"
          >
            <Minus className="w-3 h-3" />
          </button>
          <span className="flex items-center justify-center gap-0.5 text-xs text-muted w-8 text-center tabular-nums select-none">
            <Timer className="w-3 h-3 flex-shrink-0" />{estimate}
          </span>
          <button
            onClick={() => setTaskEstimate(task.id, estimate + 1)}
            className="flex items-center justify-center w-5 h-6 rounded text-muted hover:text-foreground-secondary hover:bg-surface-hover transition-all"
            title="More estimated sessions"
          >
            <Plus className="w-3 h-3" />
          </button>
        </div>
      )}

      {!task.completed && (
        <button
          onClick={() => setActivePomodoroTask(isFocused ? null : task.id)}
          className={`flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-lg transition-all
                      ${isFocused
                        ? "text-accent opacity-100"
                        : "text-muted hover:text-foreground-secondary hover:bg-surface-hover opacity-0 group-hover:opacity-100"}`}
          title={isFocused ? "Unlink from focus timer" : "Focus on this task in the Pomodoro timer"}
        >
          <Timer className="w-3.5 h-3.5" />
        </button>
      )}

      {/* Delete */}
      <button
        onClick={() => deleteTask(task.id)}
        className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-lg
                   text-muted hover:text-foreground-secondary hover:bg-surface-hover
                   opacity-0 group-hover:opacity-100 transition-all"
      >
        <Trash2 className="w-3 h-3" />
      </button>
    </div>
  );
}

export default function TasksModule() {
  const { tasks, addTask, clearCompletedTasks, clearAllTasks } = useStore(
    useShallow((s) => ({
      tasks: s.tasks,
      addTask: s.addTask,
      clearCompletedTasks: s.clearCompletedTasks,
      clearAllTasks: s.clearAllTasks,
    }))
  );

  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function handleAdd() {
    const text = input.trim();
    if (!text) return;
    addTask(text);
    setInput("");
  }

  const pending = tasks.filter((t) => !t.completed);
  const done = tasks.filter((t) => t.completed);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
        <div>
          <h1 className="text-sm font-semibold text-foreground">Tasks</h1>
          <div className="flex items-center gap-2 mt-0.5">
            <p className="text-xs text-muted">
              {pending.length} remaining · {done.length} done
            </p>
            {done.length > 0 && (
              <button
                onClick={clearCompletedTasks}
                className="flex items-center gap-1 text-xs text-muted hover:text-foreground-secondary transition-colors"
              >
                <Trash2 className="w-3 h-3" />
                Clear completed
              </button>
            )}
            {tasks.some((t) => !t.linkedEventId) && (
              <button
                onClick={() => {
                  if (confirm("Clear all tasks? Calendar deadline tasks are kept.")) clearAllTasks();
                }}
                className="flex items-center gap-1 text-xs text-muted hover:text-red-400 transition-colors"
              >
                <Trash2 className="w-3 h-3" />
                Clear all
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="max-w-2xl mx-auto space-y-6">

          {/* Add task input */}
          <div className="flex items-center gap-3">
            <div className="flex-1 flex items-center gap-3 bg-surface-elevated border border-border
                            rounded-xl px-4 py-3 focus-within:border-border-active transition-colors">
              <Plus className="w-4 h-4 text-muted flex-shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                placeholder="Add a new task..."
                className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted
                           outline-none"
              />
              {input.trim() && (
                <motion.button
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  onClick={handleAdd}
                  className="text-xs text-muted hover:text-foreground-secondary transition-colors flex-shrink-0"
                >
                  Enter
                </motion.button>
              )}
            </div>
          </div>

          {/* Empty state */}
          {tasks.length === 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center justify-center py-16 gap-3"
            >
              <div className="w-12 h-12 rounded-2xl bg-surface-hover border border-border
                             flex items-center justify-center">
                <span className="text-xl">✓</span>
              </div>
              <p className="text-sm text-muted">All clear. Add a task above.</p>
            </motion.div>
          )}

          {/* Pending tasks */}
          {pending.length > 0 && (
            <section>
              <h2 className="text-xs font-medium text-muted uppercase tracking-widest mb-3">
                To do — {pending.length}
              </h2>
              <div className="space-y-2">
                <AnimatePresence mode="popLayout">
                  {pending.map((task) => (
                    <motion.div
                      key={task.id}
                      layout
                      initial={{ opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, x: 20, height: 0, marginBottom: 0 }}
                      transition={{ duration: 0.2 }}
                    >
                      <TaskItem task={task} />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </section>
          )}

          {/* Done tasks */}
          {done.length > 0 && (
            <section>
              <h2 className="text-xs font-medium text-muted uppercase tracking-widest mb-3">
                Completed — {done.length}
              </h2>
              <div className="space-y-2">
                <AnimatePresence mode="popLayout">
                  {done.map((task) => (
                    <motion.div
                      key={task.id}
                      layout
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 0.6 }}
                      exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                      transition={{ duration: 0.2 }}
                    >
                      <TaskItem task={task} />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
