import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bell, Info, Check, Sparkles, Timer, type LucideIcon } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useStore, type Toast } from "../store/useStore";

// §6.1 — the single shared transient-notification surface. All gentle,
// auto-dismissing in-app notifications go through useStore().pushToast(...).
// Non-blocking, dismiss by click or after a timeout (default 10s).

const ICONS: Record<NonNullable<Toast["icon"]>, LucideIcon> = {
  bell: Bell, info: Info, check: Check, sparkles: Sparkles, timer: Timer,
};

function ToastRow({ toast }: { toast: Toast }) {
  const dismiss = useStore((s) => s.dismissToast);
  const duration = toast.durationMs ?? 10_000;

  useEffect(() => {
    if (duration <= 0) return;
    const t = setTimeout(() => dismiss(toast.id), duration);
    return () => clearTimeout(t);
  }, [toast.id, duration, dismiss]);

  const Icon = toast.icon ? ICONS[toast.icon] : null;
  const accent =
    toast.tone === "error" ? "text-red-400" : toast.tone === "success" ? "text-green-500" : "text-accent";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 16, scale: 0.98 }}
      transition={{ type: "spring", stiffness: 380, damping: 30 }}
      onClick={() => dismiss(toast.id)}
      className="pointer-events-auto cursor-pointer surface border border-border rounded-xl shadow-2xl
                 px-3.5 py-2.5 w-[min(88vw,360px)] flex items-center gap-2.5"
    >
      {Icon && <Icon className={`w-4 h-4 flex-shrink-0 ${accent}`} />}
      <span className="flex-1 text-sm text-foreground-secondary">{toast.message}</span>
      {toast.actionLabel && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            toast.onAction?.();
            dismiss(toast.id);
          }}
          className="flex-shrink-0 text-xs font-medium text-accent hover:underline"
        >
          {toast.actionLabel}
        </button>
      )}
    </motion.div>
  );
}

export default function ToastHost() {
  const toasts = useStore(useShallow((s) => s.toasts));
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[260] flex flex-col items-center gap-2 pointer-events-none">
      <AnimatePresence>
        {toasts.map((t) => (
          <ToastRow key={t.id} toast={t} />
        ))}
      </AnimatePresence>
    </div>
  );
}
