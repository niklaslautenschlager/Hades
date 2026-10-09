import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { open } from "@tauri-apps/plugin-dialog";
import { Cloud, CloudOff, FolderOpen, RefreshCw, AlertTriangle, Download, Check } from "lucide-react";
import { useStore } from "../../store/useStore";
import { SYNC_BETA_NOTICE, saveBackupViaDialog, syncNow } from "../../lib/noteSync";

export function BetaBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center text-[9px] font-bold uppercase tracking-wider leading-none
                  px-1.5 py-1 rounded border border-amber-500/60 bg-amber-500/20 text-foreground ${className}`}
    >
      Beta
    </span>
  );
}

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : typeof e === "string" ? e : "Unknown error";
}

type Pending = { kind: "enable" } | { kind: "folder"; path: string; switching: boolean } | null;
type BackupState =
  | { state: "idle" }
  | { state: "saving" }
  | { state: "saved"; path: string }
  | { state: "error"; message: string };

function SyncSwitch({ label, description, value, onChange }: {
  label: string;
  description: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!value)}
      role="switch"
      aria-checked={value}
      className="flex items-center justify-between gap-3 w-full px-3 py-2 rounded-lg border border-border
                 hover:border-border-active text-left transition-all duration-150"
    >
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <p className="text-xs text-muted mt-0.5">{description}</p>
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

function ConfirmModal({ pending, backup, onBackup, onCancel, onConfirm }: {
  pending: NonNullable<Pending>;
  backup: BackupState;
  onBackup: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onCancel();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel]);

  const switching = pending.kind === "folder" && pending.switching;
  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="sync-confirm-title"
        className="surface w-full max-w-md p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
          <h3 id="sync-confirm-title" className="text-sm font-semibold text-foreground">
            {switching ? "Switch sync folder?" : pending.kind === "folder" ? "Use this sync folder?" : "Turn on Cloud Sync?"}
          </h3>
          <BetaBadge className="ml-auto" />
        </div>

        <p className="text-sm text-foreground leading-relaxed">{SYNC_BETA_NOTICE}</p>
        <p className="text-xs text-muted mt-2 leading-relaxed">
          {pending.kind === "folder" ? (
            <>
              Hades will merge your notes with whatever is in <span className="font-mono break-all">{pending.path}</span>.
              Notes that exist on both sides with different text are kept as conflict copies, never overwritten.
            </>
          ) : (
            <>
              Hades will start writing your notes to a folder you choose and merging changes from your other devices.
            </>
          )}
        </p>

        <div className="mt-4 rounded-lg border border-border px-3 py-2.5 flex items-center gap-3">
          <div className="flex-1 min-w-0 text-xs">
            {backup.state === "saved" ? (
              <span className="flex items-center gap-1.5 text-foreground">
                <Check className="w-3.5 h-3.5 flex-shrink-0 text-green-500" />
                <span className="truncate font-mono" title={backup.path}>Saved: {backup.path}</span>
              </span>
            ) : backup.state === "error" ? (
              <span className="text-red-400">Backup failed: {backup.message}</span>
            ) : backup.state === "saving" ? (
              <span className="text-muted">Saving backup…</span>
            ) : (
              <span className="text-muted">Saves your notes and app data as a JSON file you choose. API keys are left out.</span>
            )}
          </div>
          <button
            onClick={onBackup}
            disabled={backup.state === "saving"}
            className="btn-ghost text-xs border border-border flex-shrink-0 flex items-center gap-1.5 disabled:opacity-40"
          >
            <Download className="w-3.5 h-3.5" />
            {backup.state === "saved" ? "Back up again" : "Back up now"}
          </button>
        </div>

        <div className="flex items-center justify-end gap-3 mt-5">
          <button onClick={onCancel} className="btn-ghost" autoFocus>
            Cancel
          </button>
          <button onClick={onConfirm} className="btn-primary">
            I have a backup — continue
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default function SyncSettings() {
  const syncEnabled = useStore((s) => s.syncEnabled);
  const syncFolder = useStore((s) => s.syncFolder);
  const lastSyncAt = useStore((s) => s.lastSyncAt);
  const syncStatus = useStore((s) => s.syncStatus);
  const syncError = useStore((s) => s.syncError);
  const pendingCount = useStore((s) => s.pendingCount);
  const nextSyncAt = useStore((s) => s.nextSyncAt);
  const setSyncEnabled = useStore((s) => s.setSyncEnabled);
  const setSyncFolder = useStore((s) => s.setSyncFolder);

  const [pending, setPending] = useState<Pending>(null);
  const [backup, setBackup] = useState<BackupState>({ state: "idle" });
  const [folderError, setFolderError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const retrying = syncEnabled && (syncStatus === "offline" || syncStatus === "error");
  useEffect(() => {
    if (!retrying) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [retrying]);

  async function pickFolder() {
    setFolderError(null);
    try {
      const selected = await open({ directory: true, multiple: false });
      if (selected && typeof selected === "string") {
        setBackup({ state: "idle" });
        setPending({ kind: "folder", path: selected, switching: syncFolder !== null });
      }
    } catch (e) {
      setFolderError(`Couldn't open the folder picker: ${errText(e)}`);
    }
  }

  async function runBackup() {
    setBackup({ state: "saving" });
    try {
      const path = await saveBackupViaDialog();
      setBackup(path ? { state: "saved", path } : { state: "idle" });
    } catch (e) {
      setBackup({ state: "error", message: errText(e) });
    }
  }

  function confirm() {
    if (!pending) return;
    if (pending.kind === "enable") setSyncEnabled(true);
    else setSyncFolder(pending.path);
    setPending(null);
  }

  const busy = syncStatus === "syncing";
  const retryIn = retrying && nextSyncAt > 0 ? formatCountdown(nextSyncAt - now) : null;

  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        <Cloud className="w-3.5 h-3.5 text-muted" />
        <span className="text-xs font-medium text-foreground-secondary uppercase tracking-wider">
          Cloud Sync
        </span>
        <BetaBadge />
      </div>

      <div
        role="note"
        className="flex items-start gap-2.5 mb-4 px-3 py-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10"
      >
        <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-500" />
        <p className="text-xs text-foreground leading-relaxed">{SYNC_BETA_NOTICE}</p>
      </div>

      <div className="space-y-3">
        <SyncSwitch
          label="Enable cloud sync"
          description="Keeps your notes in sync, about every 30 seconds, with a folder you control (Syncthing, Dropbox, Google Drive, etc.)."
          value={syncEnabled}
          onChange={(v) => {
            if (v) {
              setBackup({ state: "idle" });
              setPending({ kind: "enable" });
            } else {
              setSyncEnabled(false);
            }
          }}
        />

        {syncEnabled && (
          <>
            <div>
              <label className="block text-xs text-muted mb-1.5">Sync folder</label>
              <button
                onClick={pickFolder}
                className="flex items-center gap-2 w-full px-3 py-2 rounded-lg border border-border
                           text-sm text-left text-foreground-secondary hover:text-foreground
                           hover:border-border-active transition-all"
              >
                <FolderOpen className="w-3.5 h-3.5 flex-shrink-0 text-muted" />
                <span className="flex-1 truncate font-mono text-xs">
                  {syncFolder ?? "No folder selected"}
                </span>
              </button>
              <p className="text-xs text-muted mt-1">
                Point this at a folder synced by Google Drive, Syncthing, Nextcloud, or iCloud Drive.
              </p>
              {folderError && <p className="text-xs text-red-400 mt-1">{folderError}</p>}
            </div>

            {syncFolder && (
              <div className="rounded-lg border border-border px-3 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    {busy ? (
                      <RefreshCw className="w-3 h-3 flex-shrink-0 text-muted animate-spin" />
                    ) : syncStatus === "offline" ? (
                      <CloudOff className="w-3 h-3 flex-shrink-0 text-amber-500" />
                    ) : syncStatus === "error" ? (
                      <AlertTriangle className="w-3 h-3 flex-shrink-0 text-red-400" />
                    ) : lastSyncAt ? (
                      <Cloud className="w-3 h-3 flex-shrink-0 text-muted" />
                    ) : (
                      <CloudOff className="w-3 h-3 flex-shrink-0 text-muted" />
                    )}
                    <span className="text-xs text-foreground truncate">
                      {busy
                        ? "Syncing…"
                        : syncStatus === "offline"
                        ? "Offline: sync folder unavailable"
                        : syncStatus === "error"
                        ? "Sync error"
                        : lastSyncAt
                        ? `Last synced ${new Date(lastSyncAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                        : "Not yet synced"}
                    </span>
                  </div>
                  {retrying ? (
                    <button
                      onClick={() => void syncNow({ trigger: "manual" })}
                      disabled={busy}
                      className="text-xs text-foreground-secondary hover:text-foreground transition-colors disabled:opacity-40 flex-shrink-0"
                    >
                      Retry now
                    </button>
                  ) : (
                    <button
                      onClick={() => void syncNow({ trigger: "manual" })}
                      disabled={busy}
                      className="text-xs text-foreground-secondary hover:text-foreground transition-colors disabled:opacity-40 flex-shrink-0"
                    >
                      Sync now
                    </button>
                  )}
                </div>

                {retrying && syncError && (
                  <p className="text-xs text-muted mt-1.5 leading-relaxed break-words">{syncError}</p>
                )}
                <p className="text-xs text-muted mt-1.5">
                  {pendingCount > 0
                    ? `${pendingCount} change${pendingCount === 1 ? "" : "s"} waiting to sync`
                    : lastSyncAt
                    ? "Everything is synced"
                    : "No changes waiting"}
                  {retryIn ? ` · retrying in ${retryIn}` : ""}
                </p>
              </div>
            )}
          </>
        )}
      </div>

      {pending && (
        <ConfirmModal
          pending={pending}
          backup={backup}
          onBackup={runBackup}
          onCancel={() => setPending(null)}
          onConfirm={confirm}
        />
      )}
    </section>
  );
}
