import { useState } from "react";
import { X, Key, Timer, Eye, EyeOff, Cpu, Volume2, Play, Palette, CalendarClock, Sliders } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useShallow } from "zustand/react/shallow";
import { useStore, type SoundType, type Theme, type AIVendor } from "../../store/useStore";
import { AI_MODELS, VENDOR_LABELS, VENDOR_KEY_URLS } from "../../lib/ai";
import { previewSound } from "../../lib/sound";

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

const THEME_OPTIONS: { id: Theme; label: string; description: string; preview: string[] }[] = [
  { id: "dark",       label: "Zinc Dark",  description: "Default dark",         preview: ["#09090b", "#27272a", "#f4f4f5"] },
  { id: "light",      label: "Paper",      description: "Warm paper white",     preview: ["#faf8f1", "#e9e3d0", "#1c1917"] },
  { id: "catppuccin", label: "Catppuccin", description: "Mocha — soft pastels", preview: ["#1e1e2e", "#45475a", "#cdd6f4"] },
  { id: "gruvbox",    label: "Gruvbox",    description: "Retro warm earth",     preview: ["#282828", "#504945", "#ebdbb2"] },
  { id: "nord",       label: "Nord",       description: "Cool arctic blues",    preview: ["#2e3440", "#4c566a", "#eceff4"] },
];

const VENDOR_IDS: AIVendor[] = ["groq", "openai", "anthropic", "ollama"];

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
    autoSyncDeadlines,
    setAutoSyncDeadlines,
    showWeekNumbers,
    setShowWeekNumbers,
    weekStartsOn,
    setWeekStartsOn,
    weeklyGoalHours,
    setWeeklyGoalHours,
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
      autoSyncDeadlines: s.autoSyncDeadlines,
      setAutoSyncDeadlines: s.setAutoSyncDeadlines,
      showWeekNumbers: s.showWeekNumbers,
      setShowWeekNumbers: s.setShowWeekNumbers,
      weekStartsOn: s.weekStartsOn,
      setWeekStartsOn: s.setWeekStartsOn,
      weeklyGoalHours: s.weeklyGoalHours,
      setWeeklyGoalHours: s.setWeeklyGoalHours,
    }))
  );

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
          className="w-full max-w-md surface p-6 max-h-[85vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
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

          <div className="space-y-6">
            {/* Theme */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Palette className="w-3.5 h-3.5 text-muted" />
                <span className="text-xs font-medium text-foreground-secondary uppercase tracking-wider">
                  Theme
                </span>
              </div>
              <div className="grid grid-cols-1 gap-1.5">
                {THEME_OPTIONS.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTheme(t.id)}
                    className={`flex items-center justify-between px-3 py-2 rounded-lg border
                                text-sm transition-all duration-150
                                ${theme === t.id
                                  ? "bg-surface-hover border-border-active text-foreground"
                                  : "bg-transparent border-border text-foreground-secondary hover:text-foreground hover:border-border-active"
                                }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-0.5">
                        {t.preview.map((c, i) => (
                          <div key={i} className="w-3.5 h-3.5 rounded-full border border-border" style={{ backgroundColor: c }} />
                        ))}
                      </div>
                      <span className="font-medium">{t.label}</span>
                    </div>
                    <span className="text-xs text-muted">{t.description}</span>
                  </button>
                ))}
              </div>
            </section>

            {/* AI Vendor */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Cpu className="w-3.5 h-3.5 text-muted" />
                <span className="text-xs font-medium text-foreground-secondary uppercase tracking-wider">
                  AI Vendor
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1.5 mb-3">
                {VENDOR_IDS.map((v) => (
                  <button
                    key={v}
                    onClick={() => selectVendor(v)}
                    className={`px-3 py-2 rounded-lg border text-sm font-medium transition-all
                                ${localVendor === v
                                  ? "bg-surface-hover border-border-active text-foreground"
                                  : "bg-transparent border-border text-foreground-secondary hover:text-foreground hover:border-border-active"
                                }`}
                  >
                    {VENDOR_LABELS[v]}
                  </button>
                ))}
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
                      placeholder={localVendor === "groq" ? "gsk_..." : localVendor === "openai" ? "sk-..." : "sk-ant-..."}
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
                                    ? "bg-surface-hover border-border-active text-foreground"
                                    : "bg-transparent border-border text-foreground-secondary hover:text-foreground hover:border-border-active"
                                  }`}
                    >
                      <span className="font-medium">{m.label}</span>
                      <span className="text-xs font-mono text-muted">{m.id}</span>
                    </button>
                  ))}
                </div>
              </div>
            </section>

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
                                  ? "bg-surface-hover border-border-active text-foreground"
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
        className={`w-9 h-5 rounded-full relative transition-colors flex-shrink-0
                    ${value ? "bg-foreground" : "bg-surface-hover"}`}
      >
        <div
          className={`absolute top-0.5 w-4 h-4 rounded-full transition-all
                      ${value ? "left-[18px] bg-surface" : "left-0.5 bg-muted"}`}
        />
      </div>
    </button>
  );
}
