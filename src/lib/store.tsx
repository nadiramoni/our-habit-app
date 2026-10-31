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
  todayStr,
  uid,
} from "./types";
import { makeT, T } from "./i18n";
import { reminderOfTheDay } from "./logic";
import { isNative } from "./native";
import { waterAlarmTimes, WaterAlarmCfg } from "./types";

const KEY = "ourhabit_v1";

// ---------- v2.9: PER-ACCOUNT NAMES (owner: "নাদিরা মনি লগ আউট করে আগের ----------
// ---------- জিমেইলে ঢুকলেও নাম নাদিরা মনি-ই থাকে") -------------------------
// The old code kept ONE global settings.name/nameSet for the whole device —
// after switching accounts the PREVIOUS account's name stuck forever. Names
// now live in a per-UID map; switching accounts loads THAT account's
// registered name, and signing out clears the display name completely.
const NAMES_KEY = "oh_names";

interface NameEntry {
  name: string;
  nameSet?: boolean;
}

function loadNames(): Record<string, NameEntry> {
  try {
    return JSON.parse(localStorage.getItem(NAMES_KEY) || "{}") as Record<string, NameEntry>;
  } catch {
    return {};
  }
}

function persistName(uid: string, patch: Partial<NameEntry>): void {
  try {
    const names = loadNames();
    const cur = names[uid] || {};
    names[uid] = {
      name: patch.name !== undefined ? patch.name : cur.name || "",
      nameSet: patch.nameSet !== undefined ? patch.nameSet : cur.nameSet,
    };
    localStorage.setItem(NAMES_KEY, JSON.stringify(names));
  } catch {
    /* ignore */
  }
}

/**
 * v2.9: remember a name for a uid RIGHT NOW (no React state race) — used by
 * the sign-UP flow: updateSettings({name}) runs before the auth listener has
 * put the account into state, which would skip the per-uid persist above.
 */
export function rememberAccountName(uid: string, name: string, nameSet = true): void {
  if (!uid || !name) return;
  persistName(uid, { name, nameSet });
}

