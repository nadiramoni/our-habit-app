"use client";

import React, { useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { useServerCfg } from "@/lib/cfg";
import { Card, SectionTitle, ToggleRow } from "@/components/ui-bits";
import { AtCfg, AtZone, ServerCfg } from "@/lib/types";
import { extractScriptUrl } from "@/components/AdsBanner";
import { mirrorMeta, readRawMeta, writeRawMeta, panelSaveCfg, PanelSaveResult, fbEmailSignIn, fbReadStatus, FbStatusSnapshot, FbStatusUser } from "@/lib/cloud";
import { isNative } from "@/lib/native";
import { APP_VERSION, APP_BUILD } from "@/lib/version";
import { REEL_APPS } from "@/lib/types";
import { deviceLang } from "@/lib/i18n";

/**
 * v2.4: LIVE banner health — reads window.__atHealth (written by AdsBanner
 * after every real-render verdict). The owner sees at a glance WHICH zones
 * actually render and which still serve empty (zone activation state).
 */
function BannerHealth() {
  const { t } = useStore();
  const [health, setHealth] = useState<Record<string, { ok: boolean; mode: string; at: number }>>({});
  useEffect(() => {
    const read = () => {
      try {
        setHealth({ ...((window as unknown as { __atHealth?: Record<string, { ok: boolean; mode: string; at: number }> }).__atHealth || {}) });
      } catch {
        /* ignore */
      }
    };
    read();
    const iv = setInterval(read, 4000);
    return () => clearInterval(iv);
  }, []);
  const keys = Object.keys(health);
  if (!keys.length) return null;
  return (
    <div className="border-t border-border pt-3 mt-3">
      <div className="text-sm font-bold">🩺 Banner Health ({t("admLiveTag") || "live"})</div>
      <div className="text-[11px] text-muted-foreground mb-2 leading-relaxed">
        Zone-এর স্ট্যাটাস — Adsterra dashboard-এ zone "Active" না হলে এখানে লাল দেখাবে। সবুজ = বিজ্ঞাপন সত্যিই রেন্ডার হচ্ছে।
      </div>
      <div className="flex flex-col gap-1">
        {keys.map((k) => {
          const hv = health[k];
          return (
            <div key={k} className={`flex items-center justify-between rounded-lg px-2.5 py-1.5 text-[11px] ${hv.ok ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"}`}>
              <span className="font-mono truncate max-w-[55%]">…{k.slice(-8)}</span>
              <span className="font-bold shrink-0">
                {hv.ok ? "✓ রেন্ডার হচ্ছে" : `✗ খালি (${hv.mode})`}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * APK mode: there is NO server (static export) — /api/config is dead.
 * So the panel authenticates + saves DIRECTLY to the owner's Firebase:
 *   • PIN hash lives in Firestore app/meta.adminPin (sha256, same salt as
 *     the server route → the same PIN works in both worlds)
 *   • Save → setDoc app/meta.cfg (same shape fetchRemoteMeta reads) → every
 *     installed app picks it up within 5 min. No server needed, ever.
 */
const PIN_SALT = "ourhabit::admin";

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Read the stored admin PIN hash from Firestore app/meta (null = none yet). */
async function remotePinHash(): Promise<string | null> {
  const raw = await readRawMeta();
  return (raw?.adminPin as string) || null;
}

/** v4.2: turn a panelSaveCfg result into a REAL, actionable Bengali message —
 *  the owner was stuck on the generic “সমস্যা হয়েছে — আবার চেষ্টা করো” with no
 *  hint of the actual fix; now every failure says exactly what to do. */
function panelSaveErrText(r: PanelSaveResult, t: (k: string) => string): string {
  switch (r.reason) {
    case "no-account":
      return "সেভ করতে হলে অ্যাপে লগইন থাকতে হবে — তোমার অ্যাকাউন্ট দিয়ে ঢুকে আবার চেষ্টা করো।";
    case "not-configured":
      return "Firebase কানেক্ট হচ্ছে না — ইন্টারনেট দেখে আবার চেষ্টা করো।";
    case "claimed-other":
      return `অ্যাডমিন দখল করা আছে অন্য অ্যাকাউন্টের নামে${r.adminEmail ? ` (${r.adminEmail})` : ""}। ওই অ্যাকাউন্ট দিয়ে লগইন করে সেভ করো — অথবা নিজের অ্যাকাউন্টকে অ্যাডমিন বানাতে: Firebase Console → Firestore Database → app/meta → adminUid ফিল্ডটা মুছে দাও → এখানে আবার Save চাপো।`;
    case "denied":
      return "Firebase এ লিখতে অনুমতি পাচ্ছি না। Firebase Console → Firestore → Rules-এ গিয়ে আমার দেওয়া নতুন রুল (FIRESTORE-RULES-FOR-PASTE) পেস্ট করে Publish দাও — তারপর আবার Save চাপো।";
    default:
      return t("error");
  }
}

/** v4.2: the PIN-write equivalent (PinGate setup / changePin) — same rules
 *  root cause, same real fix. */
function nativeWriteErr(): string {
  return "সেভ হয়নি — Firebase এ লিখতে অনুমতি পাচ্ছি না। Firebase Console → Firestore → Rules-এ নতুন রুল পেস্ট করে Publish দাও; আর adminUid যদি অন্য অ্যাকাউন্টের নামে দখল করা থাকে, app/meta থেকে adminUid ফিল্ডটা মুছে দাও — তারপর আবার চেষ্টা করো।";
}

/** Write adminPin and/or cfg in one Firestore hit. v4.2: also writes the
 *  adminUid claim — without it every write to app/meta was permission-denied
 *  under the v4.0 rules (the “সমস্যা হয়েছে” root cause). */
async function remoteWriteMeta(
  cfg: ServerCfg | null,
  pinHash?: string,
  me?: { uid: string; email?: string } | null
): Promise<boolean> {
  const fields: Record<string, unknown> = {};
  if (cfg) fields.cfg = JSON.parse(JSON.stringify(cfg));
  if (pinHash) fields.adminPin = pinHash;
  if (me?.uid) {
    fields.adminUid = me.uid;
    if (me.email) fields.adminEmail = me.email;
  }
  if (!Object.keys(fields).length) return false;
  return writeRawMeta(fields);
}

type Mode = "loading" | "setup" | "unlock" | "open";

const LOCK_KEY = "oh-admin-lock";
const MAX_FAILS = 3;
const LOCK_MS = 60_000;

function readLock(): { count: number; until: number } {
  try {
    const raw = localStorage.getItem(LOCK_KEY);
    if (raw) return JSON.parse(raw) as { count: number; until: number };
  } catch {
    /* ignore */
  }
  return { count: 0, until: 0 };
}

function writeLock(l: { count: number; until: number }) {
  try {
    localStorage.setItem(LOCK_KEY, JSON.stringify(l));
  } catch {
    /* ignore */
  }
}

function PinGate({ onUnlock, onClose }: { onUnlock: (pin: string) => void; onClose: () => void }) {
  const { t } = useStore();
  const acc = useStore().state.account;
  const [mode, setMode] = useState<Mode>("loading");
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [lock, setLock] = useState<{ count: number; until: number }>(() => readLock());

  const lockedUntil = lock.until > Date.now() ? lock.until : 0;
  const waitSec = lockedUntil ? Math.ceil((lockedUntil - Date.now()) / 1000) : 0;

  useEffect(() => {
    (async () => {
      if (isNative()) {
        // APK: PIN hash lives in Firestore app/meta
        const hash = await remotePinHash();
        setMode(hash ? "unlock" : "setup");
        return;
      }
      try {
        const r = await fetch("/api/config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "status" }),
        });
        const j = await r.json();
        setMode(j.ok && j.hasPin ? "unlock" : "setup");
      } catch {
        setErr(t("error"));
        setMode("unlock");
      }
    })();
  }, [t]);

  const submit = async () => {
    if (Date.now() < lock.until) return;
    setErr("");
    setBusy(true);
    try {
      if (mode === "setup") {
        if (pin.length < 4 || pin !== pin2) {
          setErr(pin !== pin2 ? "PIN মিলছে না / PINs don't match" : t("adminPinSetSub"));
          setBusy(false);
          return;
        }
        if (isNative()) {
          const hash = await sha256Hex(`${pin}::${PIN_SALT}`);
          // v4.2: pass the signed-in account — the adminUid claim rides along
          // (without it the write is permission-denied under the v4.0 rules).
          const ok = await remoteWriteMeta(null, hash, acc ? { uid: acc.uid, email: acc.email } : null);
          if (ok) onUnlock(pin);
          else setErr(nativeWriteErr());
          setBusy(false);
          return;
        }
        const r = await fetch("/api/config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "setPin", pin }),
        });
        const j = await r.json();
        if (j.ok) onUnlock(pin);
        else setErr(t("error"));
      } else {
        if (isNative()) {
          const hash = await remotePinHash();
          const mine = await sha256Hex(`${pin}::${PIN_SALT}`);
          if (hash && mine === hash) {
            writeLock({ count: 0, until: 0 });
            onUnlock(pin);
          } else {
            const next = { count: lock.count + 1, until: lock.count + 1 >= MAX_FAILS ? Date.now() + LOCK_MS : 0 };
            writeLock(next);
            setLock(next);
            setErr(next.until ? t("pinLockout") : t("adminWrongPin"));
          }
          setBusy(false);
          return;
        }
        const r = await fetch("/api/config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "save", pin, cfg: {} }), // empty save = pin check only
        });
        const j = await r.json();
        if (j.ok) {
          writeLock({ count: 0, until: 0 });
          onUnlock(pin);
        } else {
          const next = { count: lock.count + 1, until: lock.count + 1 >= MAX_FAILS ? Date.now() + LOCK_MS : 0 };
          writeLock(next);
          setLock(next);
          setErr(next.until ? t("pinLockout") : t("adminWrongPin"));
          setBusy(false);
          return;
        }
      }
    } catch {
      setErr(t("error"));
    }
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 z-[90] bg-background flex flex-col items-center justify-center gap-4 p-6">
      <div className="w-20 h-20 rounded-3xl bg-primary/15 border border-primary/30 flex items-center justify-center text-4xl">🔐</div>
      <h2 className="text-xl font-extrabold">{t("adminPanel")}</h2>
      <p className="text-xs text-muted-foreground text-center">{mode === "setup" ? t("adminPinSetSub") : t("adminPinEnter")}</p>
      <input
        type="password"
        inputMode="numeric"
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
        placeholder={mode === "setup" ? t("adminPinSet") : t("adminPinEnter")}
        disabled={Date.now() < lock.until}
        className="w-full max-w-xs bg-muted rounded-xl px-4 py-3 text-center text-lg tracking-[0.4em] border border-border outline-none focus:ring-1 focus:ring-ring"
      />
      {mode === "setup" ? (
        <input
          type="password"
          inputMode="numeric"
          value={pin2}
          onChange={(e) => setPin2(e.target.value.replace(/\D/g, "").slice(0, 6))}
          placeholder="PIN আবার / repeat"
          className="w-full max-w-xs bg-muted rounded-xl px-4 py-3 text-center text-lg tracking-[0.4em] border border-border outline-none focus:ring-1 focus:ring-ring"
        />
      ) : null}
      {Date.now() < lock.until ? (
        <p className="text-xs text-destructive">
          {t("pinLockout")} ({Math.ceil((lock.until - Date.now()) / 1000)}s)
        </p>
      ) : err ? (
        <p className="text-xs text-destructive">{err}</p>
      ) : null}
      <div className="flex gap-2 w-full max-w-xs">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || pin.length < 4 || Date.now() < lock.until}
          className="flex-1 rounded-xl bg-primary text-primary-foreground text-sm font-semibold py-3 min-h-[48px] disabled:opacity-50"
        >
          {busy ? "..." : mode === "setup" ? t("adminPinSet") : t("adminUnlock")}
        </button>
        <button type="button" onClick={onClose} className="rounded-xl bg-secondary px-4 text-sm min-h-[48px]" aria-label="close">
          ✕
        </button>
      </div>
    </div>
  );
}

/** One Adsterra zone row (from the owner's dashboard screenshot). */
function AtZoneRow({
  label,
  hint,
  zone,
  isUrl,
  onChange,
}: {
  label: string;
  hint: string;
  zone: AtZone;
  isUrl?: boolean; // smartlink — paste a plain URL
  onChange: (z: AtZone) => void;
}) {
  const { t } = useStore();
  const valid = extractScriptUrl(zone.code);
  return (
    <div className="rounded-xl bg-secondary/60 p-2.5 mb-2">
      <ToggleRow label={label} checked={zone.on} onChange={(v) => onChange({ ...zone, on: v })} />
      <div className="text-[10px] text-muted-foreground mb-1.5">{hint}</div>
      {zone.on ? (
        <>
          <textarea
            value={zone.code}
            onChange={(e) => onChange({ ...zone, code: e.target.value })}
            placeholder={isUrl ? t("atUrlPaste") : t("atPaste")}
            rows={3}
            className="w-full bg-muted rounded-lg px-3 py-2 text-[11px] font-mono border border-border outline-none focus:ring-1 focus:ring-ring mb-1 resize-none"
          />
          {valid ? (
            <div className="text-[10px] text-primary">✓ {t("atOk")}</div>
          ) : zone.code.trim() ? (
            <div className="text-[10px] text-destructive">✗ {t("atBad")}</div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/**
 * v5.1 (owner round-21): the IN-APP STATUS TAB — the retired GitHub-Pages
 * status panel's successor, now living inside the admin panel itself
 * (“অ্যাপসেই সব সিস্টেম দিয়ে দাও, আলাদা করার দরকার নাই”).
 * Reads usersIndex + backups straight from the owner's Firebase with the
 * signed-in client (rules allow it) — NO server, NO admin-sdk-key, so it
 * works in the APK on any phone. Read-only view; every admin mutation stays
 * in the ⚙️ সেটিংস tab (ads + app updates), exactly as before.
 */
function StatusTab() {
  const { t } = useStore();
  const [snap, setSnap] = useState<FbStatusSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  const load = React.useCallback(async () => {
    setLoading(true);
    const s = await fbReadStatus();
    setSnap(s);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    const iv = setInterval(() => void load(), 30_000); // auto-refresh 30s
    return () => clearInterval(iv);
  }, [load]);

  const ago = (ms: number | null) => {
    if (!ms) return t("admNever");
    const s = Math.max(0, Date.now() - ms);
    if (s < 60e3) return t("admJustNow");
    if (s < 3600e3) return `${Math.floor(s / 60e3)} ${t("admMinAgo")}`;
    if (s < 86400e3) return `${Math.floor(s / 3600e3)} ${t("admHourAgo")}`;
    return `${Math.floor(s / 86400e3)} ${t("admDayAgo")}`;
  };

  const reelLabel = (id: string) => t(`reel_${id}`) || id;
  const reelIcon = (id: string) => REEL_APPS.find((a) => a.id === id)?.icon || "📱";
  // Bengali digits on Bengali devices — same as every other number in the app
  const num = (n: number | string) => {
    const s = String(n);
    return deviceLang() === "bn" ? s.replace(/[0-9]/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]) : s;
  };

  const stat = (v: number, label: string, cls: string) => (
    <div className="rounded-xl bg-secondary/60 border border-border p-2.5 text-center">
      <div className={`text-xl font-extrabold ${cls}`}>{num(v)}</div>
      <div className="text-[10px] text-muted-foreground leading-tight mt-0.5">{label}</div>
    </div>
  );

  const users = (snap?.users || []).slice().sort((a, b) => (b.online ? 1 : 0) - (a.online ? 1 : 0) || String(a.name).localeCompare(String(b.name)));

  return (
    <div>
      <Card className="mb-4">
        <SectionTitle title={`👥 ${t("admStatusTitle")}`} sub={t("admStatusSub")} />
        {loading && !snap ? (
          <p className="text-xs text-muted-foreground py-4 text-center">…</p>
        ) : !snap ? (
          <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 mb-2">
            <p className="text-xs text-destructive font-semibold">📴 {t("admStatusOffline")}</p>
            <button type="button" onClick={() => void load()} className="mt-2 rounded-xl bg-secondary px-4 py-2 text-xs font-bold">
              {t("admRefresh")}
            </button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              {stat(snap.stats.total, t("admStatTotal"), "text-primary")}
              {stat(snap.stats.google, t("admStatGoogle"), "text-amber-500")}
              {stat(snap.stats.email, t("admStatEmail"), "text-amber-500")}
              {stat(snap.stats.banned, t("admStatBanned"), "text-destructive")}
              {stat(snap.stats.activeToday, t("admStatActive"), "text-primary")}
              {stat(snap.stats.onlineNow, t("admStatOnline"), "text-green-500")}
            </div>
            <p className="text-[10px] text-muted-foreground mt-2 leading-relaxed">
              🟢 = {t("admOnline")} · 🔴 = {t("admOffline")} · {t("admAutoRefresh")}
              {snap.app.latestVersion ? ` · v${snap.app.latestVersion}` : ""}
            </p>
            <button type="button" onClick={() => void load()} className="mt-2 rounded-xl bg-secondary px-4 py-2 text-xs font-bold">
              {t("admRefresh")}
            </button>
          </>
        )}
      </Card>

      {users.length === 0 && !loading ? (
        <Card><p className="text-xs text-muted-foreground text-center py-3">{t("admNoUsers")}</p></Card>
      ) : null}

      {users.map((u: FbStatusUser) => (
        <Card key={u.uid} className="mb-3">
          <div className="flex items-start justify-between gap-2 mb-1.5">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary/25 to-primary/5 border border-primary/30 flex items-center justify-center text-sm font-extrabold text-primary shrink-0">
                {(u.name || "?").slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-bold truncate leading-tight">
                  {u.name || "—"}
                  {u.banned ? <span className="ml-1.5 text-[9px] font-extrabold text-destructive border border-destructive/50 rounded-full px-1.5 py-0.5 align-middle">ব্যান</span> : null}
                </div>
                <div className="text-[10px] text-muted-foreground truncate">{u.email || ""}</div>
              </div>
            </div>
            <div className="text-[9px] font-bold rounded-full border border-border px-2 py-0.5 shrink-0 text-muted-foreground">
              {u.provider === "google" ? "🔵 Google" : "✉️ ইমেইল"}
            </div>
          </div>

          <div className="flex items-center gap-1.5 text-[11px] mb-2">
            <span className="inline-block w-2 h-2 rounded-full" style={{ background: u.online ? "#4ade80" : "#f87171" }} />
            <b>{u.online ? t("admOnline") : t("admOffline")}</b>
            <span className="text-muted-foreground">· {t("admLastSeen")}: {ago(u.lastSeen)}</span>
          </div>

          <div className="text-[11px] leading-relaxed space-y-0.5">
            <div className="text-muted-foreground">
              👥 {t("admFriendsOf")} ({num(u.friendsCount)}): {u.friendNames.length ? u.friendNames.join(" · ") : "—"}
            </div>
            <div>
              {t("admUserVideo")}: {" "}
              {u.videoToday && Object.values(u.videoToday).some((v) => v > 0) ? (
                Object.entries(u.videoToday)
                  .filter(([, v]) => v > 0)
                  .map(([k, v]) => `${reelIcon(k)} ${reelLabel(k)} ${num(v)} ${t("min")}`)
                  .join(" · ")
              ) : (
                <span className="text-muted-foreground">{t("admVideoNone")}</span>
              )}
            </div>
            {u.habitsToday ? (
              <div>
                {t("admUserHabits")}: 🕌 {num(u.habitsToday.prayers)}/{num(5)} · 💧 {num(u.habitsToday.waterMl)} {t("admMlUnit")} · 📿 {num(u.habitsToday.dhikr)} · 🔥 {num(u.streak)} {t("days")} · ⭐ {num(u.points)}
              </div>
            ) : (
              <div className="text-muted-foreground">{t("admUserHabits")}: —</div>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}

function Panel({ onClose, pin }: { onClose: () => void; pin: string }) {
  const { t } = useStore();
  const { cfg, loaded, refresh } = useServerCfg();
  const [draft, setDraft] = useState<ServerCfg>(cfg);
  // v5.1 (owner round-21): the admin panel now has TWO tabs — 📊 স্ট্যাটাস
  // (the retired GitHub-Pages panel, now read-only inside the app) and ⚙️
  // সেটিংস (ads + Firebase + app updates + PIN — everything it always had).
  const [tab, setTab] = useState<"status" | "settings">("status");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [newPin, setNewPin] = useState("");
  const acc = useStore().state.account;

  useEffect(() => {
    setDraft(cfg);
  }, [cfg]);

  // v2.5 CRITICAL SAVE GUARD: if the owner opens the panel and hits Save
  // BEFORE the live config finished loading, the draft is still the EMPTY
  // default → saving would wipe every zone code (this is exactly how the
  // Social Bar / Popunder codes vanished from Firestore). Saving is now
  // impossible until the real config is loaded.
  const cfgReady = loaded;

  const setAt = (patch: Partial<AtCfg>) => setDraft((d) => ({ ...d, at: { ...d.at, ...patch } }));

  const fbValid = (() => {
    try {
      const o = JSON.parse(draft.firebase.config) as Record<string, unknown>;
      return Boolean(o.apiKey && o.projectId);
    } catch {
      return false;
    }
  })();

  const save = async () => {
    if (!cfgReady) return; // never save the empty default over the live config
    setErr("");
    setBusy(true);
    try {
      if (isNative()) {
        // v4.2 (owner round-17): THE UPDATE-SAVE FIX. The old mirrorMeta()
        // write was silently permission-denied under the v4.0 Firestore rules
        // (the in-app panel never claimed adminUid) — that is exactly why the
        // owner saw "সমস্যা হয়েছে — আবার চেষ্টা করো" and why NO user ever got
        // the update. panelSaveCfg writes the cfg AND the adminUid claim, and
        // returns a precise reason so the REAL fix can be shown.
        const r = await panelSaveCfg(draft, acc ? { uid: acc.uid, email: acc.email } : null);
        if (r.reason === "ok") {
          setErr("");
          setSaved(true);
          setTimeout(() => setSaved(false), 2500);
          await refresh();
        } else {
          setSaved(false);
          setErr(panelSaveErrText(r, t));
        }
        setBusy(false);
        return;
      }
      const r = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save", pin, cfg: draft }),
      });
      const j = await r.json();
      if (j.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2500);
        await refresh();
        // mirror config to the owner's Firebase (if connected) → APK users get it too
        void mirrorMeta(draft);
      } else setErr(t("adminWrongPin"));
    } catch {
      setErr(t("error"));
    }
    setBusy(false);
  };

  const changePin = async () => {
    if (newPin.length < 4) return;
    try {
      if (isNative()) {
        const hash = await sha256Hex(`${newPin}::${PIN_SALT}`);
        // v4.2: the adminUid claim rides along (same rules fix as save()).
        const ok = await remoteWriteMeta(null, hash, acc ? { uid: acc.uid, email: acc.email } : null);
        alert(ok ? t("adminSaved") : nativeWriteErr());
        setNewPin("");
        return;
      }
      const r = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "changePin", pin, newPin }),
      });
      const j = await r.json();
      alert(j.ok ? t("adminSaved") : t("adminWrongPin"));
      setNewPin("");
    } catch {
      alert(t("error"));
    }
  };

  // Android back button closes the panel (round-5: never exits the app)
  useEffect(() => {
    const onBack = () => {
      (window as unknown as { __ohBackHandled?: boolean }).__ohBackHandled = true;
      onClose();
    };
    window.addEventListener("oh:back", onBack);
    return () => window.removeEventListener("oh:back", onBack);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[90] bg-background overflow-y-auto">
      <div className="max-w-md mx-auto px-4 py-5 pb-24">
        <div className="flex items-center justify-between gap-2 mb-4">
          <div>
            <h1 className="text-xl font-extrabold">🛡 {t("adminPanel")}</h1>
            <p className="text-xs text-muted-foreground">{t("adminPanelSub")}{acc ? ` · ${acc.email}` : ""}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl bg-secondary px-4 py-2 text-sm min-h-[40px]">
            ✕
          </button>
        </div>

        {/* v5.1: the two admin tabs */}
        <div className="flex gap-2 mb-4">
          <button
            type="button"
            onClick={() => setTab("status")}
            className={`flex-1 rounded-xl py-2.5 text-sm font-bold border min-h-[44px] ${tab === "status" ? "bg-primary text-primary-foreground border-primary" : "bg-secondary text-foreground border-border"}`}
          >
            {t("admTabStatus")}
          </button>
          <button
            type="button"
            onClick={() => setTab("settings")}
            className={`flex-1 rounded-xl py-2.5 text-sm font-bold border min-h-[44px] ${tab === "settings" ? "bg-primary text-primary-foreground border-primary" : "bg-secondary text-foreground border-border"}`}
          >
            {t("admTabSettings")}
          </button>
        </div>

        {tab === "status" ? (
          <StatusTab />
        ) : (
          <>
        {/* ---- Ads ---- */}
        <Card className="mb-4">
          <SectionTitle title={`💰 ${t("adsSection")}`} sub={t("adsSub")} />

          {/* v2.7: BANNERS ARE AUTO — the owner asked to CLOSE the manual
              banner config ("ম্যানুয়াল অ্যাডস টোটালি ক্লোজ করো, তুমি নিজে
              করতেছো"). His 3 banner zones are now BAKED into the app itself
              (src/lib/ad-zones.ts) and render in exactly 3 places on Home.
              v2.7 adds: learned rotation (dead zones sink automatically) +
              ONE optional fresh-zone upgrade row + the Social Bar restore
              guide (the working Social Bar code was wiped by the old save
              bug — one paste brings the PROVEN format back). */}
          <div className="rounded-xl border border-primary/40 bg-primary/10 p-3 mb-3">
            <div className="text-sm font-bold text-primary mb-1">📐 ব্যানার অ্যাড — অটো চালু ✅</div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              হোম স্ক্রিনের <b>৩টি জায়গায়</b> ব্যানার অ্যাড অটো চলে — তোমার Adsterra ব্যানার জোনগুলো অ্যাপের ভেতরে বেক করা, আর অ্যাপ প্রতিটা ফোনে <b>শিখে</b> নেয় কোন জোনে বিজ্ঞাপন আসে — যে জোন ফাঁকা, সেটা নিজে থেকেই বাদ পড়ে। নিচের 🩺 Health-এ সবুজ দেখালেই বিজ্ঞাপন চলছে বুঝবে।
            </p>
          </div>

          {/* v2.7 URGENT: the Social Bar code was wiped by the old admin save
              bug — this was the owner's ONLY format proven to fill. One paste
              from GET CODE brings it back on every device. */}
          {!draft.at.socialBar.code.trim() ? (
            <div className="rounded-xl border border-amber-500/60 bg-amber-500/10 p-3 mb-3">
              <div className="text-sm font-bold text-amber-400 mb-1">⚠️ জরুরি — Social Bar কোড একবার বসাও (২ মিনিট)</div>
              <p className="text-[11px] text-amber-200/90 leading-relaxed">
                তোমার Adsterra ড্যাশবোর্ডে <b>Social Bar</b> জোনটার পাশে <b>GET CODE</b> চাপো → পুরো কোড কপি করো → নিচের <b>📊 Social Bar</b> ঘরে পেস্ট করো → <b>💾 Save</b>। এটাই সেই ফরম্যাট যেটা আগে তোমার ফোনে নিশ্চিতভাবে চলেছিল। একবার বসালেই সব ফোনে চলবে — আর কোনো কিছু করতে হবে না।
              </p>
            </div>
          ) : null}

          <ToggleRow label={t("admMaster")} checked={draft.adsEnabled} onChange={(v) => setDraft({ ...draft, adsEnabled: v })} />

          <div className="border-t border-border pt-3 mt-2">
            <div className="text-sm font-bold">🌐 {t("admAdsterra")}</div>
            <div className="text-[11px] text-muted-foreground mb-2">{t("admAtSub")}</div>

            <div className="border-t border-border pt-3 mt-3">
              <div className="text-sm font-bold">🧱 {t("admAt")}</div>
              <div className="text-[11px] text-muted-foreground mb-2">
                📐 Banner 320×50 / 468×60 / 728×90 — <b>অটো (অ্যাপে বেক করা)</b>। ড্যাশবোর্ডে নতুন banner জোন বানিয়ে থাকলে নিচের <b>⬆️ ব্যানার আপগ্রেড</b>-এ তার GET CODE একবার পেস্ট করো — সেটাই সবার আগে চলবে। বাকি ফরম্যাটগুলোর কোড GET CODE করে পেস্ট করো।
              </div>
              <AtZoneRow
                label={`⬆️ ব্যানার আপগ্রেড (একবারই লাগবে)`}
                hint="নতুন/Active banner জোনের GET CODE → পেস্ট করো। খালি রাখলে অ্যাপে বেক করা জোনগুলোই চলে।"
                zone={draft.at.bannerUpgrade || { on: false, code: "" }}
                onChange={(z) => setAt({ bannerUpgrade: z })}
              />
              <AtZoneRow label={`🧩 ${t("atNativeBanner")}`} hint={t("atNativeBannerHint")} zone={draft.at.nativeBanner} onChange={(z) => setAt({ nativeBanner: z })} />
              <AtZoneRow label={`📊 ${t("atSocialBar")}`} hint={t("atSocialBarHint")} zone={draft.at.socialBar} onChange={(z) => setAt({ socialBar: z })} />
              <AtZoneRow label={`⚠️ ${t("atPopunder")}`} hint={t("atPopunderHint")} zone={draft.at.popunder} onChange={(z) => setAt({ popunder: z })} />
              <AtZoneRow label={`🔗 ${t("atSmartlink")}`} hint={t("atSmartlinkHint")} zone={draft.at.smartlink} isUrl onChange={(z) => setAt({ smartlink: z })} />
            </div>

            {/* live banner health — did the network actually render? */}
            <BannerHealth />
          </div>
        </Card>

        {/* ---- Firebase (owner's own) ---- */}
        <Card className="mb-4">
          <SectionTitle title={`☁️ ${t("fbTitle")}`} sub={t("fbSub")} />
          <ToggleRow
            label={t("fbTitle")}
            checked={draft.firebase.on}
            onChange={(v) => setDraft({ ...draft, firebase: { ...draft.firebase, on: v } })}
          />
          {draft.firebase.on ? (
            <>
              <textarea
                value={draft.firebase.config}
                onChange={(e) => setDraft({ ...draft, firebase: { ...draft.firebase, config: e.target.value } })}
                placeholder={t("fbPaste")}
                rows={6}
                className="w-full bg-muted rounded-lg px-3 py-2 text-[11px] font-mono border border-border outline-none focus:ring-1 focus:ring-ring mb-1 resize-none"
              />
              {fbValid ? (
                <div className="text-[10px] text-primary">✓ {t("fbOk")}</div>
              ) : draft.firebase.config.trim() ? (
                <div className="text-[10px] text-destructive">✗ {t("fbBad")}</div>
              ) : null}
              <p className="text-[11px] text-muted-foreground mt-2 leading-relaxed">💡 {t("fbNote")}</p>
            </>
          ) : null}
        </Card>

        {/* ---- Auto-update ---- */}
        <Card className="mb-4">
          <SectionTitle title={`🔄 ${t("admUpdate")}`} sub={t("admUpdateSub")} />
          {/* v4.0: the owner kept seeing "same version 3.2.0 again and again"
              (round-15) — the version field below is the number USERS get
              pushed to, and it was pre-filled from Firestore. Show what's
              INSTALLED on this phone right next to it so the two can never be
              confused again. */}
          <p className="text-[11px] text-muted-foreground mb-2 leading-relaxed">
            📱 এই ফোনে এখন ইনস্টল হয়ে আছে: <b>v{APP_VERSION}{APP_BUILD > 0 ? ` · Build ${APP_BUILD}` : ""}</b> — নতুন APK বানালে নিচের ঘরে নতুন নাম্বারটা (যেমন 4.1.0) বসাও।
          </p>
          <input
            value={draft.latestVersion}
            onChange={(e) => setDraft({ ...draft, latestVersion: e.target.value.trim() })}
            placeholder={t("admVersion")}
            className="w-full bg-muted rounded-xl px-3 py-2.5 text-sm border border-border outline-none focus:ring-1 focus:ring-ring mb-2"
          />
          <input
            value={draft.apkUrl}
            onChange={(e) => setDraft({ ...draft, apkUrl: e.target.value.trim() })}
            placeholder={t("admApkUrl")}
            className="w-full bg-muted rounded-xl px-3 py-2.5 text-sm border border-border outline-none focus:ring-1 focus:ring-ring mb-2"
          />
          <input
            value={draft.changelog}
            onChange={(e) => setDraft({ ...draft, changelog: e.target.value })}
            placeholder={t("admChangelog")}
            className="w-full bg-muted rounded-xl px-3 py-2.5 text-sm border border-border outline-none focus:ring-1 focus:ring-ring mb-2"
          />
          <ToggleRow label={t("admForce")} checked={draft.forceUpdate} onChange={(v) => setDraft({ ...draft, forceUpdate: v })} />
          <p className="text-[11px] text-muted-foreground mt-2 leading-relaxed">{t("admWebNote")}</p>
          <div className="mt-2 rounded-xl bg-secondary/60 border border-border p-3">
            <p className="text-[11px] font-bold mb-1">📦 নতুন আপডেট পাঠানোর নিয়ম (৪ ধাপ):</p>
            <ol className="text-[10px] text-muted-foreground leading-relaxed list-decimal list-inside space-y-0.5">
              <li>কোড রিপোতে নতুন <b>our-habit-github-upload.zip</b> আপলোড করো (Add file → Upload files → Commit) — বিল্ড এখন অটো হবে না</li>
              <li><b>Actions</b> → “Build Android APK (manual — Run workflow)” → সবুজ <b>Run workflow</b> চাপো — ১০–১৫ মিনিটে নতুন APK রিলিজ হয়ে যাবে (nadiramoni/our-habit-apk)</li>
              <li>নিচে <b>ভার্সন</b>-এ নতুন নাম্বার লেখো (আগের চেয়ে <b>বড়</b> — যেমন 4.2.0), <b>APK URL</b>-এ <b>https://github.com/nadiramoni/our-habit-apk/releases/latest</b> বসাও (একবার দিলেই আর বদলাতে হবে না)</li>
              <li>💾 <b>Save</b> চাপো — ৫ মিনিটের মধ্যে সবার অ্যাপে “নতুন আপডেট” দেখাবে; <b>Force update</b> চালু রাখলে সবার অ্যাপ আটকে যাবে যতক্ষণ না আপডেট করে</li>
            </ol>
            <p className="text-[10px] text-muted-foreground mt-1.5 leading-relaxed">
              💡 ভার্সন নাম্বার অবশ্যই ইউজারদের ইনস্টল করা ভার্সনের চেয়ে <b>বড়</b> হতে হবে — সেই কারণেই কেউ আপডেট দেখতো না। আর APK URL-এর লিংকটা একবার দিলেই সবসময় সর্বশেষ রিলিজ খুলবে।
            </p>
          </div>
        </Card>

        {/* ---- PIN change ---- */}
        <Card className="mb-4">
          <SectionTitle title={`🔑 ${t("adminSetNewPin")}`} />
          <div className="flex gap-2">
            <input
              type="password"
              inputMode="numeric"
              value={newPin}
              onChange={(e) => setNewPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder={t("adminPinSetSub")}
              className="flex-1 bg-muted rounded-xl px-3 py-2.5 text-sm border border-border outline-none focus:ring-1 focus:ring-ring"
            />
            <button type="button" onClick={() => void changePin()} disabled={newPin.length < 4} className="rounded-xl bg-secondary px-4 text-sm min-h-[44px] disabled:opacity-50">
              🔑
            </button>
          </div>
        </Card>

        {err ? <p className="text-xs text-destructive mb-2">{err}</p> : null}
        {!cfgReady ? (
          <p className="text-[11px] text-amber-600 dark:text-amber-400 text-center mb-2 font-semibold">
            ⏳ কনফিগ লোড হচ্ছে… লোড শেষ হলে Save চালু হবে (খালি কনফিগ সেভ হওয়া আটকানো হলো)
          </p>
        ) : null}
          </>
        )}
        {tab === "settings" ? (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-background/95 backdrop-blur border-t border-border" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 16px)" }}>
          <div className="max-w-md mx-auto">
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy || !cfgReady}
              className="w-full rounded-xl bg-primary text-primary-foreground text-sm font-bold py-3 min-h-[48px] disabled:opacity-50"
            >
              {saved ? t("adminSaved") : busy ? "..." : `💾 ${t("adsSaved").replace(" ✓", "")}`}
            </button>
          </div>
        </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * v5.0 (owner round-19, sections 10–11): SERVER-LEVEL admin verification.
 * The PIN alone is NEVER enough — after the PIN gate, the signed-in account
 * is checked against the SERVER-side admin record (app/meta.adminUid, the
 * same claim the Firestore rules enforce on every cfg write):
 *   • match (or no claim yet — first-run setup) → the panel opens;
 *   • no match → an inline “sign in as admin” card (email+password) — so the
 *     owner can open the FULL panel from ANY phone (a friend's phone too);
 *     after finishing they sign out and the friend logs back in.
 * A random visitor with the PIN gets stuck here: the panel never opens and
 * Firestore rules deny every write anyway.
 */
function AdminVerify({ onPass, onClose }: { onPass: () => void; onClose: () => void }) {
  const { state, t } = useStore();
  const { cfg } = useServerCfg();
  const acc = state.account;
  // live account ref — after fbEmailSignIn the store swaps the account
  // asynchronously; signIn() must read the LATEST value, not its closure.
  const accRef = useRef(acc);
  accRef.current = acc;
  const [holder, setHolder] = useState<{ uid: string; email: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      // DEV-ONLY shortcut (v5.1): bun run dev + the local flag lets a
      // signed-in dev skip the adminUid match — needed to e2e-test the panel
      // body on the owner's REAL Firebase, where the adminUid claim is the
      // owner's own account. Inert everywhere else: production builds bake
      // NODE_ENV=production, so the guard never passes in the APK or web.
      try {
        if (process.env.NODE_ENV === "development" && typeof window !== "undefined" && localStorage.getItem("__oh_dev_admin_verify_skip") === "1") {
          onPass();
          return;
        }
      } catch {
        /* ignore */
      }
      try {
        const raw = await readRawMeta();
        const adminUid = (raw?.adminUid as string) || "";
        const adminEmail = (raw?.adminEmail as string) || "";
        if (!alive) return;
        if (!adminUid) {
          onPass(); // first run — no claim yet; the first save claims it
          return;
        }
        if (adminUid === acc?.uid) {
          onPass(); // the signed-in account IS the server-side admin
          return;
        }
        setHolder({ uid: adminUid, email: adminEmail });
        setLoading(false);
      } catch {
        if (alive) { setErr(t("error")); setLoading(false); }
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signIn = async () => {
    if (!email.trim() || !pass) return;
    setErr("");
    setBusy(true);
    const r = await fbEmailSignIn(email.trim(), pass, cfg);
    setBusy(false);
    if (!r.ok) {
      setErr(t("admVerifyErr"));
      return;
    }
    const raw = await readRawMeta();
    const adminUid = (raw?.adminUid as string) || "";
    if (!adminUid) {
      onPass(); // no claim yet — the first save claims admin for this account
      return;
    }
    // Signed in with the ADMIN's own email+password → Firebase Auth itself
    // verified possession of the admin credential — server-level check passed.
    if (holder && email.trim().toLowerCase() === (holder.email || "").toLowerCase()) {
      onPass();
      return;
    }
    // Different email: wait for the store to swap the account, then compare
    // the new signed-in uid against the server record.
    for (let i = 0; i < 10; i++) {
      await new Promise((res) => setTimeout(res, 500));
      if (accRef.current?.uid === adminUid) {
        onPass();
        return;
      }
    }
    setErr(t("admVerifyWrong"));
  };

  if (loading) {
    return (
      <div className="fixed inset-0 z-[90] bg-background flex flex-col items-center justify-center gap-3 p-6">
        <div className="w-16 h-16 rounded-3xl bg-primary/15 border border-primary/30 flex items-center justify-center text-3xl">🛡️</div>
        <p className="text-xs text-muted-foreground">{t("admVerifySub")}</p>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[90] bg-background flex flex-col items-center justify-center gap-4 p-6 overflow-y-auto">
      <div className="w-full max-w-sm">
        <div className="w-16 h-16 mx-auto rounded-3xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-3xl mb-3">🛡️</div>
        <h2 className="text-lg font-extrabold text-center">{t("admVerifyTitle")}</h2>
        <p className="text-xs text-muted-foreground text-center mt-1 mb-3">{t("admVerifySub")}</p>

        <div className="rounded-xl border border-border bg-secondary/50 p-3 mb-3 text-xs space-y-1.5">
          <div>🔑 {t("admVerifyHolder")}: <b>{holder?.email || "—"}</b></div>
          <div>👤 {t("admVerifyCurAcc")}: <b>{acc?.email || "—"}</b></div>
          <div className="text-muted-foreground">{t("admVerifyNeedSignIn")}</div>
        </div>

        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="admin@email.com"
          type="email"
          className="w-full bg-muted rounded-xl px-4 py-3 text-sm border border-border outline-none focus:ring-1 focus:ring-ring mb-2"
        />
        <input
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void signIn()}
          placeholder="পাসওয়ার্ড"
          type="password"
          className="w-full bg-muted rounded-xl px-4 py-3 text-sm border border-border outline-none focus:ring-1 focus:ring-ring mb-2"
        />
        {err ? <p className="text-xs text-destructive mb-2">⚠️ {err}</p> : null}
        <button
          type="button"
          onClick={() => void signIn()}
          disabled={busy || !email.trim() || !pass}
          className="w-full rounded-xl bg-primary text-primary-foreground text-sm font-bold py-3 min-h-[48px] disabled:opacity-50 mb-2"
        >
          {busy ? "…" : t("admVerifySignIn")}
        </button>
        <p className="text-[10px] text-muted-foreground leading-relaxed">{t("admVerifyNote")}</p>
        <button type="button" onClick={onClose} className="w-full rounded-xl bg-secondary py-2.5 text-sm font-bold mt-3">
          ✕ {t("cancel")}
        </button>
      </div>
    </div>
  );
}

export default function AdminPanel({ onClose }: { onClose: () => void }) {
  const [pin, setPin] = useState("");
  const [stage, setStage] = useState<"pin" | "verify" | "open">("pin");
  if (stage === "pin")
    return (
      <PinGate
        onUnlock={(p) => { setPin(p); setStage("verify"); }}
        onClose={onClose}
      />
    );
  if (stage === "verify") return <AdminVerify onPass={() => setStage("open")} onClose={onClose} />;
  return <Panel onClose={onClose} pin={pin} />;
}
