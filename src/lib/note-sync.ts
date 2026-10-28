"use client";

/**
 * note-sync.ts — OFFLINE-FIRST shared notes engine (the heart of v2.0).
 *
 * Guarantees (owner's requirements, point 6 + 7):
 *  ✓ A note written WITHOUT internet is saved to the device instantly and
 *    queued — it NEVER disappears. When internet returns it auto-sends.
 *  ✓ Two devices can also exchange notes DIRECTLY (Bluetooth/WiFi-Direct via
 *    the NearbySync Android plugin) — see nearby.ts + applyPartnerPayload().
 *  ✓ Edits made offline stay local, sync later, and merge both ways.
 *  ✓ NO DUPLICATES: one stable id per note; every retry writes the same
 *    Firestore doc id (setDoc merge) — receiving side merges by id.
 *  ✓ CONFLICTS: if both people edited the same note offline, nothing is lost —
 *    a conflict card lets them choose "mine / theirs / keep both".
 *  ✓ Survives app restarts, network changes, airplane mode (localStorage).
 *  ✓ Status per note: local | pending | sent | synced | failed — shown in UI.
 */

import { SharedNoteItem, uid } from "./types";

export type NoteStatus = "local" | "pending" | "sent" | "synced" | "failed";

export interface SyncNote {
  id: string;
  author: string; // uid
  authorName: string;
  text: string;
  done: boolean;
  doneBy: string | null;
  createdAt: number; // ms epoch
  updatedAt: number; // ms epoch
  deleted?: boolean; // tombstone — synced as deletion to the partner
  // ---- local-only sync metadata ----
  status: NoteStatus;
  dirty: boolean; // has unsynced local changes
  baseText: string | null; // text at last successful sync (3-way merge base)
  attempts: number; // failed flush attempts
}

export interface NoteConflict {
  id: string;
  mine: string;
  theirs: string;
  mineName: string;
  theirsName: string;
  remoteUpdatedAt: number;
}

interface PairStore {
  notes: Record<string, SyncNote>;
  outbox: string[]; // note ids waiting to be sent (oldest first)
  conflicts: Record<string, NoteConflict>;
  lastFlush: number;
  lastRemoteAt: number;
}

const MAX_NOTES = 500;
const MAX_ATTEMPTS = 5;
const keyOf = (pairKey: string) => `oh_notesync_v2:${pairKey}`;

// ---------- module state ----------
const stores = new Map<string, PairStore>();
const listeners = new Map<string, Set<(n: SyncNote[], meta: { pending: number; online: boolean }) => void>>();
const conflictListeners = new Map<string, Set<(c: NoteConflict[]) => void>>();
let online = typeof navigator === "undefined" ? true : navigator.onLine;
let flushTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function setOnline(v: boolean) {
  if (online === v) return;
  online = v;
  for (const pairKey of stores.keys()) {
    emit(pairKey);
    if (v) void flushPair(pairKey);
  }
}

export function isOnline(): boolean {
  return online;
}

// ---------- persistence ----------
function load(pairKey: string): PairStore {
  if (stores.has(pairKey)) return stores.get(pairKey)!;
  let s: PairStore = { notes: {}, outbox: [], conflicts: {}, lastFlush: 0, lastRemoteAt: 0 };
  try {
    const raw = localStorage.getItem(keyOf(pairKey));
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PairStore>;
      s = {
        notes: parsed.notes || {},
        outbox: (parsed.outbox || []).filter((id) => s.notes[id] || (parsed.notes || {})[id]),
        conflicts: parsed.conflicts || {},
        lastFlush: parsed.lastFlush || 0,
        lastRemoteAt: parsed.lastRemoteAt || 0,
      };
    }
  } catch {
    /* corrupted → fresh */
  }
  stores.set(pairKey, s);
  return s;
}

