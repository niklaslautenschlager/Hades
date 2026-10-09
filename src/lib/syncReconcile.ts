import type { NoteFile } from "../store/useStore";

// Pure reconciliation core for cloud sync. No I/O, no clock, no randomness:
// the result is a function of the input alone, so every device that sees the
// same data takes the same decisions and the devices converge.

export const EPOCH_ISO = "1970-01-01T00:00:00.000Z";
export const TOMBSTONE_MAX_AGE_MS = 90 * 24 * 3600_000;
// Local stamps further ahead than this are treated as "the clock was wrong when
// this was written" and are clamped to now before they leave the device.
export const SKEW_TOLERANCE_MS = 10 * 60_000;

export const VALID_ID = /^[A-Za-z0-9_-]{1,128}$/;

export type RemoteItem = NoteFile & { device?: string };
export type Tombstones = Record<string, string>;

/** What both sides agreed on at the end of the last successful sync of one item. */
export interface BaseEntry {
  h: string;          // content hash
  u: string;          // updatedAt
  n: string;          // name
  t: string;          // tags, comma-joined
  p: string | null;   // parentId
}
export type SyncBase = Record<string, BaseEntry>;

export interface ReconcileInput {
  local: readonly NoteFile[];
  remote: readonly RemoteItem[];
  localTombstones: Tombstones;
  remoteTombstones: Tombstones;
  base: SyncBase;
  deviceId: string;
  now: number | string | Date;
}

export interface ConflictRecord {
  id: string;
  copyId: string | null;
  winner: "local" | "remote";
}

export interface ReconcilePlan {
  /** Desired state of every syncable item, sorted by id. */
  merged: NoteFile[];
  localUpserts: NoteFile[];
  localDeletes: string[];
  remoteWrites: RemoteItem[];
  remoteDeletes: string[];
  /** Ids of conflict copies created by this plan (a subset of merged). */
  copies: string[];
  conflicts: ConflictRecord[];
  tombstones: Tombstones;
  localTombstonesChanged: boolean;
  remoteTombstonesChanged: boolean;
  base: SyncBase;
  isEmpty: boolean;
}

// ── Hashing ─────────────────────────────────────────────────────────────────

function cyrb53(str: string, seed: number): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** Two independent 53-bit hashes plus the length: change detection, not security. */
export function hashText(s: string): string {
  return `${cyrb53(s, 0).toString(36)}${cyrb53(s, 7).toString(36)}${s.length.toString(36)}`;
}

// ── Canonical forms ─────────────────────────────────────────────────────────

export function canonName(v: unknown): string {
  const s = typeof v === "string" ? v.replace(/[\r\n]+/g, " ").trim() : "";
  return s || "Untitled";
}

export function canonTags(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of v) {
    if (typeof t !== "string") continue;
    for (const part of t.split(/[,\r\n]+/)) {
      const s = part.trim();
      if (s && !seen.has(s)) {
        seen.add(s);
        out.push(s);
      }
    }
  }
  return out;
}

export function normTs(v: unknown, fallback: string): string {
  if (typeof v === "string") {
    const t = Date.parse(v);
    if (!Number.isNaN(t)) return new Date(t).toISOString();
  }
  return fallback;
}

function canonParent(parentId: unknown, id: string): string | null {
  return typeof parentId === "string" && parentId !== "" && parentId !== id ? parentId : null;
}

export function normalizeItem(n: NoteFile): NoteFile {
  const updatedAt = normTs(n.updatedAt, normTs(n.createdAt, EPOCH_ISO));
  return {
    id: n.id,
    name: canonName(n.name),
    content: typeof n.content === "string" ? n.content : "",
    tags: canonTags(n.tags),
    parentId: canonParent(n.parentId, n.id),
    isFolder: n.isFolder === true,
    createdAt: normTs(n.createdAt, updatedAt),
    updatedAt,
  };
}

function toMs(v: number | string | Date): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (v instanceof Date) return v.getTime();
  const t = Date.parse(v);
  return Number.isNaN(t) ? 0 : t;
}

