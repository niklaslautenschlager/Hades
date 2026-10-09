import { useState, useEffect, useSyncExternalStore } from "react";
import { X, Key, Timer, Eye, EyeOff, Cpu, Volume2, Play, Palette, CalendarClock, Sliders, Cloud, RefreshCw, Download, RotateCw, ArrowUpCircle, Sparkles, AlertTriangle, Trash2, BookOpen, Database, Bot } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useShallow } from "zustand/react/shallow";
import { ask } from "@tauri-apps/plugin-dialog";
import { useStore, type SoundType, type AIVendor } from "../../store/useStore";
import { AI_MODELS, VENDOR_LABELS, VENDOR_KEY_URLS, VENDOR_INFO, VENDOR_TIER_LABELS } from "../../lib/ai";
import { getRagStatus, rebuildIndex, clearIndex, type RagStatus } from "../../lib/ragIndex";
import { THEMES, THEME_GROUPS } from "../../lib/themes";
import { previewSound } from "../../lib/sound";
import SyncSettings, { BetaBadge } from "./SyncSettings";
import { installUpdate, restartApp, hostPlatform } from "../../lib/updater";
import { getBridgeStatus, subscribeBridgeStatus } from "../../lib/workspaceBridge";

interface Props {
  onClose: () => void;
}

const SOUND_OPTIONS: { id: SoundType; label: string; description: string }[] = [
  { id: "chime", label: "Chime", description: "Pleasant bell arpeggio" },
  { id: "bell", label: "Bell", description: "Classic rich bell tone" },
  { id: "gong", label: "Gong", description: "Deep resonant gong" },
  { id: "digital", label: "Digital", description: "Short electronic beeps" },
  { id: "none", label: "None", description: "No sound" },
];

const VENDOR_IDS: AIVendor[] = ["groq", "openai", "anthropic", "deepseek", "ollama"];

