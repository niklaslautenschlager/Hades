import { useState, useRef, useEffect, useMemo } from "react";
import { Send, Bot, User, Loader2, Trash2, AlertCircle, Zap, Plus, MessageSquare, ChevronDown, Sparkles } from "lucide-react";
import { marked } from "marked";
import { motion, AnimatePresence } from "framer-motion";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../../store/useStore";
import {
  streamChatResponse,
  findCommand,
  matchingCommands,
  COMMANDS,
  AI_MODELS,
  VENDOR_LABELS,
  APP_CONTEXT,
  DEEP_RESEARCH_COMMAND,
  type Command,
} from "../../lib/ai";
import { retrieveContext } from "../../lib/aiContext";
import { renderAssistantHtml, handleCitationClick } from "../../lib/citations";
import {
  buildAgentSystemPrompt,
  parseToolCalls,
  stripToolBlocks,
  executeToolCalls,
} from "../../lib/aiTools";
import type { AIVendor } from "../../store/useStore";

const MAX_AGENT_ROUNDS = 4;

marked.setOptions({ breaks: true, gfm: true });

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
    aiVendor,
    aiVendorConfigs,
    aiEnabled,
    aiUseStudyContext,
    agentMode,
    conversations,
    activeConversationId,
    addChatMessage,
    setChatLoading,
    clearChat,
    newConversation,
    switchConversation,
    deleteConversation,
    setConversationUnrestricted,
    setGoal,
    startTimer,
    pauseTimer,
    resetTimer,
    setActiveModule,
    addNote,
    setAIVendor,
    setAIVendorConfig,
  } = useStore(
    useShallow((s) => ({
      chatMessages: s.chatMessages,
      isChatLoading: s.isChatLoading,
      aiVendor: s.aiVendor,
      aiVendorConfigs: s.aiVendorConfigs,
      aiEnabled: s.aiEnabled,
      aiUseStudyContext: s.aiUseStudyContext,
      agentMode: s.agentMode,
      conversations: s.conversations,
      activeConversationId: s.activeConversationId,
      addChatMessage: s.addChatMessage,
      setChatLoading: s.setChatLoading,
      clearChat: s.clearChat,
      newConversation: s.newConversation,
      switchConversation: s.switchConversation,
      deleteConversation: s.deleteConversation,
      setConversationUnrestricted: s.setConversationUnrestricted,
      setGoal: s.setGoal,
      startTimer: s.startTimer,
      pauseTimer: s.pauseTimer,
      resetTimer: s.resetTimer,
      setActiveModule: s.setActiveModule,
      addNote: s.addNote,
      setAIVendor: s.setAIVendor,
      setAIVendorConfig: s.setAIVendorConfig,
    }))
  );

  const activeConfig = aiVendorConfigs[aiVendor];
  const availableModels = AI_MODELS[aiVendor];
  // Unrestricted mode is a property of the active conversation so it persists
  // and is restored when switching threads.
  const activeConv = conversations.find((c) => c.id === activeConversationId);
  const unrestricted = activeConv?.unrestricted ?? false;
  const setUnrestricted = setConversationUnrestricted;

  const [input, setInput] = useState("");
  const assistantSeed = useStore((s) => s.assistantSeed);
  const [streamingContent, setStreamingContent] = useState("");
  const [error, setError] = useState("");
  const [showConversations, setShowConversations] = useState(false);
  const [selectedHint, setSelectedHint] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Command autocomplete
  const hints = useMemo(() => matchingCommands(input), [input]);
  const isCommand = input.trim().startsWith("/");
  const matchedCommand = useMemo(() => findCommand(input.trim()), [input]);

  useEffect(() => setSelectedHint(0), [input]);

  // Consume a one-shot seed (e.g. "Chat with this PDF", command palette).
  useEffect(() => {
    if (!assistantSeed) return;
    setInput(assistantSeed.text);
    useStore.setState({ assistantSeed: null });
    setTimeout(() => {
      inputRef.current?.focus();
      const el = inputRef.current;
      if (el) el.setSelectionRange(el.value.length, el.value.length);
    }, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assistantSeed?.n]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [chatMessages, streamingContent]);

  // ─── Local command handlers ─────────────────────────────────────────────

  function handleLocalCommand(cmd: Command, arg: string): boolean {
    switch (cmd.name) {
      case "/I-want-to-waste-my-time":
        addChatMessage({ role: "user", content: cmd.name });
        setUnrestricted(true);
        addChatMessage({ role: "assistant", content: "Unrestricted mode activated. I can now talk about anything. What's on your mind?" });
        return true;

      case "/back-to-studying":
        addChatMessage({ role: "user", content: cmd.name });
        setUnrestricted(false);
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
        const argLower = arg.toLowerCase();
        // Look for matching model in current vendor
        const found = availableModels.find(
          (m) => m.id.toLowerCase().includes(argLower) || m.label.toLowerCase().includes(argLower)
        );
        if (found && argLower) {
          setAIVendorConfig(aiVendor, { model: found.id });
          addChatMessage({ role: "user", content: `/model ${arg}` });
          addChatMessage({ role: "assistant", content: `Switched to **${found.label}**.` });
        } else {
          addChatMessage({ role: "user", content: `/model ${arg}` });
          const available = availableModels.map((m) => `\`${m.label}\``).join(", ");
          addChatMessage({
            role: "assistant",
            content: `Models for ${VENDOR_LABELS[aiVendor]}: ${available}`,
          });
        }
        return true;
      }

      case "/vendor": {
        const argLower = arg.toLowerCase().trim();
        const validVendors: AIVendor[] = ["groq", "openai", "anthropic", "deepseek", "ollama"];
        const target = validVendors.find((v) => v === argLower);
        if (target) {
          setAIVendor(target);
          addChatMessage({ role: "user", content: `/vendor ${arg}` });
          addChatMessage({ role: "assistant", content: `Switched to **${VENDOR_LABELS[target]}**.` });
        } else {
          addChatMessage({ role: "user", content: `/vendor ${arg}` });
          addChatMessage({
            role: "assistant",
            content: `Current vendor: **${VENDOR_LABELS[aiVendor]}**\n\nAvailable: ${validVendors.map((v) => `\`${v}\``).join(", ")}`,
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

  // One streamed turn. Streams deltas to the UI; resolves with the full text.
  function streamOnce(
    messages: { role: "user" | "assistant"; content: string }[],
    extra: { deepResearch?: boolean; agentSystem?: string; studyContext?: string },
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      let acc = "";
      streamChatResponse(
        {
          vendor: aiVendor,
          apiKey: activeConfig.apiKey,
          model: activeConfig.model,
          baseUrl: activeConfig.baseUrl,
          messages,
          unrestricted,
          appContext: APP_CONTEXT,
          studyContext: extra.studyContext,
          deepResearch: extra.deepResearch,
          agentSystem: extra.agentSystem,
          maxTokens: extra.deepResearch ? 4096 : extra.agentSystem ? 2048 : undefined,
        },
        (delta) => { acc += delta; setStreamingContent(acc); },
        () => resolve(acc),
        (err) => reject(new Error(err)),
      );
    });
  }

  async function runAI(
    allMessages: { role: "user" | "assistant"; content: string }[],
    opts: { deepResearch?: boolean; query?: string } = {}
  ) {
    setStreamingContent("");
    setChatLoading(true);
    setError("");

    const agent = agentMode && !opts.deepResearch;
    // In agent mode the model retrieves notes itself via search_notes; otherwise
    // inject retrieved study context up front when enabled.
    const studyContext =
      !agent && aiUseStudyContext && opts.query ? (await retrieveContext(opts.query)) || undefined : undefined;
    const agentSystem = agent ? buildAgentSystemPrompt() : undefined;

    try {
      let messages = [...allMessages];
      for (let round = 0; ; round++) {
        const text = await streamOnce(messages, { deepResearch: opts.deepResearch, agentSystem, studyContext });
        setStreamingContent("");

        if (!agent) {
          addChatMessage({ role: "assistant", content: text });
          break;
        }

        const calls = parseToolCalls(text);
        const visible = stripToolBlocks(text);

        if (calls.length === 0) {
          addChatMessage({ role: "assistant", content: visible || text });
          break;
        }

        const outcomes = await executeToolCalls(calls);
        const chips = outcomes.map((o) => `${o.ok ? "✓" : "✗"} ${o.summary}`).join("\n");
        addChatMessage({ role: "assistant", content: visible ? `${visible}\n\n${chips}` : chips });

        if (round >= MAX_AGENT_ROUNDS - 1) break;

        const obs = outcomes.map((o, i) => `[${i + 1}] ${o.tool}: ${o.observation}`).join("\n\n");
        messages = [
          ...messages,
          { role: "assistant", content: text },
          { role: "user", content: `Observations:\n${obs}\n\nContinue if more steps are needed, otherwise give your final answer.` },
        ];
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStreamingContent("");
      setChatLoading(false);
    }
  }

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
        await runAI(
          [...chatMessages, { role: "user", content: injected }],
          { deepResearch: match.command.name === DEEP_RESEARCH_COMMAND, query: match.arg || injected }
        );
        return;
      }
    }

    // Regular message
    addChatMessage({ role: "user", content: text });
    await runAI([...chatMessages, { role: "user", content: text }], { query: text });
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

  // Privacy opt-in: when AI is disabled, show nothing but a gentle pointer.
  if (!aiEnabled) {
    return (
      <div className="flex flex-col flex-1 min-w-0 min-h-0 items-center justify-center text-center px-6 gap-3">
        <div className="w-12 h-12 rounded-2xl bg-surface-hover border border-border flex items-center justify-center">
          <Sparkles className="w-5 h-5 text-muted" />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground-secondary">AI is turned off</p>
          <p className="text-xs text-muted mt-1 max-w-[260px]">
            Enable AI features in Settings to chat with Socrates. Your data stays on your device until you do.
          </p>
        </div>
      </div>
    );
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
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-border flex-shrink-0 relative">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
            unrestricted ? "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)]" : "bg-foreground-secondary animate-pulse"
          }`} />
          <span className="text-sm font-medium text-foreground-secondary flex-shrink-0">Socrates</span>
          {unrestricted ? (
            <span className="flex items-center gap-1 text-xs text-amber-400/80 ml-1 flex-shrink-0">
              <Zap className="w-3 h-3" />
              unrestricted
            </span>
          ) : (
            <span className="text-xs text-muted ml-1 flex-shrink-0">
              {VENDOR_LABELS[aiVendor]}
            </span>
          )}
          {agentMode && (
            <span className="text-xs text-accent ml-1 flex-shrink-0" title="Agent mode — Socrates can act on the app">
              · agent
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {/* Conversation switcher */}
          <button
            onClick={() => setShowConversations((v) => !v)}
            className="flex items-center gap-1.5 btn-ghost text-xs max-w-[140px]"
            title="Conversations"
          >
            <MessageSquare className="w-3 h-3 flex-shrink-0" />
            <span className="truncate">{activeConv?.title ?? "New chat"}</span>
            <ChevronDown className="w-3 h-3 flex-shrink-0" />
          </button>
          <button
            onClick={() => { newConversation(); setError(""); setShowConversations(false); }}
            className="flex items-center justify-center w-7 h-7 rounded-lg text-muted
                       hover:text-foreground-secondary hover:bg-surface-hover transition-all"
            title="New conversation"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        {showConversations && (
          <div className="fixed inset-0 z-40" onClick={() => setShowConversations(false)} />
        )}
        <AnimatePresence>
          {showConversations && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.12 }}
                className="absolute right-4 top-full mt-1 w-64 max-h-72 overflow-y-auto z-50
                           bg-surface-elevated border border-border rounded-lg shadow-xl py-1"
              >
                {conversations.length === 0 && (
                  <p className="px-3 py-2 text-xs text-muted">No conversations yet.</p>
                )}
                {conversations.map((c) => (
                  <div
                    key={c.id}
                    className={`group flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors
                               ${c.id === activeConversationId ? "bg-surface-hover" : "hover:bg-surface-hover"}`}
                    onClick={() => { switchConversation(c.id); setShowConversations(false); setError(""); }}
                  >
                    <MessageSquare className="w-3 h-3 text-muted flex-shrink-0" />
                    <span className="flex-1 truncate text-xs text-foreground-secondary">{c.title}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteConversation(c.id); }}
                      className="opacity-0 group-hover:opacity-100 text-muted hover:text-red-400 transition-all flex-shrink-0"
                      title="Delete conversation"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </motion.div>
          )}
        </AnimatePresence>
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
              {msg.role === "user" ? (
                <div className="max-w-[80%] px-3.5 py-2.5 rounded-2xl rounded-tr-sm text-sm leading-relaxed whitespace-pre-wrap bg-surface-hover text-foreground">
                  {msg.content}
                </div>
              ) : (
                <div
                  className="markdown-body prose-chat max-w-[80%] px-3.5 py-2.5 rounded-2xl rounded-tl-sm bg-surface-elevated border border-border"
                  onClick={(e) => handleCitationClick(e.target as HTMLElement)}
                  dangerouslySetInnerHTML={{ __html: renderAssistantHtml(msg.content) }}
                />
              )}
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
            <div className="max-w-[80%] px-3.5 py-2.5 rounded-2xl rounded-tl-sm bg-surface-elevated border border-border">
              <div
                className="markdown-body prose-chat"
                dangerouslySetInnerHTML={{ __html: marked.parse(streamingContent) as string }}
              />
              <span className="inline-block w-1 h-3.5 bg-foreground-secondary animate-pulse rounded-sm align-text-bottom" />
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
                         : "bg-accent-gradient text-[var(--accent-contrast)] hover:brightness-105"
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