function persist(pairKey: string, s: PairStore) {
  try {
    localStorage.setItem(keyOf(pairKey), JSON.stringify(s));
  } catch {
    // storage full → drop old synced tombstones and retry once
    try {
      const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
      for (const id of Object.keys(s.notes)) {
        const n = s.notes[id];
        if (n.deleted && !n.dirty && n.updatedAt < cutoff) delete s.notes[id];
      }
      localStorage.setItem(keyOf(pairKey), JSON.stringify(s));
    } catch {
      /* give up silently — engine keeps memory state */
    }
  }
}

function emit(pairKey: string) {
  const s = stores.get(pairKey);
  if (!s) return;
  const notes = sortedNotes(s);
  const pending = Object.values(s.notes).filter((n) => n.dirty && !n.deleted).length;
  listeners.get(pairKey)?.forEach((cb) => cb(notes, { pending, online }));
  conflictListeners.get(pairKey)?.forEach((cb) => cb(Object.values(s.conflicts)));
}

export function sortedNotes(s: PairStore): SyncNote[] {
  return Object.values(s.notes)
    .filter((n) => !n.deleted)
    .sort((a, b) => a.createdAt - b.createdAt);
}

// ---------- subscription ----------
export function subscribePair(
  pairKey: string,
  cb: (notes: SyncNote[], meta: { pending: number; online: boolean }) => void,
  conflictCb?: (c: NoteConflict[]) => void
): () => void {
  if (!listeners.has(pairKey)) listeners.set(pairKey, new Set());
  listeners.get(pairKey)!.add(cb);
  if (conflictCb) {
    if (!conflictListeners.has(pairKey)) conflictListeners.set(pairKey, new Set());
    conflictListeners.get(pairKey)!.add(conflictCb);
  }
  const s = load(pairKey);
  emit(pairKey);
  return () => {
    listeners.get(pairKey)?.delete(cb);
    if (conflictCb) conflictListeners.get(pairKey)?.delete(conflictCb);
    void s;
  };
}

// ---------- local mutations (work fully offline) ----------
export function addLocalNote(pairKey: string, text: string, author: string, authorName: string): SyncNote {
  const s = load(pairKey);
  const now = Date.now();
  const note: SyncNote = {
    id: uid() + now.toString(36),
    author,
    authorName,
    text: text.trim(),
    done: false,
    doneBy: null,
    createdAt: now,
    updatedAt: now,
    status: "pending",
    dirty: true,
    baseText: null,
    attempts: 0,
  };
  s.notes[note.id] = note;
  if (!s.outbox.includes(note.id)) s.outbox.push(note.id);
  persist(pairKey, s);
  emit(pairKey);
  scheduleFlush(pairKey, 400);
  return note;
}

export function editLocalNote(pairKey: string, id: string, text: string) {
  const s = load(pairKey);
  const n = s.notes[id];
  if (!n) return;
  n.text = text.trim();
  n.updatedAt = Date.now();
  if (!n.dirty) {
    n.dirty = true;
    n.status = "pending";
  }
  if (!s.outbox.includes(id)) s.outbox.push(id);
  persist(pairKey, s);
  emit(pairKey);
  scheduleFlush(pairKey, 400);
}

export function toggleLocalDone(pairKey: string, id: string, meUid: string) {
  const s = load(pairKey);
  const n = s.notes[id];
  if (!n) return;
  n.done = !n.done;
  n.doneBy = n.done ? meUid : null;
  n.updatedAt = Date.now();
  if (!n.dirty) {
    n.dirty = true;
    n.status = "pending";
  }
  if (!s.outbox.includes(id)) s.outbox.push(id);
  persist(pairKey, s);
  emit(pairKey);
  scheduleFlush(pairKey, 400);
}

/** Delete = tombstone locally, then sync the deletion to the partner. */
export function deleteLocalNote(pairKey: string, id: string) {
  const s = load(pairKey);
  const n = s.notes[id];
  if (!n) return;
  n.deleted = true;
  n.updatedAt = Date.now();
  n.dirty = true;
  if (!s.outbox.includes(id)) s.outbox.push(id);
  persist(pairKey, s);
  emit(pairKey);
  scheduleFlush(pairKey, 400);
}

