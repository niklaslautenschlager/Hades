import { useState } from "react";
import { X, Key, Timer, Eye, EyeOff, Cpu, Volume2, Play } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useShallow } from "zustand/react/shallow";
import { useStore, type SoundType } from "../../store/useStore";
import { GROQ_MODELS } from "../../lib/ai";
import { previewSound } from "../../lib/sound";
import type { GroqModelId } from "../../store/useStore";

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

export default function SettingsModal({ onClose }: Props) {
  const {
    apiKey,
    setApiKey,
    groqModel,
    setGroqModel,
    workDuration,
    breakDuration,
    longBreakDuration,
    sessionsUntilLongBreak,
    setPomodoroSettings,
    soundType,
    setSoundType,
    soundVolume,
    setSoundVolume,
  } = useStore(
    useShallow((s) => ({
      apiKey: s.apiKey,
      setApiKey: s.setApiKey,
      groqModel: s.groqModel,
      setGroqModel: s.setGroqModel,
      workDuration: s.workDuration,
      breakDuration: s.breakDuration,
      longBreakDuration: s.longBreakDuration,
      sessionsUntilLongBreak: s.sessionsUntilLongBreak,
      setPomodoroSettings: s.setPomodoroSettings,
      soundType: s.soundType,
      setSoundType: s.setSoundType,
      soundVolume: s.soundVolume,
      setSoundVolume: s.setSoundVolume,
    }))
  );

  const [localKey, setLocalKey] = useState(apiKey);
  const [showKey, setShowKey] = useState(false);
  const [localModel, setLocalModel] = useState<GroqModelId>(groqModel);
  const [work, setWork] = useState(String(workDuration));
  const [brk, setBrk] = useState(String(breakDuration));
  const [longBrk, setLongBrk] = useState(String(longBreakDuration));
  const [sessions, setSessions] = useState(String(sessionsUntilLongBreak));
  const [localSound, setLocalSound] = useState<SoundType>(soundType);
  const [localVolume, setLocalVolume] = useState(soundVolume);
  const [saved, setSaved] = useState(false);

  function handleSave() {
    setApiKey(localKey.trim());
    setGroqModel(localModel);
    setPomodoroSettings({
      workDuration: Math.max(1, Math.min(90, parseInt(work) || 25)),
      breakDuration: Math.max(1, Math.min(30, parseInt(brk) || 5)),
      longBreakDuration: Math.max(1, Math.min(60, parseInt(longBrk) || 15)),
      sessionsUntilLongBreak: Math.max(2, Math.min(8, parseInt(sessions) || 4)),
    });
    setSoundType(localSound);
    setSoundVolume(localVolume);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }

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
            {/* Groq API Key */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Key className="w-3.5 h-3.5 text-muted" />
                <span className="text-xs font-medium text-foreground-secondary uppercase tracking-wider">
                  Groq API Key
                </span>
                <a
                  href="https://console.groq.com/keys"
                  target="_blank"
                  rel="noreferrer"
                  className="ml-auto text-xs text-muted hover:text-foreground-secondary transition-colors"
                >
                  console.groq.com
                </a>
              </div>
              <div className="relative">
                <input
                  type={showKey ? "text" : "password"}
                  value={localKey}
                  onChange={(e) => setLocalKey(e.target.value)}
                  placeholder="gsk_..."
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
              <p className="mt-1.5 text-xs text-muted">
                Free tier available. Stored locally, never transmitted elsewhere.
              </p>
            </section>

            {/* Model selection */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Cpu className="w-3.5 h-3.5 text-muted" />
                <span className="text-xs font-medium text-foreground-secondary uppercase tracking-wider">
                  Model
                </span>
              </div>
              <div className="flex flex-col gap-1.5">
                {GROQ_MODELS.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setLocalModel(m.id)}
                    className={`flex items-center justify-between px-3 py-2.5 rounded-lg border
                                text-sm transition-all duration-150
                                ${localModel === m.id
                                  ? "bg-surface-hover border-border-active text-foreground"
                                  : "bg-transparent border-border text-foreground-secondary hover:text-foreground hover:border-border-active"
                                }`}
                  >
                    <span className="font-medium">{m.label}</span>
                    <span className="text-xs font-mono text-muted">{m.id}</span>
                  </button>
                ))}
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
