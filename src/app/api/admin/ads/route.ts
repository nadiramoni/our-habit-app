/**
 * /api/admin/ads — the owner's full control over ads + app config, from the
 * localhost dashboard. Reads/writes the SAME app/meta doc the in-app secret
 * panel uses → every installed app picks changes up within ~5 minutes.
 *
 * GET  → { meta } (the whole app/meta: cfg, adminPin, updatedAt…)
 * POST → { cfg } (full ServerCfg object) → merged into app/meta.cfg
 */

import { NextResponse } from "next/server";
import { isAdminAuthed, readMeta, unauthorized, writeMeta } from "@/lib/admin-fb";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  if (!(await isAdminAuthed(req))) return unauthorized();
  try {
    const meta = await readMeta();
    return NextResponse.json({ meta: meta || {} });
  } catch (e) {
    return NextResponse.json({ error: "server", message: String((e as Error)?.message || e).slice(0, 200) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!(await isAdminAuthed(req))) return unauthorized();
  let body: { cfg?: Record<string, unknown>; adminPin?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }
  try {
    const fields: Record<string, unknown> = {};
    if (body.cfg) fields.cfg = body.cfg; // full ServerCfg replace (same shape the in-app panel saves)
    if (typeof body.adminPin === "string" && body.adminPin.trim()) fields.adminPin = body.adminPin.trim();
    if (!Object.keys(fields).length) return NextResponse.json({ error: "empty" }, { status: 400 });
    await writeMeta(fields);
    return NextResponse.json({ ok: true, message: "সেভ হয়ে গেছে ✅ — সব অ্যাপ ৫ মিনিটের মধ্যে আপডেট পাবে" });
  } catch (e) {
    return NextResponse.json({ error: "server", message: String((e as Error)?.message || e).slice(0, 200) }, { status: 500 });
  }
}