export function retryNote(pairKey: string, id: string) {
  const s = load(pairKey);
  const n = s.notes[id];
  if (!n) return;
  n.attempts = 0;
  n.status = "pending";
  if (!s.outbox.includes(id)) s.outbox.push(id);
  persist(pairKey, s);
  emit(pairKey);
  void flushPair(pairKey);
}

// ---------- conflict resolution (user chooses — nothing is lost) ----------
export type ConflictChoice = "mine" | "theirs" | "both";

export function resolveConflict(pairKey: string, id: string, choice: ConflictChoice) {
  const s = load(pairKey);
  const c = s.conflicts[id];
  const n = s.notes[id];
  if (!c || !n) return;
  if (choice === "mine") {
    // keep my text — it stays dirty and overwrites the remote copy on flush
    n.dirty = true;
    n.status = "pending";
    if (!s.outbox.includes(id)) s.outbox.push(id);
  } else if (choice === "theirs") {
    n.text = c.theirs;
    n.dirty = false;
    n.status = "synced";
    n.baseText = c.theirs;
    n.updatedAt = c.remoteUpdatedAt;
  } else {
    n.text = `${c.mine}\n\n— ${c.theirsName} —\n${c.theirs}`;
    n.dirty = true;
    n.status = "pending";
    n.updatedAt = Date.now();
    if (!s.outbox.includes(id)) s.outbox.push(id);
  }
  delete s.conflicts[id];
  persist(pairKey, s);
  emit(pairKey);
  if (choice !== "theirs") scheduleFlush(pairKey, 300);
}

// ---------- remote merge (Firestore snapshot or Nearby payload) ----------
interface RemoteNote {
  id: string;
  author: string;
  authorName?: string;
  text: string;
  done: boolean;
  doneBy: string | null;
  createdAt: string | number;
  updatedAt?: number;
  deleted?: boolean;
}

/** Convert a remote raw note into a SyncNote-shaped plain object. */
interface NormalizedNote extends RemoteNote {
  authorName: string;
  text: string;
  done: boolean;
  updatedAt: number;
  deleted: boolean;
}

function normalizeRemote(r: RemoteNote): NormalizedNote {
  return {
    ...r,
    authorName: r.authorName || "",
    text: String(r.text || ""),
    done: Boolean(r.done),
    updatedAt: Number(r.updatedAt || 0) || (typeof r.createdAt === "number" ? r.createdAt : Date.parse(String(r.createdAt)) || 0),
    deleted: Boolean(r.deleted),
  };
}

/**
 * Merge incoming notes. Both Firestore snapshots and Nearby payloads go
 * through this one path → same dedup + conflict rules everywhere.
 * Returns how many notes were new/updated.
 */
