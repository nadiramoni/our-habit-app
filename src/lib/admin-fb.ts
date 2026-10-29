/**
 * admin-fb.ts — SERVER-ONLY Firebase Admin bridge for the owner's
 * localhost admin dashboard (/admin).
 *
 * What this unlocks (impossible from the app itself):
 *   • listUsers()  → EVERY account + whether it signed up with Google or email
 *   • updateUser() → ban / unban (disabled) + set a new password for any user
 *   • deleteUser() → remove an account completely
 *   • Firestore     → read every user's real habit status (backups/{uid}) and
 *                    control the ads config (app/meta) that all apps follow.
 *
 * SETUP (one time, ~2 minutes — full Bengali guide: download/ADMIN-GUIDE-bn.md):
 *   Firebase Console → ⚙️ Project Settings → Service accounts →
 *   "Generate new private key" → save the JSON as `admin-sdk-key.json`
 *   in the project root (next to package.json). NEVER share that file.
 */

import { createHash, createHmac } from "crypto";
import { readFileSync, existsSync } from "fs";
import path from "path";
// firebase-admin v14: auth/firestore/credential moved to sub-path imports
import { initializeApp, getApps, getApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

// ---------- lazy singletons ----------
let adminApp: any = null;
let adminAuth: any = null;
let adminDb: any = null;
let initError = "";

export const KEY_FILE = "admin-sdk-key.json";
export const KEY_PATH = path.join(process.cwd(), KEY_FILE);

export interface AdminStatus {
  ready: boolean;
  error: string;
  hint: string;
}

/** Returns { ok, message } — message is a clear Bengali instruction on failure. */
export function adminKeyStatus(): AdminStatus {
  if (process.env.FIREBASE_ADMIN_KEY) return { ready: true, error: "", hint: "" };
  if (existsSync(KEY_PATH)) return { ready: true, error: "", hint: "" };
  return {
    ready: false,
    error: "no_key",
    hint: `admin-sdk-key.json ফাইলটা পাওয়া যায়নি। Firebase Console → ⚙️ Project Settings → Service accounts → "Generate new private key" → ডাউনলোড হওয়া JSON ফাইলটাকে "${KEY_FILE}" নামে প্রজেক্ট ফোল্ডারে রাখো (package.json এর পাশে), তারপর আবার চেষ্টা করো।`,
  };
}

function getAdmin(): { auth: any; db: any } {
  if (adminApp && adminAuth && adminDb) return { auth: adminAuth, db: adminDb };
  const st = adminKeyStatus();
  if (!st.ready) throw new Error("no_key");
  try {
    const raw = process.env.FIREBASE_ADMIN_KEY || readFileSync(KEY_PATH, "utf8");
    const info = JSON.parse(raw) as { project_id?: string; client_email?: string; private_key?: string };
    const cred = cert({
      projectId: info.project_id,
      clientEmail: info.client_email,
      privateKey: info.private_key,
    });
    adminApp = getApps().length ? getApp() : initializeApp({ credential: cred });
    adminAuth = getAuth(adminApp);
    adminDb = getFirestore(adminApp);
    return { auth: adminAuth, db: adminDb };
  } catch (e) {
    initError = String((e as Error)?.message || e);
    throw new Error(`admin_init_failed: ${initError.slice(0, 120)}`);
  }
}

// ---------- admin session (master password) ----------
// The master password hash lives in Firestore app/meta.adminPassHash — the
// SAME doc the in-app panel uses, so there is one source of truth. Session
// cookie = HMAC(passHash) — deterministic, survives dev-server restarts, and
// dies the moment the password is changed.

export const ADMIN_COOKIE = "oh_admin_session";

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export function sessionToken(passHash: string): string {
  return createHmac("sha256", passHash).update("ourhabit-admin-v3").digest("hex");
}

export async function getAdminPassHash(): Promise<string | null> {
  const { db } = getAdmin();
  const snap = await db.collection("app").doc("meta").get();
  if (!snap.exists) return null;
  const h = snap.data()?.adminPassHash;
  return typeof h === "string" && h ? h : null;
}

/** Reads + verifies the session cookie from a Request. */
export async function isAdminAuthed(req: Request): Promise<boolean> {
  try {
    const cookie = req.headers.get("cookie") || "";
    const m = cookie.match(new RegExp(`${ADMIN_COOKIE}=([a-f0-9]+)`));
    if (!m) return false;
    const passHash = await getAdminPassHash();
    if (!passHash) return false;
    return m[1] === sessionToken(passHash);
  } catch {
    return false;
  }
}

export function unauthorized(): Response {
  return Response.json({ error: "unauthorized" }, { status: 401 });
}

// ---------- Firestore helpers ----------

/** Reads app/meta (ads cfg + everything else) as a plain object. */
export async function readMeta(): Promise<Record<string, unknown> | null> {
  const { db } = getAdmin();
  const snap = await db.collection("app").doc("meta").get();
  return snap.exists ? snap.data() : null;
}

/** Merges fields into app/meta (same write path as the in-app panel). */
export async function writeMeta(fields: Record<string, unknown>): Promise<void> {
  const { db } = getAdmin();
  await db.collection("app").doc("meta").set({ ...fields, updatedAt: new Date() }, { merge: true });
}

/** Bulk-read usersIndex/{uid} docs for display names. */
export async function readProfiles(uids: string[]): Promise<Map<string, Record<string, unknown>>> {
  const { db } = getAdmin();
  const out = new Map<string, Record<string, unknown>>();
  const CHUNK = 100; // firestore getAll practical chunk
  for (let i = 0; i < uids.length; i += CHUNK) {
    const slice = uids.slice(i, i + CHUNK);
    const refs = slice.map((u) => db.collection("usersIndex").doc(u));
    if (!refs.length) continue;
    const snaps = await db.getAll(...refs);
    snaps.forEach((s: any, idx: number) => {
      if (s.exists) out.set(slice[idx], s.data());
    });
  }
  return out;
}

/**
 * Bulk-read backups/{uid} updatedAt + a COMPACT status snapshot for the users
 * table (today's habits). Firestore returns full docs; we only keep a summary
 * to keep the response small.
 */
export interface BackupSummary {
  updatedAt: unknown;
  days: number; // how many logged days exist
  streak: number;
  points: number;
  today: {
    prayers: number; // 0..5
    waterMl: number;
    reelsMin: number | null;
    dhikr: number;
    meditationMin: number;
    focusMin: number;
  } | null;
  lastDay: {
    date: string;
    prayers: number;
    waterMl: number;
    reelsMin: number | null;
    dhikr: number;
    meditationMin: number;
    focusMin: number;
  } | null;
}

function summarizeLog(log: Record<string, unknown> | undefined): BackupSummary["today"] {
  if (!log) return null;
  const prayers = log.prayers && typeof log.prayers === "object" ? Object.values(log.prayers).filter(Boolean).length : 0;
  const dhikr =
    log.dhikr && typeof log.dhikr === "object"
      ? Object.values(log.dhikr).reduce((a: number, b: unknown) => a + (Number(b) || 0), 0)
      : 0;
  return {
    prayers,
    waterMl: Number(log.waterMl) || 0,
    reelsMin: log.reelsMin === null || log.reelsMin === undefined ? null : Number(log.reelsMin) || 0,
    dhikr,
    meditationMin: Number(log.meditationMin) || 0,
    focusMin: Number(log.focusMin) || 0,
  };
}

export async function readBackupSummaries(uids: string[]): Promise<Map<string, BackupSummary>> {
  const { db } = getAdmin();
  const out = new Map<string, BackupSummary>();
  const CHUNK = 100;
  for (let i = 0; i < uids.length; i += CHUNK) {
    const slice = uids.slice(i, i + CHUNK);
    const refs = slice.map((u) => db.collection("backups").doc(u));
    if (!refs.length) continue;
    const snaps = await db.getAll(...refs);
    snaps.forEach((s: any, idx: number) => {
      const uid = slice[idx];
      if (!s.exists) return;
      const d = s.data() || {};
      const state = (d.state || {}) as Record<string, any>;
      const logs = (state.logs || {}) as Record<string, Record<string, unknown>>;
      const dates = Object.keys(logs).sort();
      const lastDate = dates.length ? dates[dates.length - 1] : "";
      const todayKey = new Date().toISOString().slice(0, 10);
      const todayLog = logs[todayKey] || (lastDate === todayKey ? logs[lastDate] : undefined);
      out.set(uid, {
        updatedAt: d.updatedAt ?? null,
        days: dates.length,
        streak: Number(state.settings?.streak ?? state.streak ?? 0) || 0,
        points: Number(state.points ?? 0) || 0,
        today: summarizeLog(todayLog),
        lastDay: lastDate ? { date: lastDate, ...summarizeLog(logs[lastDate])! } : null,
      });
    });
  }
  return out;
}

/** Full backup read for the user-detail view (state = whole AppState). */
export async function readBackup(uid: string): Promise<Record<string, any> | null> {
  const { db } = getAdmin();
  const snap = await db.collection("backups").doc(uid).get();
  if (!snap.exists) return null;
  return snap.data() || null;
}

/** Deletes a user's Firestore footprint (backups + usersIndex + pairs notes). */
export async function deleteUserData(uid: string): Promise<void> {
  const { db } = getAdmin();
  await db.collection("backups").doc(uid).delete();
  await db.collection("usersIndex").doc(uid).delete();
  // pair notes: pairKey = sorted uids joined by | — scan the pair docs of this uid
  const pairs = await db.collection("pairs").listDocuments();
  for (const p of pairs) {
    if (!p.id.includes(uid)) continue;
    const notes = await p.collection("notes").listDocuments();
    for (const n of notes) await n.delete();
    await p.delete();
  }
}

export { getAdmin };
