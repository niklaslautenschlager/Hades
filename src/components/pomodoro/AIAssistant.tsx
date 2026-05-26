import { useState, useRef, useEffect } from "react";
import { Send, Bot, User, Loader2, Trash2, AlertCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../../store/useStore";
import { streamChatResponse } from "../../lib/ai";

interface Props {
  goal: string;
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
  } = useStore(
    useShallow((s) => ({
      chatMessages: s.chatMessages,
      isChatLoading: s.isChatLoading,
      apiKey: s.apiKey,
      groqModel: s.groqModel,
      addChatMessage: s.addChatMessage,
      setChatLoading: s.setChatLoading,
      clearChat: s.clearChat,
    }))
  );

  const [input, setInput] = useState("");
  const [streamingContent, setStreamingContent] = useState("");
  const [error, setError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [chatMessages, streamingContent]);

  async function handleSend() {
    const text = input.trim();
    if (!text || isChatLoading) return;

    setInput("");
    setError("");
    addChatMessage({ role: "user", content: text });

    const allMessages = [
      ...chatMessages,
      { role: "user" as const, content: text },
    ];

    setStreamingContent("");
    setChatLoading(true);

    let accumulated = "";

    await streamChatResponse(
      apiKey,
      allMessages,
      groqModel,
      (delta) => {
        accumulated += delta;
        setStreamingContent(accumulated);
      },
      () => {
        addChatMessage({ role: "assistant", content: accumulated });
        setStreamingContent("");
        setChatLoading(false);
      },
      (err) => {
        setError(err);
        setStreamingContent("");
        setChatLoading(false);
      }
    );
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const hasMessages = chatMessages.length > 0 || !!streamingContent;

  return (
    <div className="flex flex-col flex-1 min-w-0 min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-800/50 flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-zinc-400 animate-pulse-slow" />
          <span className="text-sm font-medium text-zinc-300">Socrates</span>
          <span className="text-xs text-zinc-600 ml-1">education & productivity only</span>
        </div>
        {hasMessages && (
          <button
            onClick={clearChat}
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
            <div className="w-12 h-12 rounded-2xl bg-zinc-800/60 border border-zinc-700/40 flex items-center justify-center">
              <Bot className="w-5 h-5 text-zinc-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-zinc-300">Socrates</p>
              <p className="text-xs text-zinc-600 mt-1 max-w-[260px]">
                Ask me anything about studying, productivity, or{" "}
                {goal ? `your goal: "${goal}"` : "your current topic"}
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
                  className="text-left text-xs px-3 py-2 bg-zinc-800/40 border border-zinc-800/60
                             rounded-lg text-zinc-400 hover:text-zinc-200 hover:border-zinc-700/60
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
                               ${msg.role === "user" ? "bg-zinc-700" : "bg-zinc-800 border border-zinc-700/50"}`}>
                {msg.role === "user" ? (
                  <User className="w-3.5 h-3.5 text-zinc-300" />
                ) : (
                  <Bot className="w-3.5 h-3.5 text-zinc-400" />
                )}
              </div>
              <div
                className={`max-w-[80%] px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap
                             ${msg.role === "user"
                               ? "bg-zinc-800 text-zinc-200 rounded-tr-sm"
                               : "bg-zinc-900 border border-zinc-800/50 text-zinc-300 rounded-tl-sm"
                             }`}
              >
                {msg.content}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Streaming message */}
        {streamingContent && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex gap-3"
          >
            <div className="flex-shrink-0 w-7 h-7 rounded-full bg-zinc-800 border border-zinc-700/50 flex items-center justify-center">
              <Bot className="w-3.5 h-3.5 text-zinc-400" />
            </div>
            <div className="max-w-[80%] px-3.5 py-2.5 rounded-2xl rounded-tl-sm text-sm
                            leading-relaxed bg-zinc-900 border border-zinc-800/50 text-zinc-300 whitespace-pre-wrap">
              {streamingContent}
              <span className="inline-block w-1 h-3.5 ml-0.5 bg-zinc-400 animate-pulse rounded-sm align-text-bottom" />
            </div>
          </motion.div>
        )}

        {isChatLoading && !streamingContent && (
          <div className="flex gap-3">
            <div className="w-7 h-7 rounded-full bg-zinc-800 border border-zinc-700/50 flex items-center justify-center">
              <Loader2 className="w-3.5 h-3.5 text-zinc-400 animate-spin" />
            </div>
            <div className="flex items-center gap-1 px-3.5 py-2.5 bg-zinc-900 border border-zinc-800/50 rounded-2xl rounded-tl-sm">
              {[0, 1, 2].map((i) => (
                <motion.span
                  key={i}
                  className="w-1.5 h-1.5 rounded-full bg-zinc-500"
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
            <p className="text-xs text-red-400">{error}</p>
          </motion.div>
        )}
      </div>

      {/* Input */}
      <div className="flex-shrink-0 px-4 py-3 border-t border-zinc-800/50">
        <div className="flex items-end gap-2 bg-zinc-900 border border-zinc-800/60 rounded-xl
                        focus-within:border-zinc-700/60 transition-colors duration-150">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about studying, focus, or your goal..."
            rows={1}
            className="flex-1 bg-transparent px-3.5 py-3 text-sm text-zinc-200
                       placeholder:text-zinc-600 resize-y focus:outline-none
                       min-h-[44px] max-h-48 overflow-y-auto"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isChatLoading}
            className="flex items-center justify-center w-8 h-8 mb-1.5 mr-1.5 rounded-lg
                       bg-zinc-100 text-zinc-950 disabled:opacity-30 disabled:cursor-not-allowed
                       hover:bg-white transition-all duration-150 flex-shrink-0"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
        <p className="text-xs text-zinc-700 mt-1.5 text-center">
          Shift+Enter for newline · Enter to send
        </p>
      </div>
    </div>
  );
}
