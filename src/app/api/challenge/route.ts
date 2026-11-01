import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authUser, cleanUsername } from "@/lib/server-auth";

function addDaysStr(s: string, delta: number): string {
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + delta);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

async function sumPoints(username: string, from: string, to: string): Promise<number> {
  const rows = await db.dailySummary.findMany({
    where: { username, date: { gte: from, lte: to } },
    select: { points: true },
  });
  return rows.reduce((a, r) => a + r.points, 0);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const action = String(body?.action || "");
    const me = cleanUsername(String(body?.username || ""));
    const pin = String(body?.pin || "");
    const user = await authUser(me, pin);
    if (!user) return NextResponse.json({ ok: false, error: "auth" }, { status: 401 });

    if (action === "create") {
      const friend = cleanUsername(String(body?.friend || ""));
      const days = Number(body?.days) === 30 ? 30 : 7;
      const rel = await db.friendship.findFirst({
        where: {
          status: "accepted",
          OR: [
            { fromUser: me, toUser: friend },
            { fromUser: friend, toUser: me },
          ],
        },
      });
      if (!rel) return NextResponse.json({ ok: false, error: "not_friends" }, { status: 400 });
      const pad = (n: number) => String(n).padStart(2, "0");
      const d = new Date();
      const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      // if there's a pending challenge between the two, replace
      await db.challenge.deleteMany({
        where: {
          status: "pending",
          OR: [
            { fromUser: me, toUser: friend },
            { fromUser: friend, toUser: me },
          ],
        },
      });
      const c = await db.challenge.create({
        data: { fromUser: me, toUser: friend, days, startDate: today, status: "pending" },
      });
      return NextResponse.json({ ok: true, id: c.id });
    }

    if (action === "list") {
      const pad = (n: number) => String(n).padStart(2, "0");
      const d = new Date();
      const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      const rows = await db.challenge.findMany({
        where: { OR: [{ fromUser: me }, { toUser: me }] },
        orderBy: { createdAt: "desc" },
        take: 20,
      });
      const out: Array<Record<string, unknown>> = [];
      for (const c of rows) {
        const friendName = c.fromUser === me ? c.toUser : c.fromUser;
        const u = await db.user.findUnique({ where: { username: friendName } });
        const end = addDaysStr(c.startDate, c.days - 1);
        const status = c.status === "pending" ? "pending" : today > end ? "ended" : "active";
        let myTotal = 0;
        let friendTotal = 0;
        if (status !== "pending") {
          const to = status === "ended" ? end : today;
          myTotal = await sumPoints(me, c.startDate, to);
          friendTotal = await sumPoints(friendName, c.startDate, to);
        }
        out.push({
          id: c.id,
          fromUser: c.fromUser,
          toUser: c.toUser,
          days: c.days,
          startDate: c.startDate,
          endDate: end,
          status,
          myTotal,
          friendTotal,
          friendName: u?.name || friendName,
          iAmStarter: c.fromUser === me,
        });
      }
      return NextResponse.json({ ok: true, today, challenges: out });
    }

    if (action === "respond") {
      const id = String(body?.id || "");
      const accept = Boolean(body?.accept);
      const c = await db.challenge.findUnique({ where: { id } });
      if (!c) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
      if (c.toUser !== me) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
      if (accept) await db.challenge.update({ where: { id }, data: { status: "active" } });
      else await db.challenge.delete({ where: { id } });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: false, error: "unknown_action" }, { status: 400 });
  } catch (e) {
    console.error("challenge error", e);
    return NextResponse.json({ ok: false, error: "server" }, { status: 500 });
  }
}
