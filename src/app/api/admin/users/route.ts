/**
 * /api/admin/users — the full account list for the admin table.
 *
 * Merges THREE sources into one row per account:
 *   • Auth listUsers()  → email, provider (google.com / password), disabled,
 *                         lastSignIn, createdAt
 *   • usersIndex/{uid}  → the REGISTERED full name (what the app shows)
 *   • backups/{uid}     → last activity + today's habit summary (নামাজ/পানি/রিলস…)
 *
 * GET ?page=1 (100 users per page — Auth's listUsers page size)
 */

import { NextResponse } from "next/server";
import { getAdmin, isAdminAuthed, readProfiles, readBackupSummaries, unauthorized } from "@/lib/admin-fb";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  if (!(await isAdminAuthed(req))) return unauthorized();
  try {
    const { auth } = getAdmin();
    const url = new URL(req.url);
    const maxPages = Math.min(Math.max(Number(url.searchParams.get("pages") || 1), 1), 20); // up to 2000 users
    const rows: Record<string, unknown>[] = [];
    let token: string | undefined;
    let total = 0;

    for (let p = 0; p < maxPages; p++) {
      const res = await auth.listUsers(100, token);
      total += res.users.length;
      for (const u of res.users) {
        rows.push({
          uid: u.uid,
          email: u.email || "",
          displayName: u.displayName || "",
          provider: u.providerData?.[0]?.providerId === "google.com" ? "google" : "password",
          disabled: Boolean(u.disabled),
          emailVerified: Boolean(u.emailVerified),
          createdAt: u.metadata?.creationTime || null,
          lastSignIn: u.metadata?.lastSignInTime || null,
        });
      }
      token = res.pageToken;
      if (!token) break;
    }

    // merge display names + habit summaries (bulk reads)
    const uids = rows.map((r) => String(r.uid));
    const [profiles, backups] = await Promise.all([readProfiles(uids), readBackupSummaries(uids)]);
    for (const r of rows) {
      const uid = String(r.uid);
      const p = profiles.get(uid);
      const b = backups.get(uid);
      r.name = (p?.name as string) || r.displayName || (r.email ? String(r.email).split("@")[0] : "");
      r.inviteCode = (p?.inviteCode as string) || "";
      r.friends = Array.isArray(p?.friends) ? p.friends.length : 0;
      if (b) {
        r.lastActive = b.updatedAt ?? null;
        r.days = b.days;
        r.streak = b.streak;
        r.today = b.today;
        r.lastDay = b.lastDay;
      } else {
        r.lastActive = null;
        r.days = 0;
        r.streak = 0;
        r.today = null;
        r.lastDay = null;
      }
    }

    const stats = {
      total: rows.length,
      google: rows.filter((r) => r.provider === "google").length,
      email: rows.filter((r) => r.provider === "password").length,
      banned: rows.filter((r) => r.disabled).length,
      activeToday: rows.filter((r) => (r.today as unknown) !== null && r.today).length,
      withApp: rows.filter((r) => Number(r.days) > 0).length,
    };

    return NextResponse.json({ users: rows, stats, hasMore: Boolean(token) });
  } catch (e) {
    return NextResponse.json({ error: "server", message: String((e as Error)?.message || e).slice(0, 200) }, { status: 500 });
  }
}