const tagsKey = (tags: readonly string[]) => tags.join(",");

export function itemHash(n: NoteFile): string {
  return hashText(
    JSON.stringify([n.isFolder, n.name, tagsKey(n.tags), n.parentId, hashText(n.content)])
  );
}

function sameTags(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((t, i) => t === b[i]);
}

function sameItem(a: NoteFile, b: NoteFile): boolean {
  return (
    Array.isArray(a.tags) &&
    a.id === b.id &&
    a.name === b.name &&
    a.content === b.content &&
    a.parentId === b.parentId &&
    a.isFolder === b.isFolder &&
    a.createdAt === b.createdAt &&
    a.updatedAt === b.updatedAt &&
    sameTags(a.tags, b.tags)
  );
}

// createdAt is not stored by older manifests, so it must never trigger a write
// on its own (older clients would drop it again and the two would ping-pong).
function sameForRemote(a: NoteFile, b: NoteFile): boolean {
  return (
    a.name === b.name &&
    a.content === b.content &&
    a.parentId === b.parentId &&
    a.isFolder === b.isFolder &&
    a.updatedAt === b.updatedAt &&
    sameTags(a.tags, b.tags)
  );
}

// ── Base bookkeeping ────────────────────────────────────────────────────────

const contentHashCache = new WeakMap<object, string>();

function cachedContentHash(n: NoteFile): string {
  let h = contentHashCache.get(n);
  if (h === undefined) {
    h = hashText(typeof n.content === "string" ? n.content : "");
    contentHashCache.set(n, h);
  }
  return h;
}

export function baseEntryOf(n: NoteFile): BaseEntry {
  return {
    h: cachedContentHash(n),
    u: n.updatedAt,
    n: canonName(n.name),
    t: tagsKey(canonTags(n.tags)),
    p: canonParent(n.parentId, n.id),
  };
}

export function matchesBase(n: NoteFile, b: BaseEntry): boolean {
  return (
    b.h === cachedContentHash(n) &&
    b.n === canonName(n.name) &&
    b.t === tagsKey(canonTags(n.tags)) &&
    b.p === canonParent(n.parentId, n.id)
  );
}

/** Missing or corrupt persisted base degrades to "nothing known". */
export function sanitizeBase(raw: unknown): SyncBase {
  const out: SyncBase = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [id, e] of Object.entries(raw as Record<string, unknown>)) {
    if (!VALID_ID.test(id) || !e || typeof e !== "object") continue;
    const b = e as Partial<BaseEntry>;
    if (typeof b.h !== "string" || typeof b.u !== "string" || typeof b.n !== "string" || typeof b.t !== "string") continue;
    if (b.p !== null && typeof b.p !== "string") continue;
    out[id] = { h: b.h, u: b.u, n: b.n, t: b.t, p: b.p };
  }
  return out;
}

export function sanitizeTombstones(raw: unknown): Tombstones {
  const out: Tombstones = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string" && !Number.isNaN(Date.parse(v))) out[id] = v;
  }
  return out;
}

/** Items that differ from the last synced state, plus synced items deleted since. */
export function countPending(notes: readonly NoteFile[], baseRaw: unknown): number {
  const base = sanitizeBase(baseRaw);
  let pending = 0;
  const seen = new Set<string>();
  for (const n of notes) {
    if (!n || !VALID_ID.test(n.id)) continue;
    seen.add(n.id);
    const b = base[n.id];
    if (!b || !matchesBase(n, b)) pending++;
  }
  for (const id of Object.keys(base)) if (!seen.has(id)) pending++;
  return pending;
}

// ── Tombstones ──────────────────────────────────────────────────────────────

