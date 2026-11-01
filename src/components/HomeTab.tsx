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
import { dayPoints, fetchPrayerTimes, reminderOfTheDay, dhikrTotal, computeStreaks, MAX_POINTS } from "@/lib/logic";
import AdsBanner from "@/components/AdsBanner";
import { isNative, nativeGetVideoUsage, nativeOpenUsageAccess, nativeVibrate, nativeEnsureNotifPermission, nativeConfirmNotification, nativeRequestNotifications, nativeOpenNotificationSettings, UsageResult } from "@/lib/native";
import { playAdd, playAlarmOn, playChime, playFanfare, playMinus, playStart, playTick, previewSound } from "@/lib/audio";
import { glassesOf, waterAlarmTimes, WaterAlarmCfg, shiftTime, AZAN_SOUNDS } from "@/lib/types";

// ---------- v2.4: alarm ON/OFF confirmation popup (owner round-6 #3) ----------
// "অ্যালার্ম চালু করলে সাথে সাথে একটি পপ-আপ: আপনার অ্যালার্মটি সফলভাবে চালু
// হয়েছে" — green check animation, vibrates, auto-dismisses.
function AlarmConfirm({ text, warn }: { text: string; warn?: boolean }) {
  return (
    <div className="fixed inset-0 z-[92] flex items-center justify-center p-6 pointer-events-none">
      <div
        className={`alarm-confirm-pop rounded-3xl bg-card border-2 shadow-2xl px-6 py-5 flex flex-col items-center gap-2 text-center max-w-[320px] ${
          warn ? "border-destructive/60 shadow-destructive/20" : "border-primary/50 shadow-primary/30"
        }`}
      >
        <span
          className={`w-14 h-14 rounded-full flex items-center justify-center text-2xl font-extrabold shadow-lg ${
            warn ? "bg-destructive text-white shadow-destructive/30" : "bg-primary text-primary-foreground shadow-primary/30"
          }`}
        >
          {warn ? "⚠️" : "✓"}
        </span>
        <p className={`text-sm font-bold leading-snug ${warn ? "text-destructive" : "text-primary"}`}>{text}</p>
      </div>
    </div>
  );
}