// ---------- v2.8 FIX: the reminder engine's fired-flag store ----------
// (was a useRef INSIDE the provider while checkReminders runs at MODULE
// scope → ReferenceError every 20s tick — the in-app reminder engine silently
// died. Now one module-level store, loaded once, used by both.)
const firedRef: { current: Record<string, boolean> } = { current: {} };
try {
  firedRef.current = JSON.parse(localStorage.getItem("ourhabit_fired") || "{}") as Record<string, boolean>;
} catch {
  firedRef.current = {};
}

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
  /** v2.9: sound = optional raw resource (APK) — plays on the alarm channel */
  fireNotif: (title: string, body: string, sound?: string) => void;
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
    // v5.5: per-key merge so installs saved before মসজিদে যাওয়ার জন্য get the
    // full default shape (all OFF, editable times)
    mosquePrayers: {
      ...base.mosquePrayers,
      ...(saved.mosquePrayers || {}),
      fajr: { ...base.mosquePrayers!.fajr, ...(saved.mosquePrayers?.fajr || {}) },
      dhuhr: { ...base.mosquePrayers!.dhuhr, ...(saved.mosquePrayers?.dhuhr || {}) },
      asr: { ...base.mosquePrayers!.asr, ...(saved.mosquePrayers?.asr || {}) },
      maghrib: { ...base.mosquePrayers!.maghrib, ...(saved.mosquePrayers?.maghrib || {}) },
      isha: { ...base.mosquePrayers!.isha, ...(saved.mosquePrayers?.isha || {}) },
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
        // v5.1 ONE-TIME DEFAULT-LANGUAGE FIX (owner: "আগে বাংলা+ইংরেজি
        // দুইটা অপশন ছিল, এখন সব ইংরেজি — ডিফল্ট বাংলা হবে")। Devices that
        // were switched to English by the old device-language-follow build
        // (never by an explicit choice) go back to বাংলা exactly once; anyone
        // who truly wants English re-selects it in Settings and it sticks.
        try {
          if (!localStorage.getItem("oh_lang_v51")) {
            localStorage.setItem("oh_lang_v51", "1");
            if (parsed.settings && parsed.settings.language === "en") {
              parsed.settings = { ...parsed.settings, language: "bn" };
            }
          }
        } catch {
          /* ignore */
        }
         
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
          // v2.9 ACCOUNT-SWITCH FIX: names are PER-ACCOUNT now. Signing out
          // clears the display name; signing in loads THIS account's own
          // registered name — the previous account's name can NEVER stick
          // (owner: "জিমেইল ঐটাই থাকে কিন্তু নামটা নাদিরা মনি থাকে").
          if (!acc) {
            return { ...s, account: null, settings: { ...s.settings, name: "", nameSet: false } };
          }
          // same account re-event: the registered name (settings.name) wins
          // — the Gmail display name only ever fills an EMPTY name
          if (s.account?.uid === acc.uid) {
            const name = s.settings.name || acc.name || "";
            return { ...s, account: acc, settings: { ...s.settings, name } };
          }
          // ACCOUNT SWITCHED → load THIS account's saved name (or the account
          // name as a prefill; NameCapture asks once, then it is saved per-uid)
          const entry = loadNames()[acc.uid];
          const name = entry?.name || acc.name || "";
          return {
            ...s,
            account: acc,
            settings: { ...s.settings, name, nameSet: Boolean(entry?.nameSet) },
          };
        });
      });
    });
    return () => {
      cancelled = true;
      if (un) un();
    };
  }, [ready]);

  // v2.8: the old effect here FORCIBLY copied account.name (the Gmail
  // display name) into settings.name on every auth event — that is exactly
  // the bug the owner reported ("ওর জিমেইলের নামটা থাকবে না"). It is now
  // REMOVED: settings.name (the registered full name) is the single source
  // of truth, and only fills FROM the account when still empty (see the
  // listener above).

  // theme
  useEffect(() => {
    if (!ready) return;
    document.documentElement.classList.toggle("dark", state.settings.theme === "dark");
  }, [state.settings.theme, ready]);

  const t = useMemo(() => makeT(state.settings.language), [state.settings.language]);

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setState((s) => {
      // v2.9: name/nameSet changes persist into the PER-ACCOUNT map — every
      // account keeps its own registered name on this device forever
      if ((patch.name !== undefined || patch.nameSet !== undefined) && s.account?.uid) {
        persistName(s.account.uid, patch as Partial<NameEntry>);
      }
      return { ...s, settings: { ...s.settings, ...patch } };
    });
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

  // v2.8: fired-flag store moved to module scope (see top) — the reminder
  // engine reads/writes it directly, no provider-local copy needed

  const fireNotif = useCallback((title: string, body: string, _sound?: string) => {
    // APK: the web Notification API is dead inside a WebView — route through
    // the native LocalNotifications plugin so EVERY reminder really appears
    // in the Android notification shade. v5.7: the notification goes to the
    // QUIET channel (oh_quiet — no sound, no vibration) — the ONLY loud thing
    // left is the azan (owner: "শুধুমাত্র আজানটাই অ্যালার্মে আসবে")। The
    // legacy `_sound` argument is intentionally ignored.
    try {
      if (isNative()) {
        void (async () => {
          try {
            const { LocalNotifications } = await import("@capacitor/local-notifications");
            const perm = await LocalNotifications.checkPermissions();
            if (perm.display !== "granted") return;
            const { ensureQuietLocalChannel } = await import("./native");
            await ensureQuietLocalChannel();
            await LocalNotifications.schedule({
              notifications: [{ id: Math.floor(Math.random() * 2000000000), title, body, channelId: "oh_quiet" }],
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

  // v2.8: fired flags are loaded once at module scope
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
  // v5.7: APK-তে নন-আজান রিমাইন্ডারের ডেলিভারি native exact ইঞ্জিনই করে
  // (সাইলেন্ট নোটিফিকেশন + নাম ধরে ডাক, ঠিক সময়ে) — এই ২০-সেকেন্ড ইঞ্জিন
  // নন-আজান রিমাইন্ডারের জন্য শুধু ওয়েবে চলবে, নাহলে ডাবল নোটিফিকেশন আসত।
  const native = isNative();

  // v5.7: ফুল-স্ক্রিন অ্যালার্ম-ওভারলে ("অ্যানিমেশন") এখন শুধুই আজানের —
  // owner: "ওই যে আজানের যে পপ আপ ওইটা একদম ঠিক থাকবে… এরপরেও যে অ্যাপের
  // একটা অ্যানিমেশন আসে… এগুলো কিছু যাতে না আসে"
  const alarm = (k: string, title: string, body: string, sound = true) => {
    fire(title, body);
    onAlarm({ key: k, title, body, sound });
    mark(k);
  };
  // v5.7: সাধারণ রিমাইন্ডার — শুধু নোটিফিকেশন, কোনো পপআপ/বাজনা নয়
  const remind = (k: string, title: string, body: string) => {
    if (native) {
      mark(k); // native exact ইঞ্জিন নিজেই ডেলিভার করছে (নাম ধরে ডাকসহ)
      return;
    }
    fire(title, body);
    mark(k);
  };

  if (s.fajrAlarm.on && hm === s.fajrAlarm.time && !already("fajr")) {
    alarm("fajr", t("appName"), t("fajrAlarmMsg"));
  }
  const prayerKeys = ["fajr", "dhuhr", "asr", "maghrib", "isha"] as const;
  for (const pk of prayerKeys) {
    const cfg = s.adhanAlerts[pk];
    if (!cfg?.on) continue;
    // v5.7: মাগরিবের +৩ মিনিট বাদ — আজান ওয়াক্তের ঠিক সময়েই বাজে (native
    // ইঞ্জিনের সাথে হুবহু এক)
    if (hm === cfg.time && !already(`adhan_${pk}`)) {
      alarm(`adhan_${pk}`, t("appName"), t("adhanMsg"));
    }
  }
  // ---------- v5.7: নামাজের রিমাইন্ডার — সাইলেন্ট নোটিফিকেশন + নাম ধরে ডাক,
  // পপআপ নয়। সবার জন্য একই কথা (owner: "ইয়াসিন, নামাজ পড়ার সময় হইছে নামাজ
  // পড়ো")। APK-তে native exact ইঞ্জিনই দেয়। ----------
  for (const pk of prayerKeys) {
    const mc = s.mosquePrayers?.[pk];
    if (mc?.on && hm === mc.time && !already(`mosque_${pk}`)) {
      remind(`mosque_${pk}`, `🕌 ${t("mosqueFire")} — ${t(`prayer_${pk}`)}`, t("mosqueBodyAll"));
    }
  }
  // ---------- খাবার — v5.7: "দুপুরের খাবারের সময় হইছে খাবার খাও। জাস্ট
  // এটুকুই" — ১৫ মিনিট আগের প্রি-অ্যালার্ট সম্পূর্ণ বাদ, মিউজিক-অ্যালার্ম বাদ ----------
  const mealBody = {
    breakfast: "mealRemindBreakfast",
    lunch: "mealRemindLunch",
    dinner: "mealRemindDinner",
  } as const;
  for (const mk of ["breakfast", "lunch", "dinner"] as const) {
    const cfg = s.mealAlarms?.[mk];
    if (cfg?.on && hm === cfg.time && !already(`meal_${mk}`)) {
      remind(`meal_${mk}`, t(`meal_${mk}`), t(mealBody[mk]));
    }
  }
  // daily "Our Habit Reminder" — v5.7: সাইলেন্ট নোটিফিকেশন + ডাক
  if (s.habitsAlarm?.on && hm === s.habitsAlarm.time && !already("habits")) {
    remind("habits", t("appName"), t("habitRemindBody"));
  }
  // v2.5 APP-OPEN NUDGES — ওয়েবে জেন্টল নাজ; APK-তে exact ইঞ্জিন নিজেই দেয়
  if (!native && s.habitsAlarm?.on && (hm === "10:00" || hm === "16:00") && !already(`nudge_${hm}`)) {
    fire(`👋 ${t("appName")}`, t("nudgeBody"));
    mark(`nudge_${hm}`);
  }
  if (hm === s.checkinTime && !already("checkin")) {
    remind("checkin", t("appName"), t("checkinRemindBody"));
  }
  if (s.ayatNotif.on && hm === s.ayatNotif.time && !already("ayat")) {
    remind("ayat", t("ayatNotifTitle"), reminderText(state, t));
  }
  // v2.4 WATER ALARM — interval-based। APK-তে exact ইঞ্জিন দেয় (v5.7:
  // সাইলেন্ট নোটিফিকেশন + নাম ধরে ডাক); ইঞ্জিন শুধু ওয়েবে, ডাবল এড়াতে।
  const wa: WaterAlarmCfg | null = s.waterAlarm?.on
    ? s.waterAlarm
    : s.hourlyWater
      ? { on: true, intervalMin: 60, from: "09:00", to: "22:00" }
      : null;
  if (wa?.on && !native) {
    if (waterAlarmTimes(wa).includes(hm) && !already(`water_${hm}`)) {
      const l = state.logs[today];
      if (!l || l.waterMl < s.waterGoalMl) {
        fire(t("appName"), t("waterAlarmBody"));
      }
      mark(`water_${hm}`);
    }
  }
  // Reels tracking warning (owner point 5) — ওয়েবে নোটিফিকেশন; APK-তে
  // ChatWatchdog + ব্যাকগ্রাউন্ড গার্ড নাম ধরে ডেকে জানায় (v5.7)।
  const rl = Number(s.reelsLimitMin ?? 0);
  if (rl > 0 && !native) {
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
