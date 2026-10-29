/**
 * /api/admin/session — admin login for BOTH admin worlds:
 *
 *   • the /admin page (localhost) — master password + cookie (v3.0, unchanged)
 *   • the standalone GitHub-Pages panel (v3.1) — the owner's PIN + Bearer token
 *
 * GET    → { authed, needsSetup, keyReady, hint, webPin: { isDefault } }
 * POST   → THREE modes:
 *   { password, newPassword? }  master password login / change (v3.0 — cookie)
 *   { pin }                     PIN login (v3.1) → { ok, token, defaultPin }
 *   { pin, newPin }             change the PIN (needs the current pin or a
 *                               valid token) → re-issues a fresh token
 * DELETE → log out (clears the cookie; the panel drops its own token).
 */

import { NextResponse } from "next/server";
import {
  ADMIN_COOKIE,
  WEB_PIN_DEFAULT,
  adminHandler,
  adminKeyStatus,
  getAdminPassHash,
  getWebPinState,
  isAdminAuthed,
  preflight,
  readMetaAuthInfo,
  sessionToken,
  setWebPinHash,
  sha256,
  webPinHash,
  webPinToken,
  writeMeta,
} from "@/lib/admin-fb";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 12, // 12h
};

// tiny in-memory lockout for wrong PINs (the API only lives on the owner's PC)
const pinFails = new Map<string, { n: number; until: number }>();
const LOCK_KEY = "webpin";
function lockState() {
  return pinFails.get(LOCK_KEY) || { n: 0, until: 0 };
}

async function get_raw(req: Request) {
  const key = adminKeyStatus();
  if (!key.ready)
    return NextResponse.json({ keyReady: false, hint: key.hint, authed: false, needsSetup: false });
  try {
    const info = await readMetaAuthInfo();
    const needsSetup = !info.passHash;
    const authed = await isAdminAuthed(req); // cookie OR Bearer (password token or pin token)
    return NextResponse.json({
      keyReady: true,
      authed,
      needsSetup,
      webPin: { isDefault: info.webPin.isDefault, defaultPin: WEB_PIN_DEFAULT },
    });
  } catch (e) {
    return NextResponse.json(
      { keyReady: false, hint: String((e as Error)?.message || e).slice(0, 160), authed: false, needsSetup: false },
      { status: 500 },
    );
  }
}

