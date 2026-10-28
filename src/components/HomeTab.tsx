"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useStore } from "@/lib/store";
import { Card, Chip, SectionTitle, Ring, Bar } from "@/components/ui-bits";
import {
  DHIKRS,
  PRAYER_KEYS,
  PrayerKey,
  REEL_APPS,
  ReelApp,
  MEAL_KEYS,
  MealKey,
  addDays,
  emptyReels,
  getLog,
  qiblaBearing,
} from "@/lib/types";
import { dayPoints, fetchPrayerTimes, reminderOfTheDay, dhikrTotal, computeStreaks } from "@/lib/logic";
import AdsBanner, { AtNativeInline } from "@/components/AdsBanner";
import { isNative, nativeGetVideoUsage, nativeOpenUsageAccess, UsageResult } from "@/lib/native";
import { playAdd, playFanfare, playMinus, playTick } from "@/lib/audio";

// ---------- Header ----------
function Header({ onSecret }: { onSecret?: () => void }) {
  const { state, today, t, openAuth } = useStore();
  const log = getLog(state, today);
  const holdRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // SECRET owner trigger: hold the greeting for 2.5s — invisible to normal users
  const startHold = () => {
    if (!onSecret) return;
    cancelHold();
    holdRef.current = setTimeout(() => {
      holdRef.current = null;
      try {
        navigator.vibrate?.(80);
      } catch {
        /* no vibration */
      }
      onSecret();
    }, 2500);
  };
  const cancelHold = () => {
    if (holdRef.current) {
      clearTimeout(holdRef.current);
      holdRef.current = null;
    }
  };
  const h = new Date().getHours();
  const greet =
    h < 12 ? t("greet_morning") : h < 16 ? t("greet_afternoon") : h < 19 ? t("greet_evening") : t("greet_night");
  const name = state.account?.name || state.settings.name || "";
  const dateLabel = useMemo(() => {
    try {
      const d = new Date();
      const loc = state.settings.language === "bn" ? "bn-BD" : "en-GB";
      return new Intl.DateTimeFormat(loc, { weekday: "long", day: "numeric", month: "long" }).format(d);
    } catch {
      return today;
    }
  }, [today, state.settings.language]);
  return (
    <div className="flex items-start justify-between gap-3 mb-4">
      <div
        className="flex items-center gap-3 min-w-0"
        onPointerDown={startHold}
        onPointerUp={cancelHold}
        onPointerLeave={cancelHold}
        onPointerCancel={cancelHold}
        onContextMenu={(e) => e.preventDefault()}
        style={{ WebkitTouchCallout: "none", WebkitUserSelect: "none", userSelect: "none" }}
      >
        {state.account ? (
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-primary/25 to-primary/5 border border-primary/30 flex items-center justify-center text-lg font-extrabold text-primary shrink-0 shadow-sm">
            {(state.account.name || "?").slice(0, 1).toUpperCase()}
          </div>
        ) : (
          <button
            type="button"
            onClick={openAuth}
            className="w-11 h-11 rounded-2xl bg-gradient-to-br from-primary/25 to-primary/5 border border-primary/30 flex flex-col items-center justify-center shrink-0 shadow-sm active:scale-95 transition-transform"
            aria-label={t("loginCta")}
          >
            <span className="text-base leading-none">👤</span>
            <span className="text-[7px] font-bold text-primary leading-none mt-0.5">{t("loginChip")}</span>
          </button>
        )}
        <div className="min-w-0">
          <h1 className="text-xl font-bold leading-tight truncate">
            {greet}
            {name ? (
              <>
                , <span className="grad-text">{name}</span>
              </>
            ) : (
              ""
            )}{" "}
            👋
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">{dateLabel}</p>
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className="points-pill inline-flex items-center gap-1.5 rounded-full px-3 py-1.5">
          <span className="text-lg">⚡</span>
          <span className="text-sm font-bold text-primary">
            {dayPoints(log)} <span className="text-[10px] font-normal text-muted-foreground">/ 41</span>
          </span>
        </div>
        <div className="text-[10px] text-muted-foreground mt-1">{t("todayPoints")}</div>
      </div>
    </div>
  );
}

// ---------- Daily reminder ----------
function ReminderCard() {
  const { today, state, t } = useStore();
  const r = reminderOfTheDay(today);
  const bn = state.settings.language === "bn";
  return (
    <Card className="mb-4 quote-card bg-gradient-to-br from-primary/10 via-primary/5 to-transparent border-primary/20">
      <div className="flex gap-3 items-start relative">
        <span className="text-2xl">🕌</span>
        <div>
          <div className="text-[10px] font-bold text-primary uppercase tracking-wider">{t("dailyReminderCard")}</div>
          <p className="text-sm mt-1 leading-snug">{bn ? r.bn : r.en}</p>
          <p className="text-[11px] text-muted-foreground mt-1">— {r.src}</p>
        </div>
      </div>
    </Card>
  );
}