export default function SettingsModal({ onClose }: Props) {
  const {
    workDuration,
    breakDuration,
    longBreakDuration,
    sessionsUntilLongBreak,
    setPomodoroSettings,
    soundType,
    setSoundType,
    soundVolume,
    setSoundVolume,
    theme,
    setTheme,
    aiVendor,
    aiVendorConfigs,
    setAIVendor,
    setAIVendorConfig,
    aiEnabled,
    setAiEnabled,
    aiUseStudyContext,
    setAiUseStudyContext,
    agentMode,
    setAgentMode,
    wipeAllAIData,
    autoSyncDeadlines,
    setAutoSyncDeadlines,
    sessionReflectionEnabled,
    setSessionReflectionEnabled,
    remindersEnabled,
    setRemindersEnabled,
    reminderLeadMinutes,
    setReminderLeadMinutes,
    setOnboardingSeen,
    showWeekNumbers,
    setShowWeekNumbers,
    weekStartsOn,
    setWeekStartsOn,
    weeklyGoalHours,
    setWeeklyGoalHours,
    syncFolder,
    updateAvailable,
    updateVersion,
    updateChangelog,
    updateAssetUrl,
    isUpdating,
    updateInstalled,
    updateError,
    setIsUpdating,
    setUpdateInstalled,
    setUpdateError,
  } = useStore(
    useShallow((s) => ({
      workDuration: s.workDuration,
      breakDuration: s.breakDuration,
      longBreakDuration: s.longBreakDuration,
      sessionsUntilLongBreak: s.sessionsUntilLongBreak,
      setPomodoroSettings: s.setPomodoroSettings,
      soundType: s.soundType,
      setSoundType: s.setSoundType,
      soundVolume: s.soundVolume,
      setSoundVolume: s.setSoundVolume,
      theme: s.theme,
      setTheme: s.setTheme,
      aiVendor: s.aiVendor,
      aiVendorConfigs: s.aiVendorConfigs,
      setAIVendor: s.setAIVendor,
      setAIVendorConfig: s.setAIVendorConfig,
      aiEnabled: s.aiEnabled,
      setAiEnabled: s.setAiEnabled,
      aiUseStudyContext: s.aiUseStudyContext,
      setAiUseStudyContext: s.setAiUseStudyContext,
      agentMode: s.agentMode,
      setAgentMode: s.setAgentMode,
      wipeAllAIData: s.wipeAllAIData,
      autoSyncDeadlines: s.autoSyncDeadlines,
      setAutoSyncDeadlines: s.setAutoSyncDeadlines,
      sessionReflectionEnabled: s.sessionReflectionEnabled,
      setSessionReflectionEnabled: s.setSessionReflectionEnabled,
      remindersEnabled: s.remindersEnabled,
      setRemindersEnabled: s.setRemindersEnabled,
      reminderLeadMinutes: s.reminderLeadMinutes,
      setReminderLeadMinutes: s.setReminderLeadMinutes,
      setOnboardingSeen: s.setOnboardingSeen,
      showWeekNumbers: s.showWeekNumbers,
      setShowWeekNumbers: s.setShowWeekNumbers,
      weekStartsOn: s.weekStartsOn,
      setWeekStartsOn: s.setWeekStartsOn,
      weeklyGoalHours: s.weeklyGoalHours,
      setWeeklyGoalHours: s.setWeeklyGoalHours,
      syncFolder:           s.syncFolder,
      updateAvailable:      s.updateAvailable,
      updateVersion:        s.updateVersion,
      updateChangelog:      s.updateChangelog,
      updateAssetUrl:       s.updateAssetUrl,
      isUpdating:           s.isUpdating,
      updateInstalled:      s.updateInstalled,
      updateError:          s.updateError,
      setIsUpdating:        s.setIsUpdating,
      setUpdateInstalled:   s.setUpdateInstalled,
      setUpdateError:       s.setUpdateError,
    }))
  );

  const platform = hostPlatform();

  const [localVendor, setLocalVendor] = useState<AIVendor>(aiVendor);
  const localConfig = aiVendorConfigs[localVendor];
  const [keyDraft, setKeyDraft] = useState(localConfig.apiKey);
  const [modelDraft, setModelDraft] = useState(localConfig.model);
  const [baseUrlDraft, setBaseUrlDraft] = useState(localConfig.baseUrl ?? "");
  const [showKey, setShowKey] = useState(false);

  const [work, setWork] = useState(String(workDuration));
  const [brk, setBrk] = useState(String(breakDuration));
  const [longBrk, setLongBrk] = useState(String(longBreakDuration));
  const [sessions, setSessions] = useState(String(sessionsUntilLongBreak));
  const [goalHours, setGoalHours] = useState(String(weeklyGoalHours));
  const [localSound, setLocalSound] = useState<SoundType>(soundType);
  const [localVolume, setLocalVolume] = useState(soundVolume);
  const [saved, setSaved] = useState(false);

  type Tab = "ai" | "appearance" | "productivity" | "sync" | "advanced";
  const [tab, setTab] = useState<Tab>("ai");

  // Study (RAG) index status, loaded lazily for the AI tab.
  const [ragStatus, setRagStatus] = useState<RagStatus | null>(null);
  const [ragBusy, setRagBusy] = useState(false);
  const [ragMsg, setRagMsg] = useState<string | null>(null);
  const ocrEscalations = useStore((s) => s.ocrEscalations);
  const ocrLog = useStore((s) => s.ocrLog);
  const mcpBridgeEnabled = useStore((s) => s.mcpBridgeEnabled);
  const setMcpBridgeEnabled = useStore((s) => s.setMcpBridgeEnabled);
  const bridgeStatus = useSyncExternalStore(subscribeBridgeStatus, getBridgeStatus);

  useEffect(() => {
    if (tab !== "ai") return;
    let alive = true;
    // Polled so a background build started by auto-indexing is visible here.
    const load = () => {
      getRagStatus()
        .then((s) => { if (alive) setRagStatus(s); })
        .catch(() => { /* status is informational */ });
    };
    load();
    const timer = setInterval(load, 5000);
    return () => { alive = false; clearInterval(timer); };
  }, [tab]);

  async function handleRebuildIndex(embedder: "auto" | "ollama" = "auto") {
    setRagBusy(true);
    setRagMsg(null);
    try {
      const count = await rebuildIndex(undefined, { embedder });
      const status = await getRagStatus();
      setRagStatus(status);
      setRagMsg(`Indexed ${count} chunk${count === 1 ? "" : "s"} with ${status.embedder?.label ?? "the built-in index"}.`);
    } catch (e) {
      setRagMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setRagBusy(false);
    }
  }

  function selectVendor(v: AIVendor) {
    setLocalVendor(v);
    const cfg = aiVendorConfigs[v];
    setKeyDraft(cfg.apiKey);
    setModelDraft(cfg.model);
    setBaseUrlDraft(cfg.baseUrl ?? "");
  }

  function handleSave() {
    setAIVendor(localVendor);
    setAIVendorConfig(localVendor, {
      apiKey: keyDraft.trim(),
      model: modelDraft,
      baseUrl: baseUrlDraft.trim() || undefined,
    });

    setPomodoroSettings({
      workDuration: Math.max(1, Math.min(90, parseInt(work) || 25)),
      breakDuration: Math.max(1, Math.min(30, parseInt(brk) || 5)),
      longBreakDuration: Math.max(1, Math.min(60, parseInt(longBrk) || 15)),
      sessionsUntilLongBreak: Math.max(2, Math.min(8, parseInt(sessions) || 4)),
    });
    setWeeklyGoalHours(Math.max(1, Math.min(168, parseInt(goalHours) || 20)));
    setSoundType(localSound);
    setSoundVolume(localVolume);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }

  const keyUrl = VENDOR_KEY_URLS[localVendor];
  const needsKey = localVendor !== "ollama";

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 8 }}
          transition={{ type: "spring", stiffness: 400, damping: 30 }}
          className="w-full max-w-2xl surface p-6 max-h-[85vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-5 flex-shrink-0">
            <h2 className="text-base font-semibold text-foreground">Settings</h2>
            <button
              onClick={onClose}
              className="flex items-center justify-center w-7 h-7 rounded-lg
                         text-muted hover:text-foreground hover:bg-surface-hover
                         transition-all duration-150"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex gap-5 flex-1 min-h-0">
            {/* Tab rail */}
            <nav className="flex flex-col gap-1 w-32 flex-shrink-0">
              {([
                { id: "ai", label: "AI", icon: Sparkles },
                { id: "appearance", label: "Appearance", icon: Palette },
                { id: "productivity", label: "Productivity", icon: Timer },
                { id: "sync", label: "Sync", icon: Cloud },
                { id: "advanced", label: "Advanced", icon: Sliders },
              ] as { id: Tab; label: string; icon: typeof Sparkles }[]).map((t) => {
                const Icon = t.icon;
                const active = tab === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-left transition-all
                                ${active
                                  ? "bg-accent-soft text-foreground"
                                  : "text-foreground-secondary hover:text-foreground hover:bg-surface-hover"}`}
                  >
                    <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                    {t.label}
                    {t.id === "sync" && <BetaBadge className="ml-auto" />}
                    {t.id === "advanced" && updateAvailable && (
                      <span className="ml-auto w-1.5 h-1.5 rounded-full bg-green-500" />
                    )}
                  </button>
                );
              })}
            </nav>

            {/* Content pane */}
            <div className="flex-1 min-w-0 space-y-6 overflow-y-auto pr-1">
            {/* Update (shown only when available) */}
            {tab === "advanced" && updateAvailable && (
              <section className="rounded-xl border border-border-active bg-surface-hover px-4 py-3">
                <div className="flex items-center gap-2 mb-2">
                  <ArrowUpCircle className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
                  <span className="text-xs font-medium text-foreground-secondary uppercase tracking-wider">
                    Update available — v{updateVersion}
                  </span>
                </div>

                {updateChangelog && (
                  <pre className="text-xs text-muted whitespace-pre-wrap font-sans
                                  max-h-28 overflow-y-auto mb-3 leading-relaxed">
                    {updateChangelog.trim()}
                  </pre>
                )}

                {updateError && (
                  <p className="text-xs text-red-400 mb-2">{updateError}</p>
                )}

                {updateInstalled ? (
                  platform === "linux" ? (
                    <button
                      onClick={() => restartApp().catch(() => {})}
                      className="flex items-center gap-2 w-full justify-center px-3 py-2
                                 rounded-lg bg-accent-gradient text-[var(--accent-contrast)] text-xs font-semibold
                                 glow-accent-sm hover:brightness-105 transition-all"
                    >
                      <RotateCw className="w-3.5 h-3.5" />
                      Restart to apply
                    </button>
                  ) : platform === "macos" ? (
                    <p className="text-xs text-foreground-secondary text-center py-1 leading-relaxed">
                      Installer opened — drag Hades to Applications, then relaunch.
                    </p>
                  ) : (
                    <p className="text-xs text-foreground-secondary text-center py-1 leading-relaxed">
                      Installer launched — follow the on-screen prompts to complete the update.
                    </p>
                  )
                ) : (
                  <button
                    disabled={isUpdating || !updateAssetUrl}
                    onClick={async () => {
                      if (!updateAssetUrl) return;
                      setIsUpdating(true);
                      setUpdateError(null);
                      try {
                        await installUpdate(updateAssetUrl);
                        setUpdateInstalled(true);
                      } catch (e) {
                        setUpdateError(e instanceof Error ? e.message : String(e));
                      } finally {
                        setIsUpdating(false);
                      }
                    }}
                    className="flex items-center gap-2 w-full justify-center px-3 py-2
                               rounded-lg bg-accent-gradient text-[var(--accent-contrast)] text-xs font-semibold
                               glow-accent-sm hover:brightness-105 transition-all disabled:opacity-50"
                  >
                    {isUpdating ? (
                      <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Downloading…</>
                    ) : (
                      <><Download className="w-3.5 h-3.5" /> Install update</>
                    )}
                  </button>
                )}
              </section>
            )}

            {/* Theme */}
            {tab === "appearance" && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Palette className="w-3.5 h-3.5 text-muted" />
                <span className="text-xs font-medium text-foreground-secondary uppercase tracking-wider">
                  Theme
                </span>
              </div>
              <div className="space-y-3">
                {THEME_GROUPS.map((group) => (
                  <div key={group}>
                    <div className="text-[10px] font-medium uppercase tracking-wider text-muted mb-1.5 px-0.5">
                      {group}
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {THEMES.filter((t) => t.group === group).map((t) => {
                        const selected = theme === t.id;
                        return (
                          <button
                            key={t.id}
                            onClick={() => setTheme(t.id)}
                            title={t.description}
                            className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg border
                                        text-sm transition-all duration-150
                                        ${selected
                                          ? "border-accent bg-accent-soft text-foreground"
                                          : "bg-transparent border-border text-foreground-secondary hover:text-foreground hover:border-border-active"
                                        }`}
                          >
                            <span
                              className="flex-shrink-0 w-7 h-7 rounded-md border border-border overflow-hidden relative"
                              style={{ background: t.swatch[0] }}
                            >
                              <span
                                className="absolute bottom-0 right-0 w-4 h-4 rounded-tl-md"
                                style={{ background: `linear-gradient(135deg, ${t.swatch[1]}, ${t.swatch[2]})` }}
                              />
                            </span>
                            <span className="font-medium text-xs truncate">{t.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </section>
            )}

            {/* AI Assistant */}
            {tab === "ai" && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="w-3.5 h-3.5 text-muted" />
                <span className="text-xs font-medium text-foreground-secondary uppercase tracking-wider">
                  AI Assistant
                </span>
              </div>

              <Toggle
                label="Enable AI features"
                description="When off, the assistant and all AI options are hidden. Your data stays on your device."
                value={aiEnabled}
                onChange={setAiEnabled}
              />

              <div className={`mt-3 ${aiEnabled ? "" : "opacity-40 pointer-events-none select-none"}`}>
              <div className="grid grid-cols-2 gap-1.5 mb-2">
                {VENDOR_IDS.map((v) => (
                  <button
                    key={v}
                    onClick={() => selectVendor(v)}
                    className={`px-3 py-2 rounded-lg border text-sm font-medium transition-all
                                ${localVendor === v
                                  ? "bg-accent-soft border-accent text-foreground"
                                  : "bg-transparent border-border text-foreground-secondary hover:text-foreground hover:border-border-active"
                                }`}
                  >
                    {VENDOR_LABELS[v]}
                  </button>
                ))}
              </div>

              {/* Free/local vs paid/cloud disclaimer */}
              <div className="flex items-start gap-2 mb-3 px-2.5 py-2 rounded-lg bg-surface-hover border border-border">
                <span
                  className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded flex-shrink-0
                              ${VENDOR_INFO[localVendor].tier === "local"
                                ? "bg-green-500/15 text-green-400"
                                : VENDOR_INFO[localVendor].tier === "free-api"
                                ? "bg-sky-500/15 text-sky-400"
                                : "bg-amber-500/15 text-amber-400"}`}
                >
                  {VENDOR_TIER_LABELS[VENDOR_INFO[localVendor].tier]}
                </span>
                <p className="text-xs text-muted leading-relaxed">{VENDOR_INFO[localVendor].note}</p>
              </div>

              {needsKey && (
                <>
                  <div className="flex items-center gap-2 mb-2">
                    <Key className="w-3 h-3 text-muted" />
                    <span className="text-xs text-muted">API Key</span>
                    {keyUrl && (
                      <a
                        href={keyUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-auto text-xs text-muted hover:text-foreground-secondary transition-colors"
                      >
                        get a key →
                      </a>
                    )}
                  </div>
                  <div className="relative mb-3">
                    <input
                      type={showKey ? "text" : "password"}
                      value={keyDraft}
                      onChange={(e) => setKeyDraft(e.target.value)}
                      placeholder={localVendor === "groq" ? "gsk_..." : localVendor === "anthropic" ? "sk-ant-..." : "sk-..."}
                      className="input-base pr-10 font-mono text-xs"
                    />
                    <button
                      onClick={() => setShowKey(!showKey)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted
                                 hover:text-foreground-secondary transition-colors"
                    >
                      {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </>
              )}

              {localVendor === "ollama" && (
                <div className="mb-3">
                  <label className="block text-xs text-muted mb-1">Base URL</label>
                  <input
                    type="text"
                    value={baseUrlDraft}
                    onChange={(e) => setBaseUrlDraft(e.target.value)}
                    placeholder="http://localhost:11434"
                    className="input-base font-mono text-xs"
                  />
                  <p className="text-xs text-muted mt-1">
                    Requires <code className="font-mono">ollama serve</code> running locally.
                  </p>
                </div>
              )}

              <div>
                <label className="block text-xs text-muted mb-1.5">Model</label>
                <div className="flex flex-col gap-1.5">
                  {AI_MODELS[localVendor].map((m) => (
                    <button
                      key={m.id}
                      onClick={() => setModelDraft(m.id)}
                      className={`flex items-center justify-between px-3 py-2 rounded-lg border
                                  text-sm transition-all duration-150
                                  ${modelDraft === m.id
                                    ? "bg-accent-soft border-accent text-foreground"
                                    : "bg-transparent border-border text-foreground-secondary hover:text-foreground hover:border-border-active"
                                  }`}
                    >
                      <span className="font-medium">{m.label}</span>
                      <span className="text-xs font-mono text-muted">{m.id}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Study context (local RAG over notes + PDFs) */}
              <div className="mt-3 space-y-2.5">
                <Toggle
                  label="Use my notes as context"
                  description="Shares your open note and PDF, plus the most relevant notes, PDF passages, calendar events and tasks, with the assistant when you chat. Only fully private with Ollama — cloud vendors receive that text."
                  value={aiUseStudyContext}
                  onChange={setAiUseStudyContext}
                />

                {/* Study index (RAG) */}
                <div className="rounded-lg border border-border px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Database className="w-3.5 h-3.5 text-muted flex-shrink-0" />
                      <span className="text-xs text-foreground-secondary truncate">
                        {ragStatus === null
                          ? "Study index"
                          : !ragStatus.embedder
                          ? "Study index — not built yet"
                          : `${ragStatus.chunks} chunk${ragStatus.chunks === 1 ? "" : "s"}${ragStatus.lastBuilt ? ` · ${new Date(ragStatus.lastBuilt).toLocaleDateString()}` : ""}${ragStatus.pending > 0 ? ` · ${ragStatus.pending} item${ragStatus.pending === 1 ? "" : "s"} waiting` : ""}`}
                      </span>
                    </div>
                    <button
                      onClick={() => handleRebuildIndex()}
                      disabled={ragBusy}
                      className="btn-ghost text-xs border border-border flex items-center gap-1.5 flex-shrink-0 disabled:opacity-50"
                    >
                      {ragBusy ? <RefreshCw className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                      {ragBusy ? "Indexing…" : "Rebuild"}
                    </button>
                  </div>
                  <p className="text-[11px] text-muted mt-1.5 leading-relaxed">
                    {ragStatus?.embedder?.kind === "ollama"
                      ? `Semantic index via ${ragStatus.embedder.label}.${ragStatus.embedderReady ? "" : " Ollama isn't reachable right now, so search falls back to keywords until it's back — Rebuild switches to the built-in index."}`
                      : "Built-in on-device index — works with every AI vendor, no setup needed."}{" "}
                    Notes, PDFs, calendar events and tasks re-index automatically as they change.
                  </p>
                  {ragStatus?.embedder?.kind === "local" && ragStatus.ollamaReachable && (
                    <button
                      onClick={() => handleRebuildIndex("ollama")}
                      disabled={ragBusy}
                      className="btn-ghost text-xs border border-border mt-1.5 disabled:opacity-50"
                    >
                      Upgrade to semantic index (Ollama)
                    </button>
                  )}
                  {ragMsg && <p className="text-[11px] text-foreground-secondary mt-1">{ragMsg}</p>}
                  {ocrEscalations > 0 && (
                    <p className="text-[11px] text-muted mt-1" title={ocrLog.slice(0, 8).join("\n")}>
                      OCR fallbacks used: {ocrEscalations}. A high count means many PDFs lack a text layer.
                    </p>
                  )}
                </div>

                {/* Agent mode */}
                <Toggle
                  label="Agent mode"
                  description="Let Socrates act on the app — create tasks, calendar events, flashcards & notes from your requests. It always tells you what it did."
                  value={agentMode}
                  onChange={setAgentMode}
                />
                <div className="flex items-center gap-1.5 px-0.5">
                  <Bot className="w-3 h-3 text-muted flex-shrink-0" />
                  <p className="text-xs text-muted">Additive only — there are no delete actions.</p>
                </div>
              </div>
              </div>
            </section>
            )}

            {/* Productivity tab */}
            {tab === "productivity" && (
            <>
            {/* Calendar / Productivity Behavior */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <CalendarClock className="w-3.5 h-3.5 text-muted" />
                <span className="text-xs font-medium text-foreground-secondary uppercase tracking-wider">
                  Calendar & Tasks
                </span>
              </div>
              <div className="space-y-2.5">
                <Toggle
                  label="Auto-sync deadlines to Tasks"
                  description="Calendar events marked as deadlines show up in the to-do list."
                  value={autoSyncDeadlines}
                  onChange={setAutoSyncDeadlines}
                />
                <Toggle
                  label="Week starts on Monday"
                  description="Otherwise weeks start on Sunday."
                  value={weekStartsOn === 1}
                  onChange={(v) => setWeekStartsOn(v ? 1 : 0)}
                />
                <Toggle
                  label="Show week numbers"
                  description="Display ISO week numbers in calendar views."
                  value={showWeekNumbers}
                  onChange={setShowWeekNumbers}
                />
                <Toggle
                  label="Ask for a session reflection"
                  description="After each focus session, a quick prompt asks what you got done — logged for your weekly review."
                  value={sessionReflectionEnabled}
                  onChange={setSessionReflectionEnabled}
                />
                <Toggle
                  label="Event reminders"
                  description="A gentle in-app reminder shortly before a calendar event starts."
                  value={remindersEnabled}
                  onChange={setRemindersEnabled}
                />
                {remindersEnabled && (
                  <div className="flex items-center justify-between pl-1">
                    <span className="text-xs text-muted">Remind me this many minutes before</span>
                    <input
                      type="number"
                      min={1}
                      max={120}
                      value={reminderLeadMinutes}
                      onChange={(e) =>
                        setReminderLeadMinutes(Math.max(1, Math.min(120, parseInt(e.target.value) || 10)))
                      }
                      className="input-base w-16 text-center text-sm font-mono"
                    />
                  </div>
                )}
              </div>
            </section>

            {/* Pomodoro Settings */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Timer className="w-3.5 h-3.5 text-muted" />
                <span className="text-xs font-medium text-foreground-secondary uppercase tracking-wider">
                  Timer Intervals (minutes)
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Work", value: work, set: setWork },
                  { label: "Short break", value: brk, set: setBrk },
                  { label: "Long break", value: longBrk, set: setLongBrk },
                  { label: "Sessions until long break", value: sessions, set: setSessions },
                ].map(({ label, value, set }) => (
                  <div key={label}>
                    <label className="block text-xs text-muted mb-1">{label}</label>
                    <input
                      type="number"
                      value={value}
                      onChange={(e) => set(e.target.value)}
                      className="input-base text-center font-mono"
                    />
                  </div>
                ))}
              </div>
            </section>

            {/* Weekly Goal */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Sliders className="w-3.5 h-3.5 text-muted" />
                <span className="text-xs font-medium text-foreground-secondary uppercase tracking-wider">
                  Weekly Focus Goal
                </span>
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  value={goalHours}
                  onChange={(e) => setGoalHours(e.target.value)}
                  className="input-base text-center font-mono w-24"
                />
                <span className="text-xs text-muted">hours per week</span>
              </div>
            </section>

            {/* Sound Settings */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Volume2 className="w-3.5 h-3.5 text-muted" />
                <span className="text-xs font-medium text-foreground-secondary uppercase tracking-wider">
                  Sound
                </span>
              </div>
              <div className="flex flex-col gap-1.5 mb-3">
                {SOUND_OPTIONS.map((s) => (
                  <div
                    key={s.id}
                    className={`flex items-center justify-between px-3 py-2.5 rounded-lg border cursor-pointer
                                text-sm transition-all duration-150
                                ${localSound === s.id
                                  ? "bg-accent-soft border-accent text-foreground"
                                  : "bg-transparent border-border text-foreground-secondary hover:text-foreground hover:border-border-active"
                                }`}
                    onClick={() => setLocalSound(s.id)}
                  >
                    <div>
                      <span className="font-medium">{s.label}</span>
                      <span className="text-xs text-muted ml-2">{s.description}</span>
                    </div>
                    {s.id !== "none" && (
                      <button
                        onClick={(e) => { e.stopPropagation(); previewSound(s.id, localVolume); }}
                        className="p-1 rounded text-muted hover:text-foreground-secondary transition-colors"
                        title="Preview"
                      >
                        <Play className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">Volume</label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={localVolume}
                    onChange={(e) => setLocalVolume(parseFloat(e.target.value))}
                    className="flex-1 accent-current"
                  />
                  <span className="text-xs text-muted font-mono w-8 text-right">
                    {Math.round(localVolume * 100)}%
                  </span>
                </div>
              </div>
            </section>
            </>
            )}

            {/* Sync tab — Cloud Sync */}
            {tab === "sync" && <SyncSettings />}

            {/* Advanced tab — Danger Zone (the Update banner above is also gated here) */}
            {tab === "advanced" && (
            <section>
              {/* Replay onboarding */}
              <div className="rounded-xl border border-border px-4 py-3 mb-5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">Replay the tutorial</p>
                  <p className="text-xs text-muted mt-0.5">Show the first-launch walkthrough again.</p>
                </div>
                <button
                  onClick={() => { setOnboardingSeen(false); onClose(); }}
                  className="btn-ghost text-xs border border-border flex-shrink-0"
                >
                  Replay
                </button>
              </div>

              {/* MCP bridge — opt-in, needs a sync folder */}
              <div className="mb-5">
                <div className={syncFolder ? "" : "opacity-50 pointer-events-none"} aria-disabled={!syncFolder}>
                  <Toggle
                    label="Share live workspace with MCP server (opt-in)"
                    description="Writes your schedule, open notes, the open PDF's text and study stats to a hidden .hades-bridge folder inside your sync folder, so a local MCP client can read them and log study time. Your cloud provider may upload those files. Off by default; turning it off deletes the snapshot."
                    value={mcpBridgeEnabled && !!syncFolder}
                    onChange={(v) => { if (syncFolder) setMcpBridgeEnabled(v); }}
                  />
                </div>
                <p className={`text-xs mt-1.5 px-1 ${mcpBridgeEnabled && bridgeStatus.state === "error" ? "text-red-400" : "text-muted"}`}>
                  {!syncFolder
                    ? "Choose a sync folder in the Sync tab first."
                    : !mcpBridgeEnabled
                    ? "Off — nothing is written."
                    : bridgeStatus.state === "error"
                    ? `Problem: ${bridgeStatus.error}`
                    : bridgeStatus.lastWriteAt
                    ? `Sharing. Last update ${new Date(bridgeStatus.lastWriteAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`
                    : "Starting…"}
                </p>
              </div>

              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
                <span className="text-xs font-medium text-red-400 uppercase tracking-wider">
                  Danger Zone
                </span>
              </div>
              <div className="rounded-xl border border-red-900/40 bg-red-950/20 px-4 py-3">
                <p className="text-sm font-medium text-foreground">Wipe all AI data</p>
                <p className="text-xs text-muted mt-0.5 mb-3 leading-relaxed">
                  Permanently deletes every saved conversation, the assistant's memory, and the
                  local study index. Your API keys and settings are kept. This cannot be undone.
                </p>
                <button
                  onClick={async () => {
                    const ok = await ask(
                      "Permanently delete all AI conversations, memory, and the study index? This cannot be undone.",
                      { title: "Wipe all AI data", kind: "warning", okLabel: "Wipe everything", cancelLabel: "Cancel" }
                    ).catch(() => false);
                    if (ok) {
                      wipeAllAIData();
                      await clearIndex();
                      setRagStatus(null);
                      setRagMsg(null);
                    }
                  }}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg border border-red-900/50
                             text-xs font-semibold text-red-400 hover:bg-red-950/40 transition-all"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Wipe all AI data
                </button>
              </div>
            </section>
            )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 mt-6 pt-5 border-t border-border">
            <button onClick={onClose} className="btn-ghost">
              Cancel
            </button>
            <button onClick={handleSave} className="btn-primary min-w-[72px]">
              {saved ? "Saved" : "Save"}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

function Toggle({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!value)}
      className="flex items-center justify-between gap-3 w-full px-3 py-2 rounded-lg border border-border
                 hover:border-border-active text-left transition-all duration-150"
    >
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium text-foreground">{label}</span>
        {description && (
          <p className="text-xs text-muted mt-0.5">{description}</p>
        )}
      </div>
      <div
        className={`w-9 h-5 rounded-full relative transition-all flex-shrink-0
                    ${value ? "bg-accent-gradient glow-accent-sm" : "bg-surface-hover"}`}
      >
        <div
          className={`absolute top-0.5 w-4 h-4 rounded-full transition-all
                      ${value ? "left-[18px] bg-[var(--accent-contrast)]" : "left-0.5 bg-muted"}`}
        />
      </div>
    </button>
  );
}
