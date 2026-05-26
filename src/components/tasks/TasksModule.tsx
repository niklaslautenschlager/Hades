import { useState, useRef } from "react";
import { Plus, Trash2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useShallow } from "zustand/react/shallow";
import { useStore, type Task } from "../../store/useStore";

interface TaskItemProps {
  task: Task;
}

function TaskItem({ task }: TaskItemProps) {
  const { toggleTask, deleteTask } = useStore(
    useShallow((s) => ({
      toggleTask: s.toggleTask,
      deleteTask: s.deleteTask,
    }))
  );

  return (
    <div className="group flex items-center gap-3 px-4 py-3.5 bg-zinc-900 border border-zinc-800/50
                    rounded-xl cursor-default select-none hover:border-zinc-700/50 transition-all duration-150">
      {/* Checkbox */}
      <button
        onClick={() => toggleTask(task.id)}
        className={`flex-shrink-0 w-5 h-5 rounded-md border-2 flex items-center justify-center
                     transition-all duration-200
                     ${task.completed
                       ? "bg-zinc-300 border-zinc-300"
                       : "border-zinc-600 hover:border-zinc-400"
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
              className="w-3 h-3 text-zinc-950"
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
        <span
          className={`text-sm transition-colors duration-300 ${
            task.completed ? "text-zinc-600" : "text-zinc-200"
          }`}
        >
          {task.text}
        </span>

        <motion.div
          className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-px bg-zinc-600"
          initial={false}
          animate={{ scaleX: task.completed ? 1 : 0, originX: 0 }}
          transition={{ duration: 0.3, ease: "easeInOut" }}
        />
      </div>

      {/* Delete */}
      <button
        onClick={() => deleteTask(task.id)}
        className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-lg
                   text-zinc-700 hover:text-zinc-400 hover:bg-zinc-800/60
                   opacity-0 group-hover:opacity-100 transition-all"
      >
        <Trash2 className="w-3 h-3" />
      </button>
    </div>
  );
}

export default function TasksModule() {
  const { tasks, addTask } = useStore(
    useShallow((s) => ({
      tasks: s.tasks,
      addTask: s.addTask,
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
      <header className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/50 flex-shrink-0">
        <div>
          <h1 className="text-sm font-semibold text-zinc-100">Tasks</h1>
          <p className="text-xs text-zinc-600 mt-0.5">
            {pending.length} remaining · {done.length} done
          </p>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="max-w-2xl mx-auto space-y-6">

          {/* Add task input */}
          <div className="flex items-center gap-3">
            <div className="flex-1 flex items-center gap-3 bg-zinc-900 border border-zinc-800/60
                            rounded-xl px-4 py-3 focus-within:border-zinc-700/60 transition-colors">
              <Plus className="w-4 h-4 text-zinc-600 flex-shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                placeholder="Add a new task..."
                className="flex-1 bg-transparent text-sm text-zinc-200 placeholder:text-zinc-600
                           outline-none"
              />
              {input.trim() && (
                <motion.button
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  onClick={handleAdd}
                  className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors flex-shrink-0"
                >
                  Enter ↵
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
              <div className="w-12 h-12 rounded-2xl bg-zinc-800/40 border border-zinc-800/60
                             flex items-center justify-center">
                <span className="text-xl">✓</span>
              </div>
              <p className="text-sm text-zinc-500">All clear. Add a task above.</p>
            </motion.div>
          )}

          {/* Pending tasks */}
          {pending.length > 0 && (
            <section>
              <h2 className="text-xs font-medium text-zinc-600 uppercase tracking-widest mb-3">
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
              <h2 className="text-xs font-medium text-zinc-700 uppercase tracking-widest mb-3">
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
