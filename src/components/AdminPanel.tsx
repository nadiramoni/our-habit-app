"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { useServerCfg } from "@/lib/cfg";
import { Card, SectionTitle, ToggleRow } from "@/components/ui-bits";
import { AtCfg, AtZone, ServerCfg } from "@/lib/types";
import { extractScriptUrl } from "@/components/AdsBanner";
import { mirrorMeta, readRawMeta, writeRawMeta, fbListUsers, FbProfile } from "@/lib/cloud";
import { isNative, nativeChatServiceRunning, nativeNotifPermission, nativeRequestNotifications, nativeRequestBatteryExemption, nativePermissionStatus, nativeRealTestNotification, nativeOpenNotificationSettings } from "@/lib/native";
import { fmtClock } from "@/lib/i18n";

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

/** Write adminPin and/or cfg in one Firestore hit. */
async function remoteWriteMeta(cfg: ServerCfg | null, pinHash?: string): Promise<boolean> {
  const fields: Record<string, unknown> = {};
  if (cfg) fields.cfg = JSON.parse(JSON.stringify(cfg));
  if (pinHash) fields.adminPin = pinHash;
  if (!Object.keys(fields).length) return false;
  return writeRawMeta(fields);
}

/**
 * v5.1 ADMIN SECURITY ISOLATION (owner: "অ্যাডমিন সিকিউরিটি")। If the live
 * Firestore rules are the v3.2 cloud-panel set, app/meta writes require
 * isAdmin() — adminUid (the FIRST account that ever wrote meta) must match
 * the caller. This helper CLAIMS adminUid when the field is still empty and
 * refuses with a clear Bengali error when a DIFFERENT account holds it — so
 * only the owner's own account can ever change PIN/ads/update settings.
 */