function mergeTombstones(nowMs: number, sources: { data: Tombstones; clamp: boolean }[]): Tombstones {
  const best = new Map<string, number>();
  const cutoff = nowMs - TOMBSTONE_MAX_AGE_MS;
  for (const { data, clamp } of sources) {
    for (const [id, ts] of Object.entries(data)) {
      let t = Date.parse(ts);
      if (Number.isNaN(t)) continue;
      if (clamp && t > nowMs + SKEW_TOLERANCE_MS) t = nowMs;
      if (t < cutoff) continue;
      const prev = best.get(id);
      if (prev === undefined || t > prev) best.set(id, t);
    }
  }
  const out: Tombstones = {};
  for (const id of [...best.keys()].sort()) out[id] = new Date(best.get(id)!).toISOString();
  return out;
}

function sameBase(a: SyncBase, b: SyncBase): boolean {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((id) => {
    const x = a[id];
    const y = b[id];
    return y !== undefined && x.h === y.h && x.u === y.u && x.n === y.n && x.t === y.t && x.p === y.p;
  });
}

function sameTombstones(a: Tombstones, b: Tombstones): boolean {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => b[k] !== undefined && Date.parse(b[k]) === Date.parse(a[k]));
}

// ── Conflict copies ─────────────────────────────────────────────────────────

const CONFLICT_SUFFIX = / \(conflict copy [^)]*\)$/;

function shortDevice(dev: string | undefined): string {
  return dev ? dev.slice(0, 4) : "legacy";
}

function fmtStamp(iso: string): string {
  return iso.slice(0, 16).replace("T", " ");
}

export function makeConflictCopy(loser: NoteFile, loserDevice: string | undefined, parentId: string | null): NoteFile {
  let base = loser.name;
  while (CONFLICT_SUFFIX.test(base)) base = base.replace(CONFLICT_SUFFIX, "");
  const id = `cc${hashText(`${loser.id}|${loser.updatedAt}|${itemHash(loser)}`)}`;
  return {
    id,
    name: canonName(`${base} (conflict copy ${shortDevice(loserDevice)} ${fmtStamp(loser.updatedAt)})`),
    content: loser.content,
    tags: loser.tags,
    parentId,
    isFolder: false,
    createdAt: loser.createdAt,
    updatedAt: loser.updatedAt,
  };
}

// ── Three-way merge of one item present (and alive) on both sides ───────────

interface Ver {
  u: number;
  dev: string;
  h: string;
}

function cmpVer(a: Ver, b: Ver): number {
  if (a.u !== b.u) return a.u < b.u ? -1 : 1;
  if (a.dev !== b.dev) return a.dev < b.dev ? -1 : 1;
  if (a.h !== b.h) return a.h < b.h ? -1 : 1;
  return 0;
}

interface MergeResult {
  item: NoteFile;
  copy: NoteFile | null;
  conflict: boolean;
  winner: "local" | "remote";
}

