import { useState } from "react";
import { Sparkles, Loader2, RefreshCw } from "lucide-react";
import { marked } from "marked";
import { useStore } from "../../store/useStore";
import { generateWeeklyReview, hasWeekData } from "../../lib/weeklyReview";

// F13 — an AI narrative of the week's focus, on demand (so we never spend
// tokens unprompted). Only shown when AI is enabled and there's week data.

export default function WeeklyReviewCard() {
  const aiEnabled = useStore((s) => s.aiEnabled);
  const [review, setReview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!aiEnabled || !hasWeekData()) return null;

  async function run() {
    setBusy(true);
    setError(null);
    try {
      setReview(await generateWeeklyReview());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="surface p-5">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-accent" />
          <h2 className="text-sm font-semibold text-foreground">Weekly Review</h2>
        </div>
        <button
          onClick={run}
          disabled={busy}
          className="btn-ghost text-xs border border-border flex items-center gap-1.5 disabled:opacity-50"
        >
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : review ? <RefreshCw className="w-3 h-3" /> : <Sparkles className="w-3 h-3" />}
          {busy ? "Thinking…" : review ? "Regenerate" : "Generate"}
        </button>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {review ? (
        <div
          className="markdown-body prose-chat text-sm"
          dangerouslySetInnerHTML={{ __html: marked.parse(review) as string }}
        />
      ) : (
        !error && (
          <p className="text-xs text-muted leading-relaxed">
            Get an AI summary of this week's focus, what you accomplished, and a suggestion for next week.
          </p>
        )
      )}
    </div>
  );
}