/** "HH:MM" (24h) → "8:00 AM" — how the owner's reference app shows times. */
function fmt12(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || "");
  if (!m) return hhmm || "";
  const h = parseInt(m[1], 10);
  const ap = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m[2]} ${ap}`;
}

/**
 * Shared hook for every alarm toggle — v2.6 makes confirmation UNMISTAKABLE:
 *   ON  → permission gate (real dialog if needed) → LOUD jingle + vibration
 *        + green popup WITH the next ring time + a REAL Android notification
 *        with sound (audible even at low media volume — notification stream)
 *   OFF → soft chime + popup
 * If notifications are denied the popup turns RED and the system settings
 * open — no more silent failures.
 */
function useAlarmConfirm() {
  const { t } = useStore();
  const [msg, setMsg] = useState<string | null>(null);
  const [warn, setWarn] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = (on: boolean, label?: string, nextAt?: string) => {
    if (on) {
      void (async () => {
        const granted = await nativeEnsureNotifPermission();
        if (granted) {
          void nativeVibrate(40);
          try {
            playAlarmOn();
          } catch {
            /* audio not ready yet */
          }
          const name = label ? `${label} ` : "";
          const when = nextAt ? ` — ⏰ ${t("next")}: ${fmt12(nextAt)}` : "";
          setWarn(false);
          setMsg(`${name}${t("alarmOnToast")}${when}`);
          // the AUDIBLE native confirmation (notification stream, fixed id →
          // each confirmation replaces the previous one, the shade never fills)
          void nativeConfirmNotification(`✓ ${label || t("appName")}`, `${t("alarmOnToast")}${when}`);
        } else {
          void nativeVibrate(80);
          setWarn(true);
          setMsg(t("alarmPermWarn"));
          await nativeOpenNotificationSettings();
        }
      })();
    } else {
      void nativeVibrate(20);
      try {
        playChime();
      } catch {
        /* ignore */
      }
      setWarn(false);
      setMsg(t("alarmOffToast"));
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setMsg(null), 2600);
  };
  const node = msg ? <AlarmConfirm text={msg} warn={warn} /> : null;
  return { show, node };
}

// ---------- v2.6: live alarm truth — what the OS REALLY holds ----------
interface AlarmStatus {
  ok: boolean;
  permDenied: boolean;
  pending: number;
  expected: number;
  anyOn: boolean;
  nextAt: string;
  at: number;
}

function useAlarmStatus(): AlarmStatus | null {
  const [st, setSt] = useState<AlarmStatus | null>(() => {
    try {
      return JSON.parse(localStorage.getItem("oh_alarmstatus") || "null") as AlarmStatus | null;
    } catch {
      return null;
    }
  });
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent).detail as AlarmStatus | undefined;
      if (d) setSt(d);
    };
    window.addEventListener("oh:alarmstatus", on);
    return () => window.removeEventListener("oh:alarmstatus", on);
  }, []);
  return st;
}

/** Status chip for the meals + alarms screens: green = OS-verified active
 *  alarms, red = something is wrong (permission / nothing pending). */
function AlarmStatusBar() {
  const { t } = useStore();
  const st = useAlarmStatus();
  const [, force] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => force((n) => n + 1), 15000);
    return () => clearInterval(iv);
  }, []);
  if (!isNative()) return null;
  if (!st) return null;
  if (!st.anyOn) return null;
  if (st.permDenied) {
    return (
      <div className="mb-3 rounded-xl border border-destructive/40 bg-destructive/10 p-3 flex items-center gap-3">
        <span className="text-xl shrink-0">🔕</span>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-bold text-destructive">{t("alarmPermWarnShort")}</div>
        </div>
        <button
          type="button"
          onClick={async () => {
            const ok = await nativeRequestNotifications();
            if (!ok) await nativeOpenNotificationSettings();
          }}
          className="rounded-xl bg-destructive text-white text-xs font-bold px-3 py-2.5 min-h-[40px] shrink-0"
        >
          {t("alarmAllowBtn")}
        </button>
      </div>
    );
  }
  if (!st.ok || st.pending === 0) {
    return (
      <div className="mb-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 flex items-center gap-3">
        <span className="text-xl shrink-0">⚠️</span>
        <div className="text-xs font-semibold text-amber-600 dark:text-amber-400">{t("alarmNonePending")}</div>
      </div>
    );
  }
  const next = st.nextAt ? fmt12(new Date(st.nextAt).toTimeString().slice(0, 5)) : "";
  return (
    <div className="mb-3 rounded-xl border border-primary/30 bg-primary/10 px-3 py-2.5 flex items-center gap-2">
      <span className="text-base shrink-0">🔔</span>
      <div className="text-xs font-semibold text-primary">
        {st.pending} {t("alarmsActiveWord")}
        {next ? ` · ${t("next")}: ${next}` : ""}
      </div>
    </div>
  );
}

// ---------- Header ----------
function Header({ onSecret }: { onSecret?: () => void }) {
  const { state, today, t, openAuth } = useStore();
  const log = getLog(state, today);
  const holdRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // SECRET owner trigger: hold the greeting for 3s — invisible to normal users
  // (v5.1: exactly 3 seconds, per the owner's "৩ সেকেন্ড চেপে ধরলে" rule)
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
    }, 3000);
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
  // v3.0: the REGISTERED full name (first+last from signup) ALWAYS wins —
  // owner: "আনোয়ার হোসেন সাকিব দিলাম → সেই পুরো নামেই ডাকবে; অন্য ফোনে
  // তাহমিদ জামিল হলে সেই নামে ডাকবে" (per-account name, never the Gmail one).
  const name = (state.settings.name || state.account?.name || "").trim();
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
    </div>
  );
}

// ---------- v2.5 MOSQUE CARD (owner round-7: ক্যাপ/উপরের কার্ডটা রেফারেন্স
// অ্যাপের মতো সুন্দর মসজিদ কার্ড হবে — সেম স্টাইল) ----------
function MosqueBadge() {
  return (
    <svg viewBox="0 0 96 96" className="w-full h-full" role="img" aria-label="Mosque">
      <defs>
        <linearGradient id="oh-mcard-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2ea36f" />
          <stop offset="100%" stopColor="#0d5c40" />
        </linearGradient>
      </defs>
      <circle cx="48" cy="48" r="46" fill="url(#oh-mcard-sky)" />
      <circle cx="24" cy="26" r="2" fill="#ffe9a3" opacity="0.9" />
      <circle cx="72" cy="20" r="1.6" fill="#ffe9a3" opacity="0.8" />
      <circle cx="66" cy="34" r="1.4" fill="#fff" opacity="0.7" />
      <path d="M48 18 a9 9 0 1 0 0.01 0 z" fill="none" />
      <path d="M62 22 a10 10 0 1 1 -6 -18 a8 8 0 1 0 6 18 z" fill="#ffe9a3" />
      {/* minarets */}
      <rect x="16" y="46" width="7" height="34" rx="3" fill="#0b4d36" />
      <circle cx="19.5" cy="44" r="5" fill="#0b4d36" />
      <circle cx="19.5" cy="41" r="1.6" fill="#ffe9a3" />
      <rect x="73" y="46" width="7" height="34" rx="3" fill="#0b4d36" />
      <circle cx="76.5" cy="44" r="5" fill="#0b4d36" />
      <circle cx="76.5" cy="41" r="1.6" fill="#ffe9a3" />
      {/* hall */}
      <rect x="28" y="62" width="40" height="18" rx="3" fill="#0b4d36" />
      <path d="M45 80 v-10 a3.5 3.5 0 0 1 7 0 v10 z" fill="#063928" />
      {/* dome */}
      <path d="M48 32 c9 0 14 7 16 15 c-10 4 -22 4 -32 0 c2 -8 7 -15 16 -15 z" fill="#0b4d36" />
      <path d="M48 28 l2.2 5 h-4.4 z" fill="#ffe9a3" />
      <circle cx="48" cy="26.5" r="1.8" fill="#ffe9a3" />
    </svg>
  );
}

// ---------- Daily reminder (v2.5: reference-app style mosque card) ----------
function ReminderCard() {
  const { today, state, t } = useStore();
  const r = reminderOfTheDay(today);
  const bn = state.settings.language === "bn";
  return (
    <div
      className="mb-4 rounded-3xl border border-primary/25 overflow-hidden relative"
      style={{ background: "linear-gradient(135deg, rgba(46,163,111,0.16) 0%, rgba(13,92,64,0.10) 55%, transparent 100%)" }}
    >
      <div className="flex items-stretch gap-3 p-4">
        <div className="w-16 h-16 rounded-2xl bg-primary/15 border border-primary/30 shadow-inner shrink-0 overflow-hidden flex items-center justify-center">
          <MosqueBadge />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-bold text-primary uppercase tracking-[0.18em] flex items-center gap-1.5">
            <span className="inline-block w-4 h-[2px] rounded bg-primary/60" />
            {t("dailyReminderCard")}
          </div>
          <p className="text-[15px] font-semibold leading-snug mt-1.5">{bn ? r.bn : r.en}</p>
          <p className="text-[11px] text-muted-foreground mt-1.5">— {r.src}</p>
        </div>
      </div>
      {/* decorative bottom strip like the reference card */}
      <div className="h-1.5 w-full" style={{ background: "linear-gradient(90deg, var(--primary) 0%, color-mix(in srgb, var(--primary) 35%, transparent) 60%, transparent 100%)" }} />
    </div>
  );
}

// ---------- v2.5 FULL MONTH CALENDAR (owner round-7) ----------
// "শেষ ৭ দিন" আর থাকবে না — পুরো মাস জুড়ে তারিখ-ভিত্তিক ক্যালেন্ডার:
//   • প্রতিটা দিনের রিং = ওই দিনের পয়েন্ট (শূন্য হলে খালি)
//   • যেকোনো পুরোনো তারিখে চাপ দিলে ওই দিনে কী করা হয়েছিল / করা হয়নি
//     (not-done গুলোতে স্পষ্ট ✗ "করা হয়নি" লেখা থাকবে — owner-এর
//     "no habit" মার্কিং)
//   • রেকর্ড-হীন দিনে "এই দিনে কোনো রেকর্ড নেই" (রেফারেন্স অ্যাপের মতো)
function MonthCard() {
  const { state, today, t } = useStore();
  const [sel, setSel] = useState(today);
  const [view, setView] = useState(() => {
    const [y, m] = today.split("-").map(Number);
    return { y, m };
  });
  const cur = useMemo(() => {
    const [y, m] = today.split("-").map(Number);
    return { y, m };
  }, [today]);
  const isThisMonth = view.y === cur.y && view.m === cur.m;

  const monthLabel = useMemo(() => {
    try {
      return new Intl.DateTimeFormat(state.settings.language === "bn" ? "bn-BD" : "en-GB", {
        month: "long",
        year: "numeric",
      }).format(new Date(view.y, view.m - 1, 1));
    } catch {
      return `${view.y}-${String(view.m).padStart(2, "0")}`;
    }
  }, [view, state.settings.language]);

  // Saturday-first grid (Bangladesh week: শনি → শুক্র)
  const cells = useMemo(() => {
    const lead = (new Date(view.y, view.m - 1, 1).getDay() + 1) % 7;
    const days = new Date(view.y, view.m, 0).getDate();
    const out: (string | null)[] = Array(lead).fill(null);
    for (let d = 1; d <= days; d++) {
      out.push(`${view.y}-${String(view.m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
    }
    return out;
  }, [view]);

  const shiftMonth = (delta: number) => {
    setView((v) => {
      let m = v.m + delta;
      let y = v.y;
      if (m < 1) { m = 12; y -= 1; }
      if (m > 12) { m = 1; y += 1; }
      return { y, m };
    });
  };

  // (v2.8: the per-day weekday label was removed — the compact calendar no
  //  longer needs the `wd` helper)

  const weekdayLabels = useMemo(() => {
    // one fixed reference week starting on a Saturday (2026-10-24 = শনিবার)
    const fmt = (d: string) => {
      const [y, m, dd] = d.split("-").map(Number);
      return new Intl.DateTimeFormat(state.settings.language === "bn" ? "bn-BD" : "en-GB", { weekday: "narrow" }).format(
        new Date(y, m - 1, dd)
      );
    };
    return ["2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"].map(fmt);
  }, [state.settings.language]);

  // ---------- selected day detail ----------
  const selLog = state.logs[sel];
  const selPts = selLog ? dayPoints(selLog) : 0;
  const goal = state.settings.waterGoalMl;
  const doneRow = (ok: boolean) =>
    ok ? (
      <span className="text-primary font-bold shrink-0">✓</span>
    ) : (
      <span className="text-destructive font-bold shrink-0" title={t("notDone")}>✗</span>
    );
  const hmFmt = (mins: number) =>
    mins >= 60 ? `${Math.floor(mins / 60)} ${t("hour")} ${mins % 60} ${t("min")}` : `${mins} ${t("min")}`;

  const selDateLabel = useMemo(() => {
    try {
      const [y, m, d] = sel.split("-").map(Number);
      return new Intl.DateTimeFormat(state.settings.language === "bn" ? "bn-BD" : "en-GB", {
        weekday: "long",
        day: "numeric",
        month: "long",
      }).format(new Date(y, m - 1, d));
    } catch {
      return sel;
    }
  }, [sel, state.settings.language]);

  const customList = state.customHabits || [];

  return (
    <Card className="mb-4">
      <SectionTitle title={`🗓 ${t("monthView")}`} sub={t("monthViewSub")} />

      {/* month header: ‹ অক্টোবর ২০২৬ › */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <button
          type="button"
          onClick={() => shiftMonth(-1)}
          aria-label="prev month"
          className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center text-sm shrink-0 active:scale-95 transition-transform"
        >
          ‹
        </button>
        <div className="text-sm font-extrabold text-center flex-1 truncate">{monthLabel}</div>
        <button
          type="button"
          onClick={() => shiftMonth(1)}
          disabled={isThisMonth}
          aria-label="next month"
          className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center text-sm shrink-0 active:scale-95 transition-transform disabled:opacity-40"
        >
          ›
        </button>
      </div>

      {/* weekday row */}
      <div className="grid grid-cols-7 gap-[3px] mb-1">
        {weekdayLabels.map((w, i) => (
          <div key={i} className="text-center text-[8px] font-bold text-muted-foreground uppercase">
            {w}
          </div>
        ))}
      </div>

      {/* day grid — v2.8 COMPACT (owner: "ক্যালেন্ডারটা আরো ছোট করবা"): tiny
          rings, no per-day weekday label, tight gaps — the whole month now
          fits in a slim band instead of a long block */}
      <div className="grid grid-cols-7 gap-[3px]">
        {cells.map((d, i) => {
          if (!d) return <div key={`e${i}`} />;
          const future = d > today;
          const l = state.logs[d];
          const pts = l ? dayPoints(l) : 0;
          const pct = Math.max(0, Math.min(1, pts / MAX_POINTS));
          const isSel = d === sel;
          const isToday = d === today;
          const dayNum = Number(d.split("-")[2]);
          return (
            <button
              key={d}
              type="button"
              disabled={future}
              onClick={() => setSel(d)}
              className={`flex flex-col items-center justify-center rounded-lg py-0.5 transition-all ${
                future ? "opacity-30" : "active:scale-95"
              } ${isSel ? "bg-primary/15 ring-1 ring-primary/50" : ""}`}
            >
              <Ring pct={pct} size={25} stroke={2.5}>
                <span className={`text-[9px] font-bold leading-none ${isToday ? "text-primary" : ""}`}>{dayNum}</span>
              </Ring>
            </button>
          );
        })}
      </div>

      {sel !== today ? (
        <button
          type="button"
          onClick={() => {
            setSel(today);
            setView(cur);
          }}
          className="mt-2 text-[10px] font-semibold text-primary bg-primary/10 border border-primary/25 rounded-full px-2.5 py-1 min-h-[28px]"
        >
          ↩ {t("goToday")}
        </button>
      ) : null}

      {/* ---------- selected day's full record (v2.8 compact rows) ---------- */}
      <div className="mt-2.5 pt-2.5 border-t border-border">
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <div className="text-[13px] font-bold">{selDateLabel}</div>
          {selLog ? (
            <span className="text-[10px] font-bold text-primary bg-primary/10 border border-primary/25 rounded-full px-2 py-0.5 shrink-0">
              ⚡ {selPts} {t("pointShort")}
            </span>
          ) : null}
        </div>

        {!selLog ? (
          <div className="rounded-xl bg-secondary/60 border border-border px-3 py-4 text-center">
            <div className="text-2xl mb-1">🕰️</div>
            <p className="text-xs text-muted-foreground font-medium">{t("noRecordDay")}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {/* prayers */}
            <div className="flex items-center gap-2 rounded-lg bg-secondary/50 px-2.5 py-1.5">
              {doneRow(Object.values(selLog.prayers).filter(Boolean).length === 5)}
              <span className="text-xs font-medium flex-1">🕌 {t("prayers")}</span>
              <span className="text-[11px] font-bold">
                {Object.values(selLog.prayers).filter(Boolean).length}/5
              </span>
            </div>
            {/* water */}
            <div className="flex items-center gap-2 rounded-lg bg-secondary/50 px-2.5 py-1.5">
              {doneRow(selLog.waterMl >= goal)}
              <span className="text-xs font-medium flex-1">💧 {t("water")}</span>
              <span className="text-[11px] font-bold">
                {glassesOf(selLog.waterMl)} {t("glassUnit")} · {(selLog.waterMl / 1000).toFixed(2)}L
                {selLog.waterMl >= goal ? "" : ` · ${t("notDone")}`}
              </span>
            </div>
            {/* prayer water */}
            <div className="flex items-center gap-2 rounded-lg bg-secondary/50 px-2.5 py-1.5">
              {doneRow(selLog.prayerWater.filter(Boolean).length === 5)}
              <span className="text-xs font-medium flex-1">🥛 {t("prayerWater")}</span>
              <span className="text-[11px] font-bold">{selLog.prayerWater.filter(Boolean).length}/5</span>
            </div>
            {/* reels */}
            <div className="flex items-center gap-2 rounded-lg bg-secondary/50 px-2.5 py-1.5">
              {doneRow(selLog.reelsMin !== null && selLog.reelsMin === 0)}
              <span className="text-xs font-medium flex-1">🎬 {t("reels")}</span>
              <span className={`text-[11px] font-bold ${selLog.reelsMin ? "text-destructive" : "text-primary"}`}>
                {selLog.reelsMin === null ? t("notDone") : selLog.reelsMin === 0 ? `🔥 ${t("reelsFreeToday").split("!")[0]}` : hmFmt(selLog.reelsMin)}
              </span>
            </div>
            {/* dhikr */}
            <div className="flex items-center gap-2 rounded-lg bg-secondary/50 px-2.5 py-1.5">
              {doneRow(dhikrTotal(selLog) >= 100)}
              <span className="text-xs font-medium flex-1">📿 {t("dhikr")}</span>
              <span className="text-[11px] font-bold">{dhikrTotal(selLog)}</span>
            </div>
            {/* meditation / focus */}
            <div className="flex items-center gap-2 rounded-lg bg-secondary/50 px-2.5 py-1.5">
              {doneRow(selLog.meditationMin >= 10)}
              <span className="text-xs font-medium flex-1">🧘 {t("meditation")}</span>
              <span className="text-[11px] font-bold">{hmFmt(selLog.meditationMin)}</span>
            </div>
            <div className="flex items-center gap-2 rounded-lg bg-secondary/50 px-2.5 py-1.5">
              {doneRow(selLog.focusMin >= 25)}
              <span className="text-xs font-medium flex-1">🎯 {t("focus")}</span>
              <span className="text-[11px] font-bold">{hmFmt(selLog.focusMin)}</span>
            </div>
            {/* sleep */}
            <div className="flex items-center gap-2 rounded-lg bg-secondary/50 px-2.5 py-1.5">
              {doneRow(Boolean(selLog.sleepBed && selLog.sleepWake))}
              <span className="text-xs font-medium flex-1">😴 {t("sleep")}</span>
              <span className="text-[11px] font-bold">
                {selLog.sleepBed && selLog.sleepWake ? `${selLog.sleepBed} → ${selLog.sleepWake}` : t("notDone")}
              </span>
            </div>
            {/* custom habits — done AND not-done both listed (owner: no habit মার্কিং) */}
            {customList.map((h) => (
              <div key={h.id} className="flex items-center gap-2 rounded-lg bg-secondary/50 px-2.5 py-1.5">
                {doneRow(Boolean(selLog.customDone?.[h.id]))}
                <span className="text-xs font-medium flex-1 truncate">
                  {h.icon} {h.name}
                </span>
                <span className={`text-[11px] font-bold ${selLog.customDone?.[h.id] ? "text-primary" : "text-destructive"}`}>
                  {selLog.customDone?.[h.id] ? "✓" : t("notDone")}
                </span>
              </div>
            ))}
            {/* note */}
            {selLog.note.trim() ? (
              <div className="rounded-lg bg-secondary/50 px-2.5 py-1.5">
                <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">📝 {t("note")}</div>
                <p className="text-xs leading-relaxed whitespace-pre-wrap break-words">{selLog.note}</p>
              </div>
            ) : null}
          </div>
        )}
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
      // v2.5: adhan reminder TIMES auto-follow the fetched prayer times
      // (on/off switches stay user-controlled — auto only moves the clock)
      const st = state.settings;
      const adhanAlerts = { ...st.adhanAlerts };
      PRAYER_KEYS.forEach((pk) => {
        adhanAlerts[pk] = { ...adhanAlerts[pk], time: times2[pk] };
      });
      updateSettings({
        prayerTimes: times2,
        prayerTimesDate: today,
        location: { lat, lng, label },
        adhanAlerts,
        adhanAutoSet: true,
      });
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
  const glasses = glassesOf(log.waterMl);
  const goalGlasses = Math.max(1, Math.round(goal / 250));
  const leftGlasses = Math.max(0, goalGlasses - glasses);
  const glassButtons = useMemo(() => {
    const n = Math.round(goal / 250);
    return Math.min(n, 12);
  }, [goal]);

  const add = (ml: number) => {
    updateLog(today, (l) => ({ waterMl: Math.max(0, l.waterMl + ml) }));
    void nativeVibrate(ml > 0 ? 25 : 15);
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
      {/* v2.4: GLASSES first (owner: "আমি কত গ্লাস পানি খেয়েছি") — instant
          numbers: drank / remaining / percent, all update immediately */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="rounded-xl bg-primary/10 border border-primary/25 px-2 py-2 text-center">
          <div className="text-lg font-extrabold text-primary leading-none">{glasses}</div>
          <div className="text-[9px] text-muted-foreground mt-1">{t("glassesDone")}</div>
        </div>
        <div className="rounded-xl bg-secondary/60 border border-border px-2 py-2 text-center">
          <div className="text-lg font-extrabold leading-none">{leftGlasses}</div>
          <div className="text-[9px] text-muted-foreground mt-1">{t("glassesLeft")}</div>
        </div>
        <div className="rounded-xl bg-secondary/60 border border-border px-2 py-2 text-center">
          <div className="text-lg font-extrabold leading-none">{Math.round(pct * 100)}%</div>
          <div className="text-[9px] text-muted-foreground mt-1">{t("waterOf")} {goal}ml</div>
        </div>
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

// ---------- Reels/Shorts (detail page) — v2.4 FULL AUTO REDESIGN ----------
// Owner round-6 #8: NO manual minute input, NO plus/minus buttons, NO custom
// time entry — the phone measures everything itself via Usage Access and the
// card is a live dashboard. Shorts/Reels COUNT is REAL (each shorts-style
// activity resume = one video opened, straight from OS UsageEvents).
function ReelsCard() {
  const { state, updateLog, updateSettings, today, t } = useStore();
  const log = getLog(state, today);
  const reels = { ...emptyReels(), ...(log.reels || {}) };
  const total = Object.values(reels).reduce((a, b) => a + b, 0);
  const shorts = REEL_APPS.filter((a) => a.short).reduce((a, x) => a + reels[x.id], 0);
  const long = reels.ytlong + reels.mobiletv; // v5.8: মোবাইল টিভি/সিনেমাও লং ভিডিও
  const [nativeOn, setNativeOn] = useState(false);
  const [granted, setGranted] = useState<boolean | null>(null);
  const [counts, setCounts] = useState({ total: 0, yt: 0, fb: 0, ig: 0, tt: 0, other: 0 });
  const [autoBusy, setAutoBusy] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setNativeOn(isNative()), 0);
    return () => clearTimeout(id);
  }, []);

  // AUTO-TRACK: pull real numbers from the OS — no button press needed.
  const autoTrack = async (silent = true) => {
    if (!isNative()) return;
    if (!silent) setAutoBusy(true);
    const res: UsageResult | null = await nativeGetVideoUsage();
    if (!res) {
      if (!silent) setAutoBusy(false);
      return;
    }
    setGranted(res.granted);
    if (res.granted) {
      setCounts({
        total: res.shortsCount || 0,
        yt: res.shortsYt || 0,
        fb: res.shortsFb || 0,
        ig: res.shortsIg || 0,
        tt: res.shortsTt || 0,
        other: res.shortsOther || 0,
      });
      updateLog(today, (l) => {
        const next = {
          ...emptyReels(),
          ...(l.reels || {}),
          facebook: res.facebook,
          ytshorts: res.ytshorts,
          tiktok: res.tiktok,
          instagram: res.instagram,
          ytlong: res.ytlong,
          mobiletv: res.mobiletv,
          other: res.other,
        };
        const sum = Object.values(next).reduce((a, b) => a + b, 0);
        return { reels: next, reelsMin: sum };
      });
    }
    if (!silent) setAutoBusy(false);
  };

  // auto on open + every 5 min + when the user comes back to the app
  useEffect(() => {
    if (!nativeOn) return;
    const first = setTimeout(() => void autoTrack(true), 0);
    const iv = setInterval(() => void autoTrack(true), 5 * 60000);
    const onVis = () => {
      if (document.visibilityState === "visible") void autoTrack(true);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearTimeout(first);
      clearInterval(iv);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [nativeOn, today]);

  const weekWasted = useMemo(() => {
    let sum = 0;
    for (let i = 0; i < 7; i++) {
      const l = state.logs[addDays(today, -i)];
      if (l?.reelsMin) sum += l.reelsMin;
    }
    return sum;
  }, [state.logs, today]);

  // 2h 05min style display (owner: মিনিট ও ঘণ্টা হিসেবে)
  const hm = (mins: number) => (mins >= 60 ? `${Math.floor(mins / 60)} ${t("hour")} ${mins % 60} ${t("min")}` : `${mins} ${t("min")}`);

  const appRows = REEL_APPS.map((a) => ({ ...a, min: reels[a.id] })).sort((a, b) => b.min - a.min);
  const maxRow = Math.max(1, ...appRows.map((r) => r.min));
  // v5.8: per-app shorts count (owner: "শর্ট ভিডিও সে কয়টা দেখছে ওইটা দেখা যায়")
  const shortOf = { facebook: counts.fb, ytshorts: counts.yt, ytlong: 0, tiktok: counts.tt, instagram: counts.ig, mobiletv: 0, other: counts.other };

  return (
    <Card className="mb-4">
      <SectionTitle
        title={`🎬 ${t("reels")}`}
        sub={nativeOn ? t("autoTrackingOn") : t("autoTrackNote")}
        right={<span className="text-xs text-muted-foreground shrink-0">{t("reelsTotalToday")}: <b className={total > 0 ? "text-destructive" : "text-primary"}>{hm(total)}</b></span>}
      />

      {/* auto badge — the card measures itself */}
      {nativeOn && granted ? (
        <div className="rounded-xl bg-primary/10 border border-primary/25 px-3 py-2 text-[11px] font-semibold text-primary flex items-center gap-2 mb-3">
          <span className="w-2 h-2 rounded-full bg-primary animate-pulse shrink-0" />
          🤖 {t("autoTrackingOn")}
        </div>
      ) : null}

      {/* permission card — one tap to fix, then everything is automatic */}
      {nativeOn && granted === false ? (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 mb-3">
          <div className="text-sm font-bold text-amber-600 dark:text-amber-400 mb-1">📊 {t("usageNeedPerm")}</div>
          <p className="text-[11px] text-muted-foreground leading-relaxed mb-2">{t("usageAccessNote")}</p>
          <button
            type="button"
            onClick={async () => {
              await nativeOpenUsageAccess();
              // re-check when the user comes back
              setTimeout(() => void autoTrack(true), 1500);
            }}
            className="rounded-xl bg-primary text-primary-foreground text-xs font-semibold px-4 py-2.5 min-h-[40px]"
          >
            ⚙️ {t("permUsageOpen")}
          </button>
        </div>
      ) : null}

      {/* headline stats: shorts count + shorts minutes + long minutes — ALWAYS
          visible, even at 0 (owner: ০ দেখালেই মনে হচ্ছিল "ট্র্যাকারটা এখানে
          শো করতেছে না" — এখন সব সময় সব সংখ্যা দেখা যাবে) */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="rounded-xl bg-destructive/10 border border-destructive/25 px-2 py-2.5 text-center">
          <div className="text-lg font-extrabold text-destructive leading-none">{counts.total}</div>
          <div className="text-[9px] text-muted-foreground mt-1 leading-tight">{t("shortsWatched")}</div>
        </div>
        <div className="rounded-xl bg-amber-500/10 border border-amber-500/25 px-2 py-2.5 text-center">
          <div className="text-lg font-extrabold text-amber-600 dark:text-amber-400 leading-none">{shorts}</div>
          <div className="text-[9px] text-muted-foreground mt-1 leading-tight">{t("shortsVsLong")} ⚡ {t("min")}</div>
        </div>
        <div className="rounded-xl bg-sky-500/10 border border-sky-500/25 px-2 py-2.5 text-center">
          <div className="text-lg font-extrabold text-sky-600 dark:text-sky-400 leading-none">{long}</div>
          <div className="text-[9px] text-muted-foreground mt-1 leading-tight">{t("longWatched")} 📺 {t("min")}</div>
        </div>
      </div>
      <div className="h-3 rounded-full overflow-hidden flex bg-muted mb-1.5">
        <div className="h-full bg-destructive/80" style={{ width: `${total ? (shorts / total) * 100 : 0}%` }} />
        <div className="h-full bg-amber-500/70" style={{ width: `${total ? (long / total) * 100 : 0}%` }} />
      </div>
      {total === 0 && counts.total === 0 ? (
        <div className="rounded-xl bg-primary/10 text-primary text-sm font-medium px-3 py-2 my-2">{t("reelsFreeToday")}</div>
      ) : null}

      {/* per-app live minutes — ALL apps ALWAYS listed (owner: "যত প্রকার আরো
          আছে সব দেখা যাবে" — ০ মিনিট হলেও প্রতিটা অ্যাপ লিস্টে থাকবে, তাই বোঝা
          যাবে ট্র্যাকার ওই অ্যাপটাও মাপছে) — READ-ONLY */}
      <div className="text-xs font-semibold mt-2 mb-0.5">{t("reelsPerApp")}</div>
      <p className="text-[9px] text-muted-foreground mb-1.5">{t("reelsAppsCovered")}</p>
      <div className="flex flex-col gap-1.5">
        {appRows.map((r) => (
          <div key={r.id} className={`flex items-center gap-2 rounded-xl border p-2 ${r.min > 0 ? "border-destructive/30 bg-destructive/5" : "border-border bg-secondary/30 opacity-60"}`}>
            <span className="text-base w-6 text-center shrink-0">{r.icon}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-xs font-medium truncate">
                  {t(`reel_${r.id}`)}
                  {r.short && shortOf[r.id] ? <span className="text-[9px] font-semibold text-muted-foreground ml-1">· {shortOf[r.id]} {t("reelsShortsUnit")}</span> : null}
                </span>
                <span className={`text-[11px] font-bold shrink-0 ${r.min > 0 ? "text-destructive" : "text-muted-foreground"}`}>{hm(r.min)}</span>
              </div>
              <Bar pct={r.min / maxRow} className="h-1.5" />
            </div>
          </div>
        ))}
      </div>

      {/* daily limit — crossing it fires a REAL tracking notification */}
      <div className="rounded-xl border border-border bg-secondary/40 p-2.5 mt-3">
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

      {log.reelsMin !== null && log.reelsMin > 0 ? (
        <div className="rounded-xl bg-destructive/10 text-destructive text-sm font-medium px-3 py-2 mt-3">
          ⏳ {hm(log.reelsMin)} — {t("reelsWasted")}
        </div>
      ) : null}

      <p className="text-xs text-muted-foreground mt-3">
        {t("reelsWeek")}: <b className="text-destructive">{hm(weekWasted)}</b> · {t("reelsWarning")}
      </p>
      {!nativeOn ? <p className="text-[10px] text-muted-foreground mt-2 opacity-80">{t("autoTrackNote")}</p> : null}
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
    // round-5: dhikr counter = VIBRATION only (no sound — quiet dhikr)
    void nativeVibrate(nextVal === target ? 120 : 20);
    if (nextVal === target) {
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
  const [customOn, setCustomOn] = useState(false);
  const [customVal, setCustomVal] = useState("");
  const [left, setLeft] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const ivRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const doneRef = useRef(doneMsg);
  useEffect(() => {
    doneRef.current = doneMsg;
  }, [doneMsg]);

  // effective duration: custom minutes (1…360) when the ✏️ chip is selected
  const effPreset = customOn && customVal ? Math.max(1, Math.min(360, parseInt(customVal, 10) || 0)) : preset;

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

  const mm = left === null ? effPreset * 60 : left;
  const display = `${String(Math.floor(mm / 60)).padStart(2, "0")}:${String(mm % 60).padStart(2, "0")}`;
  const pct = left === null ? 0 : 1 - left / (effPreset * 60);

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
            {/* round-5: CUSTOM minutes — 1 min up to 6 hours, owner's request */}
            <Chip active={customOn && left === null} onClick={() => { if (!running) { setCustomOn(true); setLeft(null); } }}>
              ✏️ {t("timerCustom")}
            </Chip>
          </div>
          {customOn && !running ? (
            <div className="flex gap-2 items-center">
              <input
                inputMode="numeric"
                value={customVal}
                onChange={(e) => setCustomVal(e.target.value.replace(/\D/g, "").slice(0, 3))}
                placeholder={t("timerCustomHint")}
                aria-label={t("timerCustom")}
                className="flex-1 bg-muted rounded-xl px-3 py-2 text-sm border border-border outline-none focus:ring-1 focus:ring-ring min-h-[44px]"
              />
              <span className="text-xs text-muted-foreground shrink-0">{t("min")} · 1–360</span>
            </div>
          ) : null}
          <div className="flex gap-2">
            {!running ? (
              <button
                type="button"
                onClick={() => {
                  const mins = customOn ? Math.max(1, Math.min(360, parseInt(customVal, 10) || 0)) : preset;
                  if (customOn) setPreset(mins);
                  setElapsed(0);
                  setRunning(true);
                  setLeft(mins * 60);
                  playStart(); // round-5: clear “we've begun” sound
                  void nativeVibrate(40);
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

// ---------- Sleep ----------
function SleepCard() {
  const { state, updateLog, updateSettings, today, t } = useStore();
  const log = getLog(state, today);
  const [bed, setBed] = useState(log.sleepBed || "");
  const [wake, setWake] = useState(log.sleepWake || "");
  const [saved, setSaved] = useState(false);
  const s = state.settings;
  const confirm = useAlarmConfirm();

  const save = () => {
    updateLog(today, { sleepBed: bed || null, sleepWake: wake || null });
    setSaved(true);
    playAdd();
    void nativeVibrate(30);
    setTimeout(() => setSaved(false), 1600);
  };

  // sleep duration (wake before bed → slept past midnight → +24h)
  const dur = (() => {
    if (!bed || !wake) return null;
    const [bh, bm] = bed.split(":").map(Number);
    const [wh, wm] = wake.split(":").map(Number);
    let mins = wh * 60 + wm - (bh * 60 + bm);
    if (mins <= 0) mins += 24 * 60;
    return mins;
  })();

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
      {dur !== null ? (
        <div className="mt-3 rounded-xl bg-primary/10 border border-primary/25 px-3 py-2.5 text-sm font-bold text-primary text-center">
          🛏 {t("sleepDuration")}: {Math.floor(dur / 60)} {t("hour")} {dur % 60} {t("min")}
        </div>
      ) : null}
      {/* daily bedtime reminder — one alert each day (owner round-5) */}
      {confirm.node}
      <div className="mt-3 pt-3 border-t border-border flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">⏰ {t("sleepAlarm")}</div>
          <div className="text-xs text-muted-foreground">{t("sleepAlarmSub")}</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <input
            type="time"
            value={s.sleepAlarm?.time || "22:30"}
            onChange={(e) => updateSettings({ sleepAlarm: { on: true, time: e.target.value } })}
            className="bg-muted rounded-lg px-2 py-1.5 text-sm border border-border outline-none focus:ring-1 focus:ring-ring"
          />
          <button
            type="button"
            role="switch"
            aria-checked={Boolean(s.sleepAlarm?.on)}
            onClick={() => {
              confirm.show(!s.sleepAlarm?.on, t("sleepAlarm"), s.sleepAlarm?.time || "22:30");
              updateSettings({ sleepAlarm: { on: !s.sleepAlarm?.on, time: s.sleepAlarm?.time || "22:30" } });
            }}
            className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${s.sleepAlarm?.on ? "bg-primary" : "bg-muted border border-border"}`}
          >
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${s.sleepAlarm?.on ? "left-[22px]" : "left-0.5"}`} />
          </button>
        </div>
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
// v2.6: this is the screen the owner marked — every toggle now confirms
// audibly (loud jingle + REAL Android notification sound), shows the next
// ring time, and the OS-verified status bar proves the alarms are live.
function MealsCard() {
  const { state, updateSettings, t } = useStore();
  const meals = state.settings.mealAlarms;
  const confirm = useAlarmConfirm();
  const icons: Record<MealKey, string> = { breakfast: "🌅", lunch: "🍛", dinner: "🌙" };
  return (
    <Card className="mb-4">
      <SectionTitle title={`🍽 ${t("meals")}`} sub={t("mealsSub")} />
      {confirm.node}
      <AlarmStatusBar />
      <div className="flex flex-col gap-1">
        {MEAL_KEYS.map((mk) => (
          <div key={mk} className={`rounded-xl border p-3 ${meals[mk].on ? "border-primary/40 bg-primary/5" : "border-border bg-secondary/40"}`}>
            <div className="flex items-center gap-3">
              <span className="text-2xl">{icons[mk]}</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold">{t(`meal_${mk}`)}</div>
                <div className="text-xs text-muted-foreground">{meals[mk].on ? `🎵 ${t("mealsSub")} · ⏰ ${fmt12(meals[mk].time)}` : t("off")}</div>
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
                onClick={() => {
                  confirm.show(!meals[mk].on, t(`meal_${mk}`), meals[mk].time);
                  updateSettings({ mealAlarms: { ...meals, [mk]: { ...meals[mk], on: !meals[mk].on } } });
                }}
                className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${meals[mk].on ? "bg-primary" : "bg-muted border border-border"}`}
              >
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${meals[mk].on ? "left-[22px]" : "left-0.5"}`} />
              </button>
            </div>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-muted-foreground mt-2">🎵 {t("mealAlarmsCfgSub")} · 🎲 {t("mealMusicNote")}</p>
    </Card>
  );
}

// ---------- v2.8: AZAN SOUND PICKER (আজানের ধ্বনি) ----------
// Owner: "আরো নিজের থেকে অনেকগুলা মিউজিক অ্যাড করাও — যাতে এখানে সবকিছু থাকে"।
// 5 REAL adhan recitations are bundled in the APK (the owner's own + 4
// more). ▶ previews 8 seconds instantly; tapping a row picks it for every
// azan + Fajr alarm (native alarm channel + the in-app full-screen azan).
function AzanSoundCard() {
  const { state, updateSettings, t } = useStore();
  const chosen = state.settings.azanSound || "adhan.mp3";
  const [playing, setPlaying] = useState<string>("");

  const preview = (file: string) => {
    if (playing === file) {
      setPlaying("");
      return; // tap again = stop
    }
    setPlaying(file);
    void previewSound(file, 8);
    setTimeout(() => setPlaying((p) => (p === file ? "" : p)), 8200);
  };

  return (
    <Card className="mb-4 border-primary/25 bg-gradient-to-br from-primary/5 to-transparent">
      <SectionTitle title={`🎵 ${t("azanSoundTitle")}`} sub={t("azanSoundSub")} />
      <div className="flex flex-col gap-1.5">
        {AZAN_SOUNDS.map((a, i) => {
          const isOn = chosen === a.file;
          const label = state.settings.language === "bn" ? a.labelBn : a.labelEn;
          return (
            <div
              key={a.file}
              className={`flex items-center gap-2.5 rounded-xl border px-3 py-2 transition-all ${
                isOn ? "border-primary/45 bg-primary/10" : "border-border bg-secondary/40"
              }`}
            >
              <button
                type="button"
                onClick={() => updateSettings({ azanSound: a.file })}
                className="flex-1 flex items-center gap-2.5 min-w-0 text-left active:scale-[0.99] transition-transform"
              >
                <span
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-extrabold shrink-0 ${
                    isOn ? "bg-primary text-primary-foreground" : "bg-secondary border border-border"
                  }`}
                >
                  {isOn ? "✓" : i + 1}
                </span>
                <span className={`text-sm font-semibold truncate ${isOn ? "text-primary" : ""}`}>{label}</span>
              </button>
              <button
                type="button"
                aria-label={`${t("azanPreview")} ${label}`}
                onClick={() => preview(a.file)}
                className={`w-9 h-9 rounded-full flex items-center justify-center text-sm shrink-0 active:scale-90 transition-transform ${
                  playing === a.file ? "bg-primary text-primary-foreground animate-pulse" : "bg-secondary border border-border"
                }`}
              >
                {playing === a.file ? "⏹" : "▶"}
              </button>
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-muted-foreground mt-2 leading-relaxed">📢 {t("azanSoundNote")}</p>
    </Card>
  );
}

// ---------- All alarms & reminders (detail page) ----------
function AlarmsCard() {
  const { state, updateSettings, t } = useStore();
  const s = state.settings;
  const confirm = useAlarmConfirm();

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

  // v2.4 water alarm config with migration from the legacy hourly toggle
  const wa: WaterAlarmCfg = s.waterAlarm || { on: false, intervalMin: 60, from: "09:00", to: "22:00" };
  const setWa = (patch: Partial<WaterAlarmCfg>) => updateSettings({ waterAlarm: { ...wa, ...patch }, hourlyWater: false });
  const timesPreview = wa.on ? waterAlarmTimes(wa) : [];

  return (
    <div>
      {confirm.node}
      <AlarmStatusBar />
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
              onClick={() => {
                confirm.show(!s.fajrAlarm.on, t("fajrAlarm"), s.fajrAlarm.time);
                updateSettings({ fajrAlarm: { ...s.fajrAlarm, on: !s.fajrAlarm.on } });
              }}
              className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${s.fajrAlarm.on ? "bg-primary" : "bg-muted border border-border"}`}
            >
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${s.fajrAlarm.on ? "left-[22px]" : "left-0.5"}`} />
            </button>
          </div>
        </div>
      </Card>

      {/* ---------- v2.8: AZAN SOUND PICKER (owner: "নিজে থেকে অনেকগুলা
          মিউজিক অ্যাড করাও — যাতে এখানে সবকিছু থাকে") — 5 real recitations,
          tap ▶ to hear an 8-second preview, tap a row to choose ---------- */}
      <AzanSoundCard />

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
        {/* v2.5: নামাজের রিমাইন্ডার অটো সেট ব্যাজ (owner: এগুলো সব অটো থাকবে —
            লোকেশনের নামাজের সময় বদলালে রিমাইন্ডারের সময়ও নিজে নিজে আপডেট হয়) */}
        {s.adhanAutoSet !== false && s.prayerTimes ? (
          <div className="rounded-xl bg-primary/10 border border-primary/25 px-3 py-2 text-[11px] font-semibold text-primary mb-2">
            🤖 {t("adhanAutoBadge")}
          </div>
        ) : null}
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
                onClick={() => {
                  confirm.show(!s.adhanAlerts[k].on, t(`prayer_${k}`), s.adhanAlerts[k].time);
                  setAdhanTime(k, { on: !s.adhanAlerts[k].on });
                }}
                className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${s.adhanAlerts[k].on ? "bg-primary" : "bg-muted border border-border"}`}
              >
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${s.adhanAlerts[k].on ? "left-[22px]" : "left-0.5"}`} />
              </button>
            </div>
          </div>
        ))}
      </Card>

      {/* ---------- v5.6: নামাজের রিমাইন্ডার (owner: "মসজিদে যাওয়ার দরকার নাই —
          নামাজের সময় হইছে নামাজ পড়ো। এটাই দেও। সবার জন্যের ক্ষেত্রে মেয়ে ছেলে
          সবার ক্ষেত্রে সেম") — FIVE manual jamat times; at the set minute the
          exact alarm rings and the phone CALLS by name with the SAME line for
          everyone: "নামাজের সময় হইছে, নামাজ পড়ো" ---------- */}
      <Card className="mb-4 border-emerald-600/30 bg-gradient-to-br from-emerald-600/5 to-transparent">
        <SectionTitle title={`🕌 ${t("mosqueTitle")}`} sub={t("mosqueSub")} />
        <div className="rounded-xl bg-emerald-600/10 border border-emerald-600/25 px-3 py-2 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 mb-2">
          {t("mosqueNote")}
        </div>
        {PRAYER_KEYS.map((k) => {
          const mc = s.mosquePrayers?.[k] || { on: false, time: "05:30" };
          const setMc = (patch: Partial<{ on: boolean; time: string }>) => {
            const base = s.mosquePrayers || {
              fajr: { on: false, time: "05:30" },
              dhuhr: { on: false, time: "13:30" },
              asr: { on: false, time: "17:00" },
              maghrib: { on: false, time: "18:15" },
              isha: { on: false, time: "19:45" },
            };
            updateSettings({ mosquePrayers: { ...base, [k]: { ...mc, ...patch } } });
          };
          return (
            <div key={k} className="flex items-center justify-between gap-3 py-2 border-t border-border first:border-0">
              <span className="text-sm font-medium">🕌 {t(`prayer_${k}`)}</span>
              <div className="flex items-center gap-2">
                <input
                  type="time"
                  value={mc.time}
                  onChange={(e) => setMc({ time: e.target.value })}
                  className="bg-muted rounded-lg px-2 py-1.5 text-sm border border-border outline-none focus:ring-1 focus:ring-ring"
                />
                <button
                  type="button"
                  role="switch"
                  aria-checked={mc.on}
                  onClick={() => {
                    confirm.show(!mc.on, t(`prayer_${k}`), mc.time);
                    setMc({ on: !mc.on });
                  }}
                  className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${mc.on ? "bg-primary" : "bg-muted border border-border"}`}
                >
                  <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${mc.on ? "left-[22px]" : "left-0.5"}`} />
                </button>
              </div>
            </div>
          );
        })}
        <p className="text-[10px] text-muted-foreground mt-2 leading-relaxed">
          ⏰ {t("mosqueSub")}
        </p>
      </Card>

      {/* ---------- v2.4 WATER ALARM (owner round-6 #1: নির্দিষ্ট সময় পরপর
          পানির নোটিফিকেশন — My Habito স্টাইল, ✓ Drink / 💤 Later বাটনসহ) ---------- */}
      <Card className="mb-4 border-sky-500/30 bg-gradient-to-br from-sky-500/5 to-transparent">
        <SectionTitle title={t("waterAlarm")} sub={t("waterAlarmSub")} />
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium">💧 {t("waterAlarm")}</span>
          <button
            type="button"
            role="switch"
            aria-checked={wa.on}
            onClick={() => {
              confirm.show(!wa.on, t("water"), waterAlarmTimes(wa)[0]);
              setWa({ on: !wa.on });
            }}
            className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${wa.on ? "bg-primary" : "bg-muted border border-border"}`}
          >
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${wa.on ? "left-[22px]" : "left-0.5"}`} />
          </button>
        </div>
        {wa.on ? (
          <div className="mt-3 rounded-xl border border-border bg-secondary/40 p-2.5">
            <div className="text-xs font-semibold mb-2">⏱ {t("waterEvery")}</div>
            <div className="flex flex-wrap gap-1.5">
              {[30, 60, 120, 180].map((v) => (
                <Chip key={v} active={wa.intervalMin === v} onClick={() => setWa({ intervalMin: v })}>
                  {v < 60 ? `${v} মিনিট` : `${v / 60} ঘণ্টা`}
                </Chip>
              ))}
            </div>
            <div className="text-xs font-semibold mt-3 mb-1.5">🕐 {t("waterWindow")}</div>
            <div className="flex items-center gap-2">
              <input
                type="time"
                value={wa.from}
                onChange={(e) => setWa({ from: e.target.value })}
                className="bg-muted rounded-lg px-2 py-1.5 text-sm border border-border outline-none focus:ring-1 focus:ring-ring"
              />
              <span className="text-xs text-muted-foreground">→</span>
              <input
                type="time"
                value={wa.to}
                onChange={(e) => setWa({ to: e.target.value })}
                className="bg-muted rounded-lg px-2 py-1.5 text-sm border border-border outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            {timesPreview.length ? (
              <p className="text-[10px] text-muted-foreground mt-2 leading-relaxed">
                🔔 {timesPreview.length} {t("reminders")} · {timesPreview.slice(0, 4).join(", ")}
                {timesPreview.length > 4 ? "…" : ""}
              </p>
            ) : null}
            <p className="text-[10px] text-muted-foreground mt-1.5 leading-relaxed">
              🎵 water-alarm music · ✓ {t("waterDone")} / 💤 {t("waterSnooze")}
            </p>
          </div>
        ) : null}
      </Card>

      {/* ---------- v2.4: daily OUR HABIT REMINDER (owner: প্রতিদিন একটা করে
          অ্যালার্ট দিও) ---------- */}
      <Card className="mb-4 border-primary/25 bg-gradient-to-br from-primary/5 to-transparent">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold">{t("habitsReminder")}</div>
            <div className="text-xs text-muted-foreground">{t("habitsReminderSub")}</div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <input
              type="time"
              value={s.habitsAlarm?.time || "20:00"}
              onChange={(e) => updateSettings({ habitsAlarm: { on: true, time: e.target.value } })}
              className="bg-muted rounded-lg px-2 py-1.5 text-sm border border-border outline-none focus:ring-1 focus:ring-ring"
            />
            <button
              type="button"
              role="switch"
              aria-checked={Boolean(s.habitsAlarm?.on)}
              onClick={() => {
                confirm.show(!s.habitsAlarm?.on, t("habitsReminder"), s.habitsAlarm?.time || "20:00");
                updateSettings({ habitsAlarm: { on: !s.habitsAlarm?.on, time: s.habitsAlarm?.time || "20:00" } });
              }}
              className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${s.habitsAlarm?.on ? "bg-primary" : "bg-muted border border-border"}`}
            >
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${s.habitsAlarm?.on ? "left-[22px]" : "left-0.5"}`} />
            </button>
          </div>
        </div>
      </Card>

      <Card className="mb-4">
        <SectionTitle title={`🍽 ${t("meals")}`} sub={t("mealsSub")} />
        {MEAL_KEYS.map((mk) => (
          <div key={mk} className="flex items-center justify-between gap-3 py-2 border-t border-border first:border-0">
            <span className="text-sm font-medium">{t(`meal_${mk}`)}</span>
            <div className="flex items-center gap-2">
              <input
                type="time"
                value={s.mealAlarms[mk].time}
                onChange={(e) => updateSettings({ mealAlarms: { ...s.mealAlarms, [mk]: { ...s.mealAlarms[mk], time: e.target.value } } })}
                className="bg-muted rounded-lg px-2 py-1.5 text-sm border border-border outline-none focus:ring-1 focus:ring-ring"
              />
              <button
                type="button"
                role="switch"
                aria-checked={s.mealAlarms[mk].on}
                onClick={() => {
                  confirm.show(!s.mealAlarms[mk].on, t(`meal_${mk}`), s.mealAlarms[mk].time);
                  updateSettings({ mealAlarms: { ...s.mealAlarms, [mk]: { ...s.mealAlarms[mk], on: !s.mealAlarms[mk].on } } });
                }}
                className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${s.mealAlarms[mk].on ? "bg-primary" : "bg-muted border border-border"}`}
              >
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${s.mealAlarms[mk].on ? "left-[22px]" : "left-0.5"}`} />
              </button>
            </div>
          </div>
        ))}
        {/* v5.7: ১৫-মিনিট আগের প্রি-অ্যালার্ট পুরো বাদ (owner: "দুপুরের খাবারের
            সময় হইছে খাবার খাও — জাস্ট এটুকুই") — খাবারের সময়ে এখন শুধু নাম
            ধরে ডাক + সাইলেন্ট নোটিফিকেশন, বাজনা শুধুই আজানে */}
        <p className="text-[10px] text-muted-foreground mt-2 leading-relaxed">🔕 {t("quietRule")}</p>
      </Card>

      <Card className="mb-4">
        <SectionTitle title={`🔔 ${t("reminders")}`} />
        <div className="flex items-center justify-between gap-3 py-2">
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
              onClick={() => {
                confirm.show(!s.ayatNotif.on, t("dailyAyat"), s.ayatNotif.time);
                updateSettings({ ayatNotif: { ...s.ayatNotif, on: !s.ayatNotif.on } });
              }}
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

      {/* v2.5: the whole "নোটিফিকেশন অনুমতি / টেস্ট নোটিফিকেশন" card that used
          to sit here is REMOVED — owner round-7 marked it with a red X:
          "এই পুরা ফাংশন যেটা আছে নোটিফিকেশন ওটা টোটালি এখান থেকে সরাইয়া
          করে রিমুভ করে দিবা"। Notification permission now lives ONLY in
          Settings → Permissions. */}
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
  | "sleep"
  | "note"
  | "meals"
  | "alarms"
  | "newhabit";

const DETAIL_I18N: Record<DetailKey, string> = {
  prayers: "detailPrayers",
  water: "detailWater",
  reels: "detailReels",
  dhikr: "detailDhikr",
  meditation: "detailMeditation",
  focus: "detailFocus",
  sleep: "detailSleep",
  note: "detailNote",
  meals: "detailMeals",
  alarms: "detailAlarms",
  newhabit: "newHabit",
};

const TINT: Record<DetailKey, string> = {
  prayers: "from-emerald-500/15 to-transparent border-emerald-500/25",
  water: "from-sky-500/15 to-transparent border-sky-500/25",
  reels: "from-rose-500/15 to-transparent border-rose-500/25",
  dhikr: "from-violet-500/15 to-transparent border-violet-500/25",
  meditation: "from-teal-500/15 to-transparent border-teal-500/25",
  focus: "from-amber-500/15 to-transparent border-amber-500/25",
  sleep: "from-indigo-500/15 to-transparent border-indigo-500/25",
  note: "from-slate-500/15 to-transparent border-slate-500/25",
  meals: "from-orange-500/15 to-transparent border-orange-500/25",
  alarms: "from-red-500/15 to-transparent border-red-500/25",
  newhabit: "from-primary/15 to-transparent border-primary/25",
};

// ---------- v2.8: THIN ONE-PER-ROW HABIT LINES (owner round-10) ----------
// "নামাজটা একটা ছোট চিকন লম্বা সাইজের রাখবা... নামাজের নিচে পানি, পানির
// নিচে ঘুম — একটা লেআউটের ভিতরে, একটা সাইজে একটাই থাকবে, আরো চিকন হবে"
// Every habit is now ONE full-width slim bar: icon · name · live value ·
// thin progress line at the bottom · ✓/› — one below another, সুন্দর ও compact।
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
  const partial = typeof pct === "number" && pct > 0 && pct < 1;
  return (
    <button
      type="button"
      onClick={() => onOpen(titleKey)}
      className={`habit-row tile-in relative w-full text-left rounded-2xl border bg-gradient-to-r ${TINT[tint as DetailKey] || tint} px-3 flex items-center gap-3 min-h-[56px] overflow-hidden transition-transform active:scale-[0.98] ${done ? "tile-done" : ""}`}
    >
      <span className="tile-ico w-10 h-10 rounded-xl bg-background/80 dark:bg-background/60 border border-border flex items-center justify-center text-lg shadow-sm shrink-0">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-extrabold leading-tight">{t(DETAIL_I18N[titleKey as DetailKey])}</div>
        {sub ? <div className="text-[10px] text-muted-foreground truncate leading-tight mt-0.5">{sub}</div> : null}
      </div>
      <div className="text-right shrink-0 max-w-[42%]">
        <div className="text-[15px] font-extrabold leading-tight truncate">{value}</div>
        {partial ? <div className="text-[9px] text-muted-foreground">{Math.round((pct || 0) * 100)}%</div> : null}
      </div>
      {done ? (
        <span className="tile-check w-7 h-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[12px] font-bold shadow shrink-0">✓</span>
      ) : (
        <span className="text-muted-foreground/70 text-lg leading-none shrink-0">›</span>
      )}
      {/* thin progress line along the bottom of the bar */}
      {typeof pct === "number" ? (
        <span className="absolute bottom-0 left-0 h-[3px] bg-primary/80 rounded-r-full transition-all" style={{ width: `${Math.round(Math.min(1, pct) * 100)}%` }} />
      ) : null}
    </button>
  );
}

function HabitGrid({ onOpen }: { onOpen: (k: DetailKey) => void }) {
  const { state, today, t, toggleCustomHabit } = useStore();
  const log = getLog(state, today);
  const goal = state.settings.waterGoalMl;
  const prayersDone = PRAYER_KEYS.filter((k) => log.prayers[k]).length;
  const reelsTotal = log.reelsMin ?? 0;
  const nextPrayerKey = PRAYER_KEYS.find((k) => !log.prayers[k]);
  const customList = state.customHabits || [];

  const toggleCustom = (id: string, wasOn: boolean) => {
    toggleCustomHabit(today, id);
    void nativeVibrate(20);
    if (!wasOn) playTick(customList.findIndex((h) => h.id === id) + 1);
    else playMinus();
  };

  // v2.8 ORDER (owner: "নামাজের নিচে পানি, পানির নিচে ঘুম") — one slim line each
  return (
    <div className="flex flex-col gap-2 mb-4">
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
        value={`${glassesOf(log.waterMl)} ${t("glassUnit")}`}
        sub={`${(log.waterMl / 1000).toFixed(2)} / ${(goal / 1000).toFixed(1)} L · ${Math.round(Math.min(1, log.waterMl / goal) * 100)}%`}
        pct={Math.min(1, log.waterMl / goal)}
        tint="water"
        onOpen={onOpen}
      />
      <HabitTile
        icon="😴"
        titleKey="sleep"
        value={log.sleepBed && log.sleepWake ? `${log.sleepBed} → ${log.sleepWake}` : "—"}
        sub={t("sleepSub")}
        pct={log.sleepBed && log.sleepWake ? 1 : 0}
        tint="sleep"
        onOpen={onOpen}
      />
      <HabitTile
        icon="🎬"
        titleKey="reels"
        value={reelsTotal === 0 && log.reelsMin !== null ? `🔥 ${t("reelsFreeToday").split("!")[0]}` : `${reelsTotal} ${t("min")}`}
        sub={t("tapForDetails")}
        pct={reelsTotal === 0 && log.reelsMin !== null ? 1 : 0}
        tint="reels"
        onOpen={onOpen}
      />
      <HabitTile
        icon="📿"
        titleKey="dhikr"
        value={`${dhikrTotal(log)}`}
        sub={t("dhikrTodayTotal")}
        pct={dhikrTotal(log) >= 100 ? 1 : dhikrTotal(log) / 100}
        tint="dhikr"
        onOpen={onOpen}
      />
      <HabitTile
        icon="🧘"
        titleKey="meditation"
        value={`${log.meditationMin} ${t("min")}`}
        sub={t("meditationSub")}
        pct={log.meditationMin >= 10 ? 1 : log.meditationMin / 10}
        tint="meditation"
        onOpen={onOpen}
      />
      <HabitTile
        icon="🎯"
        titleKey="focus"
        value={`${log.focusMin} ${t("min")}`}
        sub={t("focusSub")}
        pct={log.focusMin >= 25 ? 1 : log.focusMin / 25}
        tint="focus"
        onOpen={onOpen}
      />

      {/* ---- v2.5: user-created habits (নতুন হ্যাবিট) — now slim rows,
          one tap = done today ---- */}
      {customList.map((h) => {
        const on = Boolean(log.customDone?.[h.id]);
        return (
          <button
            key={h.id}
            type="button"
            onClick={() => toggleCustom(h.id, on)}
            className={`habit-row tile-in relative w-full text-left rounded-2xl border px-3 flex items-center gap-3 min-h-[56px] overflow-hidden transition-transform active:scale-[0.98] ${
              on
                ? "border-primary/40 bg-gradient-to-r from-primary/25 to-transparent tile-done"
                : "border-slate-500/25 bg-gradient-to-r from-slate-500/15 to-transparent"
            }`}
          >
            <span className="tile-ico w-10 h-10 rounded-xl bg-background/80 dark:bg-background/60 border border-border flex items-center justify-center text-lg shadow-sm shrink-0">
              {h.icon}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-extrabold leading-tight truncate">{h.name}</div>
              <div className="text-[10px] text-muted-foreground truncate leading-tight mt-0.5">{on ? t("doneToday") : t("notDone")}</div>
            </div>
            {on ? (
              <span className="tile-check w-7 h-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[12px] font-bold shadow shrink-0">✓</span>
            ) : (
              <span className="w-7 h-7 rounded-full border-2 border-dashed border-muted-foreground/40 text-muted-foreground/60 flex items-center justify-center text-[12px] font-bold shrink-0">+</span>
            )}
          </button>
        );
      })}

      {/* ---- v2.5: ADD-NEW-HABIT (owner: ঘুমের পাশে Add অপশন) — slim row ---- */}
      <button
        type="button"
        onClick={() => onOpen("newhabit")}
        className="habit-row tile-in w-full rounded-2xl border-2 border-dashed border-primary/40 bg-primary/5 px-3 flex items-center gap-3 min-h-[56px] text-left transition-transform active:scale-[0.98]"
      >
        <span className="w-10 h-10 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center text-xl text-primary font-bold shadow-sm shrink-0">＋</span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-extrabold text-primary">{t("newHabit")}</div>
          <div className="text-[10px] text-muted-foreground truncate leading-tight mt-0.5">{t("newHabitSub")}</div>
        </div>
        <span className="text-primary/70 text-lg leading-none shrink-0">›</span>
      </button>
    </div>
  );
}

// ---------- Prayer water strip (round-5: 1 glass after EACH prayer, on HOME) ----------
function PrayerWaterStrip() {
  const { state, updateLog, today, t } = useStore();
  const log = getLog(state, today);
  const done = log.prayerWater.filter(Boolean).length;

  const toggle = (i: number) => {
    const wasOn = log.prayerWater[i];
    void nativeVibrate(20);
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
    <Card className="mb-4 border-primary/25 bg-gradient-to-br from-primary/5 to-transparent">
      <SectionTitle
        title={`🥛 ${t("prayerWater")}`}
        sub={t("prayerWaterSub")}
        right={
          <span className={`text-[11px] font-bold shrink-0 ${done === 5 ? "text-primary" : "text-muted-foreground"}`}>
            {done}/5
          </span>
        }
      />
      <div className="grid grid-cols-5 gap-2">
        {PRAYER_KEYS.map((k, i) => {
          const on = log.prayerWater[i];
          return (
            <button
              key={k}
              type="button"
              onClick={() => toggle(i)}
              className={`rounded-xl border p-2 flex flex-col items-center gap-1 min-h-[64px] active:scale-95 transition-all ${
                on ? "bg-primary text-primary-foreground border-primary shadow-md" : "bg-secondary border-transparent"
              }`}
            >
              <span className="text-base leading-none">{on ? "🥤" : "🥛"}</span>
              <span className="text-[10px] font-medium leading-none">{t(`prayer_${k}`)}</span>
              <span className="text-[9px] opacity-70 leading-none">{on ? "✓ 250ml" : "250ml"}</span>
            </button>
          );
        })}
      </div>
    </Card>
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
      {/* v5.7: নতুন সাউন্ড-নীতির নোটিশ — বাজনা শুধুই আজানে */}
      <p className="text-[10px] text-muted-foreground mt-2.5 leading-relaxed">🔕 {t("quietRule")}</p>
    </Card>
  );
}

// ---------- v2.5: NEW HABIT manager (নতুন হ্যাবিট detail page) ----------
const HABIT_ICONS = ["✅", "📖", "🏃", "🧹", "💪", "🧺", "📚", "🚶", "🧴", "🌾", "📞", "🛠"];

function NewHabitCard() {
  const { state, t, addCustomHabit, removeCustomHabit } = useStore();
  const [name, setName] = useState("");
  const [icon, setIcon] = useState(HABIT_ICONS[0]);
  const list = state.customHabits || [];

  const add = () => {
    if (!name.trim()) return;
    addCustomHabit(name, icon);
    setName("");
    setIcon(HABIT_ICONS[0]);
    playAdd();
    void nativeVibrate(25);
  };

  return (
    <div>
      <Card className="mb-4">
        <SectionTitle title={`➕ ${t("newHabit")}`} sub={t("newHabitSub")} />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
          maxLength={40}
          placeholder={t("newHabitName")}
          aria-label={t("newHabitName")}
          className="w-full bg-muted rounded-xl px-3 py-2.5 text-sm border border-border outline-none focus:ring-1 focus:ring-ring min-h-[46px]"
        />
        <div className="flex flex-wrap gap-1.5 mt-2.5">
          {HABIT_ICONS.map((ic) => (
            <button
              key={ic}
              type="button"
              onClick={() => setIcon(ic)}
              className={`w-10 h-10 rounded-xl border text-lg flex items-center justify-center transition-all active:scale-90 ${
                icon === ic ? "border-primary bg-primary/15 scale-105" : "border-border bg-secondary/50"
              }`}
            >
              {ic}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={add}
          disabled={!name.trim() || list.length >= 12}
          className="w-full mt-3 rounded-xl bg-primary text-primary-foreground text-sm font-bold py-3 min-h-[48px] disabled:opacity-40 active:scale-[0.98] transition-transform"
        >
          ＋ {t("newHabitAdd")}
        </button>
        {list.length >= 12 ? <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-2">⚠️ {t("newHabitMax")}</p> : null}
      </Card>

      {list.length ? (
        <Card className="mb-4">
          <SectionTitle title={`📋 ${t("newHabitList")}`} />
          <div className="flex flex-col gap-1.5">
            {list.map((h) => (
              <div key={h.id} className="flex items-center gap-2.5 rounded-xl bg-secondary/50 border border-border px-3 py-2.5">
                <span className="text-lg shrink-0">{h.icon}</span>
                <span className="text-sm font-medium flex-1 min-w-0 truncate">{h.name}</span>
                <button
                  type="button"
                  aria-label={`delete ${h.name}`}
                  onClick={() => {
                    if (!confirm(`"${h.name}" — ${t("habitDeleted")}?`)) return;
                    removeCustomHabit(h.id);
                    playMinus();
                    void nativeVibrate(20);
                  }}
                  className="w-9 h-9 rounded-lg bg-destructive/10 text-destructive flex items-center justify-center text-sm shrink-0 active:scale-90 transition-transform"
                >
                  🗑
                </button>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground mt-2.5 leading-relaxed">
            💡 হোমের গ্রিডে প্রতিটা হ্যাবিটের তালেই চাপ দিলে আজকের জন্য ✓ হয়ে যাবে।
          </p>
        </Card>
      ) : null}
    </div>
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
        {k === "sleep" ? <SleepCard /> : null}
        {k === "note" ? <TodayNoteCard /> : null}
        {k === "meals" ? <MealsCard /> : null}
        {k === "alarms" ? <AlarmsCard /> : null}
        {k === "newhabit" ? <NewHabitCard /> : null}
        {/* v2.8: ads on every page (owner: "প্রত্যেকটা পেজে যেখানে যেখানে
            অ্যাড বসানো যায়") — the detail pages carry a bottom banner too */}
        <div className="mt-3">
          <AdsBanner variant="b" />
        </div>
      </div>
    </div>,
    document.body
  );
}

export default function HomeTab({ onSecret }: { onSecret?: () => void }) {
  const { t } = useStore();
  const [detail, setDetail] = useState<DetailKey | null>(null);

  // Android back button — close the open detail page first (round-5)
  useEffect(() => {
    const onBack = () => {
      setDetail((cur) => {
        if (cur !== null) {
          (window as unknown as { __ohBackHandled?: boolean }).__ohBackHandled = true;
          return null;
        }
        return cur;
      });
    };
    window.addEventListener("oh:back", onBack);
    return () => window.removeEventListener("oh:back", onBack);
  }, []);

  return (
    <div>
      <Header onSecret={onSecret} />
      <AdsBanner variant="a" />
      <ReminderCard />
      <MonthCard />
      <div className="px-1 mb-2">
        <h2 className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">{t("todayCard")}</h2>
      </div>
      <HabitGrid onOpen={setDetail} />
      <AdsBanner variant="b" />
      <PrayerWaterStrip />
      <AlarmsLayer onOpen={setDetail} />
      {/* v2.8: ads on EVERY page (owner round-10 #1) — Home keeps its 3 slots
          (top compact / mid / bottom), Stats/Notes/Friends/Settings get 2 each,
          and every detail page gets a bottom banner */}
      <div className="mb-2">
        <AdsBanner variant="b" />
      </div>
      {detail ? <DetailPage k={detail} onClose={() => setDetail(null)} /> : null}
    </div>
  );
}
