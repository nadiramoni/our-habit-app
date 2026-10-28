import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authUser, cleanUsername, hashPin, makeInviteCode, validPin, validUsername } from "@/lib/server-auth";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const action = body?.action as string;
    const username = cleanUsername(String(body?.username || ""));
    const pin = String(body?.pin || "");

    if (action === "register") {
      const name = String(body?.name || "").trim().slice(0, 40) || username;
      if (!validUsername(username))
        return NextResponse.json({ ok: false, error: "invalid_username" }, { status: 400 });
      if (!validPin(pin)) return NextResponse.json({ ok: false, error: "invalid_pin" }, { status: 400 });
      const exists = await db.user.findUnique({ where: { username } });
      if (exists) return NextResponse.json({ ok: false, error: "taken" }, { status: 409 });
      let inviteCode = makeInviteCode();
      for (let i = 0; i < 5; i++) {
        const c = await db.user.findUnique({ where: { inviteCode } });
        if (!c) break;
        inviteCode = makeInviteCode();
      }
      const user = await db.user.create({
        data: { username, pinHash: hashPin(pin, username), name, inviteCode },
      });
      return NextResponse.json({
        ok: true,
        user: { username: user.username, name: user.name, inviteCode: user.inviteCode },
      });
    }

    if (action === "login") {
      const user = await authUser(username, pin);
      if (!user) return NextResponse.json({ ok: false, error: "wrong" }, { status: 401 });
      return NextResponse.json({
        ok: true,
        user: { username: user.username, name: user.name, inviteCode: user.inviteCode },
      });
    }

    return NextResponse.json({ ok: false, error: "unknown_action" }, { status: 400 });
  } catch (e) {
    console.error("auth error", e);
    return NextResponse.json({ ok: false, error: "server" }, { status: 500 });
  }
}
