"use client";

/**
 * FriendsTab — Firebase pairing by invite code.
 * Your code ↔ their code → both of you see EVERYTHING (prayers, water, dhikr,
 * meditation, mood, sleep, per-app reels) live from the owner's Firebase.
 */

import React, { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { useServerCfg } from "@/lib/cfg";
import { Card, SectionTitle, Bar, Chip } from "@/components/ui-bits";
import { PRAYER_KEYS, REEL_APPS, emptyReels, getLog } from "@/lib/types";
import { DaySummary, FbProfile, addFriendByCode, listenDay, listenProfile, removeFriend } from "@/lib/cloud";

function DetailRow({ label, value, pct, tone }: { label: string; value: string; pct?: number; tone?: "good" | "bad" }) {
  return (
    <div className="py-1.5">
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-muted-foreground">{label}</span>
        <b className={`${tone === "bad" ? "text-destructive" : tone === "good" ? "text-primary" : "text-foreground"}`}>{value}</b>
      </div>
      {typeof pct === "number" ? <Bar pct={pct} className="h-1.5" /> : null}
    </div>
  );
}

function PartnerCard({ p, meUid, onRemoved }: { p: FbProfile; meUid: string; onRemoved: () => void }) {
  const { t } = useStore();
  const { cfg } = useServerCfg();
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState<DaySummary | null>(null);
  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    const un = listenDay(p.uid, today, (d) => setDay(d), cfg);
    return () => {
      if (un) un();
    };
  }, [p.uid, today]);

  const reels = { ...emptyReels(), ...((day?.reels as Record<string, number>) || {}) };
  const prayers = day?.prayers || {};
  const doneCount = PRAYER_KEYS.filter((k) => prayers[k]).length;
  const waterPct = day ? Math.min(1, (day.waterMl || 0) / Math.max(1, day.waterGoalMl || 1)) : 0;

  return (
    <Card className="mb-3">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-11 h-11 rounded-full bg-primary/15 border border-primary/25 flex items-center justify-center text-lg font-bold text-primary shrink-0">
          {(p.name || "?").slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold truncate">{p.name}</div>
          <div className="text-[11px] text-muted-foreground truncate">{p.email}</div>
        </div>
        <button
          type="button"
          onClick={() => {
            if (confirm(t("removeFriend") + "?")) void removeFriend({ ...p }, meUid, cfg).then(onRemoved);
          }}
          className="text-[11px] text-destructive bg-destructive/10 rounded-lg px-2 py-1.5 shrink-0"
        >
          {t("removeFriend")}
        </button>
      </div>

      {day ? (
        <div className="rounded-xl bg-secondary/50 p-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-semibold">
              ⚡ {day.points} <span className="text-muted-foreground font-normal">· 🔥 {day.streak} {t("streakDays")}</span>
            </span>
            <span className="text-xs font-bold text-primary">{Math.round((day.completion || 0) * 100)}%</span>
          </div>
          <Bar pct={day.completion || 0} className="h-2" />
        </div>
      ) : (
        <p className="text-xs text-muted-foreground text-center py-3">{t("offlineMode")}</p>
      )}

      {day ? (
        <>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="w-full mt-2 rounded-xl bg-secondary text-xs font-semibold py-2.5 min-h-[40px]"
          >
            {open ? `▲ ${t("hideDetails")}` : `👁 ${t("viewDetails")}`}
          </button>
          {open ? (
            <div className="mt-2 pt-2 border-t border-border">
              <DetailRow label={`🕌 ${t("detailPrayers")}`} value={`${doneCount}/5`} pct={doneCount / 5} tone={doneCount === 5 ? "good" : undefined} />
              <div className="grid grid-cols-5 gap-1 mb-2">
                {PRAYER_KEYS.map((k) => (
                  <div
                    key={k}
                    className={`rounded-lg text-center text-[9px] py-1.5 font-medium ${prayers[k] ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
                  >
                    {t(`prayer_${k}`)}
                  </div>
                ))}
              </div>
              <DetailRow label={`💧 ${t("detailWater")}`} value={`${day.waterMl || 0} / ${day.waterGoalMl || 0} ml`} pct={waterPct} tone={waterPct >= 1 ? "good" : undefined} />
              <DetailRow label={`📿 ${t("dhikrTodayTotal")}`} value={`${day.dhikrTotal || 0}`} />
              <DetailRow label={`🧘 ${t("detailMeditation")}`} value={`${day.meditationMin || 0} ${t("min")}`} />
              <DetailRow label={`🎯 ${t("detailFocus")}`} value={`${day.focusMin || 0} ${t("min")}`} />
              <DetailRow
                label={`🎬 ${t("detailReels")}`}
                value={`${day.reelsMin || 0} ${t("min")}`}
                tone={(day.reelsMin || 0) === 0 ? "good" : "bad"}
              />
              {day.reelsMin ? (
                <div className="flex flex-wrap gap-1 mb-1">
                  {REEL_APPS.map((a) =>
                    reels[a.id] ? (
                      <span key={a.id} className="text-[9px] rounded-full bg-destructive/10 text-destructive px-2 py-0.5 font-medium">
                        {a.icon} {a.id === "ytlong" ? "YT" : a.id.slice(0, 2).toUpperCase()}: {reels[a.id]}{t("min")}
                      </span>
                    ) : null
                  )}
                </div>
              ) : null}
              <DetailRow label={`😴 ${t("detailSleep")}`} value={day.sleepBed && day.sleepWake ? `${day.sleepBed} → ${day.sleepWake}` : "—"} />
            </div>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}

export default function FriendsTab() {
  const { state, t, openAuth } = useStore();
  const { cfg } = useServerCfg();
  const acc = state.account;
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);
  const [me, setMe] = useState<FbProfile | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!acc?.uid) {
      const id = setTimeout(() => setMe(null), 0);
      return () => clearTimeout(id);
    }
    const un = listenProfile(acc.uid, (p) => setMe(p), cfg);
    return () => {
      if (un) un();
    };
  }, [acc?.uid, cfg]);

  if (!acc || !acc.verified) {
    return (
      <div>
        <h1 className="text-xl font-bold mb-3">👥 {t("nav_friends")}</h1>
        <Card className="border-primary/30 bg-gradient-to-br from-primary/10 to-transparent">
          <div className="text-center py-3">
            <div className="text-4xl mb-2">🔐</div>
            <p className="text-sm font-semibold">{t("signInToShare")}</p>
            <p className="text-xs text-muted-foreground mt-1 mb-4">{t("whyLogin")}</p>
            <button
              type="button"
              onClick={openAuth}
              className="w-full rounded-2xl bg-primary text-primary-foreground text-sm font-bold py-3.5 min-h-[52px] shadow-md shadow-primary/25 active:scale-[0.98] transition-transform"
            >
              {t("loginCta")}
            </button>
            <p className="text-[10px] text-muted-foreground mt-2">{t("loginCtaSub")}</p>
          </div>
        </Card>
      </div>
    );
  }

  const doAdd = async () => {
    setErr("");
    setOk("");
    if (!code.trim()) return setErr(t("needCode"));
    if (!me) return setErr(t("errNetwork"));
    setBusy(true);
    const res = await addFriendByCode(me, code, cfg);
    setBusy(false);
    if (res.ok) {
      setOk(t("friendAddedFb"));
      setCode("");
    } else {
      setErr(t(res.error || "errGeneric"));
    }
  };

  return (
    <div>
      <h1 className="text-xl font-bold mb-1">👥 {t("nav_friends")}</h1>
      <p className="text-xs text-muted-foreground mb-3">{t("friendsSub")}</p>

      <Card className="mb-4 border-primary/30 bg-gradient-to-br from-primary/10 to-transparent">
        <SectionTitle title={t("myCode")} />
        <div className="flex items-center justify-center gap-3">
          <div className="text-2xl font-extrabold tracking-[0.35em] text-primary bg-background/60 border border-primary/25 rounded-xl px-4 py-2.5">
            {me?.inviteCode || "······"}
          </div>
          <button
            type="button"
            onClick={() => {
              try {
                void navigator.clipboard.writeText(me?.inviteCode || "");
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              } catch {
                /* clipboard blocked */
              }
            }}
            className="rounded-xl bg-primary text-primary-foreground text-xs font-semibold px-4 py-2.5 min-h-[44px]"
          >
            {copied ? t("copied") : `📋 ${t("copyCode")}`}
          </button>
        </div>
      </Card>

      <Card className="mb-4">
        <SectionTitle title={t("addFriendBtn")} />
        <div className="flex gap-2">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))}
            onKeyDown={(e) => e.key === "Enter" && void doAdd()}
            placeholder={t("friendCodeHere")}
            inputMode="text"
            autoCapitalize="characters"
            className="flex-1 bg-muted rounded-xl px-3 py-2.5 text-sm font-mono tracking-[0.25em] uppercase border border-border outline-none focus:ring-1 focus:ring-ring min-h-[44px]"
          />
          <button
            type="button"
            onClick={() => void doAdd()}
            disabled={busy}
            className="rounded-xl bg-primary text-primary-foreground text-sm font-semibold px-4 min-h-[44px] disabled:opacity-50"
          >
            {busy ? "..." : t("addFriendBtn")}
          </button>
        </div>
        {err ? <p className="text-xs text-destructive mt-2">⚠️ {err}</p> : null}
        {ok ? <p className="text-xs text-primary mt-2">✓ {ok}</p> : null}
      </Card>

      {me && (me.friends || []).length > 0 ? (
        <div>
          {(me.friends || []).map((f) => (
            <PartnerCard
              key={f.uid}
              p={{ ...me, uid: f.uid, name: f.name, email: f.email, inviteCode: "", friends: [] }}
              meUid={me.uid}
              onRemoved={() => setMe({ ...me, friends: (me.friends || []).filter((x) => x.uid !== f.uid) })}
            />
          ))}
        </div>
      ) : (
        <Card>
          <p className="text-sm text-muted-foreground text-center py-5">
            {t("noFriends")} 💚
            <br />
            <span className="text-[11px]">{t("friendsSub")}</span>
          </p>
        </Card>
      )}
    </div>
  );
}
