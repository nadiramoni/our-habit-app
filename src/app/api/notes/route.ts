import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authUser, cleanUsername, pairKeyOf } from "@/lib/server-auth";

async function areFriends(a: string, b: string): Promise<boolean> {
  const rel = await db.friendship.findFirst({
    where: {
      status: "accepted",
      OR: [
        { fromUser: a, toUser: b },
        { fromUser: b, toUser: a },
      ],
    },
  });
  return Boolean(rel);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const action = String(body?.action || "");
    const me = cleanUsername(String(body?.username || ""));
    const pin = String(body?.pin || "");
    const user = await authUser(me, pin);
    if (!user) return NextResponse.json({ ok: false, error: "auth" }, { status: 401 });

    if (action === "list") {
      const partner = cleanUsername(String(body?.partner || ""));
      if (!(await areFriends(me, partner)))
        return NextResponse.json({ ok: false, error: "not_friends" }, { status: 400 });
      const pk = pairKeyOf(me, partner);
      const rows = await db.sharedNote.findMany({
        where: { pairKey: pk },
        orderBy: { createdAt: "asc" },
        take: 200,
      });
      return NextResponse.json({
        ok: true,
        notes: rows.map((r) => ({
          id: r.id,
          author: r.author,
          text: r.text,
          done: r.done,
          doneBy: r.doneBy,
          createdAt: r.createdAt.toISOString(),
        })),
      });
    }

    if (action === "add") {
      const partner = cleanUsername(String(body?.partner || ""));
      const text = String(body?.text || "").trim().slice(0, 500);
      if (!text) return NextResponse.json({ ok: false, error: "empty" }, { status: 400 });
      if (!(await areFriends(me, partner)))
        return NextResponse.json({ ok: false, error: "not_friends" }, { status: 400 });
      const pk = pairKeyOf(me, partner);
      await db.sharedNote.create({ data: { pairKey: pk, author: me, text } });
      return NextResponse.json({ ok: true });
    }

    if (action === "toggle") {
      const id = String(body?.id || "");
      const note = await db.sharedNote.findUnique({ where: { id } });
      if (!note) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
      const parts = note.pairKey.split("|");
      if (!parts.includes(me)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
      await db.sharedNote.update({
        where: { id },
        data: { done: !note.done, doneBy: !note.done ? me : null },
      });
      return NextResponse.json({ ok: true });
    }

    if (action === "delete") {
      const id = String(body?.id || "");
      const note = await db.sharedNote.findUnique({ where: { id } });
      if (!note) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
      const parts = note.pairKey.split("|");
      if (!parts.includes(me)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
      await db.sharedNote.delete({ where: { id } });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: false, error: "unknown_action" }, { status: 400 });
  } catch (e) {
    console.error("notes error", e);
    return NextResponse.json({ ok: false, error: "server" }, { status: 500 });
  }
}
