"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  Account,
  AppState,
  AppSettings,
  CustomHabit,
  DayLog,
  PersonalNote,
  defaultState,
  emptyLog,
  randomMealMusic,
  todayStr,
  uid,
} from "./types";
import { makeT, T } from "./i18n";
import { reminderOfTheDay } from "./logic";
import { isNative } from "./native";
import { waterAlarmTimes, WaterAlarmCfg } from "./types";

const KEY = "ourhabit_v1";

interface Ctx {
  state: AppState;
  ready: boolean;
  t: T;
  today: string;
  updateSettings: (patch: Partial<AppSettings>) => void;
  updateLog: (date: string, patch: Partial<DayLog> | ((l: DayLog) => Partial<DayLog>)) => void;
  addPersonalNote: (title: string, text: string) => void;
  deletePersonalNote: (id: string) => void;
  // v2.5: user-created habits (নতুন হ্যাবিট)
  addCustomHabit: (name: string, icon: string) => void;
  removeCustomHabit: (id: string) => void;
  toggleCustomHabit: (date: string, id: string) => void;
  setAccount: (acc: AppState["account"]) => void;
  resetAll: () => void;
  importState: (s: AppState) => void;
  // in-app login overlay (Friends/Notes/Settings open the auth screen)
  authOpen: boolean;
  openAuth: () => void;
  closeAuth: () => void;
  // notifications
  notifPerm: string;
  askNotifPerm: () => Promise<void>;
  fireNotif: (title: string, body: string) => void;
}

const StoreCtx = createContext<Ctx | null>(null);

