/**
 * /api/admin/session — the owner's localhost admin login.
 *
 * GET    → { authed, needsSetup, keyReady, hint }
 * POST   → { password, newPassword? } — first ever call with no saved hash =
 *          SETUP (saves the password); afterwards it is a normal login.
 *          newPassword present (with the old password correct) → change pass.
 * DELETE → log out (clears the cookie).
 */

import { NextResponse } from "next/server";
import {
  ADMIN_COOKIE,
  adminKeyStatus,
  getAdminPassHash,
  sessionToken,
  sha256,
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

export async function GET(req: Request) {
  const key = adminKeyStatus();
  if (!key.ready) return NextResponse.json({ keyReady: false, hint: key.hint, authed: false, needsSetup: false });
  try {
    const passHash = await getAdminPassHash();
    const needsSetup = !passHash;
    let authed = false;
    if (passHash) {
      const cookie = req.headers.get("cookie") || "";
      const m = cookie.match(new RegExp(`${ADMIN_COOKIE}=([a-f0-9]+)`));
      authed = Boolean(m && m[1] === sessionToken(passHash));
    }
    return NextResponse.json({ keyReady: true, authed, needsSetup });
  } catch (e) {
    return NextResponse.json({ keyReady: false, hint: String((e as Error)?.message || e).slice(0, 160), authed: false, needsSetup: false }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const key = adminKeyStatus();
  if (!key.ready) return NextResponse.json({ error: "no_key", hint: key.hint }, { status: 503 });
  let body: { password?: string; newPassword?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }
  const pass = String(body.password || "");
  const newPass = body.newPassword ? String(body.newPassword) : "";
  if (pass.length < 6) return NextResponse.json({ error: "short", message: "পাসওয়ার্ড অন্তত ৬ অক্ষরের হতে হবে" }, { status: 400 });

  try {
    const saved = await getAdminPassHash();
    if (!saved) {
      // FIRST TIME — set the master password
      const h = sha256(pass);
      await writeMeta({ adminPassHash: h });
      const res = NextResponse.json({ ok: true, setup: true });
      res.cookies.set(ADMIN_COOKIE, sessionToken(h), COOKIE_OPTS);
      return res;
    }
    if (sha256(pass) !== saved) {
      return NextResponse.json({ error: "wrong", message: "পাসওয়ার্ড ভুল" }, { status: 401 });
    }
    // correct old password — optionally change it
    if (newPass) {
      if (newPass.length < 6) return NextResponse.json({ error: "short", message: "নতুন পাসওয়ার্ড অন্তত ৬ অক্ষরের হতে হবে" }, { status: 400 });
      const h = sha256(newPass);
      await writeMeta({ adminPassHash: h });
      const res = NextResponse.json({ ok: true, changed: true });
      res.cookies.set(ADMIN_COOKIE, sessionToken(h), COOKIE_OPTS);
      return res;
    }
    const res = NextResponse.json({ ok: true });
    res.cookies.set(ADMIN_COOKIE, sessionToken(saved), COOKIE_OPTS);
    return res;
  } catch (e) {
    return NextResponse.json({ error: "server", message: String((e as Error)?.message || e).slice(0, 160) }, { status: 500 });
  }
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, "", { ...COOKIE_OPTS, maxAge: 0 });
  return res;
}
