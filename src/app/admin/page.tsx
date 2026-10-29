"use client";

/**
 * /admin — the OWNER's localhost control room (v3.0).
 *
 * Open http://localhost:3000/admin on the computer where the app runs.
 * What the owner can do here (his exact requests):
 *   • কারা জিমেইল দিয়ে অ্যাকাউন্ট করল, কারা ইমেইল দিয়ে — full user list
 *   • প্রত্যেকের রিয়েল স্ট্যাটাস — নামাজ / পানি / রিলস / যিকির / স্ট্রিক (১৪ দিন)
 *   • যেকোনো ইউজারের পাসওয়ার্ড নিজে বদলানো বা রিসেট মেইল পাঠানো
 *   • অ্যাকাউন্ট ব্যান / আনব্যান / ডিলিট
 *   • অ্যাডস (Adsterra ৬ জোন + AdMob + auto-update) নিজে বদলানো — সব
 *     অ্যাপ ৫ মিনিটে নতুন কনফিগ পায়
 *
 * Requires: admin-sdk-key.json in the project root (guide: ADMIN-GUIDE-bn.md).
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";

// ---------- types (mirror of the API responses) ----------
interface DayRow {
  date: string;
  prayers: boolean[];
  prayerWater: number;
  waterMl: number;
  reelsMin: number | null;
  reels: Record<string, number>;
  dhikr: number;
  meditationMin: number;
  focusMin: number;
  sleepBed: string | null;
  sleepWake: string | null;
  mood: number | null;
  note: string;
}
interface UserRow {
  uid: string;
  email: string;
  name: string;
  provider: "google" | "password";
  disabled: boolean;
  emailVerified: boolean;
  createdAt: string | null;
  lastSignIn: string | null;
  lastActive: unknown;
  days: number;
  streak: number;
  inviteCode: string;
  friends: number;
  today: { prayers: number; waterMl: number; reelsMin: number | null; dhikr: number; meditationMin: number; focusMin: number } | null;
  lastDay: { date: string; prayers: number; waterMl: number; reelsMin: number | null; dhikr: number; meditationMin: number; focusMin: number } | null;
}
interface Stats {
  total: number;
  google: number;
  email: number;
  banned: number;
  activeToday: number;
  withApp: number;
}
interface AtZone { on: boolean; code: string }
interface AdsCfg {
  adsEnabled: boolean;
  ads: { banner: { on: boolean; id: string }; native: { on: boolean; id: string }; rewarded: { on: boolean; id: string }; adsense: { on: boolean; id: string }; adsterra: { on: boolean; id: string } };
  at: Record<string, AtZone>;
  firebase: { on: boolean; config: string };
  latestVersion: string;
  apkUrl: string;
  changelog: string;
  forceUpdate: boolean;
}

const AT_ZONES: { key: string; label: string; hint: string }[] = [
  { key: "bannerUpgrade", label: "⬆️ আপগ্রেড ব্যানার (সবার আগে দেখায়)", hint: "একটা ACTIVE ব্যানার জোনের GET CODE দাও" },
  { key: "banner300", label: "ব্যানার 300×250 (মোবাইল)", hint: "300x250 ব্যানার জোন" },
  { key: "banner728", label: "ব্যানার 728×90 (ট্যাবলেট/ডেস্কটপ)", hint: "728x90 ব্যানার জোন" },
  { key: "nativeBanner", label: "নেটিভ ব্যানার (কার্ডের ফাঁকে)", hint: "Native Banner জোন" },
  { key: "socialBar", label: "সোশ্যাল বার (ভাসমান)", hint: "Social Bar জোন — সবচেয়ে বেশি আয়" },
  { key: "smartlink", label: "স্মার্টলিংক বাটন", hint: "Direct Link জোন" },
  { key: "popunder", label: "পপআন্ডার (ডিফল্ট বন্ধ)", hint: "খুললে নতুন ট্যাবে অ্যাড ওপেন হয়" },
];

function fmtDate(v: unknown): string {
  if (!v) return "—";
  try {
    const d = v instanceof Date ? v : new Date(String(v));
    if (Number.isNaN(d.getTime())) return String(v).slice(0, 16);
    return d.toLocaleString("bn-BD", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "—";
  }
}
function timeAgo(v: unknown): string {
  if (!v) return "—";
  try {
    const d = v instanceof Date ? v : new Date(String(v));
    const mins = Math.floor((Date.now() - d.getTime()) / 60000);
    if (Number.isNaN(mins)) return "—";
    if (mins < 1) return "এখন";
    if (mins < 60) return `${mins} মিনিট আগে`;
    if (mins < 1440) return `${Math.floor(mins / 60)} ঘণ্টা আগে`;
    return `${Math.floor(mins / 1440)} দিন আগে`;
  } catch {
    return "—";
  }
}
const bn = (n: number | null | undefined): string => {
  if (n === null || n === undefined) return "—";
  try {
    return new Intl.NumberFormat("bn-BD").format(n);
  } catch {
    return String(n);
  }
};

export default function AdminPage() {
  // ---------- session ----------
  const [phase, setPhase] = useState<"loading" | "nokey" | "setup" | "login" | "ready">("loading");
  const [hint, setHint] = useState("");
  const [pass, setPass] = useState("");
  const [newPass, setNewPass] = useState("");
  const [loginErr, setLoginErr] = useState("");
  const [busy, setBusy] = useState(false);

  // ---------- users ----------
  const [tab, setTab] = useState<"users" | "ads">("users");
  const [users, setUsers] = useState<UserRow[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "google" | "email" | "banned">("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<null | (typeof userDetailDefault)>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionMsg, setActionMsg] = useState("");
  const [confirmKey, setConfirmKey] = useState("");
  const [setPassVal, setSetPassVal] = useState("");
  const [usersLoading, setUsersLoading] = useState(false);

  // ---------- ads ----------
  const [ads, setAds] = useState<AdsCfg | null>(null);
  const [adsLoading, setAdsLoading] = useState(false);
  const [adsMsg, setAdsMsg] = useState("");

  const userDetailDefault = null as null | {
    user: { uid: string; email: string; displayName: string; provider: string; disabled: boolean; emailVerified: boolean; createdAt: string | null; lastSignIn: string | null };
    name: string;
    settings: { language: string; theme: string; streak: number };
    points: number;
    friends: { uid: string; name: string; email: string }[];
    backupUpdatedAt: unknown;
    days: DayRow[];
  };

  // ---------- boot ----------
  useEffect(() => {
    let dead = false;
    void (async () => {
      try {
        const r = await fetch("/api/admin/session", { cache: "no-store" });
        const j = (await r.json()) as { keyReady: boolean; authed: boolean; needsSetup: boolean; hint?: string };
        if (dead) return;
        if (!j.keyReady) {
          setHint(j.hint || "Service key নেই");
          setPhase("nokey");
        } else if (j.authed) {
          setPhase("ready");
        } else {
          setPhase(j.needsSetup ? "setup" : "login");
        }
      } catch {
        if (!dead) setPhase("nokey");
      }
    })();
    return () => {
      dead = true;
    };
  }, []);

  const loadUsers = useCallback(async () => {
    setUsersLoading(true);
    try {
      const r = await fetch("/api/admin/users?pages=5", { cache: "no-store" });
      if (r.status === 401) {
        setPhase("login");
        return;
      }
      const j = (await r.json()) as { users: UserRow[]; stats: Stats };
      setUsers(j.users || []);
      setStats(j.stats || null);
    } catch {
      /* network */
    } finally {
      setUsersLoading(false);
    }
  }, []);

  const loadAds = useCallback(async () => {
    setAdsLoading(true);
    try {
      const r = await fetch("/api/admin/ads", { cache: "no-store" });
      if (r.status === 401) {
        setPhase("login");
        return;
      }
      const j = (await r.json()) as { meta?: { cfg?: AdsCfg | string } };
      const raw = j.meta?.cfg;
      const cfg = typeof raw === "string" ? (JSON.parse(raw) as AdsCfg) : raw;
      if (cfg) setAds(cfg);
    } catch {
      /* network */
    } finally {
      setAdsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (phase !== "ready") return;
    if (tab === "users" && !users.length) void loadUsers();
    if (tab === "ads" && !ads) void loadAds();
  }, [phase, tab, users.length, ads, loadUsers, loadAds]);

  const openDetail = useCallback(async (uid: string) => {
    setSelected(uid);
    setDetailLoading(true);
    setDetail(null);
    setActionMsg("");
    setSetPassVal("");
    try {
      const r = await fetch(`/api/admin/user/${encodeURIComponent(uid)}`, { cache: "no-store" });
      if (r.status === 401) {
        setPhase("login");
        return;
      }
      setDetail((await r.json()) as typeof userDetailDefault);
    } catch {
      /* network */
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const doAction = useCallback(
    async (uid: string, action: string, extra?: Record<string, unknown>) => {
      setActionMsg("⏳ হচ্ছে…");
      try {
        const r = await fetch(`/api/admin/user/${encodeURIComponent(uid)}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action, ...extra }),
        });
        const j = (await r.json()) as { ok?: boolean; message?: string; error?: string };
        setActionMsg(j.message || j.error || "সম্পন্ন");
        if (j.ok) {
          await loadUsers();
          if (action !== "delete") await openDetail(uid);
          else setSelected(null);
        }
      } catch {
        setActionMsg("নেটওয়ার্ক সমস্যা");
      }
    },
    [loadUsers, openDetail]
  );

  const login = async () => {
    setLoginErr("");
    setBusy(true);
    try {
      const r = await fetch("/api/admin/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: pass, newPassword: newPass || undefined }),
      });
      const j = (await r.json()) as { ok?: boolean; message?: string; error?: string };
      if (j.ok) {
        setPhase("ready");
        setPass("");
        setNewPass("");
      } else {
        setLoginErr(j.message || (j.error === "short" ? "পাসওয়ার্ড অন্তত ৬ অক্ষরের হতে হবে" : "লগইন হয়নি"));
      }
    } catch {
      setLoginErr("নেটওয়ার্ক সমস্যা");
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    await fetch("/api/admin/session", { method: "DELETE" });
    setPhase("login");
    setUsers([]);
    setAds(null);
  };

  const saveAds = async () => {
    if (!ads) return;
    setAdsMsg("⏳ সেভ হচ্ছে…");
    try {
      const r = await fetch("/api/admin/ads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cfg: ads }),
      });
      const j = (await r.json()) as { ok?: boolean; message?: string; error?: string };
      setAdsMsg(j.message || (j.error ? "সেভ হয়নি" : "সম্পন্ন"));
    } catch {
      setAdsMsg("নেটওয়ার্ক সমস্যা");
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (filter === "google" && u.provider !== "google") return false;
      if (filter === "email" && u.provider !== "password") return false;
      if (filter === "banned" && !u.disabled) return false;
      if (!q) return true;
      return (u.name || "").toLowerCase().includes(q) || (u.email || "").toLowerCase().includes(q);
    });
  }, [users, search, filter]);

  // ================= LOGIN / SETUP SCREENS =================
  if (phase === "loading") {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center">
        <p className="text-slate-400 animate-pulse">লোড হচ্ছে…</p>
      </div>
    );
  }

  if (phase === "nokey") {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
        <div className="max-w-lg w-full bg-slate-900 border border-amber-500/30 rounded-2xl p-6 space-y-4">
          <div className="text-4xl text-center">🔑</div>
          <h1 className="text-xl font-bold text-center">অ্যাডমিন কী নেই</h1>
          <p className="text-sm text-slate-300 leading-relaxed">{hint}</p>
          <div className="bg-slate-800 rounded-xl p-4 text-xs text-slate-300 leading-relaxed space-y-2">
            <p className="font-bold text-slate-100">কী নামানোর নিয়ম (একবারই লাগবে):</p>
            <p>১. Firebase Console ওপেন করো → তোমার প্রজেক্ট (our-habit-61587)</p>
            <p>২. ⚙️ Project Settings → Service accounts ট্যাব</p>
            <p>৩. নিচের নীল বাটন <b>“Generate new private key”</b> চাপো → Key generated কনফার্ম করো</p>
            <p>৪. ডাউনলোড হওয়া JSON ফাইলটাকে নাম বদলে <b className="text-emerald-400">admin-sdk-key.json</b> করে প্রজেক্ট ফোল্ডারে রাখো (package.json যেখানে আছে ঠিক সেখানে)</p>
            <p>৫. এই পেজটা রিফ্রেশ দাও</p>
          </div>
          <p className="text-[11px] text-rose-400 leading-relaxed">⚠️ এই ফাইলটা কারো সাথে শেয়ার করবে না — এটা তোমার পুরো Firebase প্রজেক্টের মাস্টার চাবি।</p>
        </div>
      </div>
    );
  }

  if (phase === "setup" || phase === "login") {
    const isSetup = phase === "setup";
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
        <div className="max-w-sm w-full bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-2xl">🛡️</div>
            <div>
              <h1 className="text-lg font-bold">অ্যাডমিন প্যানেল</h1>
              <p className="text-[11px] text-slate-400">আওয়ার হ্যাবিট — মালিকের কন্ট্রোল রুম</p>
            </div>
          </div>
          {isSetup ? (
            <p className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 leading-relaxed">
              প্রথমবার ঢুকছো — নিজের একটা <b>অ্যাডমিন পাসওয়ার্ড</b> বানিয়ে নাও (অন্তত ৬ অক্ষর)। পরের বার এটা দিয়েই ঢুকবে।
            </p>
          ) : null}
          <input
            type="password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void login()}
            placeholder={isSetup ? "নতুন অ্যাডমিন পাসওয়ার্ড" : "অ্যাডমিন পাসওয়ার্ড"}
            className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-emerald-500/50"
          />
          {isSetup ? (
            <input
              type="password"
              value={newPass}
              onChange={(e) => setNewPass(e.target.value)}
              placeholder="আবার লিখো (নিশ্চিত করার জন্য)"
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-emerald-500/50"
            />
          ) : null}
          {loginErr ? <p className="text-xs text-rose-400 text-center">⚠️ {loginErr}</p> : null}
          <button
            type="button"
            onClick={() => void login()}
            disabled={busy || !pass || (isSetup && newPass !== pass)}
            className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-xl py-3 font-bold text-sm transition-colors"
          >
            {busy ? "..." : isSetup ? "পাসওয়ার্ড সেট করে ঢুকো" : "লগইন"}
          </button>
        </div>
      </div>
    );
  }

  // ================= MAIN DASHBOARD =================
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* header */}
      <header className="sticky top-0 z-30 bg-slate-900/95 backdrop-blur border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="text-xl">🛡️</span>
            <div className="min-w-0">
              <h1 className="font-bold text-sm leading-tight truncate">অ্যাডমিন প্যানেল — আওয়ার হ্যাবিট</h1>
              <p className="text-[10px] text-slate-400 leading-tight">localhost · শুধু মালিকের জন্য</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setTab("users")}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${tab === "users" ? "bg-emerald-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}
            >
              👥 ইউজার
            </button>
            <button
              type="button"
              onClick={() => setTab("ads")}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${tab === "ads" ? "bg-emerald-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}
            >
              📢 অ্যাডস
            </button>
            <button type="button" onClick={() => void logout()} className="rounded-lg px-3 py-1.5 text-xs font-bold bg-rose-600/20 text-rose-300 hover:bg-rose-600/30 transition-colors">
              বাইরে
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-5">
        {tab === "users" ? (
          <>
            {/* stats */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
              {[
                { label: "মোট ইউজার", value: stats?.total, icon: "👥", color: "text-slate-100" },
                { label: "Google (জিমেইল)", value: stats?.google, icon: "🔵", color: "text-sky-300" },
                { label: "ইমেইল (ম্যানুয়াল)", value: stats?.email, icon: "✉️", color: "text-emerald-300" },
                { label: "আজ অ্যাক্টিভ", value: stats?.activeToday, icon: "⚡", color: "text-amber-300" },
                { label: "অ্যাপ ব্যবহার করছে", value: stats?.withApp, icon: "📈", color: "text-violet-300" },
                { label: "ব্যান হওয়া", value: stats?.banned, icon: "🚫", color: "text-rose-300" },
              ].map((s) => (
                <div key={s.label} className="bg-slate-900 border border-slate-800 rounded-xl p-3">
                  <p className="text-[10px] text-slate-400 leading-tight">{s.icon} {s.label}</p>
                  <p className={`text-2xl font-extrabold mt-1 ${s.color}`}>{bn(s.value ?? 0)}</p>
                </div>
              ))}
            </div>

            {/* search + filter */}
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="🔍 নাম বা ইমেইল খোঁজো…"
                className="flex-1 min-w-[200px] bg-slate-900 border border-slate-800 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-500/40"
              />
              {([
                ["all", "সব"],
                ["google", "🔵 Google"],
                ["email", "✉️ ইমেইল"],
                ["banned", "🚫 ব্যান"],
              ] as const).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setFilter(k)}
                  className={`rounded-lg px-3 py-2 text-xs font-bold transition-colors ${filter === k ? "bg-emerald-600 text-white" : "bg-slate-900 border border-slate-800 text-slate-300 hover:bg-slate-800"}`}
                >
                  {label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => void loadUsers()}
                className="rounded-lg px-3 py-2 text-xs font-bold bg-slate-900 border border-slate-800 text-slate-300 hover:bg-slate-800 transition-colors"
              >
                🔄 রিফ্রেশ
              </button>
            </div>

            {/* users table */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[11px] text-slate-400 border-b border-slate-800 bg-slate-900/80">
                      <th className="text-right px-3 py-2.5 font-bold">নাম</th>
                      <th className="text-right px-3 py-2.5 font-bold">ইমেইল</th>
                      <th className="text-right px-3 py-2.5 font-bold">ধরন</th>
                      <th className="text-right px-3 py-2.5 font-bold">স্ট্যাটাস</th>
                      <th className="text-right px-3 py-2.5 font-bold">নামাজ (আজ)</th>
                      <th className="text-right px-3 py-2.5 font-bold">পানি</th>
                      <th className="text-right px-3 py-2.5 font-bold">রিলস</th>
                      <th className="text-right px-3 py-2.5 font-bold">স্ট্রিক</th>
                      <th className="text-right px-3 py-2.5 font-bold">শেষ অ্যাক্টিভ</th>
                      <th className="px-3 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {usersLoading && !users.length ? (
                      <tr>
                        <td colSpan={10} className="text-center py-10 text-slate-400 animate-pulse">লোড হচ্ছে…</td>
                      </tr>
                    ) : !filtered.length ? (
                      <tr>
                        <td colSpan={10} className="text-center py-10 text-slate-400">কেউ পাওয়া যায়নি</td>
                      </tr>
                    ) : (
                      filtered.map((u) => (
                        <tr key={u.uid} className="border-b border-slate-800/60 hover:bg-slate-800/40 transition-colors">
                          <td className="px-3 py-2.5 font-bold text-emerald-300 max-w-[160px] truncate">{u.name || "—"}</td>
                          <td className="px-3 py-2.5 text-slate-300 max-w-[200px] truncate">{u.email || "—"}</td>
                          <td className="px-3 py-2.5">{u.provider === "google" ? "🔵 Google" : "✉️ ইমেইল"}</td>
                          <td className="px-3 py-2.5">
                            {u.disabled ? <span className="text-[10px] font-bold bg-rose-500/15 text-rose-300 rounded-md px-2 py-1">🚫 ব্যান</span> : <span className="text-[10px] font-bold bg-emerald-500/15 text-emerald-300 rounded-md px-2 py-1">✅ সক্রিয়</span>}
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            {u.today ? (
                              <span className="font-mono">{u.today.prayers}/৫</span>
                            ) : u.lastDay ? (
                              <span className="font-mono text-slate-400" title={`শেষ লগ ${u.lastDay.date}`}>{u.lastDay.prayers}/৫</span>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-center text-slate-300">{u.today ? `${bn(u.today.waterMl)}মি°` : "—"}</td>
                          <td className="px-3 py-2.5 text-center">
                            {u.today?.reelsMin !== null && u.today?.reelsMin !== undefined ? (
                              <span className={u.today.reelsMin > 60 ? "text-rose-300 font-bold" : "text-slate-300"}>{bn(u.today.reelsMin)}মি</span>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-center">{u.days ? `🔥 ${bn(u.streak)}` : "—"}</td>
                          <td className="px-3 py-2.5 text-slate-400 text-xs">{u.lastActive ? timeAgo(u.lastActive) : "—"}</td>
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => void openDetail(u.uid)}
                              className="rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-bold px-3 py-1.5 transition-colors"
                            >
                              দেখো ›
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            <p className="text-[11px] text-slate-500 mt-3 leading-relaxed">
              মোট {bn(users.length)} অ্যাকাউন্ট লোড হয়েছে (প্রথম ৫০০) · “দেখো” চাপলে ওই ইউজারের ১৪ দিনের পুরো রিপোর্ট + ব্যান/পাসওয়ার্ড/ডিলিট অপশন আসবে
            </p>
          </>
        ) : (
          /* ================= ADS TAB ================= */
          <div className="space-y-4 max-w-3xl">
            {adsLoading || !ads ? (
              <p className="text-slate-400 animate-pulse py-10 text-center">অ্যাড কনফিগ লোড হচ্ছে…</p>
            ) : (
              <>
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h2 className="font-bold text-sm">📢 অ্যাডস মাস্টার সুইচ</h2>
                      <p className="text-[11px] text-slate-400 mt-0.5">বন্ধ করলে সব অ্যাপে সব অ্যাড উঠে যাবে</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setAds({ ...ads, adsEnabled: !ads.adsEnabled })}
                      className={`w-16 h-8 rounded-full relative transition-colors ${ads.adsEnabled ? "bg-emerald-600" : "bg-slate-700"}`}
                    >
                      <span className={`absolute top-1 w-6 h-6 bg-white rounded-full transition-all ${ads.adsEnabled ? "right-1" : "left-1"}`} />
                    </button>
                  </div>
                </div>

                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-4">
                  <h2 className="font-bold text-sm">🎯 Adsterra জোনস</h2>
                  {AT_ZONES.map((z) => {
                    const zone = ads.at?.[z.key] || { on: false, code: "" };
                    return (
                      <div key={z.key} className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-3 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-xs font-bold truncate">{z.label}</p>
                            <p className="text-[10px] text-slate-400">{z.hint}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setAds({ ...ads, at: { ...ads.at, [z.key]: { ...zone, on: !zone.on } } })}
                            className={`shrink-0 w-12 h-6 rounded-full relative transition-colors ${zone.on ? "bg-emerald-600" : "bg-slate-600"}`}
                          >
                            <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-all ${zone.on ? "right-0.5" : "left-0.5"}`} />
                          </button>
                        </div>
                        <textarea
                          value={zone.code}
                          onChange={(e) => setAds({ ...ads, at: { ...ads.at, [z.key]: { ...zone, code: e.target.value } } })}
                          placeholder="Adsterra ড্যাশবোর্ড থেকে GET CODE কপি করে এখানে পেস্ট করো"
                          rows={2}
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-[11px] font-mono outline-none focus:ring-2 focus:ring-emerald-500/40"
                        />
                      </div>
                    );
                  })}
                </div>

                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
                  <h2 className="font-bold text-sm">📱 AdMob (অ্যাপের জন্য)</h2>
                  {([
                    ["banner", "ব্যানার আইডি"],
                    ["native", "নেটিভ আইডি"],
                    ["rewarded", "রিওয়ার্ডেড আইডি"],
                  ] as const).map(([k, label]) => (
                    <div key={k} className="flex items-center gap-2">
                      <span className="text-[11px] text-slate-400 w-24 shrink-0">{label}</span>
                      <input
                        value={(ads.ads as unknown as Record<string, { id: string }>)[k]?.id || ""}
                        onChange={(e) => setAds({ ...ads, ads: { ...ads.ads, [k]: { ...(ads.ads as unknown as Record<string, { on: boolean; id: string }>)[k], id: e.target.value } } as AdsCfg["ads"] })}
                        placeholder="ca-app-pub-…"
                        className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-[11px] font-mono outline-none focus:ring-2 focus:ring-emerald-500/40"
                      />
                    </div>
                  ))}
                </div>

                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
                  <h2 className="font-bold text-sm">🔄 অটো-আপডেট</h2>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-slate-400 w-24 shrink-0">নতুন ভার্সন</span>
                    <input value={ads.latestVersion || ""} onChange={(e) => setAds({ ...ads, latestVersion: e.target.value })} placeholder="যেমন 3.0.0" className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-emerald-500/40" />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-slate-400 w-24 shrink-0">APK লিংক</span>
                    <input value={ads.apkUrl || ""} onChange={(e) => setAds({ ...ads, apkUrl: e.target.value })} placeholder="https://…apk" className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-emerald-500/40" />
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-[11px] text-slate-400 w-24 shrink-0 pt-2">চেঞ্জলগ</span>
                    <textarea value={ads.changelog || ""} onChange={(e) => setAds({ ...ads, changelog: e.target.value })} rows={3} placeholder="নতুন কী এসেছে…" className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-emerald-500/40" />
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={Boolean(ads.forceUpdate)} onChange={(e) => setAds({ ...ads, forceUpdate: e.target.checked })} className="accent-emerald-600 w-4 h-4" />
                    <span className="text-xs text-slate-300">জোর করে আপডেট (না করলে অ্যাপ খুলবে না)</span>
                  </label>
                </div>

                <div className="sticky bottom-4 bg-slate-900/95 backdrop-blur border border-slate-800 rounded-2xl p-3 flex items-center gap-3">
                  <button type="button" onClick={() => void saveAds()} className="flex-1 bg-emerald-600 hover:bg-emerald-500 rounded-xl py-3 font-bold text-sm transition-colors">
                    💾 সেভ করো — সব অ্যাপে যাবে
                  </button>
                  {adsMsg ? <p className="text-[11px] text-emerald-300 max-w-[50%] leading-snug">{adsMsg}</p> : null}
                </div>
              </>
            )}
          </div>
        )}
      </main>

      {/* ================= USER DETAIL MODAL ================= */}
      {selected ? (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm overflow-y-auto">
          <div className="min-h-full flex items-start justify-center p-4">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl my-8">
              <div className="flex items-center justify-between p-4 border-b border-slate-800 sticky top-0 bg-slate-900 rounded-t-2xl">
                <h2 className="font-bold text-sm">👤 ইউজারের পুরো রিপোর্ট</h2>
                <button type="button" onClick={() => setSelected(null)} className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 font-bold">✕</button>
              </div>
              <div className="p-4 space-y-4">
                {detailLoading || !detail ? (
                  <p className="text-slate-400 animate-pulse text-center py-10">লোড হচ্ছে…</p>
                ) : (
                  <>
                    {/* identity */}
                    <div className="bg-slate-800/50 rounded-xl p-4 space-y-1.5">
                      <p className="text-lg font-extrabold text-emerald-300">{detail.name || detail.user.displayName || "—"}</p>
                      <p className="text-xs text-slate-300">✉️ {detail.user.email || "—"}</p>
                      <p className="text-xs text-slate-400">
                        {detail.user.provider === "google" ? "🔵 Google (জিমেইল) দিয়ে অ্যাকাউন্ট" : "✉️ ইমেইল (ম্যানুয়াল) দিয়ে অ্যাকাউন্ট"}
                        {detail.user.emailVerified ? " · ✅ ভেরিফাইড" : " · ⏳ ভেরিফাই হয়নি"}
                      </p>
                      <p className="text-[11px] text-slate-400">অ্যাকাউন্ট খোলা: {fmtDate(detail.user.createdAt)} · শেষ লগইন: {fmtDate(detail.user.lastSignIn)}</p>
                      <p className="text-[11px] text-slate-400">ক্লাউড ব্যাকআপ: {detail.backupUpdatedAt ? timeAgo(detail.backupUpdatedAt) : "নেই"}</p>
                      <p className="text-[11px] text-slate-400">স্ট্রিক: 🔥 {bn(detail.settings.streak)} · পয়েন্ট: ⭐ {bn(detail.points)} · বন্ধু: {bn(detail.friends.length)}</p>
                      {detail.user.disabled ? <p className="text-xs font-bold text-rose-400">🚫 এই অ্যাকাউন্ট ব্যান করা আছে</p> : null}
                    </div>

                    {/* 14-day habit table */}
                    <div className="bg-slate-800/50 rounded-xl p-3">
                      <p className="text-xs font-bold mb-2">📅 শেষ ১৪ দিনের রিয়েল স্ট্যাটাস</p>
                      {detail.days.length ? (
                        <div className="overflow-x-auto">
                          <table className="w-full text-[11px]">
                            <thead>
                              <tr className="text-slate-400 border-b border-slate-700">
                                <th className="text-right px-1.5 py-1.5">তারিখ</th>
                                <th className="px-1.5 py-1.5">নামাজ</th>
                                <th className="text-right px-1.5 py-1.5">পানি</th>
                                <th className="text-right px-1.5 py-1.5">রিলস</th>
                                <th className="text-right px-1.5 py-1.5">যিকির</th>
                                <th className="text-right px-1.5 py-1.5">মেডি</th>
                                <th className="text-right px-1.5 py-1.5">ঘুম</th>
                              </tr>
                            </thead>
                            <tbody>
                              {detail.days.map((d) => (
                                <tr key={d.date} className="border-b border-slate-700/50">
                                  <td className="px-1.5 py-1.5 text-slate-300 font-mono">{d.date}</td>
                                  <td className="px-1.5 py-1.5 text-center">
                                    <span className="font-mono">{bn(d.prayers.filter(Boolean).length)}/৫</span>
                                    <span className="text-slate-500 tracking-tight"> {d.prayers.map((p) => (p ? "🟩" : "⬜")).join("")}</span>
                                  </td>
                                  <td className="px-1.5 py-1.5 text-right font-mono text-sky-300">{bn(d.waterMl)}মি°</td>
                                  <td className={`px-1.5 py-1.5 text-right font-mono ${(d.reelsMin || 0) > 60 ? "text-rose-300 font-bold" : "text-slate-300"}`}>{d.reelsMin === null ? "—" : `${bn(d.reelsMin)}মি`}</td>
                                  <td className="px-1.5 py-1.5 text-right font-mono text-amber-300">{bn(d.dhikr)}</td>
                                  <td className="px-1.5 py-1.5 text-right font-mono text-slate-300">{bn(d.meditationMin)}মি</td>
                                  <td className="px-1.5 py-1.5 text-right text-slate-400 font-mono text-[10px]">{d.sleepBed || "—"}→{d.sleepWake || "—"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className="text-xs text-slate-400 py-3 text-center">কোনো হ্যাবিট ডেটা নেই — এখনো অ্যাপ ব্যবহার করেনি</p>
                      )}
                    </div>

                    {/* actions */}
                    <div className="bg-slate-800/50 rounded-xl p-3 space-y-3">
                      <p className="text-xs font-bold">⚙️ অ্যাডমিন অ্যাকশন</p>
                      {/* password */}
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="text"
                          value={setPassVal}
                          onChange={(e) => setSetPassVal(e.target.value)}
                          placeholder="নতুন পাসওয়ার্ড (৬+ অক্ষর)"
                          className="flex-1 min-w-[160px] bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-emerald-500/40"
                        />
                        <button
                          type="button"
                          onClick={() => (setPassVal.trim().length >= 6 ? void doAction(detail.user.uid, "setpass", { password: setPassVal.trim() }) : setActionMsg("পাসওয়ার্ড অন্তত ৬ অক্ষরের হতে হবে"))}
                          className="rounded-lg bg-emerald-600 hover:bg-emerald-500 px-3 py-2 text-xs font-bold transition-colors"
                        >
                          🔑 পাসওয়ার্ড বদলাও
                        </button>
                        <button
                          type="button"
                          onClick={() => void doAction(detail.user.uid, "resetmail")}
                          className="rounded-lg bg-slate-700 hover:bg-slate-600 px-3 py-2 text-xs font-bold transition-colors"
                        >
                          ✉️ রিসেট মেইল
                        </button>
                      </div>
                      {/* ban / delete */}
                      <div className="flex flex-wrap items-center gap-2">
                        {detail.user.disabled ? (
                          <button type="button" onClick={() => void doAction(detail.user.uid, "unban")} className="rounded-lg bg-emerald-600/80 hover:bg-emerald-500 px-4 py-2 text-xs font-bold transition-colors">
                            ✅ আনব্যান করো
                          </button>
                        ) : confirmKey === `ban-${detail.user.uid}` ? (
                          <button type="button" onClick={() => { setConfirmKey(""); void doAction(detail.user.uid, "ban"); }} className="rounded-lg bg-rose-600 hover:bg-rose-500 px-4 py-2 text-xs font-bold animate-pulse transition-colors">
                            ⚠️ হ্যাঁ, ব্যান করে দাও!
                          </button>
                        ) : (
                          <button type="button" onClick={() => setConfirmKey(`ban-${detail.user.uid}`)} className="rounded-lg bg-rose-600/20 text-rose-300 hover:bg-rose-600/30 px-4 py-2 text-xs font-bold transition-colors">
                            🚫 ব্যান করো
                          </button>
                        )}
                        {confirmKey === `del-${detail.user.uid}` ? (
                          <button type="button" onClick={() => { setConfirmKey(""); void doAction(detail.user.uid, "delete"); }} className="rounded-lg bg-red-700 hover:bg-red-600 px-4 py-2 text-xs font-bold animate-pulse transition-colors">
                            ⚠️ হ্যাঁ, পুরো অ্যাকাউন্ট মুছে দাও!
                          </button>
                        ) : (
                          <button type="button" onClick={() => setConfirmKey(`del-${detail.user.uid}`)} className="rounded-lg bg-red-900/30 text-red-300 hover:bg-red-900/50 px-4 py-2 text-xs font-bold transition-colors">
                            🗑️ অ্যাকাউন্ট ডিলিট
                          </button>
                        )}
                      </div>
                      {actionMsg ? <p className="text-[11px] text-emerald-300 bg-emerald-500/10 rounded-lg px-3 py-2">{actionMsg}</p> : null}
                      <p className="text-[10px] text-slate-500 leading-relaxed">
                        ব্যান করলে ইউজারের সেশন কয়েক মিনিটের মধ্যে মারা যাবে আর লগইনে “অ্যাকাউন্ট ব্যান করা হয়েছে” দেখাবে। ডিলিট করলে অ্যাকাউন্ট + ক্লাউড ডেটা সব মুছে যাবে — ফেরানো যাবে না।
                      </p>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