export function mergeRemote(pairKey: string, incoming: RemoteNote[], source: "firestore" | "nearby" = "firestore"): number {
  const s = load(pairKey);
  let changed = 0;
  for (const raw of incoming) {
    const r = normalizeRemote(raw);
    if (!r.id || !r.author) continue;
    const local = s.notes[r.id];

    if (!local) {
      s.notes[r.id] = {
        id: r.id,
        author: r.author,
        authorName: r.authorName || "",
        text: r.text,
        done: r.done,
        doneBy: r.doneBy ?? null,
        createdAt: typeof r.createdAt === "number" ? r.createdAt : Date.parse(String(r.createdAt)) || Date.now(),
        updatedAt: r.updatedAt || Date.now(),
        deleted: r.deleted,
        status: "synced",
        dirty: false,
        baseText: r.text,
        attempts: 0,
      };
      changed++;
      continue;
    }

    // I already know this note — has anything changed remotely since I last saw it?
    const remoteNewer = r.updatedAt > local.updatedAt;
    const contentSame =
      local.text === r.text && local.done === r.done && Boolean(local.deleted) === Boolean(r.deleted);
    if (!remoteNewer && contentSame) continue; // exact echo of what we know

    if (!local.dirty) {
      if (!remoteNewer) continue; // stale snapshot of a clean note → ignore
      // clean local copy → simply adopt the remote truth
      local.text = r.text;
      local.done = r.done;
      local.doneBy = r.doneBy ?? null;
      local.deleted = r.deleted;
      local.updatedAt = r.updatedAt;
      local.status = "synced";
      local.baseText = r.text;
      changed++;
    } else if (local.text === r.text) {
      // text converged (only the checkbox/deleted flag differs) — take remote
      // flag state; my queued text stays harmless (same content)
      local.done = r.done;
      local.doneBy = r.doneBy ?? null;
      if (r.deleted) local.deleted = true;
      if (contentSame) {
        local.dirty = false;
        local.status = "synced";
        local.baseText = r.text;
        delete s.conflicts[r.id];
      }
      local.updatedAt = Math.max(local.updatedAt, r.updatedAt);
      changed++;
    } else if (remoteNewer || r.text !== (local.baseText ?? "")) {
      // BOTH sides changed the text while apart → save both versions, let the
      // users pick (nothing is lost — owner requirement 6E). Also fires when
      // the timestamps tie but the partner's copy differs from the last-synced
      // base (same-millisecond edits must not silently overwrite anyone).
      const prev = s.conflicts[r.id];
      s.conflicts[r.id] = {
        id: r.id,
        mine: local.text,
        theirs: r.text,
        mineName: local.authorName || "আমি",
        theirsName: r.authorName || prev?.theirsName || "পার্টনার",
        remoteUpdatedAt: r.updatedAt,
      };
      local.updatedAt = Math.max(local.updatedAt, r.updatedAt);
      changed++;
    }
    // else: stale remote copy identical to the last-synced base → my queued
    // flush overwrites it shortly → nothing to do
  }

  // trim old synced tombstones to stay under quota
  const all = Object.values(s.notes);
  if (all.length > MAX_NOTES) {
    const deletable = all
      .filter((n) => n.deleted && !n.dirty)
      .sort((a, b) => a.updatedAt - b.updatedAt)
      .slice(0, all.length - MAX_NOTES);
    for (const n of deletable) delete s.notes[n.id];
  }

  s.lastRemoteAt = Date.now();
  persist(pairKey, s);
  if (changed > 0 || source === "firestore") emit(pairKey);
  return changed;
}

/**
 * Notes I received directly from my partner's phone (Nearby).
 * My own notes that traveled via Nearby → status "sent" (delivered directly).
 * Partner's notes → merged like any remote change.
 */
export function applyPartnerPayload(pairKey: string, notes: RemoteNote[]): { received: number; deliveredMine: number } {
  const s = load(pairKey);
  let deliveredMine = 0;
  for (const raw of notes) {
    const r = normalizeRemote(raw);
    const local = s.notes[r.id];
    if (local && local.author === r.author && local.dirty) {
      // my own note came back → partner's phone has it now
      deliveredMine++;
      local.status = "sent";
      local.updatedAt = Math.max(local.updatedAt, r.updatedAt || 0);
    }
  }
  const received = mergeRemote(pairKey, notes, "nearby");
  persist(pairKey, s);
  emit(pairKey);
  return { received, deliveredMine };
}

/** Notes to hand over during a Nearby session: my unsynced + latest notes. */
export function exportForNearby(pairKey: string, meUid: string, max = 100): RemoteNote[] {
  const s = load(pairKey);
  const mine = Object.values(s.notes)
    .filter((n) => n.author === meUid)
    .sort((a, b) => (b.dirty ? 1 : 0) - (a.dirty ? 1 : 0) || b.updatedAt - a.updatedAt)
    .slice(0, max);
  return mine.map((n) => ({
    id: n.id,
    author: n.author,
    authorName: n.authorName,
    text: n.text,
    done: n.done,
    doneBy: n.doneBy,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
    deleted: n.deleted,
  }));
}