function mergeBoth(L: NoteFile, R: RemoteItem, B: BaseEntry | undefined, deviceId: string): MergeResult {
  const lu = Date.parse(L.updatedAt);
  const ru = Date.parse(R.updatedAt);
  const createdAt = L.createdAt < R.createdAt ? L.createdAt : R.createdAt;
  const updatedAt = lu >= ru ? L.updatedAt : R.updatedAt;

  if (
    L.isFolder === R.isFolder &&
    L.name === R.name &&
    L.content === R.content &&
    L.parentId === R.parentId &&
    sameTags(L.tags, R.tags)
  ) {
    return { item: { ...L, createdAt, updatedAt }, copy: null, conflict: false, winner: "local" };
  }

  const lv: Ver = { u: lu, dev: deviceId, h: itemHash(L) };
  const rv: Ver = { u: ru, dev: R.device ?? "", h: itemHash(R) };
  const localWins = cmpVer(lv, rv) >= 0;

  if (L.isFolder !== R.isFolder) {
    const win = localWins ? L : R;
    const lose = localWins ? R : L;
    const copy =
      !lose.isFolder && lose.content.trim() !== ""
        ? makeConflictCopy(lose, localWins ? R.device : deviceId, win.parentId)
        : null;
    return { item: { ...win, createdAt, updatedAt }, copy, conflict: true, winner: localWins ? "local" : "remote" };
  }

  // A remote version that is far older than what we last synced means the
  // folder went backwards (restored backup, flaky mount): never adopt it
  // silently, let it compete as a conflict so its content is preserved.
  const regressed = B !== undefined && !matchesBase(R, B) && ru < Date.parse(B.u) - SKEW_TOLERANCE_MS;
  const known = B !== undefined;
  const lc = {
    name: !known || regressed || L.name !== B.n,
    tags: !known || regressed || tagsKey(L.tags) !== B.t,
    content: !known || regressed || hashText(L.content) !== B.h,
    parent: !known || regressed || L.parentId !== B.p,
  };
  const rc = {
    name: !known || R.name !== B.n,
    tags: !known || tagsKey(R.tags) !== B.t,
    content: !known || hashText(R.content) !== B.h,
    parent: !known || R.parentId !== B.p,
  };

  function pick<T>(lval: T, rval: T, eq: (a: T, b: T) => boolean, lch: boolean, rch: boolean): { v: T; conflicted: boolean } {
    if (eq(lval, rval)) return { v: lval, conflicted: false };
    if (!lch) return { v: rval, conflicted: false };
    if (!rch) return { v: lval, conflicted: false };
    return { v: localWins ? lval : rval, conflicted: true };
  }
  const same = <T,>(a: T, b: T) => a === b;
  const name = pick(L.name, R.name, same, lc.name, rc.name);
  const tags = pick<readonly string[]>(L.tags, R.tags, sameTags, lc.tags, rc.tags);
  const content = pick(L.content, R.content, same, lc.content, rc.content);
  const parent = pick<string | null>(L.parentId, R.parentId, same, lc.parent, rc.parent);

  const item: NoteFile = {
    id: L.id,
    name: name.v,
    content: content.v,
    tags: [...tags.v],
    parentId: parent.v,
    isFolder: L.isFolder,
    createdAt,
    updatedAt,
  };

  let copy: NoteFile | null = null;
  if (content.conflicted && !L.isFolder) {
    const loser = localWins ? R : L;
    if (loser.content.trim() !== "") {
      copy = makeConflictCopy(loser, localWins ? R.device : deviceId, item.parentId);
    }
  }
  const conflict = name.conflicted || tags.conflicted || content.conflicted || parent.conflicted;
  return { item, copy, conflict, winner: localWins ? "local" : "remote" };
}

// ── Structure repair (orphans and cycles) ───────────────────────────────────

function repairStructure(merged: Map<string, NoteFile>): void {
  const ids = [...merged.keys()].sort();
  for (const id of ids) {
    const n = merged.get(id)!;
    if (n.parentId === null) continue;
    const p = merged.get(n.parentId);
    if (!p || !p.isFolder) merged.set(id, { ...n, parentId: null });
  }
  // Every node has at most one parent, so cycles are disjoint; cut each one at
  // its smallest id, independent of iteration order.
  const state = new Map<string, number>(); // 1 = on current path, 2 = done
  for (const start of ids) {
    if (state.get(start) === 2) continue;
    const path: string[] = [];
    let cur: string | null = start;
    while (cur !== null && state.get(cur) !== 2) {
      if (state.get(cur) === 1) {
        const cycle = path.slice(path.indexOf(cur));
        const cut = cycle.reduce((a, b) => (a < b ? a : b));
        merged.set(cut, { ...merged.get(cut)!, parentId: null });
        break;
      }
      state.set(cur, 1);
      path.push(cur);
      cur = merged.get(cur)!.parentId;
    }
    for (const p of path) state.set(p, 2);
  }
}

// ── Reconcile ───────────────────────────────────────────────────────────────

function collect<T extends NoteFile>(into: Map<string, T>, item: T): void {
  const prev = into.get(item.id);
  if (!prev) {
    into.set(item.id, item);
    return;
  }
  const a: Ver = { u: Date.parse(prev.updatedAt), dev: (prev as RemoteItem).device ?? "", h: itemHash(prev) };
  const b: Ver = { u: Date.parse(item.updatedAt), dev: (item as RemoteItem).device ?? "", h: itemHash(item) };
  if (cmpVer(b, a) > 0) into.set(item.id, item);
}