function mergeSettings(saved: Partial<AppSettings> | undefined, base: AppSettings): AppSettings {
  if (!saved) return base;
  return {
    ...base,
    ...saved,
    fajrAlarm: { ...base.fajrAlarm, ...(saved.fajrAlarm || {}) },
    ayatNotif: { ...base.ayatNotif, ...(saved.ayatNotif || {}) },
    // v2.4 migration: the legacy hourly toggle becomes the new interval alarm
    waterAlarm: {
      ...base.waterAlarm!,
      ...(saved.waterAlarm || {}),
      on: saved.waterAlarm ? saved.waterAlarm.on : Boolean(saved.hourlyWater),
    },
    habitsAlarm: { ...base.habitsAlarm!, ...(saved.habitsAlarm || {}) },
    mealPreAlert: saved.mealPreAlert !== false,
    mealAlarms: {
      ...base.mealAlarms,
      ...(saved.mealAlarms || {}),
      breakfast: { ...base.mealAlarms.breakfast, ...(saved.mealAlarms?.breakfast || {}) },
      lunch: { ...base.mealAlarms.lunch, ...(saved.mealAlarms?.lunch || {}) },
      dinner: { ...base.mealAlarms.dinner, ...(saved.mealAlarms?.dinner || {}) },
    },
    adhanAlerts: {
      ...base.adhanAlerts,
      ...(saved.adhanAlerts || {}),
      fajr: { ...base.adhanAlerts.fajr, ...(saved.adhanAlerts?.fajr || {}) },
      dhuhr: { ...base.adhanAlerts.dhuhr, ...(saved.adhanAlerts?.dhuhr || {}) },
      asr: { ...base.adhanAlerts.asr, ...(saved.adhanAlerts?.asr || {}) },
      maghrib: { ...base.adhanAlerts.maghrib, ...(saved.adhanAlerts?.maghrib || {}) },
      isha: { ...base.adhanAlerts.isha, ...(saved.adhanAlerts?.isha || {}) },
    },
  };
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AppState>(defaultState);
  const [ready, setReady] = useState(false);
  const [notifPerm, setNotifPerm] = useState("default");
  const [authOpen, setAuthOpen] = useState(false);
  const today = todayStr();

  // hydrate
  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as AppState;
        const base = defaultState();
         
        setState({
          ...base,
          ...parsed,
          settings: mergeSettings(parsed.settings, base.settings),
          logs: parsed.logs || {},
          personalNotes: parsed.personalNotes || [],
          customHabits: Array.isArray(parsed.customHabits) ? parsed.customHabits : [],
          // legacy PIN accounts are retired — identity is Firebase now
          account:
            parsed.account && typeof (parsed.account as Partial<Account>).uid === "string"
              ? (parsed.account as Account)
              : null,
        });
      }
    } catch {
      /* ignore */
    }
    if (typeof Notification !== "undefined") setNotifPerm(Notification.permission);
    setReady(true);
  }, []);

  // persist
  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* ignore */
    }
  }, [state, ready]);

  // Firebase auth state → account (baked config; no server needed)
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    let un: (() => void) | null = null;
    import("./cloud").then(({ fbListenAuth }) => {
      if (cancelled) return;
      un = fbListenAuth((u) => {
        const acc: Account | null = u
          ? {
              uid: u.uid,
              name: u.name,
              email: u.email,
              verified: u.emailVerified || u.provider === "google",
              provider: u.provider,
            }
          : null;
        setState((s) => {
          // auto-name: the account's name IS the app name (owner request —
          // registration first/last name fills the home greeting automatically)
          const name = acc?.name ? acc.name : s.settings.name;
          return { ...s, account: acc, settings: { ...s.settings, name } };
        });
      });
    });
    return () => {
      cancelled = true;
      if (un) un();
    };
  }, [ready]);

  // auto-name: whatever identity exists (registration first/last name, Google
  // profile) IS the app name — no manual name entry anywhere (owner request)
  useEffect(() => {
    const n = state.account?.name;
    if (!n) return;
    setState((s) => (s.settings.name === n ? s : { ...s, settings: { ...s.settings, name: n } }));
  }, [state.account?.name]);

  // theme
  useEffect(() => {
    if (!ready) return;
    document.documentElement.classList.toggle("dark", state.settings.theme === "dark");
  }, [state.settings.theme, ready]);

  const t = useMemo(() => makeT(state.settings.language), [state.settings.language]);

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setState((s) => ({ ...s, settings: { ...s.settings, ...patch } }));
  }, []);

  const updateLog = useCallback((date: string, patch: Partial<DayLog> | ((l: DayLog) => Partial<DayLog>)) => {
    setState((s) => {
      const cur = s.logs[date] ?? emptyLog();
      const p = typeof patch === "function" ? patch(cur) : patch;
      return { ...s, logs: { ...s.logs, [date]: { ...cur, ...p } } };
    });
  }, []);

  const addPersonalNote = useCallback((title: string, text: string) => {
    setState((s) => {
      const note: PersonalNote = { id: uid(), title, text, date: todayStr() };
      return { ...s, personalNotes: [note, ...s.personalNotes] };
    });
  }, []);

  const deletePersonalNote = useCallback((id: string) => {
    setState((s) => ({ ...s, personalNotes: s.personalNotes.filter((n) => n.id !== id) }));
  }, []);

  // ---------- v2.5: user-created habits (নতুন হ্যাবিট) ----------
  const addCustomHabit = useCallback((name: string, icon: string) => {
    const clean = name.trim().slice(0, 40);
    if (!clean) return;
    setState((s) => {
      const list = s.customHabits || [];
      if (list.length >= 12) return s; // sane cap
      const h: CustomHabit = { id: uid(), name: clean, icon: icon || "✅" };
      return { ...s, customHabits: [...list, h] };
    });
  }, []);

  const removeCustomHabit = useCallback((id: string) => {
    setState((s) => ({ ...s, customHabits: (s.customHabits || []).filter((h) => h.id !== id) }));
  }, []);

  const toggleCustomHabit = useCallback((date: string, id: string) => {
    setState((s) => {
      const cur = s.logs[date] ?? emptyLog();
      const done = { ...(cur.customDone || {}) };
      done[id] = !done[id];
      return { ...s, logs: { ...s.logs, [date]: { ...cur, customDone: done } } };
    });
  }, []);

  const setAccount = useCallback((acc: AppState["account"]) => {
    setState((s) => ({ ...s, account: acc }));
  }, []);

  const openAuth = useCallback(() => setAuthOpen(true), []);
  const closeAuth = useCallback(() => setAuthOpen(false), []);

  const resetAll = useCallback(() => {
    const fresh = defaultState();
    setState(fresh);
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const importState = useCallback((s: AppState) => {
    const base = defaultState();
    setState({
      ...base,
      ...s,
      settings: mergeSettings(s.settings, base.settings),
      logs: s.logs || {},
      personalNotes: s.personalNotes || [],
      customHabits: Array.isArray(s.customHabits) ? s.customHabits : [],
    });
  }, []);

  const askNotifPerm = useCallback(async () => {
    if (typeof Notification === "undefined") return;
    try {
      const p = await Notification.requestPermission();
      setNotifPerm(p);
    } catch {
      /* ignore */
    }
  }, []);

  const firedRef = useRef<Record<string, boolean>>({});

  const fireNotif = useCallback((title: string, body: string, sound?: string) => {
    // APK: the web Notification API is dead inside a WebView — route through
    // the native LocalNotifications plugin so EVERY reminder (adhan, water,
    // meals, Reels limit) really appears in the Android notification shade.
    // sound = raw resource name; the plugin auto-creates a vibrating channel
    // per sound (round-5: water reminder got its own music loop).
    try {
      if (isNative()) {
        void (async () => {
          try {
            const { LocalNotifications } = await import("@capacitor/local-notifications");
            const perm = await LocalNotifications.checkPermissions();
            if (perm.display !== "granted") return;
            await LocalNotifications.schedule({
              notifications: [{ id: Math.floor(Math.random() * 2000000000), title, body, sound: sound || "alarm.wav" }],
            });
          } catch {
            /* ignore */
          }
        })();
        return;
      }
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        new Notification(title, { body, icon: "/icon.svg" });
      }
    } catch {
      /* ignore */
    }
  }, []);

  // load fired flags
  useEffect(() => {
    try {
      firedRef.current = JSON.parse(localStorage.getItem("ourhabit_fired") || "{}");
    } catch {
      firedRef.current = {};
    }
  }, []);

  const value: Ctx = {
    state,
    ready,
    t,
    today,
    updateSettings,
    updateLog,
    addPersonalNote,
    deletePersonalNote,
    addCustomHabit,
    removeCustomHabit,
    toggleCustomHabit,
    setAccount,
    resetAll,
    importState,
    authOpen,
    openAuth,
    closeAuth,
    notifPerm,
    askNotifPerm,
    fireNotif,
  };

  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}