// ---------- Weekly strip ----------
function WeekStrip() {
  const { state, today, t } = useStore();
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = addDays(today, -i);
    const l = state.logs[d];
    const pts = l ? dayPoints(l) : 0;
    days.push({ d, pts, pct: pts / 41 });
  }
  const lbl = (d: string) => {
    const [y, m, dd] = d.split("-").map(Number);
    return new Intl.DateTimeFormat(state.settings.language === "bn" ? "bn-BD" : "en-GB", { weekday: "narrow" }).format(
      new Date(y, m - 1, dd)
    );
  };
  return (
    <Card className="mb-4">
      <SectionTitle title={t("last7days")} />
      <div className="grid grid-cols-7 gap-1.5">
        {days.map((x) => (
          <div key={x.d} className="flex flex-col items-center gap-1">
            <Ring pct={x.pct} size={40} stroke={4}>
              <span className="text-[9px] font-bold">{x.pts}</span>
            </Ring>
            <span className={`text-[10px] ${x.d === today ? "text-primary font-bold" : "text-muted-foreground"}`}>
              {lbl(x.d)}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ---------- Prayers + Qibla (detail page) ----------
export function PrayerCard() {
  const { state, updateLog, today, t, updateSettings } = useStore();
  const log = getLog(state, today);
  const [locState, setLocState] = useState<"idle" | "loading" | "ok" | "fail">("idle");
  const times = state.settings.prayerTimes;
  // live compass (device magnetometer). null = no sensor → static dial mode
  const [heading, setHeading] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    const onOri = (e: DeviceOrientationEvent) => {
      if (!alive) return;
      const wk = (e as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading;
      const h = typeof wk === "number" ? wk : e.alpha != null ? (360 - e.alpha) % 360 : null;
      if (h != null && !Number.isNaN(h)) setHeading(h);
    };
    window.addEventListener("deviceorientationabsolute", onOri as EventListener);
    window.addEventListener("deviceorientation", onOri as EventListener);
    return () => {
      alive = false;
      window.removeEventListener("deviceorientationabsolute", onOri as EventListener);
      window.removeEventListener("deviceorientation", onOri as EventListener);
    };
  }, []);

  const autoSet = async (askGeo: boolean) => {
    setLocState("loading");
    let lat = 23.8103, lng = 90.4125, label = "Dhaka";
    if (askGeo && navigator.geolocation) {
      try {
        const pos = await new Promise<GeolocationPosition>((res, rej) =>
          navigator.geolocation.getCurrentPosition(res, rej, { timeout: 8000 })
        );
        lat = pos.coords.latitude;
        lng = pos.coords.longitude;
        label = "My location";
      } catch {
        /* fallback Dhaka */
      }
    }
    const times2 = await fetchPrayerTimes(lat, lng);
    if (times2) {
      updateSettings({ prayerTimes: times2, prayerTimesDate: today, location: { lat, lng, label } });
      setLocState("ok");
    } else setLocState("fail");
  };

  useEffect(() => {
    if (!state.settings.prayerTimes || state.settings.prayerTimesDate !== today) {
      const id = setTimeout(() => void autoSet(false), 0);
      return () => clearTimeout(id);
    }
  }, [today]);

  const toggle = (k: PrayerKey) => {
    const wasOn = log.prayers[k];
    updateLog(today, (l) => ({ prayers: { ...l.prayers, [k]: !l.prayers[k] } }));
    try {
      navigator.vibrate?.(18);
    } catch {
      /* ignore */
    }
    if (!wasOn) {
      const done = PRAYER_KEYS.filter((x) => log.prayers[x]).length + 1;
      if (done >= 5) playFanfare();
      else playTick(done); // each tick climbs the musical scale
    } else {
      playMinus();
    }
  };

  const doneCount = PRAYER_KEYS.filter((k) => log.prayers[k]).length;
  const streak = computeStreaks(state, today).current;
  const loc = state.settings.location;
  const bearing = loc ? qiblaBearing(loc.lat, loc.lng) : null;
  // compass needle: qibla angle relative to where the phone top points
  const needle = bearing != null ? (heading != null ? bearing - heading : bearing) : 0;
  const diff = ((needle + 180) % 360 + 360) % 360 - 180;
  const aligned = bearing != null && heading != null && Math.abs(diff) <= 6;

  return (
    <Card className="mb-4">
      <SectionTitle
        title={t("prayers")}
        sub={`${t("prayersSub")}${streak > 0 ? ` · 🔥 ${streak} ${t("streakDays")}` : ""}`}
        right={
          <span className="text-xs text-muted-foreground shrink-0">
            {doneCount}/5
          </span>
        }
      />
      {doneCount === 5 ? (
        <div className="mb-3 rounded-xl bg-primary/10 text-primary text-sm font-medium px-3 py-2">
          {t("allPrayersDone")}
        </div>
      ) : null}
      <div className="grid grid-cols-5 gap-2">
        {PRAYER_KEYS.map((k, i) => {
          const on = log.prayers[k];
          const time = times?.[k] || "";
          return (
            <button
              key={k}
              type="button"
              onClick={() => toggle(k)}
              className={`rounded-xl border p-2 flex flex-col items-center gap-1 min-h-[72px] transition-all ${
                on
                  ? "bg-primary text-primary-foreground border-primary shadow"
                  : "bg-secondary border-transparent text-secondary-foreground"
              }`}
            >
              <span className="text-lg leading-none">{on ? "✅" : ["🌅", "☀️", "🌤", "🌇", "🌙"][i]}</span>
              <span className="text-[11px] font-semibold leading-none">{t(`prayer_${k}`)}</span>
              {time ? <span className="text-[9px] opacity-70 leading-none">{time}</span> : null}
            </button>
          );
        })}
      </div>

      <div className="mt-4 pt-3 border-t border-border">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="text-sm font-semibold">🧭 {t("qibla")}</div>
          <button
            type="button"
            onClick={() => void autoSet(true)}
            className="text-xs rounded-lg bg-secondary px-3 py-2 min-h-[36px]"
          >
            {locState === "loading" ? "..." : t("qiblaUseLoc")}
          </button>
        </div>
        {bearing !== null ? (
          <div className="flex items-center gap-4">
            {/* live compass dial */}
            <div
              className={`relative w-36 h-36 shrink-0 rounded-full border-2 flex items-center justify-center transition-colors ${
                aligned ? "border-primary" : "border-border"
              }`}
              style={aligned ? { boxShadow: "0 0 26px -6px color-mix(in srgb, var(--primary) 60%, transparent)" } : undefined}
              role="img"
              aria-label="Qibla compass"
            >
              {/* rotating rose — when the sensor is live, N always points to real north */}
              <div
                className="absolute inset-0 transition-transform duration-100"
                style={{ transform: `rotate(${heading != null ? -heading : 0}deg)` }}
              >
                <span className="absolute top-1 left-1/2 -translate-x-1/2 text-[10px] font-extrabold text-destructive">N</span>
                <span className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[10px] font-bold text-muted-foreground">S</span>
                <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-muted-foreground">E</span>
                <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-muted-foreground">W</span>
                <span className="absolute top-6 left-1/2 -translate-x-1/2 w-px h-2 bg-border" />
                <span className="absolute bottom-6 left-1/2 -translate-x-1/2 w-px h-2 bg-border" />
                <span className="absolute left-6 top-1/2 -translate-y-1/2 h-px w-2 bg-border" />
                <span className="absolute right-6 top-1/2 -translate-y-1/2 h-px w-2 bg-border" />
              </div>
              {/* qibla needle — kaaba on the ring, line to the center */}
              <div
                className="absolute inset-0 transition-transform duration-100"
                style={{ transform: `rotate(${needle}deg)` }}
              >
                <div className="absolute left-1/2 top-2 -translate-x-1/2 flex flex-col items-center">
                  <span className="text-2xl leading-none">🕋</span>
                  <span className="w-0.5 h-12 rounded-full mt-0.5" style={{ background: "color-mix(in srgb, var(--primary) 70%, transparent)" }} />
                </div>
              </div>
              <span className="w-2.5 h-2.5 rounded-full relative z-10 shadow" style={{ background: "var(--primary)" }} />
            </div>
            <div className="min-w-0 text-xs text-muted-foreground leading-relaxed">
              <div>
                {t("qiblaDeg")}: <b className="text-foreground">{Math.round(bearing)}°</b>
                {heading != null ? <span className="opacity-70"> · N {Math.round(heading)}°</span> : null}
              </div>
              <div className="mt-1">
                {aligned ? (
                  <b className="text-primary">{t("qiblaAligned")}</b>
                ) : heading != null ? (
                  t("qiblaCompassNote")
                ) : (
                  t("qiblaNoCompass")
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">{t("qiblaNote")}</div>
        )}
      </div>
    </Card>
  );
}

// ---------- Water (detail page) ----------
function WaterCard() {
  const { state, updateLog, today, t } = useStore();
  const log = getLog(state, today);
  const goal = state.settings.waterGoalMl;
  const pct = Math.min(1, log.waterMl / goal);
  const glassButtons = useMemo(() => {
    const n = Math.round(goal / 250);
    return Math.min(n, 12);
  }, [goal]);

  const add = (ml: number) => {
    updateLog(today, (l) => ({ waterMl: Math.max(0, l.waterMl + ml) }));
    if (ml > 0) playAdd();
    else playMinus();
  };

  const togglePrayerGlass = (i: number) => {
    const wasOn = log.prayerWater[i];
    updateLog(today, (l) => {
      const pw = [...l.prayerWater];
      pw[i] = !pw[i];
      const waterMl = Math.max(0, l.waterMl + (pw[i] ? 250 : -250));
      return { prayerWater: pw, waterMl };
    });
    if (wasOn) playMinus();
    else playAdd();
  };

  return (
    <Card className="mb-4">
      <SectionTitle title={`💧 ${t("water")}`} sub={t("waterSub")} />
      {pct >= 1 ? (
        <div className="mb-3 rounded-xl bg-primary/10 text-primary text-sm font-medium px-3 py-2">
          {t("waterGoalReached")}
        </div>
      ) : null}
      <div className="flex items-center justify-between text-sm mb-2">
        <span className="font-bold">
          {log.waterMl} <span className="text-xs text-muted-foreground font-normal">/ {goal} {t("waterOf")}</span>
        </span>
        <span className="text-xs text-muted-foreground">{Math.round(pct * 100)}%</span>
      </div>
      <Bar pct={pct} className="mb-3" />
      <div className="flex flex-wrap gap-2 mb-2">
        {Array.from({ length: glassButtons }).map((_, i) => (
          <button
            key={i}
            type="button"
            aria-label="glass"
            onClick={() => add(250)}
            className={`w-9 h-11 rounded-b-xl rounded-t-md border-2 flex items-end justify-center pb-1 text-[10px] ${
              log.waterMl >= (i + 1) * 250
                ? "border-primary bg-primary/20 text-primary"
                : "border-border text-muted-foreground"
            }`}
          >
            {log.waterMl >= (i + 1) * 250 ? "💧" : ""}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={() => add(250)} className="flex-1 rounded-xl bg-primary text-primary-foreground text-sm font-semibold py-2.5 min-h-[44px]">
          + {t("addGlass")}
        </button>
        <button type="button" onClick={() => add(-250)} className="rounded-xl bg-secondary px-4 text-sm min-h-[44px]">
          {t("removeGlass")}
        </button>
      </div>

      <div className="mt-4 pt-3 border-t border-border">
        <div className="text-sm font-semibold">{t("prayerWater")}</div>
        <div className="text-xs text-muted-foreground mb-2">{t("prayerWaterSub")}</div>
        <div className="grid grid-cols-5 gap-2">
          {PRAYER_KEYS.map((k, i) => {
            const on = log.prayerWater[i];
            return (
              <button
                key={k}
                type="button"
                onClick={() => togglePrayerGlass(i)}
                className={`rounded-xl border p-2 flex flex-col items-center gap-1 min-h-[64px] transition-all ${
                  on ? "bg-primary text-primary-foreground border-primary" : "bg-secondary border-transparent"
                }`}
              >
                <span className="text-base leading-none">{on ? "🥤" : "🥛"}</span>
                <span className="text-[10px] font-medium leading-none">{t(`prayer_${k}`)}</span>
                <span className="text-[9px] opacity-70 leading-none">250ml</span>
              </button>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

// ---------- Reels (detail page) ----------
function ReelsCard() {
  const { state, updateLog, updateSettings, today, t } = useStore();
  const log = getLog(state, today);
  const reels = { ...emptyReels(), ...(log.reels || {}) };
  const total = Object.values(reels).reduce((a, b) => a + b, 0);
  const shorts = REEL_APPS.filter((a) => a.short).reduce((a, x) => a + reels[x.id], 0);
  const long = reels.ytlong;
  const estCount = Math.round(shorts / 0.5); // avg reel ≈ 30s
  const [customApp, setCustomApp] = useState<ReelApp | null>(null);
  const [customVal, setCustomVal] = useState("");
  const [nativeOn, setNativeOn] = useState(false);
  const [autoBusy, setAutoBusy] = useState(false);
  const [autoMsg, setAutoMsg] = useState("");

  useEffect(() => {
    const id = setTimeout(() => setNativeOn(isNative()), 0);
    return () => clearTimeout(id);
  }, []);

  const autoTrack = async () => {
    setAutoBusy(true);
    setAutoMsg("");
    let res: UsageResult | null = await nativeGetVideoUsage();
    if (!res || !res.granted) {
      await nativeOpenUsageAccess();
      setAutoBusy(false);
      setAutoMsg("permission");
      return;
    }
    updateLog(today, (l) => {
      const next = {
        ...emptyReels(),
        ...(l.reels || {}),
        facebook: res.facebook,
        tiktok: res.tiktok,
        instagram: res.instagram,
        ytlong: res.ytlong,
        other: res.other,
      };
      const sum = Object.values(next).reduce((a, b) => a + b, 0);
      return { reels: next, reelsMin: sum };
    });
    setAutoBusy(false);
  };

  const weekWasted = useMemo(() => {
    let sum = 0;
    for (let i = 0; i < 7; i++) {
      const l = state.logs[addDays(today, -i)];
      if (l?.reelsMin) sum += l.reelsMin;
    }
    return sum;
  }, [state.logs, today]);

  const setApp = (id: ReelApp, min: number) => {
    updateLog(today, (l) => {
      const next = { ...emptyReels(), ...(l.reels || {}), [id]: Math.max(0, Math.min(1440, min)) };
      const sum = Object.values(next).reduce((a, b) => a + b, 0);
      return { reels: next, reelsMin: sum };
    });
  };

  const setFree = () => {
    setCustomApp(null);
    updateLog(today, { reels: emptyReels(), reelsMin: 0 });
  };

  const applyCustom = () => {
    if (customApp && customVal) {
      setApp(customApp, parseInt(customVal, 10) || 0);
    }
    setCustomApp(null);
    setCustomVal("");
  };

  return (
    <Card className="mb-4">
      <SectionTitle
        title={`🎬 ${t("reels")}`}
        sub={t("reelsPerAppSub")}
        right={<span className="text-xs text-muted-foreground shrink-0">{t("reelsTotalToday")}: <b className={total > 0 ? "text-destructive" : "text-primary"}>{total} {t("min")}</b></span>}
      />
      <div className="flex flex-wrap gap-2 mb-3">
        <Chip active={log.reelsMin === 0} onClick={setFree}>
          ✂️ {t("reelsFreeToday").split("!")[0]}
        </Chip>
        {nativeOn ? (
          <button
            type="button"
            onClick={() => void autoTrack()}
            disabled={autoBusy}
            className="rounded-full bg-primary text-primary-foreground text-xs font-semibold px-3 py-1.5 min-h-[32px] disabled:opacity-50"
          >
            🤖 {autoBusy ? "..." : t("autoTrackBtn")}
          </button>
        ) : null}
      </div>

      {/* daily limit — crossing it fires a REAL tracking notification (v2.1) */}
      <div className="rounded-xl border border-border bg-secondary/40 p-2.5 mb-3">
        <div className="text-xs font-semibold">⏰ {t("reelsLimitLabel")}</div>
        <div className="text-[10px] text-muted-foreground mb-2">{t("reelsLimitSub")}</div>
        <div className="flex flex-wrap gap-1.5">
          {[0, 30, 60, 90, 120].map((v) => (
            <Chip
              key={v}
              active={(state.settings.reelsLimitMin ?? 0) === v}
              onClick={() => updateSettings({ reelsLimitMin: v })}
            >
              {v === 0 ? t("reelsLimitOff") : `${v} ${t("min")}`}
            </Chip>
          ))}
        </div>
        {(state.settings.reelsLimitMin ?? 0) > 0 && total >= (state.settings.reelsLimitMin ?? 0) ? (
          <div className="text-[11px] text-destructive font-semibold mt-2">🔔 {t("reelsLimitNotifTitle")}</div>
        ) : null}
      </div>
      {nativeOn && autoMsg === "permission" ? (
        <p className="text-[11px] text-amber-600 dark:text-amber-400 mb-2">⚙️ {t("usageAccessNote")}</p>
      ) : null}

      <div className="text-xs font-semibold mb-1.5">{t("reelsPerApp")}</div>
      <div className="flex flex-col gap-1.5">
        {REEL_APPS.map((a) => {
          const v = reels[a.id];
          return (
            <div key={a.id} className={`flex items-center gap-2 rounded-xl border p-2 ${v > 0 ? "border-destructive/40 bg-destructive/5" : "border-border bg-secondary/40"}`}>
              <span className="text-base w-6 text-center shrink-0">{a.icon}</span>
              <span className="text-xs font-medium flex-1 min-w-0 truncate">{t(`reel_${a.id}`)}</span>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  aria-label={`-${t("min")}`}
                  onClick={() => setApp(a.id, v - 5)}
                  className="w-8 h-8 rounded-lg bg-muted text-sm font-bold"
                >
                  −
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCustomApp(customApp === a.id ? null : a.id);
                    setCustomVal("");
                  }}
                  className={`w-14 h-8 rounded-lg text-xs font-bold ${v > 0 ? "bg-destructive/15 text-destructive" : "bg-muted text-muted-foreground"}`}
                >
                  {v} {t("min")}
                </button>
                <button
                  type="button"
                  aria-label={`+${t("min")}`}
                  onClick={() => setApp(a.id, v + 5)}
                  className="w-8 h-8 rounded-lg bg-primary/15 text-primary text-sm font-bold"
                >
                  +
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {customApp ? (
        <div className="flex gap-2 mt-2">
          <input
            inputMode="numeric"
            autoFocus
            placeholder={`${t("custom")} — ${t(`reel_${customApp}`)}`}
            value={customVal}
            onChange={(e) => setCustomVal(e.target.value.replace(/\D/g, ""))}
            className="flex-1 bg-muted rounded-xl px-3 py-2 text-sm border border-border outline-none focus:ring-1 focus:ring-ring min-h-[44px]"
          />
          <button type="button" onClick={applyCustom} className="rounded-xl bg-primary text-primary-foreground px-4 text-sm min-h-[44px]">
            OK
          </button>
        </div>
      ) : null}

      {log.reelsMin !== null && log.reelsMin > 0 ? (
        <div className="rounded-xl bg-destructive/10 text-destructive text-sm font-medium px-3 py-2 mt-3">
          ⏳ {log.reelsMin} {t("reelsWasted")}
        </div>
      ) : null}
      {log.reelsMin === 0 ? (
        <div className="rounded-xl bg-primary/10 text-primary text-sm font-medium px-3 py-2 mt-3">{t("reelsFreeToday")}</div>
      ) : null}

      {total > 0 ? (
        <div className="mt-3 pt-3 border-t border-border">
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="font-semibold">📊 {t("shortsVsLong")}</span>
            <span className="text-muted-foreground">{t("estReelsCount")}: <b className="text-foreground">~{estCount}</b></span>
          </div>
          <div className="h-3 rounded-full overflow-hidden flex bg-muted">
            <div className="h-full bg-destructive/80" style={{ width: `${total ? (shorts / total) * 100 : 0}%` }} />
            <div className="h-full bg-amber-500/70" style={{ width: `${total ? (long / total) * 100 : 0}%` }} />
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
            <span>⚡ {t("reel_ytshorts")}/{t("reel_tiktok")}/{t("reel_instagram")}: <b className="text-destructive">{shorts} {t("min")}</b></span>
            <span>📺 {t("reel_ytlong")}: <b className="text-amber-600 dark:text-amber-400">{long} {t("min")}</b></span>
          </div>
        </div>
      ) : null}

      <p className="text-xs text-muted-foreground mt-3">
        {t("reelsWeek")}: <b className="text-destructive">{weekWasted} {t("min")}</b> · {t("reelsWarning")}
      </p>
      <p className="text-[10px] text-muted-foreground mt-2 opacity-80">{t("autoTrackNote")}</p>
    </Card>
  );
}

// ---------- Dhikr (detail page) — RESET FIXED ----------
function DhikrCard() {
  const { state, updateLog, today, t } = useStore();
  const log = getLog(state, today);
  const [sel, setSel] = useState(DHIKRS[0].id);
  const [target, setTarget] = useState(100);
  const [pulse, setPulse] = useState(false);
  const [doneMsg, setDoneMsg] = useState(false);
  const dhikr = DHIKRS.find((d) => d.id === sel) || DHIKRS[0];
  const bn = state.settings.language === "bn";
  const total = dhikrTotal(log);

  const tap = () => {
    const nextVal = (log.dhikr[sel] || 0) + 1;
    updateLog(today, (l) => ({ dhikr: { ...l.dhikr, [sel]: (l.dhikr[sel] || 0) + 1 } }));
    setPulse(true);
    setTimeout(() => setPulse(false), 380);
    playTick(nextVal); // tasbih bead sound — climbs with the count
    if (navigator.vibrate) navigator.vibrate(15);
    if (nextVal === target) {
      playFanfare();
      setDoneMsg(true);
      setTimeout(() => setDoneMsg(false), 2600);
    }
  };

  // ✅ FIXED: reset actually clears TODAY'S count for the selected dhikr
  const resetToday = () => {
    if (!confirm(t("resetAsk"))) return;
    updateLog(today, (l) => ({ dhikr: { ...l.dhikr, [sel]: 0 } }));
    try {
      navigator.vibrate?.(30);
    } catch {
      /* ignore */
    }
    alert(t("resetDone"));
  };

  return (
    <Card className="mb-4">
      <SectionTitle title={`📿 ${t("dhikr")}`} sub={t("dhikrSub")} />
      <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2 mb-2">
        {DHIKRS.map((d) => (
          <Chip key={d.id} active={sel === d.id} onClick={() => setSel(d.id)}>
            {bn ? d.bn : d.en}
          </Chip>
        ))}
      </div>
      <div className="text-center mb-3">
        <div className="text-2xl font-bold text-primary leading-none mb-1">{dhikr.ar}</div>
        <div className="text-xs text-muted-foreground">{bn ? dhikr.bn : dhikr.en}</div>
      </div>
      <div className="flex flex-col items-center gap-3">
        <button
          type="button"
          onClick={tap}
          className="relative w-40 h-40 rounded-full bg-primary text-primary-foreground flex flex-col items-center justify-center shadow-lg active:scale-95 transition-transform"
        >
          {pulse ? <span className="absolute inset-0 rounded-full bg-primary tap-pulse" /> : null}
          <span className="text-4xl font-extrabold leading-none">{log.dhikr[sel] || 0}</span>
          <span className="text-xs mt-1 opacity-80">/ {target} {t("times")}</span>
        </button>
        {doneMsg ? (
          <div className="rounded-xl bg-primary/10 text-primary text-sm font-medium px-4 py-2">✨ {t("dhikrDone")}</div>
        ) : null}
        <div className="flex items-center gap-2">
          <Chip active={target === 33} onClick={() => setTarget(33)}>33</Chip>
          <Chip active={target === 100} onClick={() => setTarget(100)}>100</Chip>
          <Chip active={target === 500} onClick={() => setTarget(500)}>500</Chip>
          <button type="button" onClick={resetToday} className="text-xs text-destructive px-3 py-1.5 rounded-full bg-destructive/10 border border-destructive/20 min-h-[36px] font-medium">
            ↺ {t("resetTodayCount")}
          </button>
        </div>
        <div className="text-xs text-muted-foreground">
          {t("dhikrTodayTotal")}: <b className="text-foreground">{total}</b> {t("times")}
        </div>
      </div>
    </Card>
  );
}

// ---------- Timers (meditation + focus) ----------
function TimerCard({
  icon,
  title,
  sub,
  presets,
  doneMsg,
  field,
}: {
  icon: string;
  title: string;
  sub: string;
  presets: number[];
  doneMsg: string;
  field: "meditationMin" | "focusMin";
}) {
  const { state, updateLog, today, t } = useStore();
  const log = getLog(state, today);
  const [preset, setPreset] = useState(presets[0]);
  const [left, setLeft] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const ivRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const doneRef = useRef(doneMsg);
  useEffect(() => {
    doneRef.current = doneMsg;
  }, [doneMsg]);

  useEffect(() => {
    if (running && left !== null && left > 0) {
      ivRef.current = setInterval(() => {
        setLeft((v) => {
          if (v === null) return null;
          if (v <= 1) {
            clearInterval(ivRef.current!);
            setRunning(false);
            updateLog(today, (l) => ({ [field]: l[field] + preset }));
            setTimeout(() => alert(doneRef.current), 50);
            return 0;
          }
          return v - 1;
        });
      }, 1000);
    }
    return () => {
      if (ivRef.current) clearInterval(ivRef.current);
    };
  }, [running, preset, field, today]);

  const stopSave = () => {
    setRunning(false);
    if (ivRef.current) clearInterval(ivRef.current);
    const mins = Math.floor(elapsed / 60);
    if (mins >= 1) {
      updateLog(today, (l) => ({ [field]: l[field] + mins }));
      alert(`${mins} ${t("savedMin")}`);
    }
    setLeft(null);
    setElapsed(0);
  };

  const mm = left === null ? preset * 60 : left;
  const display = `${String(Math.floor(mm / 60)).padStart(2, "0")}:${String(mm % 60).padStart(2, "0")}`;
  const pct = left === null ? 0 : 1 - left / (preset * 60);

  return (
    <Card className="mb-4">
      <SectionTitle title={`${icon} ${title}`} sub={sub} />
      <div className="flex items-center gap-4">
        <Ring pct={pct} size={110} stroke={9}>
          <span className="text-xl font-bold">{display}</span>
          <span className="text-[10px] text-muted-foreground">
            {log[field]} {t("min")} {t("today").toLowerCase()}
          </span>
        </Ring>
        <div className="flex-1 flex flex-col gap-2">
          <div className="flex flex-wrap gap-1.5">
            {presets.map((p) => (
              <Chip
                key={p}
                active={preset === p && left === null}
                onClick={() => {
                  if (!running) {
                    setPreset(p);
                    setLeft(null);
                  }
                }}
              >
                {p} {t("min")}
              </Chip>
            ))}
          </div>
          <div className="flex gap-2">
            {!running ? (
              <button
                type="button"
                onClick={() => {
                  setElapsed(0);
                  setRunning(true);
                  setLeft((v) => (v === null || v <= 0 ? preset * 60 : v));
                }}
                className="flex-1 rounded-xl bg-primary text-primary-foreground text-sm font-semibold py-2.5 min-h-[44px]"
              >
                ▶ {t("start")}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setRunning(false)}
                  className="flex-1 rounded-xl bg-secondary text-sm font-semibold py-2.5 min-h-[44px]"
                >
                  ⏸ {t("pause")}
                </button>
                <button
                  type="button"
                  onClick={stopSave}
                  className="rounded-xl bg-destructive/10 text-destructive text-sm px-3 min-h-[44px]"
                >
                  ⏹
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

// ---------- Mood ----------
function MoodCard() {
  const { state, updateLog, today, t } = useStore();
  const log = getLog(state, today);
  const faces = ["😞", "😕", "😐", "🙂", "😄"];
  return (
    <Card className="mb-4">
      <SectionTitle title={`💛 ${t("mood")}`} sub={t("moodSub")} />
      <div className="grid grid-cols-5 gap-2">
        {faces.map((f, i) => {
          const v = i + 1;
          const on = log.mood === v;
          return (
            <button
              key={v}
              type="button"
              onClick={() => {
                updateLog(today, { mood: v });
              }}
              className={`rounded-xl border p-2 flex flex-col items-center gap-1 min-h-[64px] ${
                on ? "bg-primary text-primary-foreground border-primary" : "bg-secondary border-transparent"
              }`}
            >
              <span className="text-xl leading-none">{f}</span>
              <span className="text-[9px] leading-none">{t(`mood${v}`)}</span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

// ---------- Sleep ----------
function SleepCard() {
  const { state, updateLog, today, t } = useStore();
  const log = getLog(state, today);
  const [bed, setBed] = useState(log.sleepBed || "");
  const [wake, setWake] = useState(log.sleepWake || "");
  const [saved, setSaved] = useState(false);

  const save = () => {
    updateLog(today, { sleepBed: bed || null, sleepWake: wake || null });
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  };

  return (
    <Card className="mb-4">
      <SectionTitle
        title={`😴 ${t("sleep")}`}
        sub={t("sleepSub")}
        right={saved ? <span className="text-xs text-primary">{t("noteSaved")}</span> : undefined}
      />
      <div className="flex items-end gap-2">
        <label className="flex-1">
          <span className="text-xs text-muted-foreground block mb-1">🌙 {t("sleepBed")}</span>
          <input
            type="time"
            value={bed}
            onChange={(e) => setBed(e.target.value)}
            className="w-full bg-muted rounded-xl px-3 py-2 text-sm border border-border outline-none focus:ring-1 focus:ring-ring"
          />
        </label>
        <label className="flex-1">
          <span className="text-xs text-muted-foreground block mb-1">☀️ {t("sleepWake")}</span>
          <input
            type="time"
            value={wake}
            onChange={(e) => setWake(e.target.value)}
            className="w-full bg-muted rounded-xl px-3 py-2 text-sm border border-border outline-none focus:ring-1 focus:ring-ring"
          />
        </label>
        <button type="button" onClick={save} className="rounded-xl bg-primary text-primary-foreground text-sm font-semibold px-4 py-2.5 min-h-[44px]">
          ✓
        </button>
      </div>
    </Card>
  );
}

// ---------- Quick note ----------
function TodayNoteCard() {
  const { state, updateLog, today, t } = useStore();
  const log = getLog(state, today);
  const [text, setText] = useState(log.note);
  const [saved, setSaved] = useState(false);
  const tRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onChange = (v: string) => {
    setText(v);
    if (tRef.current) clearTimeout(tRef.current);
    tRef.current = setTimeout(() => {
      updateLog(today, { note: v });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    }, 600);
  };

  return (
    <Card className="mb-4">
      <SectionTitle
        title={`📝 ${t("note")}`}
        sub={t("noteSub")}
        right={saved ? <span className="text-xs text-primary">{t("noteSaved")}</span> : undefined}
      />
      <textarea
        value={text}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t("notePlaceholder")}
        rows={3}
        className="w-full bg-muted rounded-xl px-3 py-2 text-sm border border-border outline-none focus:ring-1 focus:ring-ring resize-none"
      />
    </Card>
  );
}

// ---------- Meals (detail page: display + config TOGETHER) ----------
function MealsCard() {
  const { state, updateSettings, t } = useStore();
  const meals = state.settings.mealAlarms;
  const icons: Record<MealKey, string> = { breakfast: "🌅", lunch: "🍛", dinner: "🌙" };
  return (
    <Card className="mb-4">
      <SectionTitle title={`🍽 ${t("meals")}`} sub={t("mealsSub")} />
      <div className="flex flex-col gap-1">
        {MEAL_KEYS.map((mk) => (
          <div key={mk} className={`rounded-xl border p-3 ${meals[mk].on ? "border-primary/40 bg-primary/5" : "border-border bg-secondary/40"}`}>
            <div className="flex items-center gap-3">
              <span className="text-2xl">{icons[mk]}</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold">{t(`meal_${mk}`)}</div>
                <div className="text-xs text-muted-foreground">{meals[mk].on ? `🎵 ${t("mealsSub")}` : t("off")}</div>
              </div>
              <input
                type="time"
                value={meals[mk].time}
                onChange={(e) => updateSettings({ mealAlarms: { ...meals, [mk]: { ...meals[mk], time: e.target.value } } })}
                className="bg-muted rounded-lg px-2 py-1.5 text-sm border border-border outline-none focus:ring-1 focus:ring-ring"
              />
              <button
                type="button"
                role="switch"
                aria-checked={meals[mk].on}
                aria-label={t(`meal_${mk}`)}
                onClick={() => updateSettings({ mealAlarms: { ...meals, [mk]: { ...meals[mk], on: !meals[mk].on } } })}
                className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${meals[mk].on ? "bg-primary" : "bg-muted border border-border"}`}
              >
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${meals[mk].on ? "left-[22px]" : "left-0.5"}`} />
              </button>
            </div>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-muted-foreground mt-2">🎵 {t("mealAlarmsCfgSub")}</p>
    </Card>
  );
}

// ---------- All alarms & reminders (detail page) ----------
function AlarmsCard() {
  const { state, updateSettings, t, notifPerm, askNotifPerm, fireNotif } = useStore();
  const s = state.settings;

  const setAdhanTime = (k: PrayerKey, patch: Partial<{ on: boolean; time: string }>) => {
    updateSettings({ adhanAlerts: { ...s.adhanAlerts, [k]: { ...s.adhanAlerts[k], ...patch } } });
  };

  const autoFillAdhan = () => {
    const pt = s.prayerTimes;
    if (!pt) return;
    updateSettings({
      adhanAlerts: {
        fajr: { ...s.adhanAlerts.fajr, time: pt.fajr },
        dhuhr: { ...s.adhanAlerts.dhuhr, time: pt.dhuhr },
        asr: { ...s.adhanAlerts.asr, time: pt.asr },
        maghrib: { ...s.adhanAlerts.maghrib, time: pt.maghrib },
        isha: { ...s.adhanAlerts.isha, time: pt.isha },
      },
    });
    alert(t("timesSet"));
  };

  return (
    <div>
      <Card className="mb-4">
        <SectionTitle title={`🕌 ${t("fajrAlarm")}`} sub={t("fajrAlarmSub")} />
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium">{t("fajrAlarm")}</span>
          <div className="flex items-center gap-2">
            <input
              type="time"
              value={s.fajrAlarm.time}
              onChange={(e) => updateSettings({ fajrAlarm: { ...s.fajrAlarm, time: e.target.value } })}
              className="bg-muted rounded-lg px-2 py-1.5 text-sm border border-border outline-none focus:ring-1 focus:ring-ring"
            />
            <button
              type="button"
              role="switch"
              aria-checked={s.fajrAlarm.on}
              onClick={() => updateSettings({ fajrAlarm: { ...s.fajrAlarm, on: !s.fajrAlarm.on } })}
              className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${s.fajrAlarm.on ? "bg-primary" : "bg-muted border border-border"}`}
            >
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${s.fajrAlarm.on ? "left-[22px]" : "left-0.5"}`} />
            </button>
          </div>
        </div>
      </Card>

      <Card className="mb-4">
        <SectionTitle
          title={`📢 ${t("adhanAlerts")}`}
          sub={t("adhanAlertsSub")}
          right={
            s.prayerTimes ? (
              <button type="button" onClick={autoFillAdhan} className="text-[11px] rounded-lg bg-secondary px-2.5 py-2 min-h-[36px] shrink-0">
                ⚡ {t("autoTimes")}
              </button>
            ) : undefined
          }
        />
        {PRAYER_KEYS.map((k) => (
          <div key={k} className="flex items-center justify-between gap-3 py-2 border-t border-border first:border-0">
            <span className="text-sm font-medium">{t(`prayer_${k}`)}</span>
            <div className="flex items-center gap-2">
              <input
                type="time"
                value={s.adhanAlerts[k].time}
                onChange={(e) => setAdhanTime(k, { time: e.target.value })}
                className="bg-muted rounded-lg px-2 py-1.5 text-sm border border-border outline-none focus:ring-1 focus:ring-ring"
              />
              <button
                type="button"
                role="switch"
                aria-checked={s.adhanAlerts[k].on}
                onClick={() => setAdhanTime(k, { on: !s.adhanAlerts[k].on })}
                className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${s.adhanAlerts[k].on ? "bg-primary" : "bg-muted border border-border"}`}
              >
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${s.adhanAlerts[k].on ? "left-[22px]" : "left-0.5"}`} />
              </button>
            </div>
          </div>
        ))}
      </Card>

      <Card className="mb-4">
        <SectionTitle title={`🔔 ${t("reminders")}`} />
        <div className="flex items-center justify-between gap-3 py-2">
          <div className="min-w-0">
            <div className="text-sm font-medium">{t("hourlyWater")}</div>
            <div className="text-xs text-muted-foreground">{t("hourlyWaterSub")}</div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={s.hourlyWater}
            onClick={() => updateSettings({ hourlyWater: !s.hourlyWater })}
            className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${s.hourlyWater ? "bg-primary" : "bg-muted border border-border"}`}
          >
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${s.hourlyWater ? "left-[22px]" : "left-0.5"}`} />
          </button>
        </div>
        <div className="flex items-center justify-between gap-3 py-2 border-t border-border">
          <div className="min-w-0">
            <div className="text-sm font-medium">{t("dailyAyat")}</div>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="time"
              value={s.ayatNotif.time}
              onChange={(e) => updateSettings({ ayatNotif: { ...s.ayatNotif, time: e.target.value } })}
              className="bg-muted rounded-lg px-2 py-1.5 text-sm border border-border outline-none focus:ring-1 focus:ring-ring"
            />
            <button
              type="button"
              role="switch"
              aria-checked={s.ayatNotif.on}
              onClick={() => updateSettings({ ayatNotif: { ...s.ayatNotif, on: !s.ayatNotif.on } })}
              className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${s.ayatNotif.on ? "bg-primary" : "bg-muted border border-border"}`}
            >
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${s.ayatNotif.on ? "left-[22px]" : "left-0.5"}`} />
            </button>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 py-2 border-t border-border">
          <div className="min-w-0">
            <div className="text-sm font-medium">{t("checkinTime")}</div>
          </div>
          <input
            type="time"
            value={s.checkinTime}
            onChange={(e) => updateSettings({ checkinTime: e.target.value })}
            className="bg-muted rounded-lg px-2 py-1.5 text-sm border border-border outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      </Card>

      <Card className="mb-4">
        <SectionTitle title={`🔐 ${t("permNotif")}`} sub={t("permNotifSub")} />
        <div className="flex gap-2">
          {notifPerm !== "granted" ? (
            <button type="button" onClick={() => void askNotifPerm()} className="flex-1 rounded-xl bg-primary text-primary-foreground text-sm font-semibold py-2.5 min-h-[44px]">
              🔔 {t("permNotifAsk")}
            </button>
          ) : (
            <div className="flex-1 rounded-xl bg-primary/10 text-primary text-sm font-semibold py-2.5 min-h-[44px] text-center">
              ✓ {t("permNotif")}
            </div>
          )}
          <button
            type="button"
            onClick={() => {
              fireNotif(t("appName"), t("checkinMsg"));
              alert(t("testNotif"));
            }}
            className="rounded-xl bg-secondary px-4 text-sm min-h-[44px]"
          >
            {t("permTest")}
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground mt-2 leading-relaxed">{t("alarmNote")}</p>
      </Card>
    </div>
  );
}

// ==================== HOME: card grid + detail pages ====================

type DetailKey =
  | "prayers"
  | "water"
  | "reels"
  | "dhikr"
  | "meditation"
  | "focus"
  | "mood"
  | "sleep"
  | "note"
  | "meals"
  | "alarms";

const DETAIL_I18N: Record<DetailKey, string> = {
  prayers: "detailPrayers",
  water: "detailWater",
  reels: "detailReels",
  dhikr: "detailDhikr",
  meditation: "detailMeditation",
  focus: "detailFocus",
  mood: "detailMood",
  sleep: "detailSleep",
  note: "detailNote",
  meals: "detailMeals",
  alarms: "detailAlarms",
};

const TINT: Record<DetailKey, string> = {
  prayers: "from-emerald-500/15 to-transparent border-emerald-500/25",
  water: "from-sky-500/15 to-transparent border-sky-500/25",
  reels: "from-rose-500/15 to-transparent border-rose-500/25",
  dhikr: "from-violet-500/15 to-transparent border-violet-500/25",
  meditation: "from-teal-500/15 to-transparent border-teal-500/25",
  focus: "from-amber-500/15 to-transparent border-amber-500/25",
  mood: "from-yellow-500/15 to-transparent border-yellow-500/25",
  sleep: "from-indigo-500/15 to-transparent border-indigo-500/25",
  note: "from-slate-500/15 to-transparent border-slate-500/25",
  meals: "from-orange-500/15 to-transparent border-orange-500/25",
  alarms: "from-red-500/15 to-transparent border-red-500/25",
};

function HabitTile({
  icon,
  titleKey,
  value,
  sub,
  pct,
  tint,
  onOpen,
}: {
  icon: string;
  titleKey: DetailKey;
  value: string;
  sub?: string;
  pct?: number;
  tint: string;
  onOpen: (k: DetailKey) => void;
}) {
  const { t } = useStore();
  const done = typeof pct === "number" && pct >= 1;
  return (
    <button
      type="button"
      onClick={() => onOpen(titleKey)}
      className={`habit-tile tile-in text-left rounded-2xl border bg-gradient-to-br ${TINT[tint as DetailKey] || tint} p-3.5 flex flex-col gap-2 min-h-[118px] transition-transform ${done ? "tile-done" : ""}`}
    >
      <div className="flex items-start justify-between">
        <span className="tile-ico w-9 h-9 rounded-xl bg-background/80 dark:bg-background/60 border border-border flex items-center justify-center text-lg shadow-sm">
          {icon}
        </span>
        {done ? (
          <span className="tile-check w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[11px] font-bold shadow">✓</span>
        ) : (
          <span className="text-muted-foreground/70 text-base leading-none mt-1">›</span>
        )}
      </div>
      <div>
        <div className="text-[11px] font-semibold text-muted-foreground leading-tight uppercase tracking-wide">{t(DETAIL_I18N[titleKey as DetailKey])}</div>
        <div className="text-[17px] font-extrabold leading-tight mt-0.5">{value}</div>
        {sub ? <div className="text-[10px] text-muted-foreground truncate mt-0.5">{sub}</div> : null}
      </div>
      {typeof pct === "number" ? <Bar pct={pct} className="h-1.5" /> : null}
    </button>
  );
}

function HabitGrid({ onOpen }: { onOpen: (k: DetailKey) => void }) {
  const { state, today, t } = useStore();
  const log = getLog(state, today);
  const goal = state.settings.waterGoalMl;
  const prayersDone = PRAYER_KEYS.filter((k) => log.prayers[k]).length;
  const reelsTotal = log.reelsMin ?? 0;
  const nextPrayerKey = PRAYER_KEYS.find((k) => !log.prayers[k]);

  return (
    <div className="grid grid-cols-2 gap-2.5 mb-4">
      <HabitTile
        icon="🕌"
        titleKey="prayers"
        value={`${prayersDone}/5`}
        sub={state.settings.prayerTimes?.[nextPrayerKey || "fajr"] ? `${t("next")}: ${state.settings.prayerTimes?.[nextPrayerKey || "fajr"]}` : t("prayersSub")}
        pct={prayersDone / 5}
        tint="prayers"
        onOpen={onOpen}
      />
      <HabitTile
        icon="💧"
        titleKey="water"
        value={`${(log.waterMl / 1000).toFixed(2)} / ${(goal / 1000).toFixed(1)} L`}
        sub={`${Math.round(Math.min(1, log.waterMl / goal) * 100)}%`}
        pct={Math.min(1, log.waterMl / goal)}
        tint="water"
        onOpen={onOpen}
      />
      <HabitTile
        icon="🎬"
        titleKey="reels"
        value={reelsTotal === 0 && log.reelsMin !== null ? `🔥 ${t("reelsFreeToday").split("!")[0]}` : `${reelsTotal} ${t("min")}`}
        sub={t("tapForDetails")}
        tint="reels"
        onOpen={onOpen}
      />
      <HabitTile
        icon="📿"
        titleKey="dhikr"
        value={`${dhikrTotal(log)}`}
        sub={t("dhikrTodayTotal")}
        tint="dhikr"
        onOpen={onOpen}
      />
      <HabitTile
        icon="🧘"
        titleKey="meditation"
        value={`${log.meditationMin} ${t("min")}`}
        sub={t("meditationSub")}
        tint="meditation"
        onOpen={onOpen}
      />
      <HabitTile
        icon="🎯"
        titleKey="focus"
        value={`${log.focusMin} ${t("min")}`}
        sub={t("focusSub")}
        tint="focus"
        onOpen={onOpen}
      />
      <HabitTile
        icon="😴"
        titleKey="sleep"
        value={log.sleepBed && log.sleepWake ? `${log.sleepBed} → ${log.sleepWake}` : "—"}
        sub={t("sleepSub")}
        tint="sleep"
        onOpen={onOpen}
      />
    </div>
  );
}

// ---------- Next-alarm strip (meals + reminders on the home, as own layers) ----------
function AlarmsLayer({ onOpen }: { onOpen: (k: DetailKey) => void }) {
  const { state, t } = useStore();
  const s = state.settings;
  const icons: Record<MealKey, string> = { breakfast: "🌅", lunch: "🍛", dinner: "🌙" };
  const pIcons: Record<PrayerKey, string> = { fajr: "🌅", dhuhr: "☀️", asr: "🌤", maghrib: "🌇", isha: "🌙" };

  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  const cands: { time: string; label: string; icon: string }[] = [];
  for (const mk of MEAL_KEYS) {
    if (s.mealAlarms[mk].on) cands.push({ time: s.mealAlarms[mk].time, label: t(`meal_${mk}`), icon: icons[mk] });
  }
  if (s.fajrAlarm.on) cands.push({ time: s.fajrAlarm.time, label: t("fajrAlarm"), icon: "🕌" });
  for (const pk of PRAYER_KEYS) {
    if (s.adhanAlerts[pk].on) cands.push({ time: s.adhanAlerts[pk].time, label: `${t("adhanAlerts")} · ${t(`prayer_${pk}`)}`, icon: pIcons[pk] });
  }
  const upcoming = cands
    .map((c) => ({ ...c, m: Number(c.time.split(":")[0]) * 60 + Number(c.time.split(":")[1]) }))
    .filter((c) => c.m >= mins)
    .sort((a, b) => a.m - b.m)[0];

  const nextMeal = MEAL_KEYS.find((mk) => s.mealAlarms[mk].on && Number(s.mealAlarms[mk].time.split(":")[0]) * 60 + Number(s.mealAlarms[mk].time.split(":")[1]) >= mins);

  return (
    <Card className="mb-4 border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
      <SectionTitle title={`⏰ ${t("detailAlarms")}`} sub={upcoming ? `${t("nextAlarm")}: ${upcoming.icon} ${upcoming.label} · ${upcoming.time}` : t("noAlarm")} />
      <div className="grid grid-cols-2 gap-2.5">
        <button
          type="button"
          onClick={() => onOpen("meals")}
          className={`rounded-xl border p-3 text-left active:scale-[0.97] transition-transform ${nextMeal ? "border-orange-500/40 bg-orange-500/10" : "border-border bg-secondary/40"}`}
        >
          <div className="text-xl mb-1">🍽</div>
          <div className="text-sm font-bold">{t("detailMeals")}</div>
          <div className="text-[10px] text-muted-foreground">
            {nextMeal ? `${t(`meal_${nextMeal}`)} · ${s.mealAlarms[nextMeal].time}` : t("detailMeals")}
          </div>
        </button>
        <button
          type="button"
          onClick={() => onOpen("alarms")}
          className="rounded-xl border border-red-500/30 bg-red-500/5 p-3 text-left active:scale-[0.97] transition-transform"
        >
          <div className="text-xl mb-1">🔔</div>
          <div className="text-sm font-bold">{t("detailAlarms")}</div>
          <div className="text-[10px] text-muted-foreground">{t("alarmsOnHome")}</div>
        </button>
      </div>
    </Card>
  );
}

// ---------- Full-screen detail page ----------
// v2.2 FIX: rendered through a PORTAL to <body>. It used to live inside the
// tab container whose .page-in animation (fill-mode: both) keeps a transform
// → a stacking context → the fixed overlay's z-index was trapped BELOW the
// bottom-nav (z-40 sibling). On phones the page looked like a small popup
// with the nav floating above — exactly what the owner reported.
function DetailPage({ k, onClose }: { k: DetailKey; onClose: () => void }) {
  const { t } = useStore();
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  if (typeof document === "undefined") return null; // static-export prerender safety
  return createPortal(
    <div className="fixed inset-0 bg-background overflow-y-auto animate-slide-up" style={{ zIndex: 80 }}>
      <div className="max-w-md mx-auto px-4 pb-12">
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border -mx-4 px-4 py-3 flex items-center gap-3 mb-4">
          <button
            type="button"
            onClick={onClose}
            aria-label={t("back")}
            className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center text-lg shrink-0 active:scale-95 transition-transform"
          >
            ←
          </button>
          <h1 className="text-lg font-bold truncate">{t(DETAIL_I18N[k])}</h1>
        </div>
        {k === "prayers" ? <PrayerCard /> : null}
        {k === "water" ? <WaterCard /> : null}
        {k === "reels" ? <ReelsCard /> : null}
        {k === "dhikr" ? <DhikrCard /> : null}
        {k === "meditation" ? <TimerCard icon="🧘" title={t("meditation")} sub={t("meditationSub")} presets={[10, 15, 20, 30]} doneMsg={t("meditationDone")} field="meditationMin" /> : null}
        {k === "focus" ? <TimerCard icon="🎯" title={t("focus")} sub={t("focusSub")} presets={[25, 50]} doneMsg={t("focusDone")} field="focusMin" /> : null}
        {k === "mood" ? <MoodCard /> : null}
        {k === "sleep" ? <SleepCard /> : null}
        {k === "note" ? <TodayNoteCard /> : null}
        {k === "meals" ? <MealsCard /> : null}
        {k === "alarms" ? <AlarmsCard /> : null}
      </div>
    </div>,
    document.body
  );
}

export default function HomeTab({ onSecret }: { onSecret?: () => void }) {
  const { t } = useStore();
  const [detail, setDetail] = useState<DetailKey | null>(null);

  return (
    <div>
      <Header onSecret={onSecret} />
      <AdsBanner compact variant="a" />
      <ReminderCard />
      <WeekStrip />
      <div className="px-1 mb-2">
        <h2 className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">{t("todayCard")}</h2>
      </div>
      <HabitGrid onOpen={setDetail} />
      <AdsBanner compact variant="b" />
      <AlarmsLayer onOpen={setDetail} />
      <AtNativeInline />
      <div className="mb-2">
        <AdsBanner variant="b" />
      </div>
      {detail ? <DetailPage k={detail} onClose={() => setDetail(null)} /> : null}
    </div>
  );
}
