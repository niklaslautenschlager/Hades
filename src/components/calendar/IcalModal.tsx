import { useState } from "react";
import { X, Plus, Trash2, RefreshCw, Rss, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../../store/useStore";
import { fetchAndParseIcal } from "../../lib/ical";

interface Props {
  onClose: () => void;
}

export default function IcalModal({ onClose }: Props) {
  const { icalFeeds, addIcalFeed, removeIcalFeed, toggleIcalFeed, syncIcalEvents } = useStore(
    useShallow((s) => ({
      icalFeeds: s.icalFeeds,
      addIcalFeed: s.addIcalFeed,
      removeIcalFeed: s.removeIcalFeed,
      toggleIcalFeed: s.toggleIcalFeed,
      syncIcalEvents: s.syncIcalEvents,
    }))
  );

  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [color, setColor] = useState("#6b7280");
  const [syncing, setSyncing] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  function handleAdd() {
    if (!name.trim() || !url.trim()) return;
    const fname = name.trim();
    const furl = url.trim();
    addIcalFeed({ name: fname, url: furl, color, enabled: true });
    setName("");
    setUrl("");
    // Pull the feed immediately so its events show up without a manual sync.
    const added = useStore.getState().icalFeeds.find((f) => f.url === furl && f.name === fname);
    if (added) void handleSync(added.id);
  }

  async function handleSync(feedId: string) {
    // Read from the store (not the closure) so a just-added feed is found.
    const feed = useStore.getState().icalFeeds.find((f) => f.id === feedId);
    if (!feed) return;

    setSyncing((s) => ({ ...s, [feedId]: true }));
    setErrors((s) => ({ ...s, [feedId]: "" }));

    try {
      const events = await fetchAndParseIcal(feed);
      syncIcalEvents(feedId, events);
    } catch (err) {
      setErrors((s) => ({ ...s, [feedId]: String(err) }));
    } finally {
      setSyncing((s) => ({ ...s, [feedId]: false }));
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={{ type: "spring", stiffness: 400, damping: 30 }}
        className="w-full max-w-lg surface p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Rss className="w-4 h-4 text-foreground-secondary" />
            <h2 className="text-base font-semibold text-foreground">Calendar Feeds</h2>
          </div>
          <button onClick={onClose} className="btn-ghost !p-1.5">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Add feed form */}
        <div className="space-y-2 mb-5 pb-5 border-b border-border">
          <div className="flex gap-2">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Feed name"
              className="input-base flex-1"
            />
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="w-10 h-10 rounded-lg border border-border bg-surface-elevated cursor-pointer p-1"
            />
          </div>
          <div className="flex gap-2">
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://calendar.example.com/feed.ics"
              className="input-base flex-1 text-xs font-mono"
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            />
            <button
              onClick={handleAdd}
              disabled={!name.trim() || !url.trim()}
              className="btn-primary flex items-center gap-1.5 flex-shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              Add
            </button>
          </div>
        </div>

        {/* Feeds list */}
        <div className="space-y-2 max-h-72 overflow-y-auto">
          {icalFeeds.length === 0 && (
            <p className="text-sm text-muted text-center py-4">
              No feeds added yet. Subscribe to an .ics URL above.
            </p>
          )}
          {icalFeeds.map((feed) => (
            <div
              key={feed.id}
              className="flex items-center gap-3 p-3 surface"
            >
              <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: feed.color }} />

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground truncate">{feed.name}</span>
                  <button
                    onClick={() => toggleIcalFeed(feed.id)}
                    className={`text-xs px-1.5 py-0.5 rounded font-medium transition-all ${
                      feed.enabled
                        ? "bg-surface-hover text-foreground-secondary"
                        : "bg-surface-hover text-muted"
                    }`}
                  >
                    {feed.enabled ? "on" : "off"}
                  </button>
                </div>
                <p className="text-xs text-muted truncate font-mono">{feed.url}</p>
                {errors[feed.id] && (
                  <p className="text-xs text-red-400/80 mt-0.5">{errors[feed.id]}</p>
                )}
              </div>

              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  onClick={() => handleSync(feed.id)}
                  disabled={syncing[feed.id]}
                  className="flex items-center justify-center w-7 h-7 rounded-lg
                             text-muted hover:text-foreground hover:bg-surface-hover transition-all"
                  title="Sync now"
                >
                  {syncing[feed.id] ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3.5 h-3.5" />
                  )}
                </button>
                <button
                  onClick={() => removeIcalFeed(feed.id)}
                  className="flex items-center justify-center w-7 h-7 rounded-lg
                             text-muted hover:text-red-400 hover:bg-surface-hover transition-all"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </motion.div>
    </div>
  );
}
