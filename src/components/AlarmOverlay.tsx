"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { startAlarmMusic, startMealMusic, startAzan, stopAlarmMusic } from "@/lib/audio";
import { PRAYER_KEYS } from "@/lib/types";
// v5.0: the clock follows the DEVICE language — রাত ১২:৩০ / সকাল ৯:৩০ in
// Bengali (Bangladesh 12-hour convention, owner round-19), "9:30 AM" in English.
import { appLang, fmtHM } from "@/lib/i18n";

export interface ActiveAlarm {
  key: string;
  title: string;
  body: string;
  sound: boolean;
  /** v2.8: the alarm's own "HH:MM" (from the exact-alarm engine) — shown as
   *  the BIG clock in the azan view, like the reference (WeMuslim) app. */
  time?: string;
}

/** v5.0: HH:MM → localized 12h display (Bengali day-parts + Bengali digits). */
function fmt12(hhmm: string): string {
  return fmtHM(hhmm, appLang());
}

/**
 * v2.8 AZAN BACKGROUND — the reference app's look (owner's screenshot):
 * a bright blue sky with soft clouds and sun glow over a white mosque dome
 * with tall minarets (pure SVG — crisp on every screen, zero image files).
 */
function AzanSkyArt() {
  return (
    <svg viewBox="0 0 360 640" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 w-full h-full" role="img" aria-label="Mosque dome under a blue sky">
      <defs>
        <linearGradient id="az-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#63a8f0" />
          <stop offset="45%" stopColor="#9cc9f5" />
          <stop offset="78%" stopColor="#cfe8fb" />
          <stop offset="100%" stopColor="#eaf6ff" />
        </linearGradient>
        <radialGradient id="az-sun" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fffbe8" />
          <stop offset="100%" stopColor="#ffe9a3" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="az-dome" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#d8ecdc" />
        </linearGradient>
        <linearGradient id="az-hall" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f2f7f3" />
          <stop offset="100%" stopColor="#c9dfd0" />
        </linearGradient>
      </defs>
      <rect width="360" height="640" fill="url(#az-sky)" />
      {/* sun glow */}
      <circle cx="296" cy="96" r="84" fill="url(#az-sun)" />
      <circle cx="296" cy="96" r="22" fill="#fff7d6" />
      {/* soft clouds */}
      <g fill="#ffffff" opacity="0.85">
        <ellipse cx="70" cy="110" rx="46" ry="14" />
        <ellipse cx="104" cy="100" rx="30" ry="11" />
        <ellipse cx="250" cy="180" rx="54" ry="15" />
        <ellipse cx="286" cy="170" rx="32" ry="11" />
        <ellipse cx="60" cy="260" rx="40" ry="12" opacity="0.7" />
      </g>
      {/* birds */}
      <g stroke="#3f5f80" strokeWidth="2.4" fill="none" strokeLinecap="round" opacity="0.8">
        <path d="M128 150 q8 -8 16 0 q8 -8 16 0" />
        <path d="M180 128 q6 -6 12 0 q6 -6 12 0" />
      </g>
      {/* ground */}
      <rect x="0" y="520" width="360" height="120" fill="#bcd9c0" />
      <rect x="0" y="520" width="360" height="14" fill="#a5ccab" />
      {/* left minaret */}
      <g>
        <rect x="52" y="300" width="22" height="230" rx="8" fill="url(#az-hall)" />
        <rect x="46" y="286" width="34" height="16" rx="6" fill="url(#az-hall)" />
        <path d="M63 236 c11 0 17 9 18 22 h-36 c1 -13 7 -22 18 -22 z" fill="url(#az-dome)" />
        <path d="M63 230 l2.6 7 h-5.2 z" fill="#d9b64e" />
        <rect x="58" y="360" width="10" height="26" rx="5" fill="#7fa8c9" opacity="0.75" />
        <rect x="58" y="430" width="10" height="26" rx="5" fill="#7fa8c9" opacity="0.75" />
      </g>
      {/* right minaret */}
      <g>
        <rect x="286" y="300" width="22" height="230" rx="8" fill="url(#az-hall)" />
        <rect x="280" y="286" width="34" height="16" rx="6" fill="url(#az-hall)" />
        <path d="M297 236 c11 0 17 9 18 22 h-36 c1 -13 7 -22 18 -22 z" fill="url(#az-dome)" />
        <path d="M297 230 l2.6 7 h-5.2 z" fill="#d9b64e" />
        <rect x="292" y="360" width="10" height="26" rx="5" fill="#7fa8c9" opacity="0.75" />
        <rect x="292" y="430" width="10" height="26" rx="5" fill="#7fa8c9" opacity="0.75" />
      </g>
      {/* main hall */}
      <rect x="86" y="430" width="188" height="100" rx="12" fill="url(#az-hall)" />
      {/* arcade */}
      <g fill="#9db8a6" opacity="0.65">
        {[100, 140, 180, 220, 258].map((x) => (
          <path key={x} d={`M${x} 470 v40 a12 12 0 0 0 24 0 v-40 z`} />
        ))}
      </g>
      {/* small domes */}
      <path d="M116 404 c14 0 21 12 22 26 h-44 c1 -14 8 -26 22 -26 z" fill="url(#az-dome)" />
      <path d="M244 404 c14 0 21 12 22 26 h-44 c1 -14 8 -26 22 -26 z" fill="url(#az-dome)" />
      {/* the GREAT dome (Prophet's Mosque style) */}
      <path d="M180 268 c34 4 58 30 62 68 h-124 c4 -38 28 -64 62 -68 z" fill="url(#az-dome)" />
      <ellipse cx="180" cy="336" rx="62" ry="9" fill="#e8f2ea" />
      <path d="M180 258 l4 10 h-8 z" fill="#d9b64e" />
      <circle cx="180" cy="254" r="3.4" fill="#d9b64e" />
      {/* crescent finial */}
      <g transform="translate(180 240)">
        <path d="M5 0 a5 5 0 1 1 -4 -8 a6.5 6.5 0 1 0 4 8 z" fill="#d9b64e" />
      </g>
      {/* green accent band */}
      <rect x="86" y="424" width="188" height="8" rx="4" fill="#2ea36f" opacity="0.8" />
    </svg>
  );
}