async function adminWriteMeta(myUid: string | undefined, fields: Record<string, unknown>): Promise<{ ok: boolean; notAdmin?: boolean }> {
  const raw = await readRawMeta();
  const curAdmin = String((raw as { adminUid?: unknown } | null)?.adminUid || "");
  if (curAdmin && myUid && curAdmin !== myUid) return { ok: false, notAdmin: true };
  const out: Record<string, unknown> = { ...fields };
  if (!curAdmin && myUid) out.adminUid = myUid; // first writer claims admin forever
  const ok = await writeRawMeta(out);
  return { ok };
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
          setErr(pin !== pin2 ? t("adminPinMismatch") : t("adminPinSetSub"));
          setBusy(false);
          return;
        }
        if (isNative()) {
          const hash = await sha256Hex(`${pin}::${PIN_SALT}`);
          const ok = await remoteWriteMeta(null, hash);
          if (ok) onUnlock(pin);
          else setErr(t("error"));
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
          placeholder={mode === "setup" ? t("adminPinRepeat") : t("adminPinEnter")}
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
 * v5.1: which account box does a user belong to? (owner's exact spec:
 * ইমেইল = Google accounts · মেইল = signed up manually with an email ·
 * আনকনাউন = no email recorded — an "empty" account). No email → Unknown,
 * no matter what the provider field says.
 */
function clsOf(u: FbProfile): "google" | "mail" | "unknown" {
  const email = String(u.email || "").trim();
  if (!email) return "unknown";
  return String(u.provider || "").toLowerCase().includes("google") ? "google" : "mail";
}

function Panel({ onClose, pin }: { onClose: () => void; pin: string }) {
  const { t, state } = useStore();
  const { cfg, loaded, refresh } = useServerCfg();
  const [draft, setDraft] = useState<ServerCfg>(cfg);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [newPin, setNewPin] = useState("");
  const acc = state.account;

  // ---------- v5.1: system status + account boxes + Refresh Now ----------
  const [users, setUsers] = useState<FbProfile[] | null>(null); // null = loading
  const [box, setBox] = useState<"google" | "mail" | "unknown" | "">("");
  const [svcOn, setSvcOn] = useState(false);
  const [hbAt, setHbAt] = useState(0);
  const [notifPerm, setNotifPerm] = useState<"" | "granted" | "denied" | "prompt" | "unsupported">("");
  const [battPerm, setBattPerm] = useState<"" | "granted" | "denied">("");
  const [testMsg, setTestMsg] = useState("");

  const runDiag = useCallback(async () => {
    setHbAt(Number(localStorage.getItem("oh_listener_hb") || 0));
    if (isNative()) {
      void nativeChatServiceRunning().then(setSvcOn);
      void nativeNotifPermission().then(setNotifPerm);
      void nativePermissionStatus().then((p) => setBattPerm(p?.battery || ""));
    } else {
      setSvcOn(false);
      setNotifPerm("unsupported");
      setBattPerm("");
    }
  }, []);

  /** v5.1 REFRESH NOW: one tap re-reads the live config + every account +
  * the whole notification diagnosis. */
  const loadAll = useCallback(async () => {
    void refresh();
    void fbListUsers().then(setUsers);
    void runDiag();
  }, [refresh, runDiag]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // keep the diagnosis live while the panel is open
  useEffect(() => {
    const iv = setInterval(() => void runDiag(), 5000);
    return () => clearInterval(iv);
  }, [runDiag]);

  // v5.1: the background listener writes a heartbeat every cycle — a beat
  // within the last 90s means the headless page is ALIVE (rules v3.3+).
  const hbAlive = hbAt > 0 && Date.now() - hbAt < 90_000;

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
        // APK: save DIRECTLY to the owner's Firestore (same doc fetchRemoteMeta
        // reads) — no server needed; every install picks it up within 5 min.
        // v5.1: through adminWriteMeta — claims adminUid on the first write and
        // enforces the owner's account afterwards (admin security isolation).
        const r = await adminWriteMeta(acc?.uid, { cfg: JSON.parse(JSON.stringify(draft)) });
        if (r.ok) {
          setSaved(true);
          setTimeout(() => setSaved(false), 2500);
          await refresh();
        } else setErr(r.notAdmin ? t("adminNotAdmin") : t("error"));
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
        // v5.1: adminUid-aware write (claims admin if the field is still empty)
        const r = await adminWriteMeta(acc?.uid, { adminPin: hash });
        alert(r.ok ? t("adminSaved") : r.notAdmin ? t("adminNotAdmin") : t("error"));
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

        {/* ---- v5.1: 🩺 System status — the notification truth ---- */}
        <Card className="mb-4">
          <SectionTitle title={`🩺 ${t("sysTitle")}`} sub={t("sysSub")} />
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between rounded-lg bg-secondary/60 px-2.5 py-2 text-[11px]">
              <span className="font-semibold">⚙️ {t("stService")}</span>
              <span className={`font-bold ${svcOn ? "text-green-600 dark:text-green-400" : "text-red-500"}`}>
                {svcOn ? t("svcOn") : t("svcOff")}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-secondary/60 px-2.5 py-2 text-[11px]">
              <span className="font-semibold">🎧 {t("stListener")}</span>
              <span className={`font-bold ${hbAlive ? "text-green-600 dark:text-green-400" : "text-red-500"}`}>
                {hbAlive ? t("stListenerAlive") : t("stListenerDead")}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-secondary/60 px-2.5 py-2 text-[11px]">
              <span className="font-semibold">🔔 {t("stNotifPerm")}</span>
              {notifPerm === "granted" ? (
                <span className="font-bold text-green-600 dark:text-green-400">✓</span>
              ) : (
                <button
                  type="button"
                  onClick={() => void nativeRequestNotifications().then(() => setTimeout(() => void runDiag(), 1200))}
                  className="rounded-lg bg-primary/15 border border-primary/30 text-primary font-bold px-2.5 py-1"
                >
                  {t("stGrant")}
                </button>
              )}
            </div>
            <div className="flex items-center justify-between rounded-lg bg-secondary/60 px-2.5 py-2 text-[11px]">
              <span className="font-semibold">🔋 {t("stBattery")}</span>
              {battPerm === "granted" ? (
                <span className="font-bold text-green-600 dark:text-green-400">✓</span>
              ) : (
                <button
                  type="button"
                  onClick={() => void nativeRequestBatteryExemption().then(() => setTimeout(() => void runDiag(), 1500))}
                  className="rounded-lg bg-primary/15 border border-primary/30 text-primary font-bold px-2.5 py-1"
                >
                  {t("stBatteryAsk")}
                </button>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={async () => {
              const r = await nativeRealTestNotification(`🔔 ${t("appName")}`, t("testNotif"));
              setTestMsg(r === "fired" ? t("testNotifOk") : r === "permDenied" ? t("testNotifDeny") : t("testNotifWeb"));
            }}
            className="w-full mt-2.5 rounded-xl bg-primary/15 border border-primary/30 text-primary text-xs font-bold py-2.5 min-h-[44px]"
          >
            {t("testNotif")}
          </button>
          {testMsg ? <div className="text-[10px] text-muted-foreground mt-1.5 text-center leading-relaxed">{testMsg}</div> : null}
        </Card>

        {/* ---- v5.1: 👥 Refresh Now + the 3 account boxes ---- */}
        <Card className="mb-4">
          <SectionTitle title={`👥 ${t("accountsTitle")}`} sub={t("accountsSub")} />
          <button
            type="button"
            onClick={() => void loadAll()}
            className="w-full rounded-xl bg-primary text-primary-foreground text-sm font-bold py-3 min-h-[48px] mb-1"
          >
            🔄 {t("refreshNow")}
          </button>
          <div className="text-[10px] text-muted-foreground text-center mb-3">{t("refreshNowSub")}</div>
          <div className="grid grid-cols-3 gap-2 mb-3">
            {(
              [
                { id: "google", icon: "📧", title: t("acctGoogle"), sub: t("acctGoogleSub"), n: users?.filter((u) => clsOf(u) === "google").length },
                { id: "mail", icon: "✉️", title: t("acctMail"), sub: t("acctMailSub"), n: users?.filter((u) => clsOf(u) === "mail").length },
                { id: "unknown", icon: "👤", title: t("acctUnknown"), sub: t("acctUnknownSub"), n: users?.filter((u) => clsOf(u) === "unknown").length },
              ] as const
            ).map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => setBox(box === b.id ? "" : (b.id as typeof box))}
                className={`rounded-xl border p-2.5 text-center transition-colors ${
                  box === b.id ? "border-primary bg-primary/15" : "border-border bg-secondary/60"
                }`}
              >
                <div className="text-lg leading-none mb-1">{b.icon}</div>
                <div className="text-xs font-bold">{b.title}</div>
                <div className="text-[9px] text-muted-foreground leading-tight mb-1">{b.sub}</div>
                <div className="text-sm font-extrabold text-primary">{b.n === undefined ? "…" : b.n}</div>
              </button>
            ))}
          </div>
          <div className="text-[10px] text-muted-foreground mb-2">
            {t("acctTotal")}: {users === null ? "…" : users.length}
          </div>
          {box ? (
            <div className="rounded-xl border border-border bg-secondary/40 p-2 flex flex-col gap-1.5">
              {(users || [])
                .filter((u) => clsOf(u) === box)
                .slice(0, 100)
                .map((u) => {
                  const online = Boolean(u.lastAt && Date.now() - u.lastAt < 120_000);
                  return (
                    <div key={u.uid} className="rounded-lg bg-card border border-border px-2.5 py-2 text-[11px]">
                      <div className="flex items-center gap-1.5">
                        <span className={online ? "text-green-600 dark:text-green-400" : "text-red-500"}>●</span>
                        <span className="font-bold truncate">{u.name || "—"}</span>
                        {u.banned ? <span className="ml-auto shrink-0 text-[9px] font-bold text-destructive border border-destructive/40 rounded px-1">{t("bannedTag")}</span> : null}
                      </div>
                      <div className="text-muted-foreground truncate">{u.email || t("acctUnknownSub")}</div>
                      <div className="text-muted-foreground">
                        {t("lastSeen")}: {u.lastAt ? fmtClock(u.lastAt) : "—"}
                        {u.provider ? ` · ${u.provider}` : ""}
                      </div>
                    </div>
                  );
                })}
              {users !== null && users.filter((u) => clsOf(u) === box).length === 0 ? (
                <div className="text-[11px] text-muted-foreground text-center py-2">{t("acctNoneHere")}</div>
              ) : null}
            </div>
          ) : null}
        </Card>

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
            <p className="text-[11px] font-bold mb-1">📦 নতুন আপডেট কীভাবে পাঠাবেন (৪ ধাপ):</p>
            <ol className="text-[10px] text-muted-foreground leading-relaxed list-decimal list-inside space-y-0.5">
              <li>GitHub-এ নতুন ZIP আপলোড → <b>Run workflow</b> → নতুন APK নামাও</li>
              <li>নিচে <b>ভার্সন</b>-এ নতুন নাম্বার লেখো (যেমন 1.4.0)</li>
              <li><b>APK URL</b>-এ নতুন APK-র ডাউনলোড লিংক বসাও</li>
              <li>💾 Save চাপো — <b>Force update</b> চালু রাখলে সবার অ্যাপ আটকে যাবে যতক্ষণ না আপডেট করে</li>
            </ol>
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
      </div>
    </div>
  );
}

export default function AdminPanel({ onClose }: { onClose: () => void }) {
  const [pin, setPin] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  if (!unlocked) return <PinGate onUnlock={(p) => { setPin(p); setUnlocked(true); }} onClose={onClose} />;
  return <Panel onClose={onClose} pin={pin} />;
}
