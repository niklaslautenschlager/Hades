import { useStore } from "../store/useStore";
import { syncIndex, type RagSourceType } from "./ragIndex";

// Keeps the study index current by watching the store itself, so every creation
// path is covered at once: the UI, iCal feed syncs, and the agent's tools.

const KINDS: RagSourceType[] = ["note", "pdf", "event", "task"];

// Notes change on every keystroke, so they wait for a longer pause.
const DEBOUNCE_MS: Record<RagSourceType, number> = { note: 4000, pdf: 1500, event: 1500, task: 1500 };
const FULL_DELAY_MS = 3000;
const RETRY_DELAYS_MS = [30_000, 120_000, 600_000];

let active: (() => void) | null = null;

function changedIds<T extends { id: string }>(prev: T[] | undefined, next: T[] | undefined): string[] {
  const before = new Map((prev ?? []).map((x) => [x.id, x] as const));
  const out: string[] = [];
  for (const x of next ?? []) {
    if (before.get(x.id) !== x) out.push(x.id);
    before.delete(x.id);
  }
  for (const id of before.keys()) out.push(id); // deleted
  return out;
}

/** Start background indexing. Idempotent; returns the function that stops it. */
export function startAutoIndexing(): () => void {
  if (active) return active;

  const dirty = {} as Record<RagSourceType, Set<string>>;
  const ready = {} as Record<RagSourceType, Set<string>>;
  const timers = {} as Record<RagSourceType, ReturnType<typeof setTimeout> | undefined>;
  for (const k of KINDS) {
    dirty[k] = new Set();
    ready[k] = new Set();
  }
  let fullTimer: ReturnType<typeof setTimeout> | undefined;
  let fullReady = false;
  // Set when retries ran out: the next flush then reconciles everything again.
  let needsFull = false;
  let retryAttempt = 0;
  let running = false;
  let stopped = false;
  let abort = new AbortController();

  function clearWork() {
    for (const k of KINDS) {
      clearTimeout(timers[k]);
      timers[k] = undefined;
      dirty[k].clear();
      ready[k].clear();
    }
    clearTimeout(fullTimer);
    fullTimer = undefined;
    fullReady = false;
    abort.abort();
    abort = new AbortController();
  }

  function scheduleFull(delay: number) {
    clearTimeout(fullTimer);
    fullTimer = setTimeout(() => {
      fullReady = true;
      void drain();
    }, delay);
  }

  function scheduleKind(kind: RagSourceType, ids: string[]) {
    if (ids.length === 0) return;
    for (const id of ids) dirty[kind].add(id);
    clearTimeout(timers[kind]);
    timers[kind] = setTimeout(() => {
      for (const id of dirty[kind]) ready[kind].add(id);
      dirty[kind].clear();
      void drain();
    }, DEBOUNCE_MS[kind]);
  }

  function nextJob(): { kinds: RagSourceType[]; ids?: string[] } | null {
    if (fullReady || (needsFull && KINDS.some((k) => ready[k].size > 0))) {
      fullReady = false;
      needsFull = false;
      for (const k of KINDS) ready[k].clear();
      return { kinds: KINDS };
    }
    for (const k of KINDS) {
      if (ready[k].size > 0) {
        const ids = [...ready[k]];
        ready[k].clear();
        return { kinds: [k], ids };
      }
    }
    return null;
  }

  async function drain() {
    if (running || stopped) return;
    running = true;
    try {
      while (!stopped) {
        if (!useStore.getState().aiEnabled) {
          clearWork();
          break;
        }
        const job = nextJob();
        if (!job) break;
        const signal = abort.signal;
        try {
          await syncIndex({ kinds: job.kinds, ids: job.ids, signal });
          retryAttempt = 0;
        } catch {
          if (signal.aborted || stopped) break;
          // Typically Ollama being down for an Ollama-built index. A full
          // reconcile later picks up whatever this job missed.
          if (retryAttempt < RETRY_DELAYS_MS.length) scheduleFull(RETRY_DELAYS_MS[retryAttempt++]);
          else needsFull = true;
        }
      }
    } finally {
      running = false;
    }
  }

  const unsubscribe = useStore.subscribe((s, prev) => {
    if (stopped) return;
    if (s.aiEnabled !== prev.aiEnabled) {
      if (s.aiEnabled) scheduleFull(FULL_DELAY_MS);
      else clearWork();
      return;
    }
    if (!s.aiEnabled) return;
    if (s.notes !== prev.notes) scheduleKind("note", changedIds(prev.notes, s.notes));
    if (s.calendarEvents !== prev.calendarEvents) scheduleKind("event", changedIds(prev.calendarEvents, s.calendarEvents));
    if (s.tasks !== prev.tasks) scheduleKind("task", changedIds(prev.tasks, s.tasks));
    if (s.libraryDocs !== prev.libraryDocs) scheduleKind("pdf", changedIds(prev.libraryDocs, s.libraryDocs));
  });

  if (useStore.getState().aiEnabled) scheduleFull(FULL_DELAY_MS);

  const stop = () => {
    if (stopped) return;
    stopped = true;
    unsubscribe();
    clearWork();
    active = null;
  };
  active = stop;
  return stop;
}
