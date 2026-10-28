"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { StoreProvider, useStore, checkReminders, AlarmEvent } from "@/lib/store";
import { ServerCfgProvider, useServerCfg } from "@/lib/cfg";
import HomeTab from "@/components/HomeTab";
import NotesTab from "@/components/NotesTab";
import StatsTab from "@/components/StatsTab";
import FriendsTab from "@/components/FriendsTab";
import SettingsTab from "@/components/SettingsTab";
import AuthGate from "@/components/AuthGate";
import AlarmOverlay, { ActiveAlarm } from "@/components/AlarmOverlay";
import AdminPanel from "@/components/AdminPanel";
import PermissionSetupFlow, { PERM_FLOW_KEY } from "@/components/PermissionSetupFlow";
import { AtGlobalScripts } from "@/components/AdsBanner";
import { dayPoints, dhikrTotal, computeStreaks, dayCompletion } from "@/lib/logic";
import { getLog } from "@/lib/types";
import { pushDay, ensureProfile, DaySummary } from "@/lib/cloud";
import { APP_VERSION } from "@/lib/version";
import { warmAudio, playChime } from "@/lib/audio";
import { isNative, nativeOpenUrl, nativeScheduleAlarms, NativeAlarm } from "@/lib/native";

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
  const { t, state } = useStore();
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-gradient-to-b from-background to-primary/10">
      <div className="w-28 h-28 rounded-[30px] overflow-hidden shadow-2xl shadow-primary/30 border border-primary/20 logo-pop">
        { }
        <img src="/icon-512.png" alt="Our Habit" className="w-full h-full object-cover" />
      </div>
      <div className="text-2xl font-extrabold logo-fade">{t("appName")}</div>
      <div className="text-xs text-muted-foreground logo-fade">{t("tagline")}</div>
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
  const { ready, state, t, today, fireNotif, setAccount, authOpen } = useStore();
  const [tab, setTab] = useState<Tab>("home");
  const [alarm, setAlarm] = useState<ActiveAlarm | null>(null);
  const [adminOpen, setAdminOpen] = useState(false);
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
      ])
    : "";
  useEffect(() => {
    if (!ready || !alarmSig || !isNative()) return;
    const s = stateRef.current;
    const list: NativeAlarm[] = [];
    if (s.settings.fajrAlarm?.on)
      list.push({ id: "fajr", time: s.settings.fajrAlarm.time, title: `🕌 ${t("fajrAlarm")}`, body: t("fajrAlarmMsg") });
    (["fajr", "dhuhr", "asr", "maghrib", "isha"] as const).forEach((pk) => {
      const c = s.settings.adhanAlerts?.[pk];
      if (c?.on) list.push({ id: `adhan_${pk}`, time: c.time, title: `🕌 ${t("adhanAlerts")} — ${t(`prayer_${pk}`)}`, body: t("adhanMsg") });
    });
    (["breakfast", "lunch", "dinner"] as const).forEach((mk) => {
      const c = s.settings.mealAlarms?.[mk];
      if (c?.on) list.push({ id: `meal_${mk}`, time: c.time, title: `🍽 ${t(`meal_${mk}`)}`, body: t("mealAlarmMsg") });
    });
    if (s.settings.ayatNotif?.on)
      list.push({ id: "ayat", time: s.settings.ayatNotif.time, title: t("ayatNotifTitle"), body: t("dailyReminder") });
    if (s.settings.checkinTime) list.push({ id: "checkin", time: s.settings.checkinTime, title: `🌙 ${t("appName")}`, body: t("checkinMsg") });
    if (list.length) void nativeScheduleAlarms(list);
  }, [ready, alarmSig, t]);

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

  // auto prayer times on first load
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
          stateRef.current.settings.prayerTimes = times;
          stateRef.current.settings.prayerTimesDate = today;
        }
      } catch {
        /* offline */
      }
    })();
  }, [ready, today]);

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
          name: acc.name,
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
          <AtGlobalScripts />
          {adminOpen ? <AdminPanel onClose={() => setAdminOpen(false)} /> : null}
        </div>
      </AuthGate>
      <PermFlowHost />
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
