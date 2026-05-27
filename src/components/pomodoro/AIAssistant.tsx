import { useState, useRef, useEffect, useMemo } from "react";
import { Send, Bot, User, Loader2, Trash2, AlertCircle, Zap } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../../store/useStore";
import {
  streamChatResponse,
  findCommand,
  matchingCommands,
  COMMANDS,
  GROQ_MODELS,
  type Command,
} from "../../lib/ai";

interface Props {
  goal: string;
}

function buildHelpText(): string {
  const lines = ["**Available commands:**\n"];
  for (const cmd of COMMANDS) {
    lines.push(`\`${cmd.name}\` — ${cmd.description}`);
  }
  return lines.join("\n");
}

export default function AIAssistant({ goal }: Props) {
  const {
    chatMessages,
    isChatLoading,
    apiKey,
    groqModel,
    addChatMessage,
    setChatLoading,
    clearChat,
    setGoal,
    startTimer,
    pauseTimer,
    resetTimer,
    setActiveModule,
    addNote,
    setGroqModel,
    sessionsCompleted,
  } = useStore(
    useShallow((s) => ({
      chatMessages: s.chatMessages,
      isChatLoading: s.isChatLoading,
      apiKey: s.apiKey,
      groqModel: s.groqModel,
      addChatMessage: s.addChatMessage,
      setChatLoading: s.setChatLoading,
      clearChat: s.clearChat,
      setGoal: s.setGoal,
      startTimer: s.startTimer,
      pauseTimer: s.pauseTimer,
      resetTimer: s.resetTimer,
      setActiveModule: s.setActiveModule,
      addNote: s.addNote,
      setGroqModel: s.setGroqModel,
      sessionsCompleted: s.sessionsCompleted,
    }))
  );

  const [input, setInput] = useState("");
  const [streamingContent, setStreamingContent] = useState("");
  const [error, setError] = useState("");
  const [unrestricted, setUnrestricted] = useState(false);
  const [selectedHint, setSelectedHint] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Command autocomplete
  const hints = useMemo(() => matchingCommands(input), [input]);
  const isCommand = input.trim().startsWith("/");
  const matchedCommand = useMemo(() => findCommand(input.trim()), [input]);

  useEffect(() => setSelectedHint(0), [input]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [chatMessages, streamingContent]);

  // ─── Local command handlers ─────────────────────────────────────────────

  function handleLocalCommand(cmd: Command, arg: string): boolean {
    switch (cmd.name) {
      case "/I-want-to-waste-my-time":
        setUnrestricted(true);
        addChatMessage({ role: "user", content: cmd.name });
        addChatMessage({ role: "assistant", content: "Unrestricted mode activated. I can now talk about anything. What's on your mind?" });
        return true;

      case "/back-to-studying":
        setUnrestricted(false);
        addChatMessage({ role: "user", content: cmd.name });
        addChatMessage({ role: "assistant", content: "Study mode re-engaged. Let's get back to work. What are you studying?" });
        return true;

      case "/clear":
        clearChat();
        setUnrestricted(false);
        setError("");
        return true;

      case "/help":
        addChatMessage({ role: "user", content: "/help" });
        addChatMessage({ role: "assistant", content: buildHelpText() });
        return true;

      case "/model": {
        const modelMap: Record<string, string> = {
          "70b": "llama-3.3-70b-versatile",
          "versatile": "llama-3.3-70b-versatile",
          "llama": "llama-3.3-70b-versatile",
          "8b": "llama3-8b-8192",
          "fast": "llama3-8b-8192",
          "small": "llama3-8b-8192",
          "mixtral": "mixtral-8x7b-32768",
          "8x7b": "mixtral-8x7b-32768",
        };
        const key = arg.toLowerCase();
        const modelId = modelMap[key];
        if (modelId) {
          setGroqModel(modelId as any);
          const label = GROQ_MODELS.find((m) => m.id === modelId)?.label ?? modelId;
          addChatMessage({ role: "user", content: `/model ${arg}` });
          addChatMessage({ role: "assistant", content: `Switched to **${label}**.` });
        } else {
          addChatMessage({ role: "user", content: `/model ${arg}` });
          const available = GROQ_MODELS.map((m) => `\`${m.label}\``).join(", ");
          addChatMessage({
            role: "assistant",
            content: `Unknown model "${arg}". Available: ${available}\n\nShortcuts: \`fast\` (8B), \`versatile\` (70B), \`mixtral\` (8x7B)`,
          });
        }
        return true;
      }

      case "/goal":
        if (!arg) {
          addChatMessage({ role: "user", content: "/goal" });
          addChatMessage({ role: "assistant", content: goal ? `Current goal: **${goal}**\n\nTo change it: \`/goal Your new goal here\`` : "No goal set. Usage: `/goal Finish chapter 5`" });
        } else {
          setGoal(arg);
          addChatMessage({ role: "user", content: `/goal ${arg}` });
          addChatMessage({ role: "assistant", content: `Goal set to: **${arg}**` });
        }
        return true;

      case "/timer": {
        const sub = arg.toLowerCase();
        if (sub === "start") {
          startTimer();
          addChatMessage({ role: "user", content: "/timer start" });
          addChatMessage({ role: "assistant", content: "Timer started. Focus up." });
        } else if (sub === "pause") {
          pauseTimer();
          addChatMessage({ role: "user", content: "/timer pause" });
          addChatMessage({ role: "assistant", content: "Timer paused." });
        } else if (sub === "reset") {
          resetTimer();
          addChatMessage({ role: "user", content: "/timer reset" });
          addChatMessage({ role: "assistant", content: "Timer reset." });
        } else {
          addChatMessage({ role: "user", content: `/timer ${arg}` });
          addChatMessage({ role: "assistant", content: "Usage: `/timer start`, `/timer pause`, or `/timer reset`" });
        }
        return true;
      }

      case "/note": {
        const title = arg || "Untitled";
        addNote(null);
        // The store creates the note and sets it active — now update its name
        const state = useStore.getState();
        if (state.activeNoteId) {
          useStore.getState().updateNote(state.activeNoteId, { name: title });
        }
        setActiveModule("notepad");
        addChatMessage({ role: "user", content: `/note ${title}` });
        addChatMessage({ role: "assistant", content: `Created note "**${title}**" and switched to Notes.` });
        return true;
      }

      default:
        return false;
    }
  }

  // ─── Send handler ───────────────────────────────────────────────────────

  async function handleSend() {
    const text = input.trim();
    if (!text || isChatLoading) return;
    setInput("");
    setError("");

    const match = findCommand(text);

    if (match) {
      // Local commands
      if (match.command.type === "local") {
        handleLocalCommand(match.command, match.arg);
        return;
      }

      // AI commands — inject prompt
      if (match.command.type === "ai" && match.command.aiPrompt) {
        const injected = match.command.aiPrompt.replace("{arg}", match.arg);
        addChatMessage({ role: "user", content: text });

        const allMessages = [
          ...chatMessages,
          { role: "user" as const, content: injected },
        ];

        setStreamingContent("");
        setChatLoading(true);
        let accumulated = "";

        await streamChatResponse(apiKey, allMessages, groqModel, unrestricted,
          (delta) => { accumulated += delta; setStreamingContent(accumulated); },
          () => { addChatMessage({ role: "assistant", content: accumulated }); setStreamingContent(""); setChatLoading(false); },
          (err) => { setError(err); setStreamingContent(""); setChatLoading(false); },
        );
        return;
      }
    }

    // Regular message
    addChatMessage({ role: "user", content: text });
    const allMessages = [...chatMessages, { role: "user" as const, content: text }];

    setStreamingContent("");
    setChatLoading(true);
    let accumulated = "";

    await streamChatResponse(apiKey, allMessages, groqModel, unrestricted,
      (delta) => { accumulated += delta; setStreamingContent(accumulated); },
      () => { addChatMessage({ role: "assistant", content: accumulated }); setStreamingContent(""); setChatLoading(false); },
      (err) => { setError(err); setStreamingContent(""); setChatLoading(false); },
    );
  }

  function handleClear() {
    clearChat();
    setUnrestricted(false);
    setError("");
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    // Autocomplete navigation
    if (hints.length > 0 && isCommand) {
      if (e.key === "Tab") {
        e.preventDefault();
        const h = hints[selectedHint];
        if (h) setInput(h.name + " ");
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedHint((v) => (v - 1 + hints.length) % hints.length);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedHint((v) => (v + 1) % hints.length);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const hasMessages = chatMessages.length > 0 || !!streamingContent;

  // Visual state — command glow when a valid command is matched
  const isValidCommand = matchedCommand !== null;
  const inputBorderClass = (() => {
    if (isValidCommand)
      return "bg-surface-elevated border border-border-active shadow-[0_0_16px_rgba(244,244,245,0.08)]";
    if (isCommand && hints.length > 0)
      return "bg-surface-elevated border border-border-active shadow-[0_0_12px_rgba(161,161,170,0.06)]";
    if (unrestricted)
      return "bg-surface-elevated border border-amber-500/30 shadow-[0_0_20px_rgba(251,191,36,0.08)] focus-within:border-amber-500/50";
    return "bg-surface-elevated border border-border focus-within:border-border-active";
  })();

  // The entire text glows when a valid command is detected
  const inputTextClass = isValidCommand
    ? "text-foreground font-mono text-xs command-glow"
    : isCommand && hints.length > 0
    ? "text-foreground font-mono text-xs"
    : "text-foreground";

  return (
    <div className="flex flex-col flex-1 min-w-0 min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${
            unrestricted ? "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)]" : "bg-foreground-secondary animate-pulse"
          }`} />
          <span className="text-sm font-medium text-foreground-secondary">Socrates</span>
          {unrestricted ? (
            <span className="flex items-center gap-1 text-xs text-amber-400/80 ml-1">
              <Zap className="w-3 h-3" />
              unrestricted
            </span>
          ) : (
            <span className="text-xs text-muted ml-1">education & productivity only</span>
          )}
        </div>
        {hasMessages && (
          <button
            onClick={handleClear}
            className="flex items-center gap-1.5 btn-ghost text-xs"
          >
            <Trash2 className="w-3 h-3" />
            Clear
          </button>
        )}
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {!hasMessages && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center justify-center h-full gap-3 text-center"
          >
            <div className="w-12 h-12 rounded-2xl bg-surface-hover border border-border flex items-center justify-center">
              <Bot className="w-5 h-5 text-foreground-secondary" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground-secondary">Socrates</p>
              <p className="text-xs text-muted mt-1 max-w-[260px]">
                Ask me anything about studying, productivity, or{" "}
                {goal ? `your goal: "${goal}"` : "your current topic"}
              </p>
              <p className="text-xs text-muted mt-2">
                Type <span className="font-mono text-foreground-secondary">/help</span> for commands
              </p>
            </div>
            <div className="grid grid-cols-1 gap-2 w-full max-w-[320px] mt-2">
              {[
                "Explain the Feynman technique",
                "How do I use spaced repetition?",
                "Help me break down my goal into steps",
              ].map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => { setInput(prompt); inputRef.current?.focus(); }}
                  className="text-left text-xs px-3 py-2 bg-surface-hover border border-border
                             rounded-lg text-foreground-secondary hover:text-foreground hover:border-border-active
                             transition-all duration-150"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </motion.div>
        )}

        <AnimatePresence mode="popLayout">
          {chatMessages.map((msg, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}
            >
              <div className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center
                               ${msg.role === "user" ? "bg-surface-hover" : "bg-surface-elevated border border-border"}`}>
                {msg.role === "user" ? (
                  <User className="w-3.5 h-3.5 text-foreground-secondary" />
                ) : (
                  <Bot className="w-3.5 h-3.5 text-foreground-secondary" />
                )}
              </div>
              <div
                className={`max-w-[80%] px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap
                             ${msg.role === "user"
                               ? "bg-surface-hover text-foreground rounded-tr-sm"
                               : "bg-surface-elevated border border-border text-foreground-secondary rounded-tl-sm"
                             }`}
              >
                {msg.content}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {streamingContent && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex gap-3"
          >
            <div className="flex-shrink-0 w-7 h-7 rounded-full bg-surface-elevated border border-border flex items-center justify-center">
              <Bot className="w-3.5 h-3.5 text-foreground-secondary" />
            </div>
            <div className="max-w-[80%] px-3.5 py-2.5 rounded-2xl rounded-tl-sm text-sm
                            leading-relaxed bg-surface-elevated border border-border text-foreground-secondary whitespace-pre-wrap">
              {streamingContent}
              <span className="inline-block w-1 h-3.5 ml-0.5 bg-foreground-secondary animate-pulse rounded-sm align-text-bottom" />
            </div>
          </motion.div>
        )}

        {isChatLoading && !streamingContent && (
          <div className="flex gap-3">
            <div className="w-7 h-7 rounded-full bg-surface-elevated border border-border flex items-center justify-center">
              <Loader2 className="w-3.5 h-3.5 text-foreground-secondary animate-spin" />
            </div>
            <div className="flex items-center gap-1 px-3.5 py-2.5 bg-surface-elevated border border-border rounded-2xl rounded-tl-sm">
              {[0, 1, 2].map((i) => (
                <motion.span
                  key={i}
                  className="w-1.5 h-1.5 rounded-full bg-muted"
                  animate={{ opacity: [0.3, 1, 0.3] }}
                  transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
                />
              ))}
            </div>
          </div>
        )}

        {error && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-start gap-2 px-3.5 py-2.5 bg-red-950/30 border border-red-900/40 rounded-xl"
          >
            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-red-400 whitespace-pre-line">{error}</p>
          </motion.div>
        )}
      </div>

      {/* Input area */}
      <div className="flex-shrink-0 px-4 py-3 border-t border-border relative">
        {/* Command autocomplete dropdown */}
        <AnimatePresence>
          {isCommand && hints.length > 0 && input.trim() !== hints[0]?.name && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.12 }}
              className="absolute bottom-full left-4 right-4 mb-1 bg-surface-elevated border border-border
                         rounded-lg shadow-xl overflow-hidden z-50"
            >
              {hints.map((cmd, i) => (
                <button
                  key={cmd.name}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setInput(cmd.name + " ");
                    inputRef.current?.focus();
                  }}
                  className={`flex items-center gap-3 w-full px-3 py-2 text-left transition-colors
                             ${i === selectedHint ? "bg-surface-hover" : "hover:bg-surface-hover"}`}
                >
                  <span className="font-mono text-xs text-foreground flex-shrink-0">{cmd.name}</span>
                  <span className="text-xs text-muted truncate">{cmd.description}</span>
                </button>
              ))}
              <div className="px-3 py-1.5 border-t border-border flex items-center gap-3">
                <span className="text-xs text-muted">
                  <kbd className="px-1 py-0.5 bg-surface-hover rounded text-foreground-secondary font-mono text-[10px]">Tab</kbd> to complete
                </span>
                <span className="text-xs text-muted">
                  <kbd className="px-1 py-0.5 bg-surface-hover rounded text-foreground-secondary font-mono text-[10px]">↑↓</kbd> navigate
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className={`flex items-end gap-2 rounded-xl transition-all duration-300 ${inputBorderClass}`}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={unrestricted ? "Ask anything or type / for commands..." : "Ask about studying or type / for commands..."}
            rows={1}
            className={`flex-1 bg-transparent px-3.5 py-3 text-sm
                       placeholder:text-muted resize-y focus:outline-none
                       min-h-[44px] max-h-48 overflow-y-auto transition-colors duration-200
                       ${inputTextClass}`}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isChatLoading}
            className={`flex items-center justify-center w-8 h-8 mb-1.5 mr-1.5 rounded-lg
                       disabled:opacity-30 disabled:cursor-not-allowed
                       transition-all duration-150 flex-shrink-0
                       ${unrestricted
                         ? "bg-amber-400 text-zinc-950 hover:bg-amber-300"
                         : "bg-foreground text-surface hover:opacity-90"
                       }`}
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
        <p className="text-xs text-muted mt-1.5 text-center">
          Shift+Enter for newline · Enter to send · <span className="font-mono">/</span> for commands
        </p>
      </div>
    </div>
  );
}