/** Live countdown to the next prayer — the reference app's ticking timer. */
function useNextPrayerCountdown() {
  const { state } = useStore();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(iv);
  }, []);
  const prayerTimes = state.settings.prayerTimes;
  return useMemo(() => {
    if (!prayerTimes) return null;
    const now = new Date();
    const cur = now.getHours() * 60 + now.getMinutes();
    let bestKey: (typeof PRAYER_KEYS)[number] | null = null;
    let bestMin = Infinity;
    for (const k of PRAYER_KEYS) {
      const m = /^(\d{1,2}):(\d{2})$/.exec(prayerTimes[k] || "");
      if (!m) continue;
      const t = Number(m[1]) * 60 + Number(m[2]);
      if (t > cur && t < bestMin) {
        bestMin = t;
        bestKey = k;
      }
    }
    if (!bestKey) return null; // all passed today — Fajr is tomorrow
    const left = bestMin * 60 - (cur * 60 + now.getSeconds());
    const h = String(Math.floor(left / 3600)).padStart(2, "0");
    const m = String(Math.floor((left % 3600) / 60)).padStart(2, "0");
    const s = String(left % 60).padStart(2, "0");
    return { key: bestKey, clock: `${h} : ${m} : ${s}` };
  }, [prayerTimes, tick]);
}

/** Full-screen alarm overlay — meals, Fajr, adhan. v2.8: azan gets the
 *  reference-app full-screen view (mosque dome + glass clock + countdown). */