async function post_raw(req: Request) {
  const key = adminKeyStatus();
  if (!key.ready) return NextResponse.json({ error: "no_key", hint: key.hint }, { status: 503 });
  let body: { password?: string; newPassword?: string; pin?: string; newPin?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }

  // ================= v3.1: PIN path (the GitHub-Pages panel) =================
  if (body.pin !== undefined || body.newPin !== undefined) {
    const lock = lockState();
    if (lock.until > Date.now()) {
      return NextResponse.json(
        { error: "locked", message: `অনেকবার ভুল হয়েছে — ${Math.ceil((lock.until - Date.now()) / 1000)} সেকেন্ড পরে আবার চেষ্টা করো` },
        { status: 429 },
      );
    }
    const currentPin = String(body.pin ?? "");
    const newPin = body.newPin !== undefined ? String(body.newPin).trim() : "";

    try {
      const st = await getWebPinState();

      // ---- change pin (current pin correct OR already authed via token) ----
      if (newPin) {
        const pinOk = currentPin && webPinHash(currentPin) === st.hash;
        const tokenOk = !pinOk ? await isAdminAuthed(req) : true;
        if (!pinOk && !tokenOk) {
          const s = lockState();
          pinFails.set(LOCK_KEY, { n: s.n + 1, until: s.n + 1 >= 5 ? Date.now() + 60000 : 0 });
          return NextResponse.json({ error: "wrong", message: "এই পিনটা ভুল ❌" }, { status: 401 });
        }
        if (newPin.length < 3 || newPin.length > 12) {
          return NextResponse.json(
            { error: "short", message: "নতুন পিন ৩–১২ অক্ষরের হতে হবে" },
            { status: 400 },
          );
        }
        const h = webPinHash(newPin);
        await setWebPinHash(h);
        pinFails.delete(LOCK_KEY);
        const token = webPinToken(h);
        const res = NextResponse.json({ ok: true, changed: true, token, message: "নতুন পিন সেভ হয়েছে ✅ — এখন থেকে এটা দিয়েই ঢুকবে" });
        res.cookies.set(ADMIN_COOKIE, "", { ...COOKIE_OPTS, maxAge: 0 }); // pin world ≠ cookie world
        return res;
      }

      // ---- plain pin login ----
      if (!currentPin) return NextResponse.json({ error: "short", message: "পিন লিখো" }, { status: 400 });
      if (webPinHash(currentPin) !== st.hash) {
        const s = lockState();
        const next = { n: s.n + 1, until: s.n + 1 >= 5 ? Date.now() + 60000 : 0 };
        pinFails.set(LOCK_KEY, next);
        return NextResponse.json(
          { error: "wrong", message: next.until ? "পিন ভুল ❌ — ১ মিনিট পরে আবার চেষ্টা করো" : "পিন ভুল ❌" },
          { status: 401 },
        );
      }
      pinFails.delete(LOCK_KEY);
      const token = webPinToken(st.hash);
      return NextResponse.json({
        ok: true,
        token,
        defaultPin: st.isDefault, // true → still the default 755 (panel shows a hint to change it)
        message: st.isDefault ? "ঢুকে গেছো ✅ (এখনো ডিফল্ট পিন 755 চালু — সেটিংস থেকে বদলে নাও)" : "ঢুকে গেছো ✅",
      });
    } catch (e) {
      return NextResponse.json(
        { error: "server", message: String((e as Error)?.message || e).slice(0, 160) },
        { status: 500 },
      );
    }
  }

  // ================= master password path (v3.0, the /admin page) =================
  const pass = String(body.password || "");
  const newPass = body.newPassword ? String(body.newPassword) : "";
  if (pass.length < 6)
    return NextResponse.json({ error: "short", message: "পাসওয়ার্ড অন্তত ৬ অক্ষরের হতে হবে" }, { status: 400 });

  try {
    const saved = await getAdminPassHash();
    if (!saved) {
      // FIRST TIME — set the master password
      const h = sha256(pass);
      await writeMeta({ adminPassHash: h });
      const res = NextResponse.json({ ok: true, setup: true, token: sessionToken(h) });
      res.cookies.set(ADMIN_COOKIE, sessionToken(h), COOKIE_OPTS);
      return res;
    }
    if (sha256(pass) !== saved) {
      return NextResponse.json({ error: "wrong", message: "পাসওয়ার্ড ভুল" }, { status: 401 });
    }
    // correct old password — optionally change it
    if (newPass) {
      if (newPass.length < 6)
        return NextResponse.json({ error: "short", message: "নতুন পাসওয়ার্ড অন্তত ৬ অক্ষরের হতে হবে" }, { status: 400 });
      const h = sha256(newPass);
      await writeMeta({ adminPassHash: h });
      const res = NextResponse.json({ ok: true, changed: true, token: sessionToken(h) });
      res.cookies.set(ADMIN_COOKIE, sessionToken(h), COOKIE_OPTS);
      return res;
    }
    const res = NextResponse.json({ ok: true, token: sessionToken(saved) });
    res.cookies.set(ADMIN_COOKIE, sessionToken(saved), COOKIE_OPTS);
    return res;
  } catch (e) {
    return NextResponse.json(
      { error: "server", message: String((e as Error)?.message || e).slice(0, 160) },
      { status: 500 },
    );
  }
}

async function delete_raw() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, "", { ...COOKIE_OPTS, maxAge: 0 });
  return res;
}

// ---------- CORS plumbing (v3.1: the GitHub-Pages panel calls these cross-origin) ----------
// OPTIONS preflight + CORS headers + error→500 on every response.
export const OPTIONS = preflight;
export const GET = adminHandler(get_raw);
export const POST = adminHandler(post_raw);
export const DELETE = adminHandler(delete_raw);
