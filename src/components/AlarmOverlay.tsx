"use client";

import React, { useEffect, useRef } from "react";
import { useStore } from "@/lib/store";
import { startAlarmMusic, stopAlarmMusic } from "@/lib/audio";

export interface ActiveAlarm {
  key: string;
  title: string;
  body: string;
  sound: boolean;
}

/**
 * Beautiful night-sky mosque illustration (pure SVG — crisp on every screen,
 * zero image assets). Dome + minarets + crescent + twinkling stars over a
 * deep gradient — the owner's round-6 #4: "আজানের স্ক্রিনে মসজিদভিত্তিক
 * সুন্দর ভিজ্যুয়াল দেখাবে"।
 */
function MosqueArt() {
  return (
    <svg viewBox="0 0 320 210" className="w-full h-auto" role="img" aria-label="Mosque at night">
      <defs>
        <linearGradient id="oh-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0b2545" />
          <stop offset="60%" stopColor="#134074" />
          <stop offset="100%" stopColor="#1c5d63" />
        </linearGradient>
        <linearGradient id="oh-dome" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2ea36f" />
          <stop offset="100%" stopColor="#0d5c40" />
        </linearGradient>
        <radialGradient id="oh-moon" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fff7d6" />
          <stop offset="100%" stopColor="#ffe9a3" />
        </radialGradient>
      </defs>
      <rect width="320" height="210" rx="24" fill="url(#oh-sky)" />
      {/* stars */}
      {[
        [36, 34], [70, 22], [122, 40], [178, 24], [232, 38], [272, 20], [296, 52], [58, 58], [200, 58], [258, 66],
      ].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={i % 3 === 0 ? 2.2 : 1.4} fill="#fff" className="azan-star" style={{ animationDelay: `${i * 0.35}s` }} />
      ))}
      {/* crescent moon */}
      <g transform="translate(258 46)">
        <circle r="16" fill="url(#oh-moon)" />
        <circle cx="7" cy="-4" r="14" fill="#0b2545" />
      </g>
      {/* ground */}
      <rect x="0" y="176" width="320" height="34" fill="#081f18" opacity="0.9" />
      {/* side minarets */}
      <g fill="url(#oh-dome)">
        <rect x="58" y="92" width="10" height="86" rx="4" />
        <circle cx="63" cy="88" r="8" />
        <circle cx="63" cy="76" r="2.6" fill="#ffe9a3" />
        <rect x="252" y="92" width="10" height="86" rx="4" />
        <circle cx="257" cy="88" r="8" />
        <circle cx="257" cy="76" r="2.6" fill="#ffe9a3" />
      </g>
      {/* main hall */}
      <rect x="86" y="126" width="148" height="52" rx="6" fill="#0d5c40" />
      {/* door + windows */}
      <path d="M150 178 v-26 a10 10 0 0 1 20 0 v26 z" fill="#081f18" />
      <rect x="104" y="148" width="16" height="22" rx="8" fill="#081f18" />
      <rect x="200" y="148" width="16" height="22" rx="8" fill="#081f18" />
      {/* central dome */}
      <path d="M160 66 c22 0 34 16 38 34 c-24 8 -52 8 -76 0 c4 -18 16 -34 38 -34 z" fill="url(#oh-dome)" />
      <path d="M160 60 l3 8 h-6 z" fill="#ffe9a3" />
      <circle cx="160" cy="58" r="3" fill="#ffe9a3" />
      {/* small domes */}
      <path d="M104 116 c8 0 12 7 13 14 c-9 3 -17 3 -26 0 c1 -7 5 -14 13 -14 z" fill="url(#oh-dome)" />
      <path d="M216 116 c8 0 12 7 13 14 c-9 3 -17 3 -26 0 c1 -7 5 -14 13 -14 z" fill="url(#oh-dome)" />
    </svg>
  );
}

/** Full-screen alarm overlay — meals, Fajr, adhan. Azan gets the mosque view. */
export default function AlarmOverlay({ alarm, onDismiss }: { alarm: ActiveAlarm | null; onDismiss: (snooze: boolean) => void }) {
  const { t } = useStore();
  const stopRef = useRef<(() => void) | null>(null);
  const dismissRef = useRef(onDismiss);
  useEffect(() => {
    dismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (alarm?.sound) {
      try {
        stopRef.current = startAlarmMusic();
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

  // v2.4 AZAN VIEW: mosque illustration + "আজানের সময় হয়েছে" + prayer name
  if (isAzan) {
    const prayerName = alarm.key === "fajr" ? t("fajrAlarm") : alarm.title.split("—").pop()?.trim() || "";
    return (
      <div className="fixed inset-0 z-[100] overflow-y-auto" style={{ background: "linear-gradient(180deg,#081a33 0%,#0d2b4d 45%,#123c4f 100%)" }}>
        <div className="min-h-full flex flex-col items-center justify-center gap-5 p-6 text-center">
          <div className="relative w-full max-w-[340px]">
            <div className="absolute inset-0 azan-glow rounded-[28px]" style={{ background: "radial-gradient(circle at 50% 42%, rgba(46,163,111,0.35), transparent 65%)" }} />
            <div className="relative rounded-[28px] overflow-hidden border border-primary/30 shadow-2xl">
              <MosqueArt />
            </div>
          </div>
          <div className="text-white">
            <div className="text-[11px] font-bold uppercase tracking-[0.25em] text-emerald-300 mb-2">🕌 {t("azanOverlayTitle")}</div>
            <h2 className="text-3xl font-extrabold leading-tight drop-shadow">{prayerName}</h2>
            <p className="text-sm text-emerald-100/90 mt-2 leading-relaxed max-w-[300px] mx-auto">
              {isFajr ? t("azanOverlayFajr") : t("azanOverlaySub")}
            </p>
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
              className="w-full rounded-2xl bg-white/10 text-white text-sm font-medium py-3 min-h-[48px] border border-white/20"
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