// ---------- Firestore flush (the outbox) ----------
let fbPut: ((pairKey: string, note: RemoteNote) => Promise<boolean>) | null = null;

/** cloud.ts registers its writer here (avoids a circular import). */
export function registerFbWriter(fn: (pairKey: string, note: RemoteNote) => Promise<boolean>) {
  fbPut = fn;
}

function scheduleFlush(pairKey: string, delayMs: number) {
  const prev = flushTimers.get(pairKey);
  if (prev) clearTimeout(prev);
  const t = setTimeout(() => {
    flushTimers.delete(pairKey);
    void flushPair(pairKey);
  }, delayMs);
  flushTimers.set(pairKey, t);
}

/** Send every queued note to Firestore. Safe to call any time, idempotent. */
export async function flushPair(pairKey: string): Promise<number> {
  if (!online || !fbPut) return 0;
  const s = load(pairKey);
  if (s.outbox.length === 0) return 0;
  const ids = [...s.outbox];
  let okCount = 0;

  for (const id of ids) {
    const n = s.notes[id];
    if (!n) {
      s.outbox = s.outbox.filter((x) => x !== id);
      continue;
    }
    if (!n.dirty) {
      s.outbox = s.outbox.filter((x) => x !== id);
      continue;
    }
    n.status = "sent";
    emit(pairKey);
    const ok = await fbPut(pairKey, {
      id: n.id,
      author: n.author,
      authorName: n.authorName,
      text: n.text,
      done: n.done,
      doneBy: n.doneBy,
      createdAt: new Date(n.createdAt).toISOString(),
      updatedAt: n.updatedAt,
      deleted: n.deleted,
    });
    if (ok) {
      n.dirty = false;
      n.status = "synced";
      n.baseText = n.text;
      n.attempts = 0;
      s.outbox = s.outbox.filter((x) => x !== id);
      okCount++;
    } else {
      n.attempts++;
      n.status = n.attempts >= MAX_ATTEMPTS ? "failed" : "pending";
      // stop this round on first failure (offline / rate-limit) — retried later
      break;
    }
    persist(pairKey, s);
  }
  s.lastFlush = Date.now();
  persist(pairKey, s);
  emit(pairKey);
  return okCount;
}

/**
 * Auto-sync loop: flushes on start, on 'online', every 30s, and refires the
 * snapshot listener. Returns a stop() function.
 */
export function startAutoSync(pairKey: string, opts: { listen?: (cb: (items: RemoteNote[]) => void) => () => void }): () => void {
  const stoppers: (() => void)[] = [];

  const onOnline = () => {
    setOnline(true);
    void flushPair(pairKey);
  };
  const onOffline = () => setOnline(false);
  if (typeof window !== "undefined") {
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    stoppers.push(() => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    });
  }
  setOnline(typeof navigator === "undefined" ? true : navigator.onLine);

  // Firestore realtime listener → mergeRemote (works when internet exists)
  if (opts?.listen) {
    try {
      const un = opts.listen((items) => {
        if (items.length) mergeRemote(pairKey, items, "firestore");
      });
      if (un) stoppers.push(un);
    } catch {
      /* listener unavailable */
    }
  }

  const iv = setInterval(() => void flushPair(pairKey), 30000);
  stoppers.push(() => clearInterval(iv));
  void flushPair(pairKey);

  return () => stoppers.forEach((fn) => fn());
}

/** Reset one pair's local store (used when a partner is removed). */
export function resetPair(pairKey: string) {
  stores.delete(pairKey);
  try {
    localStorage.removeItem(keyOf(pairKey));
  } catch {
    /* ignore */
  }
}