export function useStore(): Ctx {
  const c = useContext(StoreCtx);
  if (!c) throw new Error("useStore outside provider");
  return c;
}

// ---------- Reminder engine (runs in page) ----------
export interface AlarmEvent {
  key: string; // unique id e.g. "meal_lunch"
  title: string;
  body: string;
  sound: boolean; // play music alarm vs simple chime
}

export function checkReminders(
  state: AppState,
  today: string,
  fire: (title: string, body: string, sound?: string) => void,
  t: T,
  onAlarm: (ev: AlarmEvent) => void
) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const d = new Date();
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const key = (k: string) => `${today}|${k}`;
  const mark = (k: string) => {
    firedRef.current[key(k)] = true;
    try {
      localStorage.setItem("ourhabit_fired", JSON.stringify(firedRef.current));
    } catch {
      /* ignore */
    }
  };
  const already = (k: string) => firedRef.current[key(k)];
  const s = state.settings;

  const alarm = (k: string, title: string, body: string, sound = true) => {
    fire(title, body);
    onAlarm({ key: k, title, body, sound });
    mark(k);
  };

  if (s.fajrAlarm.on && hm === s.fajrAlarm.time && !already("fajr")) {
    alarm("fajr", t("appName"), t("fajrAlarmMsg"));
  }
  const prayerKeys = ["fajr", "dhuhr", "asr", "maghrib", "isha"] as const;
  for (const pk of prayerKeys) {
    const cfg = s.adhanAlerts[pk];
    if (cfg?.on && hm === cfg.time && !already(`adhan_${pk}`)) {
      alarm(`adhan_${pk}`, t("appName"), t("adhanMsg"));
    }
  }
  // meal alarms — direct music alarm (breakfast / lunch / dinner)
  // v2.5: RANDOM music — the owner's two tracks alternate (একটার পর একটা)
  for (const mk of ["breakfast", "lunch", "dinner"] as const) {
    const cfg = s.mealAlarms?.[mk];
    if (cfg?.on && hm === cfg.time && !already(`meal_${mk}`)) {
      fire(t(`meal_${mk}`), t("mealAlarmMsg"), randomMealMusic());
      onAlarm({ key: `meal_${mk}`, title: t(`meal_${mk}`), body: t("mealAlarmMsg"), sound: true });
      mark(`meal_${mk}`);
    }
    // v2.4: a 15-minute EARLY heads-up (owner: নির্ধারিত সময়ের আগেই জানাবে).
    // The APK schedules this natively too — the engine only covers web/app-open.
    if (cfg?.on && s.mealPreAlert !== false) {
      const [h, m] = cfg.time.split(":").map(Number);
      const pre = ((h * 60 + m - 15) % 1440 + 1440) % 1440;
      const preHM = `${String(Math.floor(pre / 60)).padStart(2, "0")}:${String(pre % 60).padStart(2, "0")}`;
      if (hm === preHM && !already(`mealpre_${mk}`)) {
        fire(t(`meal_${mk}`), t("mealPreMsg"));
        mark(`mealpre_${mk}`);
      }
    }
  }
  // v2.4: daily "Our Habit Reminder" — one nudge a day (owner: প্রতিদিন একটা
  // করে অ্যালার্ট দিও)
  if (s.habitsAlarm?.on && hm === s.habitsAlarm.time && !already("habits")) {
    alarm("habits", t("appName"), t("habitsAlarmMsg"), false);
  }
  // v2.5 APP-OPEN NUDGES (owner round-7: "বাজার আগে মাঝে মাঝে অ্যাপে ঢুকার
  // রিমাইন্ডার দিতে হবে — কমপ্লিট করেছেন কিনা") — two gentle check-in nudges
  // a day while the Our Habit Reminder is ON. The APK schedules them natively
  // too (page.tsx), so they arrive even when the app is closed.
  if (s.habitsAlarm?.on && (hm === "10:00" || hm === "16:00") && !already(`nudge_${hm}`)) {
    fire(`👋 ${t("appName")}`, t("nudgeBody"));
    mark(`nudge_${hm}`);
  }
  if (hm === s.checkinTime && !already("checkin")) {
    alarm("checkin", t("appName"), t("checkinMsg"), false);
  }
  if (s.ayatNotif.on && hm === s.ayatNotif.time && !already("ayat")) {
    fire(t("ayatNotifTitle"), reminderText(state, t));
    mark("ayat");
  }
  // v2.4 WATER ALARM — interval-based (owner round-6: নির্দিষ্ট সময় পরপর
  // পানির নোটিফিকেশন, My Habito-স্টাইল). In the APK the OS delivers these
  // even when the app is closed (recurring exact alarms with Done/Snooze
  // buttons), so the engine fires only on the WEB to avoid doubles.
  const wa: WaterAlarmCfg | null = s.waterAlarm?.on
    ? s.waterAlarm
    : s.hourlyWater
      ? { on: true, intervalMin: 60, from: "09:00", to: "22:00" }
      : null;
  if (wa?.on && !isNative()) {
    if (waterAlarmTimes(wa).includes(hm) && !already(`water_${hm}`)) {
      const l = state.logs[today];
      if (!l || l.waterMl < s.waterGoalMl) {
        fire(t("appName"), t("waterAlarmBody"), "wateralarm.mp3"); // owner's music loop
      }
      mark(`water_${hm}`);
    }
  }
  // Reels tracking notification (owner point 5) — independent of every other
  // toggle: when today's tracked/watched Reels minutes cross the daily limit,
  // a real notification warns ONCE (tracking itself never needs notification
  // permission — Usage Access is a separate, independent permission).
  const rl = Number(s.reelsLimitMin ?? 0);
  if (rl > 0) {
    const l = state.logs[today];
    const mins = l?.reelsMin ?? 0;
    if (mins >= rl && !already("reelsLimit")) {
      fire(t("reelsLimitNotifTitle"), `${mins} ${t("min")} — ${t("reelsLimitNotifBody")}`);
      mark("reelsLimit");
    }
  }
}

function reminderText(state: AppState, t: T): string {
  try {
    const r = reminderOfTheDay(todayStr());
    return state.settings.language === "bn" ? `${r.bn} — ${r.src}` : `${r.en} — ${r.src}`;
  } catch {
    return t("dailyReminder");
  }
}
