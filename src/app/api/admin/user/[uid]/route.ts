/**
 * /api/admin/user/[uid] — one account, full detail + the owner's powers.
 *
 * GET  → the user's auth record + their REAL habit status from the cloud
 *        backup: last 14 days of নামাজ/পানি/রিলস/যিকির/মেডিটেশন/ফোকাস +
 *        streak, points, registered name, friends.
 *
 * POST → { action: "ban" | "unban" | "setpass" | "resetmail" | "delete", password? }
 *   ban      → auth.updateUser(uid, { disabled: true })  — the user's session
 *              token dies within minutes; sign-in shows "ব্যান করা হয়েছে"
 *   unban    → disabled: false
 *   setpass  → auth.updateUser(uid, { password }) — owner sets a new password
 *              (Google accounts: password login is added/overwritten)
 *   resetmail→ auth.sendPasswordResetEmail(email) — Firebase emails the user
 *   delete   → deleteUser + Firestore data wipe (backups/usersIndex/pairs)
 */

import { NextResponse } from "next/server";
import {
  adminHandler,
  deleteUserData,
  getAdmin,
  isAdminAuthed,
  preflight,
  readBackup,
  unauthorized,
} from "@/lib/admin-fb";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PRAYERS = ["fajr", "dhuhr", "asr", "maghrib", "isha"] as const;

function dayRow(date: string, log: Record<string, unknown> | undefined) {
  if (!log) return null;
  const prayers = log.prayers && typeof log.prayers === "object" ? (log.prayers as Record<string, boolean>) : {};
  const dhikr =
    log.dhikr && typeof log.dhikr === "object"
      ? Object.values(log.dhikr as Record<string, number>).reduce((a, b) => a + (Number(b) || 0), 0)
      : 0;
  return {
    date,
    prayers: PRAYERS.map((p) => Boolean(prayers[p])),
    prayerWater: Array.isArray(log.prayerWater) ? (log.prayerWater as boolean[]).filter(Boolean).length : 0,
    waterMl: Number(log.waterMl) || 0,
    reelsMin: log.reelsMin === null || log.reelsMin === undefined ? null : Number(log.reelsMin) || 0,
    reels: (log.reels && typeof log.reels === "object" ? log.reels : {}) as Record<string, number>,
    dhikr,
    meditationMin: Number(log.meditationMin) || 0,
    focusMin: Number(log.focusMin) || 0,
    sleepBed: (log.sleepBed as string) || null,
    sleepWake: (log.sleepWake as string) || null,
    mood: log.mood ?? null,
    note: (log.note as string) || "",
  };
}

async function get_raw(req: Request, ctx: { params: Promise<{ uid: string }> }) {
  if (!(await isAdminAuthed(req))) return unauthorized();
  const { uid } = await ctx.params;
  try {
    const { auth } = getAdmin();
    const u = await auth.getUser(uid);
    const backup = await readBackup(uid);
    const state = (backup?.state || {}) as Record<string, any>;
    const logs = (state.logs || {}) as Record<string, Record<string, unknown>>;
    const dates = Object.keys(logs).sort().slice(-14).reverse();
    const days = dates.map((d) => dayRow(d, logs[d])).filter(Boolean);

    return NextResponse.json({
      user: {
        uid: u.uid,
        email: u.email || "",
        displayName: u.displayName || "",
        provider: u.providerData?.[0]?.providerId === "google.com" ? "google" : "password",
        providerId: u.providerData?.[0]?.providerId || "",
        disabled: Boolean(u.disabled),
        emailVerified: Boolean(u.emailVerified),
        createdAt: u.metadata?.creationTime || null,
        lastSignIn: u.metadata?.lastSignInTime || null,
      },
      name: state.settings?.name || u.displayName || "",
      settings: {
        language: state.settings?.language || "",
        theme: state.settings?.theme || "",
        streak: Number(state.streak ?? state.settings?.streak ?? 0) || 0,
      },
      points: Number(state.points ?? 0) || 0,
      friends: Array.isArray(state.friends) ? state.friends : [],
      backupUpdatedAt: backup?.updatedAt ?? null,
      days,
    });
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    return NextResponse.json({ error: "server", message: msg.slice(0, 200) }, { status: 500 });
  }
}

async function post_raw(req: Request, ctx: { params: Promise<{ uid: string }> }) {
  if (!(await isAdminAuthed(req))) return unauthorized();
  const { uid } = await ctx.params;
  let body: { action?: string; password?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }
  const action = String(body.action || "");
  try {
    const { auth } = getAdmin();
    switch (action) {
      case "ban": {
        await auth.updateUser(uid, { disabled: true });
        return NextResponse.json({ ok: true, message: "অ্যাকাউন্ট ব্যান হয়ে গেছে ❌ — ইউজার এখন লগইন করতে পারবে না" });
      }
      case "unban": {
        await auth.updateUser(uid, { disabled: false });
        return NextResponse.json({ ok: true, message: "অ্যাকাউন্ট আনব্যান হয়ে গেছে ✅" });
      }
      case "setpass": {
        const p = String(body.password || "");
        if (p.length < 6) return NextResponse.json({ error: "short", message: "পাসওয়ার্ড অন্তত ৬ অক্ষরের হতে হবে" }, { status: 400 });
        await auth.updateUser(uid, { password: p });
        return NextResponse.json({ ok: true, message: "নতুন পাসওয়ার্ড সেট হয়ে গেছে ✅ — ইউজারকে জানিয়ে দাও" });
      }
      case "resetmail": {
        const u = await auth.getUser(uid);
        if (!u.email) return NextResponse.json({ error: "no_email", message: "এই অ্যাকাউন্টে ইমেইল নেই" }, { status: 400 });
        await auth.sendPasswordResetEmail(u.email);
        return NextResponse.json({ ok: true, message: `রিসেট লিংক পাঠানো হয়েছে ✅ → ${u.email}` });
      }
      case "delete": {
        await deleteUserData(uid);
        await auth.deleteUser(uid);
        return NextResponse.json({ ok: true, message: "অ্যাকাউন্ট ও সব ডেটা মুছে ফেলা হয়েছে 🗑️" });
      }
      default:
        return NextResponse.json({ error: "bad_action" }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: "server", message: String((e as Error)?.message || e).slice(0, 200) }, { status: 500 });
  }
}

// ---------- CORS plumbing (v3.1: called cross-origin from the GitHub-Pages panel) ----------
export const OPTIONS = preflight;
export const GET = adminHandler(get_raw);
export const POST = adminHandler(post_raw);