export default function AlarmOverlay({ alarm, onDismiss }: { alarm: ActiveAlarm | null; onDismiss: (snooze: boolean) => void }) {
  const { t, state } = useStore();
  const stopRef = useRef<(() => void) | null>(null);
  const dismissRef = useRef(onDismiss);
  const countdown = useNextPrayerCountdown();
  useEffect(() => {
    dismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (alarm?.sound) {
      try {
        // v2.8: azan plays the CHOSEN recitation (picker: আজানের ধ্বনি),
        // meals play a RANDOM one of the 2 music tracks, others the music box.
        const key = alarm.key || "";
        const isMeal = key.startsWith("meal_") && !key.startsWith("mealpre_");
        const isAzan = key === "fajr" || key.startsWith("adhan_");
        if (isMeal) stopRef.current = startMealMusic();
        else if (isAzan) stopRef.current = startAzan(state.settings.azanSound || "adhan.mp3");
        else stopRef.current = startAlarmMusic();
      } catch {
        /* audio blocked until user interacts */
      }
    }
    // vibrate on supported phones too
    try {
      if (alarm && typeof navigator !== "undefined" && "vibrate" in navigator) {
        navigator.vibrate([400, 200, 400]);
      }
    } catch {
      /* ignore */
    }
    return () => {
      if (stopRef.current) stopRef.current();
      stopRef.current = null;
    };
  }, [alarm]);

  // Android back button dismisses the alarm overlay (round-5)
  useEffect(() => {
    const onBack = () => {
      if (alarm) {
        (window as unknown as { __ohBackHandled?: boolean }).__ohBackHandled = true;
        dismissRef.current(false);
      }
    };
    window.addEventListener("oh:back", onBack);
    return () => window.removeEventListener("oh:back", onBack);
  }, [alarm]);

  if (!alarm) return null;

  const isMeal = alarm.key.startsWith("meal_") || alarm.key.startsWith("mealpre_");
  const isAzan = alarm.key === "fajr" || alarm.key.startsWith("adhan_");
  const isFajr = alarm.key === "fajr" || alarm.key === "adhan_fajr";

  const dismiss = (snooze: boolean) => {
    if (stopRef.current) stopRef.current();
    stopRef.current = null;
    try {
      if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(0);
    } catch {
      /* ignore */
    }
    onDismiss(snooze);
  };

  // ============ v2.8 AZAN VIEW — the reference app's full-screen design ============
  // bright sky + mosque dome art fills the screen; a glassmorphism circle
  // holds the prayer name + BIG time; the next prayer ticks live below it.
  if (isAzan) {
    const prayerKey = alarm.key === "fajr" ? "fajr" : (alarm.key.split("_")[1] as (typeof PRAYER_KEYS)[number]);
    const prayerName = prayerKey ? t(`prayer_${prayerKey}`) : alarm.title.split("—").pop()?.trim() || t("fajrAlarm");
    const bigTime = alarm.time ? fmt12(alarm.time) : "";
    return (
      <div className="fixed inset-0 z-[100] overflow-hidden select-none" style={{ background: "#7db8ef" }}>
        <AzanSkyArt />
        {/* dark scrim for legibility */}
        <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(8,30,60,0.18) 0%, rgba(8,30,60,0) 40%, rgba(6,40,28,0.42) 100%)" }} />

        {/* close (top-right, like the reference) */}
        <button
          type="button"
          aria-label={t("dismiss")}
          onClick={() => dismiss(false)}
          className="absolute top-4 right-4 w-11 h-11 rounded-full bg-black/25 text-white text-lg font-bold flex items-center justify-center backdrop-blur border border-white/25 active:scale-95 transition-transform"
        >
          ✕
        </button>

        <div className="relative h-full flex flex-col items-center justify-center gap-6 px-6 text-center">
          {/* glass clock circle */}
          <div className="relative flex items-center justify-center">
            <div
              className="azan-glass w-[252px] h-[252px] rounded-full flex flex-col items-center justify-center border-white/40 border"
              style={{
                background: "rgba(10, 28, 48, 0.42)",
                backdropFilter: "blur(10px)",
                WebkitBackdropFilter: "blur(10px)",
                boxShadow: "0 18px 60px rgba(6, 30, 60, 0.45)",
              }}
            >
              <div className="text-[11px] font-bold uppercase tracking-[0.3em] text-emerald-200 mb-1.5">
                {isFajr ? `🌅 ${prayerName}` : `🕌 ${prayerName}`}
              </div>
              <div className="text-white leading-none">
                {bigTime ? (
                  <span className="text-[54px] font-extrabold tracking-tight drop-shadow-lg">{bigTime.split(" ")[0]}</span>
                ) : null}
                {bigTime.includes(" ") ? (
                  <span className="text-lg font-bold ml-1.5 align-top opacity-90">{bigTime.split(" ")[1]}</span>
                ) : null}
              </div>
              <div className="mt-2.5 text-[12px] font-semibold text-emerald-100/95 animate-pulse tracking-wide">
                📢 {t("azanOverlayTitle")}
              </div>
            </div>
          </div>

          <div className="text-white">
            <p className="text-[15px] font-semibold leading-relaxed max-w-[320px] mx-auto drop-shadow">
              {isFajr ? t("azanOverlayFajr") : t("azanOverlaySub")}
            </p>
            {countdown ? (
              <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-black/30 border border-white/25 px-4 py-2 backdrop-blur">
                <span className="text-[11px] font-semibold text-emerald-200 uppercase tracking-wider">{t("nextPrayerLabel")}</span>
                <span className="text-[13px] font-extrabold text-white">{t(`prayer_${countdown.key}`)}</span>
                <span className="text-[13px] font-extrabold text-emerald-300 font-mono tracking-wider">{countdown.clock}</span>
              </div>
            ) : null}
          </div>

          <div className="flex flex-col gap-2.5 w-full max-w-xs mt-1">
            <button
              type="button"
              onClick={() => dismiss(false)}
              className="w-full rounded-2xl bg-emerald-600 text-white text-base font-bold py-3.5 min-h-[52px] shadow-lg shadow-emerald-900/40 active:scale-[0.98] transition-transform"
              style={{ background: "linear-gradient(135deg,#12b76a,#0e9355)" }}
            >
              ✓ {t("dismiss")}
            </button>
            <button
              type="button"
              onClick={() => dismiss(true)}
              className="w-full rounded-2xl bg-white/15 text-white text-sm font-medium py-3 min-h-[48px] border border-white/25 backdrop-blur active:scale-[0.98] transition-transform"
            >
              💤 {t("snooze")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const icon = isMeal ? "🍽️" : "🔔";

  return (
    <div className="fixed inset-0 z-[100] bg-background/95 backdrop-blur flex flex-col items-center justify-center gap-6 p-6 text-center">
      <div className="relative">
        <div className="w-28 h-28 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center text-6xl animate-pulse">
          {icon}
        </div>
      </div>
      <div>
        <div className="text-xs font-semibold text-primary uppercase tracking-widest mb-1">{t("alarmRang")}</div>
        <h2 className="text-2xl font-extrabold">{alarm.title}</h2>
        {alarm.time ? <div className="text-3xl font-extrabold text-primary mt-1">{fmt12(alarm.time)}</div> : null}
        <p className="text-sm text-muted-foreground mt-1">{alarm.body}</p>
      </div>
      <div className="flex flex-col gap-2 w-full max-w-xs">
        <button
          type="button"
          onClick={() => dismiss(false)}
          className="w-full rounded-2xl bg-primary text-primary-foreground text-base font-bold py-3.5 min-h-[52px] shadow-lg"
        >
          ✓ {t("dismiss")}
        </button>
        <button
          type="button"
          onClick={() => dismiss(true)}
          className="w-full rounded-2xl bg-secondary text-sm font-medium py-3 min-h-[48px]"
        >
          💤 {t("snooze")}
        </button>
      </div>
    </div>
  );
}