export function reconcile(input: ReconcileInput): ReconcilePlan {
  const nowMs = toMs(input.now);
  const nowIso = new Date(nowMs).toISOString();
  const deviceId = input.deviceId;
  const futureCap = nowMs + SKEW_TOLERANCE_MS;

  const rawLocal = new Map<string, NoteFile>();
  const local = new Map<string, NoteFile>();
  for (const raw of input.local) {
    if (!raw || typeof raw.id !== "string" || !VALID_ID.test(raw.id)) continue;
    rawLocal.set(raw.id, raw);
    let n = normalizeItem(raw);
    if (Date.parse(n.updatedAt) > futureCap) n = { ...n, updatedAt: nowIso };
    collect(local, n);
  }
  const remote = new Map<string, RemoteItem>();
  for (const raw of input.remote) {
    if (!raw || typeof raw.id !== "string" || !VALID_ID.test(raw.id)) continue;
    const r: RemoteItem = { ...normalizeItem(raw), device: typeof raw.device === "string" && raw.device ? raw.device : undefined };
    collect(remote, r);
  }

  const localTomb = sanitizeTombstones(input.localTombstones);
  const remoteTomb = sanitizeTombstones(input.remoteTombstones);
  const tombstones = mergeTombstones(nowMs, [
    { data: localTomb, clamp: true },
    { data: remoteTomb, clamp: false },
  ]);
  const base = sanitizeBase(input.base);

  const merged = new Map<string, NoteFile>();
  const generated: NoteFile[] = [];
  const conflicts: ConflictRecord[] = [];

  const ids = [...new Set([...local.keys(), ...remote.keys()])].sort();
  for (const id of ids) {
    const L = local.get(id);
    const R = remote.get(id);
    const tMs = tombstones[id] === undefined ? -Infinity : Date.parse(tombstones[id]);
    const aliveL = L !== undefined && Date.parse(L.updatedAt) > tMs;
    const aliveR = R !== undefined && Date.parse(R.updatedAt) > tMs;

    if (aliveL && aliveR) {
      const m = mergeBoth(L!, R!, base[id], deviceId);
      merged.set(id, m.item);
      if (m.copy) generated.push(m.copy);
      if (m.conflict) conflicts.push({ id, copyId: m.copy ? m.copy.id : null, winner: m.winner });
    } else if (aliveL) {
      merged.set(id, L!);
    } else if (aliveR) {
      const { device: _device, ...rest } = R!;
      merged.set(id, rest);
    }
  }

  for (const copy of generated.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    if (merged.has(copy.id)) continue;
    if (tombstones[copy.id] !== undefined && Date.parse(copy.updatedAt) <= Date.parse(tombstones[copy.id])) continue;
    merged.set(copy.id, copy);
  }
  const copies = generated.filter((c) => merged.get(c.id) === c).map((c) => c.id);

  repairStructure(merged);

  const mergedArr = [...merged.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const localUpserts = mergedArr.filter((m) => {
    const l = rawLocal.get(m.id);
    return !l || !sameItem(l as NoteFile, m) || !Array.isArray(l.tags);
  });
  const localDeletes = [...rawLocal.keys()].filter((id) => !merged.has(id)).sort();
  const remoteWrites: RemoteItem[] = mergedArr
    .filter((m) => {
      const r = remote.get(m.id);
      return !r || !sameForRemote(r, m);
    })
    .map((m) => ({ ...m, device: deviceId }));
  const remoteDeletes = [...remote.keys()].filter((id) => !merged.has(id)).sort();

  const newBase: SyncBase = {};
  for (const m of mergedArr) newBase[m.id] = baseEntryOf(m);

  const localTombstonesChanged = !sameTombstones(tombstones, localTomb);
  const remoteTombstonesChanged = !sameTombstones(tombstones, remoteTomb);
  const baseUnchanged = sameBase(newBase, base);

  return {
    merged: mergedArr,
    localUpserts,
    localDeletes,
    remoteWrites,
    remoteDeletes,
    copies,
    conflicts,
    tombstones,
    localTombstonesChanged,
    remoteTombstonesChanged,
    base: newBase,
    isEmpty:
      localUpserts.length === 0 &&
      localDeletes.length === 0 &&
      remoteWrites.length === 0 &&
      remoteDeletes.length === 0 &&
      !localTombstonesChanged &&
      !remoteTombstonesChanged &&
      baseUnchanged,
  };
}

// ── Applying a plan to the live local state ─────────────────────────────────

export interface LocalApplyResult {
  /** The very same array as `current.notes` when nothing had to change. */
  notes: readonly NoteFile[];
  /** Ids the plan wanted to change but that the user edited meanwhile. */
  skipped: string[];
  base: SyncBase;
  baseChanged: boolean;
  tombstones: Tombstones;
  tombstonesChanged: boolean;
  removedIds: string[];
}

/**
 * Applies `plan` to the current local state. Items the user touched after the
 * plan's snapshot was taken (identity changed) are left alone; the caller
 * re-reconciles for those. Their base entry only advances when the plan already
 * wrote the remote, otherwise a later pull would look like a local edit.
 */
export function applyPlanLocally(
  snapshot: { notes: readonly NoteFile[]; tombstones: Tombstones },
  current: { notes: readonly NoteFile[]; tombstones: Tombstones; base: SyncBase },
  plan: ReconcilePlan
): LocalApplyResult {
  const snapById = new Map(snapshot.notes.map((n) => [n.id, n]));
  const curById = new Map(current.notes.map((n) => [n.id, n]));
  const upserts = new Map(plan.localUpserts.map((n) => [n.id, n]));
  const deletes = new Set(plan.localDeletes);
  const remoteWritten = new Set(plan.remoteWrites.map((w) => w.id));
  const remoteDeleted = new Set(plan.remoteDeletes);
  const touched = (id: string) => curById.get(id) !== snapById.get(id);

  const skipped = new Set<string>();
  const removedIds: string[] = [];
  const notes: NoteFile[] = [];
  let notesChanged = false;

  for (const n of current.notes) {
    if (deletes.has(n.id)) {
      if (touched(n.id)) {
        skipped.add(n.id);
        notes.push(n);
      } else {
        removedIds.push(n.id);
        notesChanged = true;
      }
    } else if (upserts.has(n.id)) {
      if (touched(n.id)) {
        skipped.add(n.id);
        notes.push(n);
      } else {
        notes.push(upserts.get(n.id)!);
        notesChanged = true;
      }
    } else {
      notes.push(n);
    }
  }
  for (const [id, u] of upserts) {
    if (curById.has(id)) continue;
    if (snapById.has(id)) {
      skipped.add(id);
    } else {
      notes.push(u);
      notesChanged = true;
    }
  }

  const base: SyncBase = {};
  const baseIds = new Set([...Object.keys(current.base), ...Object.keys(plan.base)]);
  for (const id of baseIds) {
    if (skipped.has(id)) {
      if (remoteWritten.has(id) && plan.base[id]) base[id] = plan.base[id];
      else if (!remoteDeleted.has(id) && current.base[id]) base[id] = current.base[id];
    } else if (plan.base[id]) {
      base[id] = plan.base[id];
    }
  }

  const tombstones: Tombstones = { ...plan.tombstones };
  for (const [id, ts] of Object.entries(current.tombstones)) {
    if (snapshot.tombstones[id] === ts) continue;
    if (tombstones[id] === undefined || Date.parse(tombstones[id]) < Date.parse(ts)) tombstones[id] = ts;
  }

  return {
    notes: notesChanged ? notes : current.notes,
    skipped: [...skipped].sort(),
    base,
    baseChanged: !sameBase(base, current.base),
    tombstones,
    tombstonesChanged: !sameTombstones(tombstones, current.tombstones),
    removedIds,
  };
}
