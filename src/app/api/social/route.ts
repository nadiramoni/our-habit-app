import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authUser, cleanUsername } from "@/lib/server-auth";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const action = String(body?.action || "");
    const me = cleanUsername(String(body?.username || ""));
    const pin = String(body?.pin || "");

    // summary upsert — no strict auth needed for lightweight upsert but we verify anyway
    if (action === "summary") {
      const user = await authUser(me, pin);
      if (!user) return NextResponse.json({ ok: false, error: "auth" }, { status: 401 });
      const date = String(body?.date || "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
        return NextResponse.json({ ok: false, error: "bad_date" }, { status: 400 });
      const data = {
        points: Math.max(0, Math.min(999, Number(body?.points) || 0)),
        prayersDone: Math.max(0, Math.min(5, Number(body?.prayersDone) || 0)),
        waterPct: Math.max(0, Math.min(100, Number(body?.waterPct) || 0)),
        reelsFree: Boolean(body?.reelsFree),
        streak: Math.max(0, Math.min(9999, Number(body?.streak) || 0)),
        meditationMin: Math.max(0, Math.min(999, Number(body?.meditationMin) || 0)),
        dhikrTotal: Math.max(0, Math.min(99999, Number(body?.dhikrTotal) || 0)),
      };
      // full details JSON for partner/family full visibility (capped at 4KB)
      let details: string | null = null;
      if (body?.details && typeof body.details === "object") {
        try {
          details = JSON.stringify(body.details).slice(0, 4096);
        } catch {
          details = null;
        }
      }
      await db.dailySummary.upsert({
        where: { username_date: { username: me, date } },
        create: { username: me, date, ...data, details },
        update: { ...data, ...(details ? { details } : {}) },
      });
      return NextResponse.json({ ok: true });
    }

    const user = await authUser(me, pin);
    if (!user) return NextResponse.json({ ok: false, error: "auth" }, { status: 401 });

    if (action === "friends") {
      const date = String(body?.date || "");
      const rels = await db.friendship.findMany({
        where: { OR: [{ fromUser: me }, { toUser: me }], status: "accepted" },
      });
      const friendNames = [...new Set(rels.map((r) => (r.fromUser === me ? r.toUser : r.fromUser)))].filter(
        (f) => f !== me
      );
      const friends = [];
      for (const f of friendNames) {
        const u = await db.user.findUnique({ where: { username: f } });
        if (!u) continue;
        const s = await db.dailySummary.findUnique({
          where: { username_date: { username: f, date } },
        });
        let details: unknown = null;
        if (s?.details) {
          try {
            details = JSON.parse(s.details);
          } catch {
            details = null;
          }
        }
        friends.push({
          username: u.username,
          name: u.name,
          today: s
            ? {
                date: s.date,
                points: s.points,
                prayersDone: s.prayersDone,
                waterPct: s.waterPct,
                reelsFree: s.reelsFree,
                streak: s.streak,
                meditationMin: s.meditationMin,
                dhikrTotal: s.dhikrTotal,
                updatedAt: s.updatedAt.toISOString(),
              }
            : null,
          details,
          lastSeen: s ? s.updatedAt.toISOString() : null,
        });
      }
      const reqs = await db.friendship.findMany({ where: { toUser: me, status: "pending" } });
      const requests = [];
      for (const r of reqs) {
        const u = await db.user.findUnique({ where: { username: r.fromUser } });
        if (u) requests.push({ username: u.username, name: u.name });
      }
      return NextResponse.json({
        ok: true,
        me: { inviteCode: user.inviteCode, name: user.name },
        friends,
        requests,
      });
    }

    if (action === "request") {
      const code = String(body?.code || "").trim().toUpperCase();
      const target = await db.user.findUnique({ where: { inviteCode: code } });
      if (!target) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
      if (target.username === me) return NextResponse.json({ ok: false, error: "self" }, { status: 400 });
      // already accepted?
      const existing1 = await db.friendship.findUnique({
        where: { fromUser_toUser: { fromUser: me, toUser: target.username } },
      });
      const existing2 = await db.friendship.findUnique({
        where: { fromUser_toUser: { fromUser: target.username, toUser: me } },
      });
      if (existing2?.status === "pending") {
        // target already requested me — auto-accept both
        await db.friendship.update({ where: { id: existing2.id }, data: { status: "accepted" } });
        if (existing1) await db.friendship.update({ where: { id: existing1.id }, data: { status: "accepted" } });
        return NextResponse.json({ ok: true, auto: true });
      }
      if (existing1?.status === "accepted" || existing2?.status === "accepted")
        return NextResponse.json({ ok: true, auto: true });
      await db.friendship.upsert({
        where: { fromUser_toUser: { fromUser: me, toUser: target.username } },
        create: { fromUser: me, toUser: target.username, status: "pending" },
        update: { status: "pending" },
      });
      return NextResponse.json({ ok: true });
    }

    if (action === "respond") {
      const from = cleanUsername(String(body?.from || ""));
      const accept = Boolean(body?.accept);
      const rel = await db.friendship.findUnique({
        where: { fromUser_toUser: { fromUser: from, toUser: me } },
      });
      if (!rel) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
      if (accept) {
        await db.friendship.update({ where: { id: rel.id }, data: { status: "accepted" } });
        await db.friendship.upsert({
          where: { fromUser_toUser: { fromUser: me, toUser: from } },
          create: { fromUser: me, toUser: from, status: "accepted" },
          update: { status: "accepted" },
        });
      } else {
        await db.friendship.delete({ where: { id: rel.id } });
      }
      return NextResponse.json({ ok: true });
    }

    if (action === "remove") {
      const friend = cleanUsername(String(body?.friend || ""));
      await db.friendship.deleteMany({
        where: {
          OR: [
            { fromUser: me, toUser: friend },
            { fromUser: friend, toUser: me },
          ],
        },
      });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: false, error: "unknown_action" }, { status: 400 });
  } catch (e) {
    console.error("social error", e);
    return NextResponse.json({ ok: false, error: "server" }, { status: 500 });
  }
}
