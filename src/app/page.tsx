"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { StoreProvider, useStore, checkReminders, AlarmEvent } from "@/lib/store";
import { ServerCfgProvider, useServerCfg } from "@/lib/cfg";
import HomeTab from "@/components/HomeTab";
import NotesTab from "@/components/NotesTab";
import StatsTab from "@/components/StatsTab";
import FriendsTab from "@/components/FriendsTab";
import SettingsTab from "@/components/SettingsTab";
import AuthGate, { NameCapture } from "@/components/AuthGate";
import AlarmOverlay, { ActiveAlarm } from "@/components/AlarmOverlay";
import ChatScreen, { ChatHeadsUp, ChatWatchdog } from "@/components/ChatScreen";
import AdminPanel from "@/components/AdminPanel";
import PermissionSetupFlow, { PERM_FLOW_KEY } from "@/components/PermissionSetupFlow";
import { AtGlobalScripts } from "@/components/AdsBanner";
import { dayPoints, dhikrTotal, computeStreaks, dayCompletion } from "@/lib/logic";
import { getLog, todayStr } from "@/lib/types";
import { pushDay, ensureProfile, fbIsBanned, fbSignOut, DaySummary } from "@/lib/cloud";
import { APP_VERSION } from "@/lib/version";
import { alarmSpeakText, makeT } from "@/lib/i18n";
import { warmAudio, playChime } from "@/lib/audio";
import { isNative, nativeOpenUrl, nativeScheduleAlarms, nativeHandleBackButton, listenWaterActions, nativeSnoozeWater, nativeVibrate, getCurrentLocation, NativeAlarm, AlarmSyncResult, nativeScheduleExactAlarms, nativeCancelExactAlarms, nativeSetVoiceGender, nativeExactPending, nativeConsumeAlarmLaunch, ExactAlarmSpec } from "@/lib/native";
import { waterAlarmTimes, shiftTime, randomMealMusic, PRAYER_KEYS, dateAtHM, addDays } from "@/lib/types";

type Tab = "home" | "notes" | "stats" | "friends" | "settings";

const TABS: { id: Tab; icon: string; key: string }[] = [
  { id: "home", icon: "🏠", key: "nav_home" },
  { id: "notes", icon: "📝", key: "nav_notes" },
  { id: "stats", icon: "📊", key: "nav_stats" },
  { id: "friends", icon: "👥", key: "nav_friends" },
  { id: "settings", icon: "⚙️", key: "nav_settings" },
];

