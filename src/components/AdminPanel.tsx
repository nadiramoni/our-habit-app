"use client";

import React, { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { useServerCfg } from "@/lib/cfg";
import { Card, SectionTitle, ToggleRow } from "@/components/ui-bits";
import { AtCfg, AtZone, ServerAdsCfg, ServerCfg } from "@/lib/types";
import { extractAdsterra, extractScriptUrl } from "@/components/AdsBanner";
import { mirrorMeta, readRawMeta, writeRawMeta } from "@/lib/cloud";
import { isNative } from "@/lib/native";

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
          setErr(pin !== pin2 ? "PIN মিলছে না / PINs don't match" : t("adminPinSetSub"));
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

function SlotRow({
  label,
  idLabel,
  slot,
  onChange,
}: {
  label: string;
  idLabel: string;
  slot: { on: boolean; id: string };
  onChange: (s: { on: boolean; id: string }) => void;
}) {
  return (
    <div className="rounded-xl bg-secondary/60 p-2.5 mb-2">
      <ToggleRow label={label} checked={slot.on} onChange={(v) => onChange({ ...slot, on: v })} />
      {slot.on ? (
        <input
          value={slot.id}
          onChange={(e) => onChange({ ...slot, id: e.target.value.trim() })}
          placeholder={idLabel}
          className="w-full bg-muted rounded-lg px-3 py-2 text-xs border border-border outline-none focus:ring-1 focus:ring-ring mb-1"
        />
      ) : null}
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

function Panel({ onClose, pin }: { onClose: () => void; pin: string }) {
  const { t } = useStore();
  const { cfg, refresh } = useServerCfg();
  const [draft, setDraft] = useState<ServerCfg>(cfg);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [newPin, setNewPin] = useState("");
  const acc = useStore().state.account;

  useEffect(() => {
    setDraft(cfg);
  }, [cfg]);

  const setAds = (patch: Partial<ServerAdsCfg>) => setDraft((d) => ({ ...d, ads: { ...d.ads, ...patch } }));
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
    setErr("");
    setBusy(true);
    try {
      if (isNative()) {
        // APK: save DIRECTLY to the owner's Firestore (same doc fetchRemoteMeta
        // reads) — no server needed; every install picks it up within 5 min.
        const ok = await mirrorMeta(draft);
        if (ok) {
          setSaved(true);
          setTimeout(() => setSaved(false), 2500);
          await refresh();
        } else setErr(t("error"));
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
        const ok = await remoteWriteMeta(null, hash);
        alert(ok ? t("adminSaved") : t("error"));
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

        {/* ---- Ads ---- */}
        <Card className="mb-4">
          <SectionTitle title={`💰 ${t("adsSection")}`} sub={t("adsSub")} />
          <ToggleRow label={t("admMaster")} checked={draft.adsEnabled} onChange={(v) => setDraft({ ...draft, adsEnabled: v })} />

          <div className="border-t border-border pt-3 mt-2">
            <div className="text-sm font-bold">🎯 {t("admAdmob")}</div>
            <div className="text-[11px] text-muted-foreground mb-2">{t("admAdmobSub")}</div>
            <SlotRow label={`📐 ${t("admBanner")}`} idLabel={t("admBannerId")} slot={draft.ads.banner} onChange={(s) => setAds({ banner: s })} />
            <SlotRow label={`🧩 ${t("admNative")}`} idLabel={t("admNativeId")} slot={draft.ads.native} onChange={(s) => setAds({ native: s })} />
            <SlotRow label={`🎁 ${t("admRewarded")}`} idLabel={t("admRewardedId")} slot={draft.ads.rewarded} onChange={(s) => setAds({ rewarded: s })} />
          </div>

          <div className="border-t border-border pt-3 mt-2">
            <div className="text-sm font-bold">🌐 {t("admAdsterra")}</div>
            <div className="text-[11px] text-muted-foreground mb-2">{t("admAdsterraSub")}</div>
            <div className="rounded-xl bg-secondary/60 p-2.5 mb-2">
              <ToggleRow
                label={`📐 Banner 468×60 (${t("atLiveTag")})`}
                checked={draft.ads.adsterra.on}
                onChange={(v) => setAds({ adsterra: { ...draft.ads.adsterra, on: v } })}
              />
              {draft.ads.adsterra.on ? (
                <textarea
                  value={draft.ads.adsterra.id}
                  onChange={(e) => setAds({ adsterra: { ...draft.ads.adsterra, id: e.target.value } })}
                  placeholder={t("admAdsterraPaste")}
                  rows={4}
                  className="w-full bg-muted rounded-lg px-3 py-2 text-[11px] font-mono border border-border outline-none focus:ring-1 focus:ring-ring mb-1 resize-none"
                />
              ) : null}
              {draft.ads.adsterra.on && extractAdsterra(draft.ads.adsterra.id) ? (
                <div className="text-[10px] text-primary">✓ {t("admAdsterraOk")}</div>
              ) : draft.ads.adsterra.on && draft.ads.adsterra.id.trim() ? (
                <div className="text-[10px] text-destructive">✗ {t("admAdsterraBad")}</div>
              ) : null}
            </div>

            <div className="border-t border-border pt-3 mt-3">
              <div className="text-sm font-bold">🧱 {t("admAt")}</div>
              <div className="text-[11px] text-muted-foreground mb-2">{t("admAtSub")}</div>
              <AtZoneRow label={`📐 ${t("atBanner300")}`} hint={t("atBanner300Hint")} zone={draft.at.banner300} onChange={(z) => setAt({ banner300: z })} />
              <AtZoneRow label={`📐 ${t("atBanner728")}`} hint={t("atBanner728Hint")} zone={draft.at.banner728} onChange={(z) => setAt({ banner728: z })} />
              <AtZoneRow label={`🧩 ${t("atNativeBanner")}`} hint={t("atNativeBannerHint")} zone={draft.at.nativeBanner} onChange={(z) => setAt({ nativeBanner: z })} />
              <AtZoneRow label={`📊 ${t("atSocialBar")}`} hint={t("atSocialBarHint")} zone={draft.at.socialBar} onChange={(z) => setAt({ socialBar: z })} />
              <AtZoneRow label={`⚠️ ${t("atPopunder")}`} hint={t("atPopunderHint")} zone={draft.at.popunder} onChange={(z) => setAt({ popunder: z })} />
              <AtZoneRow label={`🔗 ${t("atSmartlink")}`} hint={t("atSmartlinkHint")} zone={draft.at.smartlink} isUrl onChange={(z) => setAt({ smartlink: z })} />
            </div>
          </div>

          <div className="border-t border-border pt-3 mt-2">
            <div className="text-sm font-bold">ℹ️ {t("admAdsense")}</div>
            <div className="text-[11px] text-muted-foreground mb-2">{t("admAdsenseSub")}</div>
            <SlotRow label={`📐 ${t("admBanner")}`} idLabel={t("admAdsenseId")} slot={draft.ads.adsense} onChange={(s) => setAds({ adsense: s })} />
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
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-background/95 backdrop-blur border-t border-border" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 16px)" }}>
          <div className="max-w-md mx-auto">
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy}
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
