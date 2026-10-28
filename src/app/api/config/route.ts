import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { db } from "@/lib/db";
import { defaultServerCfg, ServerCfg } from "@/lib/types";

const SALT = "ourhabit::admin";

function hashAdmin(pin: string): string {
  return createHash("sha256").update(`${pin}::${SALT}`).digest("hex");
}

async function getValue(key: string): Promise<string | null> {
  const row = await db.appConfig.findUnique({ where: { key } });
  return row?.value ?? null;
}

async function setValue(key: string, value: string) {
  await db.appConfig.upsert({ where: { key }, create: { key, value }, update: { value } });
}

// GET — public: every client fetches the live config (ads + update info)
export async function GET() {
  try {
    const raw = await getValue("cfg");
    const cfg: ServerCfg = raw ? { ...defaultServerCfg(), ...(JSON.parse(raw) as Partial<ServerCfg>) } : defaultServerCfg();
    return NextResponse.json({ ok: true, cfg });
  } catch {
    return NextResponse.json({ ok: true, cfg: defaultServerCfg() });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const action = String(body?.action || "");

    // does an admin PIN exist yet?
    if (action === "status") {
      const hasPin = Boolean(await getValue("admin_pin"));
      return NextResponse.json({ ok: true, hasPin });
    }

    const pin = String(body?.pin || "");
    const stored = await getValue("admin_pin");

    // first-time setup — no pin yet, so this call defines it
    if (action === "setPin") {
      if (stored) return NextResponse.json({ ok: false, error: "already_set" }, { status: 403 });
      if (!/^\d{4,6}$/.test(pin)) return NextResponse.json({ ok: false, error: "bad_pin" }, { status: 400 });
      await setValue("admin_pin", hashAdmin(pin));
      return NextResponse.json({ ok: true });
    }

    if (!stored || hashAdmin(pin) !== stored) {
      return NextResponse.json({ ok: false, error: "wrong_pin" }, { status: 401 });
    }

    if (action === "changePin") {
      const newPin = String(body?.newPin || "");
      if (!/^\d{4,6}$/.test(newPin)) return NextResponse.json({ ok: false, error: "bad_pin" }, { status: 400 });
      await setValue("admin_pin", hashAdmin(newPin));
      return NextResponse.json({ ok: true });
    }

    if (action === "save") {
      const incoming = (body?.cfg || {}) as Partial<ServerCfg>;
      const raw = await getValue("cfg");
      const current: ServerCfg = raw
        ? { ...defaultServerCfg(), ...(JSON.parse(raw) as Partial<ServerCfg>) }
        : defaultServerCfg();
      const merged: ServerCfg = { ...current, ...incoming };
      await setValue("cfg", JSON.stringify(merged));
      return NextResponse.json({ ok: true, cfg: merged });
    }

    return NextResponse.json({ ok: false, error: "unknown_action" }, { status: 400 });
  } catch (e) {
    console.error("config error", e);
    return NextResponse.json({ ok: false, error: "server" }, { status: 500 });
  }
}