function BottomNav({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const { t } = useStore();
  return (
    <nav
      aria-label="Main navigation"
      className="bottom-nav fixed bottom-0 left-0 right-0 z-40 bg-card/95 backdrop-blur border-t border-border"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="max-w-md mx-auto grid grid-cols-5 px-1 pt-1">
        {TABS.map((x) => (
          <button
            key={x.id}
            type="button"
            onClick={() => setTab(x.id)}
            aria-current={tab === x.id ? "page" : undefined}
            className={`nav-item flex flex-col items-center gap-0.5 py-2 min-h-[56px] ${
              tab === x.id ? "nav-active text-primary" : "text-muted-foreground"
            }`}
          >
            <span className={`nav-ico text-xl leading-none transition-transform`}>{x.icon}</span>
            <span className="text-[10px] font-medium">{t(x.key)}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}

function Splash() {
  // v5.0 HYDRATION SAFETY: the server (and the exported static HTML) may be
  // produced with a DIFFERENT navigator locale than the user's device. This
  // splash is the only thing rendered during hydration, so it uses FIXED
  // brand literals (no t()) — the hydration output is identical on every
  // device, and the device language kicks in on the very next render.
  const { state } = useStore();
  void state;
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-gradient-to-b from-background to-primary/10">
      <div className="w-28 h-28 rounded-[30px] overflow-hidden shadow-2xl shadow-primary/30 border border-primary/20 logo-pop">
        { }
        <img src="/icon-512.png" alt="Our Habit" className="w-full h-full object-cover" />
      </div>
      <div className="text-2xl font-extrabold logo-fade">আওয়ার হ্যাবিট</div>
      <div className="text-xs text-muted-foreground logo-fade">Our Habit — একসাথে ভালো অভ্যাস</div>
    </div>
  );
}

// ---------- Auto-update banner ----------
function versionGt(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true;
    if ((pa[i] || 0) < (pb[i] || 0)) return false;
  }
  return false;
}

function UpdateBar() {
  const { cfg, loaded } = useServerCfg();
  const { t } = useStore();
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!loaded || dismissed) return null;
  const hasUpdate = Boolean(cfg.latestVersion) && versionGt(cfg.latestVersion, APP_VERSION);
  if (!hasUpdate) return null;
  const forced = cfg.forceUpdate;

  const doUpdate = async () => {
    setBusy(true);
    if (cfg.apkUrl) {
      // APK WebView blocks window.open — use the native ACTION_VIEW intent
      if (isNative()) await nativeOpenUrl(cfg.apkUrl);
      else window.open(cfg.apkUrl, "_blank");
      setBusy(false);
      return;
    }
    // Web/PWA phase: clear caches + reload = new version
    try {
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch {
      /* ignore */
    }
    setTimeout(() => window.location.reload(), 400);
  };

  return (
    <div className={`mb-4 rounded-2xl border p-3 flex items-center justify-between gap-2 ${forced ? "border-destructive/50 bg-destructive/10" : "border-primary/40 bg-primary/10"}`}>
      <div className="min-w-0">
        <div className="text-sm font-bold">🔄 {t("updateAvail")} <span className="text-[10px] font-normal opacity-70">v{cfg.latestVersion}</span></div>
        {cfg.changelog ? <div className="text-[10px] text-muted-foreground truncate">{cfg.changelog}</div> : null}
      </div>
      <div className="flex gap-1.5 shrink-0">
        <button type="button" onClick={() => void doUpdate()} disabled={busy} className="rounded-xl bg-primary text-primary-foreground text-xs font-semibold px-3 py-2 min-h-[36px]">
          {busy ? "..." : t("updateNow")}
        </button>
        {!forced ? (
          <button type="button" onClick={() => setDismissed(true)} className="rounded-xl bg-secondary text-xs px-2.5 py-2 min-h-[36px]">
            {t("updateLater")}
          </button>
        ) : null}
      </div>
    </div>
  );
}

// ---------- Forced update gate ----------
// Rendered ABOVE everything (auth screen included): when the owner flips
// force-update, nobody can use the app until they update. Runs every 5 min
// via ServerCfgProvider — panel change → every user's app blocked automatically.
function ForceGate() {
  const { cfg, loaded } = useServerCfg();
  const { t } = useStore();
  if (!loaded || !cfg.forceUpdate) return null;
  if (!(Boolean(cfg.latestVersion) && versionGt(cfg.latestVersion, APP_VERSION))) return null;
  return (
    <div className="fixed inset-0 z-[95] bg-background flex flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="w-20 h-20 rounded-3xl bg-primary/15 border border-primary/30 flex items-center justify-center text-4xl logo-float">🔄</div>
      <h2 className="text-xl font-extrabold">{t("updateAvail")} v{cfg.latestVersion}</h2>
      <p className="text-xs text-destructive font-semibold">{t("forceSub")}</p>
      <p className="text-xs text-muted-foreground max-w-[280px]">{cfg.changelog || t("forceHint")}</p>
      <button
        type="button"
        onClick={async () => {
          if (cfg.apkUrl) {
            if (isNative()) await nativeOpenUrl(cfg.apkUrl);
            else window.open(cfg.apkUrl, "_blank");
          } else window.location.reload();
        }}
        className="rounded-2xl bg-primary text-primary-foreground text-sm font-bold px-8 py-3.5 min-h-[52px] shadow-lg shadow-primary/25 active:scale-[0.98] transition-transform"
      >
        {t("updateNow")}
      </button>
      <p className="text-[10px] text-muted-foreground">{t("forceHint")}</p>
    </div>
  );
}

// ---------- Permission setup flow host (APK) ----------
// Shows the beautiful step-by-step flow ONCE on first open (real system
// dialogs: notifications → battery → usage access). Re-openable from
// Settings via the "oh:open-perm-flow" event.
function PermFlowHost() {
  const [open, setOpen] = useState(false);
  const bootedRef = useRef(false);

  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    const id = setTimeout(() => {
      if (!isNative()) return;
      try {
        if (localStorage.getItem(PERM_FLOW_KEY) !== "1") setOpen(true);
      } catch {
        setOpen(true);
      }
    }, 1200); // let the splash finish first
    const reopen = () => setOpen(true);
    window.addEventListener("oh:open-perm-flow", reopen);
    return () => {
      clearTimeout(id);
      window.removeEventListener("oh:open-perm-flow", reopen);
    };
  }, []);

  if (!open) return null;
  return <PermissionSetupFlow onFinished={() => setOpen(false)} />;
}

function Shell() {
  const { ready, state, t, today, fireNotif, setAccount, authOpen, updateLog, updateSettings } = useStore();
  const [tab, setTab] = useState<Tab>("home");
  const [alarm, setAlarm] = useState<ActiveAlarm | null>(null);
  const [adminOpen, setAdminOpen] = useState(false);
  // v2.6: bumped every time the app comes back to the foreground → the alarm
  // sync re-runs (cheap insurance against aggressive OEM battery killers that
  // wipe scheduled alarms while the app is backgrounded)
  const [resumeTick, setResumeTick] = useState(0);
  const stateRef = useRef(state);
  stateRef.current = state;
  const tRef = useRef(t);
  tRef.current = t;

  // warm audio on first user interaction (browser autoplay policy)
  useEffect(() => {
    const warm = () => warmAudio();
    window.addEventListener("pointerdown", warm, { once: true });
    return () => window.removeEventListener("pointerdown", warm);
  }, []);

  // SECRET owner access #2: open the app URL with #owner (e.g. bookmark).
  // Hash is cleared immediately so it never stays visible in the address bar.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.hash === "#owner") {
      history.replaceState(null, "", window.location.pathname + window.location.search);
      setAdminOpen(true);
    }
  }, []);

  // Android BACK button (owner round-5): never exit straight away.
  // 1) overlays listen for "oh:back" and close themselves (detail pages,
  //    admin panel, alarm overlay — they set __ohBackHandled)
  // 2) otherwise go to the Home tab
  // 3) only on Home with nothing left to close → exit the app
  const tabRef = useRef<Tab>(tab);
  tabRef.current = tab;
  const adminRef = useRef(adminOpen);
  adminRef.current = adminOpen;
  useEffect(() => {
    void nativeHandleBackButton({
      onBack: () => {
        if (adminRef.current) {
          setAdminOpen(false);
          (window as unknown as { __ohBackHandled?: boolean }).__ohBackHandled = true;
          return true;
        }
        if (tabRef.current !== "home") {
          setTab("home");
          (window as unknown as { __ohBackHandled?: boolean }).__ohBackHandled = true;
          return true;
        }
        return false;
      },
      onExit: () => {
        void (async () => {
          try {
            const { App: CapApp } = await import("@capacitor/app");
            await CapApp.exitApp();
          } catch {
            /* ignore */
          }
        })();
      },
    });
  }, []);

  const onAlarm = useCallback((ev: AlarmEvent) => {
    setAlarm((cur) => (cur ? cur : { ...ev }));
    if (!ev.sound) playChime();
  }, []);

  // reminder engine — check every 20s
  useEffect(() => {
    if (!ready) return;
    const tick = () => {
      const s = stateRef.current;
      checkReminders(s, today, fireNotif, tRef.current, onAlarm);
    };
    tick();
    const iv = setInterval(tick, 20000);
    return () => clearInterval(iv);
  }, [ready, today, fireNotif, onAlarm]);

  // NATIVE device alarms (APK): schedule today's remaining alarms with the OS
  // so they ring with a real sound even when the app is CLOSED — the 20s
  // engine above only works while the app is open. Re-synced on app open and
  // whenever any alarm setting changes.
  const alarmSig = ready
    ? JSON.stringify([
        state.settings.fajrAlarm,
        state.settings.adhanAlerts,
        state.settings.mealAlarms,
        state.settings.checkinTime,
        state.settings.ayatNotif,
        state.settings.sleepAlarm,
        state.settings.waterAlarm,
        state.settings.hourlyWater,
        state.settings.habitsAlarm,
        state.settings.mealPreAlert,
        state.settings.azanSound, // v2.8: azan recitation changes the alarm sound
        state.settings.name,     // v2.9: the name-call text follows the name
        state.settings.voiceLang, // v4.2: a ডাক-ভাষা change re-composes every call
        state.settings.language, // v5.2: the UI language drives every label now
      ])
    : "";

  // v2.6: publish the OS-verified alarm truth so the UI can show it —
  // "Nটি অ্যালার্ম সক্রিয় · পরবর্তী HH:MM" or a red permission warning.
  const publishAlarmStatus = (r: AlarmSyncResult | null, anyOn: boolean) => {
    const st = {
      ok: Boolean(r?.ok),
      permDenied: Boolean(r?.permDenied),
      pending: r?.pending ?? 0,
      expected: r?.expected ?? 0,
      anyOn,
      nextAt: r?.nextAt || "",
      at: Date.now(),
    };
    try {
      localStorage.setItem("oh_alarmstatus", JSON.stringify(st));
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new CustomEvent("oh:alarmstatus", { detail: st }));
  };

  // app resume → re-sync alarms (OEM killers, missed changes while backgrounded)
  useEffect(() => {
    if (!isNative()) return;
    let un: (() => void) | null = null;
    void (async () => {
      try {
        const { App: CapApp } = await import("@capacitor/app");
        const l = await CapApp.addListener("appStateChange", (s: { isActive: boolean }) => {
          if (s.isActive) setResumeTick((n) => n + 1);
        });
        un = () => void l.remove();
      } catch {
        /* plugin missing */
      }
    })();
    return () => {
      if (un) un();
    };
  }, []);

  useEffect(() => {
    if (!ready || !alarmSig || !isNative()) return;
    const s = stateRef.current;
    const now = Date.now();
    const azanSound = s.settings.azanSound || "adhan.mp3";
    // v2.9 NAMED ALERTS: the user's REGISTERED FULL NAME is spoken aloud by
    // AlarmSpeakService at ring time — "Anwar Hossen Sakib, পানি খাও…"
    // (owner's exact request). Adhan alarms NEVER speak —
    // "আজানের ক্ষেত্রে না ভাই, আজানটা আজানি দিবে".
    const myName = (s.settings.name || "").trim();
    // v4.2 (owner round-17): the VOICE language is BANGLA by default again —
    // the ORIGINAL system (owner: "আগের সিস্টেম — ঐরকম নাম ধরে ডাকবে কিন্তু
    // কথাটা বলবে বাংলায়। ম্যানুয়ালে সিলেক্ট না থাকলেও বাংলায়ই বলবে।").
    // v5.2 (owner round-22): bn (default) = the name AS ENTERED (English
    // letters stay English) + the Bangla sentence — "নামও বলবে। তোমার যে
    // ইংলিশ নামটা ঐটা বলবে… ঐটা টোটালি বাংলাতে বলবে" — no Bangla-script
    // substitution, no transliteration; the Bengali TTS voice reads the
    // English name Bengali-style and the words beside it stay the owner's
    // previous Bengali sentences. If the phone has no Bangla TTS voice the
    // native side auto-falls back to the English copy (speakEn) so the call
    // is never silent. en = the optional English call for those who pick it
    // in Settings → প্রোফাইল.
    const vlang: "en" | "bn" = s.settings.voiceLang === "en" ? "en" : "bn";
    const lang = vlang; // passed to the native TTS engine
    const tv = makeT(vlang); // spoken sentences in the VOICE language
    const te = makeT("en"); // English fallback — used by the native side when
    //                           the phone has NO Bangla TTS voice installed
    // v5.2: one helper composes every call — the name + the sentence
    // (i18n.alarmSpeakText); the name part is ALWAYS the name as entered.
    const spokenName = myName; // the name part of the call (as entered)
    const spokenNameEn = myName; // the English fallback name
    const named = (key: string) => alarmSpeakText(myName, key, vlang);
    const namedEn = (key: string) => alarmSpeakText(myName, key, "en");
    // v4.1: normalize whitespace in the composed meal sentences (the English
    // dictionary pieces carry their own leading space → "Lunch  time")
    const norm = (s: string) => (s ? s.replace(/\s+/g, " ").trim() : s);

    // ---------- v2.8/v2.9 EXACT ALARMS (azan / Fajr / meals / water / sleep) ----------
    const exact: ExactAlarmSpec[] = [];
    const days = [todayStr(), addDays(todayStr(), 1)];
    const pushExact = (
      key: string,
      time: string,
      title: string,
      body: string,
      sound: string,
      speak = "",
      speakEn = ""
    ) => {
      if (!/^\d{1,2}:\d{2}$/.test(time)) return;
      for (const d of days) {
        const at = dateAtHM(d, time);
        if (at > now + 30000) exact.push({ id: `${key}@${d}`, at, key, time, title, body, sound, speak, speakEn, lang });
      }
    };
    // azan + Fajr: the adhan itself, never a voice call (owner's rule)
    if (s.settings.fajrAlarm?.on)
      pushExact("fajr", s.settings.fajrAlarm.time, `🕌 ${t("fajrAlarm")}`, t("fajrAlarmMsg"), azanSound);
    (["fajr", "dhuhr", "asr", "maghrib", "isha"] as const).forEach((pk) => {
      const c = s.settings.adhanAlerts?.[pk];
      if (c?.on)
        pushExact(
          `adhan_${pk}`,
          c.time,
          `🕌 ${t("adhanAlerts")} — ${t(`prayer_${pk}`)}`,
          t("adhanMsg"),
          azanSound
        );
    });
    // v4.2 (owner round-17): নামাজের ডাক — the azan itself NEVER speaks
    // (owner's standing rule: "শুধু আজান — আজানের সময় আজান দিবে, ঐটা বাদে"),
    // but ~15 minutes AFTER each azan the voice calls the name and says
    // "নামাজ পড়ার সময় হয়েছে, নামাজে যান" — NOT long after the azan (owner:
    // "আজানের পর একটা ধরে নিবা… আজান দেওয়ার অনেকক্ষণ পর বলে না").
    // One call per prayer: if the Fajr alarm and the Fajr adhan-reminder are
    // both on, their +15 slots land close together → keep ONE (the real
    // prayer-time one wins; the other is silently skipped).
    const namazSlots: { time: string; pk: string }[] = [];
    (["fajr", "dhuhr", "asr", "maghrib", "isha"] as const).forEach((pk) => {
      const c = s.settings.adhanAlerts?.[pk];
      // v5.0 (owner round-19): মাগরিবের ডাক আজানের ~৩ মিনিট পরে — ১৫ মিনিটের
      // নিয়ম মাগরিবের ক্ষেত্রে প্রযোজ্য নয়; বাকি সব নামাজ ~১৫ মিনিট পরে।
      if (c?.on) namazSlots.push({ time: shiftTime(c.time, pk === "maghrib" ? 3 : 15), pk });
    });
    if (s.settings.fajrAlarm?.on) namazSlots.push({ time: shiftTime(s.settings.fajrAlarm.time, 15), pk: "fajr" });
    const namazTaken: number[] = [];
    for (const ns of namazSlots) {
      if (!/^\d{1,2}:\d{2}$/.test(ns.time)) continue;
      const [nh, nm] = ns.time.split(":").map(Number);
      const nmins = nh * 60 + nm;
      if (namazTaken.some((x) => Math.abs(x - nmins) < 20)) continue;
      namazTaken.push(nmins);
      pushExact(
        `namaz_${ns.pk}`,
        ns.time,
        `🕌 ${t("namazTitle")}`,
        t("namazBody"),
        "alarm.wav",
        named("speakNamaz"),
        namedEn("speakNamaz")
      );
    }
    // meals: the phone CALLS the user by name, then the owner's music rings
    (["breakfast", "lunch", "dinner"] as const).forEach((mk) => {
      const c = s.settings.mealAlarms?.[mk];
      if (c?.on) {
        // v2.5: RANDOM music — the owner's two tracks alternate. Re-synced on
        // every app open / settings change → real variety daily.
        // v4.1: the sentence follows the VOICE language (tv) and an English
        // copy (te) rides along as the fallback when the phone has no Bangla
        // TTS voice installed.
        pushExact(
          `meal_${mk}`,
          c.time,
          `🍽 ${t(`meal_${mk}`)}`,
          t("mealAlarmMsg"),
          randomMealMusic(),
          // v5.0 (owner round-19): the exact dictated sentence — “তোমার এখন খাবার
          // খাওয়ার সময় হয়েছে। সময়মতো খাওয়া-দাওয়া করে নাও।” One standalone
          // sentence (no breakfast/lunch/dinner prefix).
          named("speakMealFull"),
          namedEn("speakMealFull")
        );
        // v2.4: 15-min EARLY heads-up — spoken with the name
        if (s.settings.mealPreAlert !== false)
          pushExact(
            `mealpre_${mk}`,
            shiftTime(c.time, -15),
            `🍽 ${t(`meal_${mk}`)}`,
            t("mealPreMsg"),
            "alarm.wav",
            norm(spokenName ? `${spokenName}, ${tv(`meal_${mk}`)} ${tv("speakMealPre15")}` : ""),
            norm(spokenNameEn ? `${spokenNameEn}, ${te(`meal_${mk}`)} ${te("speakMealPre15")}` : "")
          );
      }
    });
    // sleep: spoken name-call + soft chime
    if (s.settings.sleepAlarm?.on)
      pushExact("sleep", s.settings.sleepAlarm.time, `😴 ${t("sleep")}`, t("sleepAlarmMsg"), "alarm.wav", named("speakSleep"), namedEn("speakSleep"));
    // v2.9 WATER — moved to the exact engine so it rings ON TIME and SPEAKS
    // the user's name first (owner: "পানি খাওয়ার রিমাইন্ডার হলে আমাকে ডাকবে")
    const wa = s.settings.waterAlarm?.on
      ? s.settings.waterAlarm
      : s.settings.hourlyWater
        ? { on: true, intervalMin: 60, from: "09:00", to: "22:00" }
        : null;
    if (wa?.on) {
      for (const wt of waterAlarmTimes(wa)) {
        pushExact(
          `water_${wt}`,
          wt,
          `💧 ${t("appName")}`,
          t("waterAlarmBody"),
          "wateralarm.mp3",
          named("speakWater"),
          namedEn("speakWater")
        );
      }
    }

    // ---------- REGULAR alarms (nudges / ayat / checkin) stay on
    // LocalNotifications — recurring with action buttons ----------
    const list: NativeAlarm[] = [];
    if (s.settings.ayatNotif?.on)
      list.push({ id: "ayat", time: s.settings.ayatNotif.time, title: t("ayatNotifTitle"), body: t("dailyReminder") });
    if (s.settings.checkinTime) list.push({ id: "checkin", time: s.settings.checkinTime, title: `🌙 ${t("appName")}`, body: t("checkinMsg") });
    // v2.4: daily Our Habit Reminder — now also SPEAKS the name (v2.9)
    if (s.settings.habitsAlarm?.on) {
      pushExact(
        "habits",
        s.settings.habitsAlarm.time,
        `🕌 ${t("appName")}`,
        t("habitsAlarmMsg"),
        "alarm.wav",
        named("speakHabits"),
        namedEn("speakHabits")
      );
      // v2.5 APP-OPEN NUDGES — real notifications even when the app is closed.
      list.push({ id: "nudge_morning", time: "10:00", title: `👋 ${t("appName")}`, body: t("nudgeBody") });
      list.push({ id: "nudge_afternoon", time: "16:00", title: `👋 ${t("appName")}`, body: t("nudgeBody") });
    }

    const anyOn = exact.length > 0 || list.length > 0;
    void (async () => {
      // the exact engine FIRST — it is the one that MUST ring on time
      if (exact.length) await nativeScheduleExactAlarms(exact);
      else await nativeCancelExactAlarms();
      // then the regular recurring ones (keep their Done/Snooze buttons)
      let localResult: AlarmSyncResult | null = null;
      if (list.length) {
        localResult = await nativeScheduleAlarms(list);
      } else {
        try {
          const { LocalNotifications } = await import("@capacitor/local-notifications");
          await LocalNotifications.cancelAll();
        } catch {
          /* ignore */
        }
      }
      // publish the COMBINED OS-verified truth for the UI chips
      const ex = await nativeExactPending();
      let pend = 0;
      try {
        const { LocalNotifications } = await import("@capacitor/local-notifications");
        const res = await LocalNotifications.getPending();
        pend = (res?.notifications || []).length;
      } catch {
        /* ignore */
      }
      publishAlarmStatus(
        {
          ok: true,
          expected: exact.length + list.length,
          pending: ex.count + pend,
          permDenied: Boolean(localResult?.permDenied),
          nextAt: ex.nextAt ? new Date(ex.nextAt).toISOString() : localResult?.nextAt || "",
        },
        anyOn
      );
    })();
  }, [ready, alarmSig, t, resumeTick]);

  // ---------- v4.0: push the user's GENDER to the alarm voice ----------
  // AlarmSpeakService reads it (ExactAlarmPlugin prefs) and tries to pick a
  // female voice for girls / a male voice for boys when the TTS engine
  // exposes gendered voices (plus a soft pitch shift as fallback).
  // Default = FEMALE (owner: "একটা বাংলা মেয়ের ভয়েস এড করবে") — male users
  // switch it to ছেলে কণ্ঠ from Settings → প্রোফাইল.
  useEffect(() => {
    if (!ready || !isNative()) return;
    const s = stateRef.current;
    if (!s?.account?.verified) return;
    void nativeSetVoiceGender(s.settings.gender === "male" ? "male" : "female");
  }, [ready, state.settings.gender, state.account?.verified]);

  // ---------- v2.8: the alarm that LAUNCHED the app (full-screen azan) ----------
  // When the exact alarm fires with the screen off/locked, Android launches
  // the app directly (full-screen intent). On open/resume we consume the
  // payload → the reference-style azan view + the real adhan audio plays.
  useEffect(() => {
    if (!ready || !isNative()) return;
    void (async () => {
      const payload = await nativeConsumeAlarmLaunch();
      if (!payload) return;
      setAlarm((cur) =>
        cur
          ? cur
          : {
              key: payload.key,
              title: payload.title,
              body: payload.body,
              sound: true,
              time: payload.time,
            }
      );
    })();
  }, [ready, resumeTick]);

  // v2.4: notification ACTION buttons (water "✓ Drink" / "💤 Later") —
  // tapping Drink logs a glass instantly; Later snoozes 15 minutes.
  useEffect(() => {
    if (!ready || !isNative()) return;
    void listenWaterActions((ev) => {
      if (ev.action === "waterDone") {
        updateLog(today, (l) => ({ waterMl: l.waterMl + 250 }));
        void nativeVibrate(30);
        fireNotif(`💧 ${t("appName")}`, t("waterLogged"));
      } else {
        void nativeSnoozeWater(15, `💧 ${t("appName")}`, t("waterAlarmBody"));
      }
    });
  }, [ready, today, fireNotif, t]);

  // snooze handling
  const dismissAlarm = useCallback(
    (snooze: boolean) => {
      if (snooze && alarm) {
        const ev = alarm;
        setTimeout(() => setAlarm({ ...ev }), 10 * 60 * 1000);
      }
      setAlarm(null);
    },
    [alarm]
  );

  // auto prayer times on first load — v2.5: ADHAN REMINDERS NOW AUTO-SET
  // (owner round-7: "নামাজের রিমাইন্ডার এগুলো অটো সেট করে দিবা, অটো। এটা
  // ওয়াক্ত হইলে যাতে সাথে সাথে অ্যালার্ম দেয়") — the FIRST successful fetch
  // turns all five reminders ON with the real location times; after that the
  // TIMES keep following the prayer times daily while on/off stay user-owned.
  useEffect(() => {
    if (!ready) return;
    const s = stateRef.current;
    if (s.settings.prayerTimes && s.settings.prayerTimesDate === today) return;
    (async () => {
      try {
        const { fetchPrayerTimes } = await import("@/lib/logic");
        const loc = s.settings.location;
        const lat = loc?.lat ?? 23.8103;
        const lng = loc?.lng ?? 90.4125;
        const times = await fetchPrayerTimes(lat, lng);
        if (times) {
          let firstTime = false;
          try {
            firstTime = localStorage.getItem("ourhabit_adhan_auto_done") !== "1";
          } catch {
            /* ignore */
          }
          const cur = stateRef.current.settings;
          const adhanAlerts = { ...cur.adhanAlerts };
          PRAYER_KEYS.forEach((pk) => {
            adhanAlerts[pk] = { ...adhanAlerts[pk], time: times[pk], on: firstTime ? true : adhanAlerts[pk].on };
          });
          updateSettings({
            prayerTimes: times,
            prayerTimesDate: today,
            adhanAlerts,
            adhanAutoSet: true,
          });
          try {
            localStorage.setItem("ourhabit_adhan_auto_done", "1");
          } catch {
            /* ignore */
          }
        }
      } catch {
        /* offline */
      }
    })();
  }, [ready, today, updateSettings]);

  // ---------- v2.8 WORLDWIDE LOCATION + AUTO TIMEZONE ----------
  // (owner: "USA, সুইডি, সিঙ্গাপুর, বাংলাদেশ, ইন্ডিয়া — যে কোনো দেশ থেকে
  // সবাই যাতে ব্যবহার করতে পারে; টাইমজোন সব অটো ডিটেক্ট")।
  //  • no location yet → try GPS; denied/unavailable → IP geolocation
  //  • device timezone CHANGED (user travelled abroad) → re-detect + refresh
  //    prayer times so they follow the new country automatically
  //  • throttled to once per 6h so it never spams
  useEffect(() => {
    if (!ready) return;
    const s = stateRef.current;
    let deviceTz = "";
    try {
      deviceTz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    } catch {
      deviceTz = "";
    }
    const storedTz = s.settings.location?.tz || "";
    const noLoc = !s.settings.location;
    const tzChanged = Boolean(storedTz) && Boolean(deviceTz) && storedTz !== deviceTz;
    if (!noLoc && !tzChanged) return;
    // throttle (unless we have NO location at all)
    try {
      const last = Number(localStorage.getItem("ourhabit_loctry") || 0);
      if (!noLoc && Date.now() - last < 6 * 3600 * 1000) return;
      localStorage.setItem("ourhabit_loctry", String(Date.now()));
    } catch {
      /* ignore */
    }
    const id = setTimeout(async () => {
      try {
        const { fetchPrayerTimes, fetchIpLocation } = await import("@/lib/logic");
        // 1) GPS
        let pos: { lat: number; lng: number } | null = await getCurrentLocation();
        let label = "My location";
        // 2) IP fallback — works even with GPS denied, anywhere on earth
        if (!pos) {
          const ip = await fetchIpLocation();
          if (ip) {
            pos = { lat: ip.lat, lng: ip.lng };
            label = ip.label;
          }
        }
        if (!pos) return; // offline — retried next open
        const times = await fetchPrayerTimes(pos.lat, pos.lng);
        updateSettings({
          location: { lat: pos.lat, lng: pos.lng, label, tz: deviceTz },
          ...(times ? { prayerTimes: times, prayerTimesDate: todayStr() } : {}),
        });
      } catch {
        /* offline — times refresh on next open */
      }
    }, 3000); // let the permission flow + splash finish first
    return () => clearTimeout(id);
  }, [ready, resumeTick, updateSettings]);

  // v3.2 CLOUD-BAN: the GitHub cloud admin panel (no server) sets
  // usersIndex/{uid}.banned — the app checks it on boot, every 5 minutes and
  // on every resume; a banned account is signed out and shown the ban message.
  // Read errors (offline) NEVER lock anyone out — only a confirmed true acts.
  useEffect(() => {
    if (!ready) return;
    const acc = state.account;
    if (!acc) return;
    let dead = false;
    const run = async () => {
      try {
        const banned = await fbIsBanned(acc.uid);
        if (banned && !dead) {
          await fbSignOut();
          if (!dead) {
            setAccount(null);
            try {
              window.alert(t("errBanned"));
            } catch {
              /* ignore */
            }
          }
        }
      } catch {
        /* offline — next tick */
      }
    };
    void run();
    const iv = setInterval(run, 5 * 60 * 1000);
    const onVis = () => {
      if (document.visibilityState === "visible") void run();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      dead = true;
      clearInterval(iv);
      document.removeEventListener("visibilitychange", onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, state.account?.uid]);

  // ensure the Firebase profile (invite code) exists once per signed-in user
  useEffect(() => {
    if (!ready) return;
    const acc = state.account;
    if (!acc || acc.inviteCode) return;
    let cancelled = false;
    (async () => {
      try {
        const p = await ensureProfile({
          uid: acc.uid,
          // v2.8: the REGISTERED name (settings.name) wins over the Google
          // account name — owner: "ওর জিমেইলের নামটা থাকবে না"
          name: stateRef.current.settings.name || acc.name,
          email: acc.email,
          emailVerified: acc.verified,
          provider: acc.provider,
        });
        if (p && !cancelled) {
          setAccount({
            uid: acc.uid,
            name: acc.name,
            email: acc.email,
            verified: acc.verified,
            provider: acc.provider,
            inviteCode: p.inviteCode,
          });
        }
      } catch {
        /* offline — retried next session */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, state.account?.uid, state.account?.inviteCode]);

  // push summary + FULL details to Firestore (every 60s) when signed in
  useEffect(() => {
    if (!ready) return;
    const acc = state.account;
    if (!acc || !acc.uid) return;
    const push = () => {
      const s = stateRef.current;
      const a = s.account;
      if (!a || !a.uid) return;
      const log = getLog(s, today);
      const st = computeStreaks(s, today);
      const summary: DaySummary = {
        date: today,
        points: dayPoints(log),
        prayers: log.prayers,
        prayerWater: log.prayerWater,
        waterMl: log.waterMl,
        waterGoalMl: s.settings.waterGoalMl,
        reels: log.reels,
        // v5.0: precise per-app seconds ride along in the day summary (the
        // status panel + friends view can show “৪৫ সেকেন্ড”-style precision).
        reelsSec: log.reelsSec,
        reelsMin: log.reelsMin ?? 0,
        dhikrTotal: dhikrTotal(log),
        meditationMin: log.meditationMin,
        focusMin: log.focusMin,
        mood: log.mood,
        sleepBed: log.sleepBed,
        sleepWake: log.sleepWake,
        completion: dayCompletion(log, s.settings.waterGoalMl),
        streak: st.current,
      };
      void pushDay(a.uid, summary).catch(() => undefined);
    };
    push();
    const iv = setInterval(push, 60000);
    return () => clearInterval(iv);
  }, [ready, state.account?.uid, today]);

  if (!ready) return <Splash />;

  return (
    <>
      {/* force update blocks EVERYTHING — even the login screen */}
      <ForceGate />
      <AuthGate forced={authOpen}>
        <div className="min-h-screen bg-background">
          <main className="max-w-md mx-auto px-4 pt-5 pb-24">
            <UpdateBar />
            <div key={tab} className="page-in">
              {tab === "home" ? <HomeTab onSecret={adminOpen ? undefined : () => setAdminOpen(true)} /> : null}
              {tab === "notes" ? <NotesTab /> : null}
              {tab === "stats" ? <StatsTab /> : null}
              {tab === "friends" ? <FriendsTab /> : null}
              {tab === "settings" ? <SettingsTab /> : null}
            </div>
          </main>
          <BottomNav tab={tab} setTab={setTab} />
          <AlarmOverlay alarm={alarm} onDismiss={dismissAlarm} />
          {/* v2.9: messenger-style chat (opens from Friends/Notes via
              openChat) + the background chat/reels watchdog engine */}
          <ChatScreen />
          {/* v4.3: messenger-style heads-up popup — "টুট" sound + banner
              when a message arrives while the app is open (tap → open chat) */}
          <ChatHeadsUp />
          <AtGlobalScripts />
          {adminOpen ? <AdminPanel onClose={() => setAdminOpen(false)} /> : null}
        </div>
      </AuthGate>
      <PermFlowHost />
      <NameCapture />
      <ChatWatchdog />
    </>
  );
}

export default function Page() {
  return (
    <StoreProvider>
      <ServerCfgProvider>
        <Shell />
      </ServerCfgProvider>
    </StoreProvider>
  );
}
