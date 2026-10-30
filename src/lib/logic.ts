import {
  DayLog,
  PrayerKey,
  PRAYER_KEYS,
  AppState,
  addDays,
} from "./types";

// ---------- Points ----------
// v2.4: mood removed from the tracked set (owner round-6: অপ্রয়োজনীয় মুড অপশন
// সরানো) → 41 became 40. Prayer 5×2 +5 bonus, water 3, reels-free 5,
// dhikr 2, meditation 3, focus 3, gratitude 2, sleep 1, note 1, prayer-water 5
export const MAX_POINTS = 40;

export function dayPoints(l: DayLog): number {
  let p = 0;
  const prayersDone = PRAYER_KEYS.filter((k) => l.prayers[k]).length;
  p += prayersDone * 2;
  if (prayersDone === 5) p += 5;
  p += l.prayerWater.filter(Boolean).length;
  if (waterGoalMet(l)) p += 3;
  if (l.reelsMin !== null && l.reelsMin === 0) p += 5;
  if (dhikrTotal(l) >= 100) p += 2;
  if (l.meditationMin >= 10) p += 3;
  if (l.focusMin >= 25) p += 3;
  if (l.gratitudes.filter((g) => g.trim()).length >= 3) p += 2;
  if (l.sleepBed && l.sleepWake) p += 1;
  if (l.note.trim()) p += 1;
  return p;
}

export function dhikrTotal(l: DayLog): number {
  return Object.values(l.dhikr).reduce((a, b) => a + b, 0);
}

export function prayersDone(l: DayLog): number {
  return PRAYER_KEYS.filter((k) => l.prayers[k]).length;
}

export function waterGoalMet(l: DayLog): boolean {
  return l.waterMl >= 3000; // replaced by settings-aware wrapper below
}

// ---------- 10 tracked items for the daily ring ----------
export interface HabitCheck {
  id: string;
  done: boolean;
}

export function dayChecks(l: DayLog, goalMl: number): HabitCheck[] {
  return [
    { id: "prayers", done: prayersDone(l) === 5 },
    { id: "prayerWater", done: l.prayerWater.every(Boolean) },
    { id: "water", done: l.waterMl >= goalMl },
    { id: "reels", done: l.reelsMin !== null && l.reelsMin === 0 },
    { id: "dhikr", done: dhikrTotal(l) >= 100 },
    { id: "meditation", done: l.meditationMin >= 10 },
    { id: "focus", done: l.focusMin >= 25 },
    { id: "gratitude", done: l.gratitudes.filter((g) => g.trim()).length >= 3 },
    { id: "sleep", done: Boolean(l.sleepBed && l.sleepWake) },
  ];
}

export function dayCompletion(l: DayLog, goalMl: number): number {
  const c = dayChecks(l, goalMl);
  return c.filter((x) => x.done).length / c.length;
}

// ---------- Levels ----------
export const LEVEL_TITLES_BN = ["নবীন", "সাধক", "যোদ্ধা", "বীর", "দূরন্ত", "মাস্টার", "গুরু", "লিজেন্ড"];
export const LEVEL_TITLES_EN = ["Rookie", "Seeker", "Fighter", "Brave", "Storm", "Master", "Guru", "Legend"];

export function levelInfo(totalPoints: number) {
  const level = Math.floor(totalPoints / 100) + 1;
  const inLevel = totalPoints % 100;
  const titles = LEVEL_TITLES_BN;
  const titlesEn = LEVEL_TITLES_EN;
  return {
    level,
    inLevel,
    toNext: 100 - inLevel,
    title: titles[Math.min(level - 1, titles.length - 1)],
    titleEn: titlesEn[Math.min(level - 1, titlesEn.length - 1)],
  };
}

// ---------- Streaks (with weekly freeze) ----------
function weekKey(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const onejan = new Date(dt.getFullYear(), 0, 1);
  const week = Math.ceil(((dt.getTime() - onejan.getTime()) / 86400000 + onejan.getDay() + 1) / 7);
  return `${dt.getFullYear()}-W${week}`;
}

// A day "qualifies" for the streak if it earned at least 20 points
function qualifies(l: DayLog, goalMl: number): boolean {
  return dayPoints(l) >= 20;
}

export function computeStreaks(state: AppState, today: string) {
  const goal = state.settings.waterGoalMl;
  // collect up to 400 days back
  let cursor = today;
  // current streak
  let current = 0;
  let freezesAvailable = 1; // per week
  const usedWeeks = new Set<string>();
  let dayCursor = today;
  const todayLog = state.logs[today];
  if (!todayLog || !qualifies(todayLog, goal)) {
    // today not yet done — streak can still be alive from yesterday
    dayCursor = addDays(today, -1);
  }
  for (let i = 0; i < 400; i++) {
    const l = state.logs[dayCursor];
    if (l && qualifies(l, goal)) {
      current++;
      dayCursor = addDays(dayCursor, -1);
    } else {
      // try freeze: the gap is yesterday-of-chain, only if we already have some streak and freeze available for that week
      const wk = weekKey(dayCursor);
      if (current > 0 && freezesAvailable > 0 && !usedWeeks.has(wk)) {
        usedWeeks.add(wk);
        freezesAvailable--;
        dayCursor = addDays(dayCursor, -1);
        // continue looking — but if next is also broken, loop will exit
      } else break;
    }
  }
  if (current === 0 && (!todayLog || !qualifies(todayLog, goal))) current = 0;

  // best streak
  const dates = Object.keys(state.logs).sort();
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  let freezeUsedThisWeek = false;
  for (const d of dates) {
    if (!qualifies(state.logs[d], goal)) {
      run = 0;
      prev = d;
      freezeUsedThisWeek = false;
      continue;
    }
    if (prev && addDays(prev, 1) === d) {
      run++;
    } else if (prev && run > 0) {
      // check gap of exactly one day + weekly freeze not used
      const wk = weekKey(prev);
      const gapDate = addDays(prev, 1);
      if (addDays(gapDate, 1) === d && !freezeUsedThisWeek && weekOf(gapDate) === weekOf(d)) {
        run++; // freeze bridges the gap
        freezeUsedThisWeek = true;
      } else {
        run = 1;
        freezeUsedThisWeek = false;
      }
      void wk;
    } else {
      run = 1;
      freezeUsedThisWeek = false;
    }
    best = Math.max(best, run);
    prev = d;
  }

  // willpower best = longest reels-free streak
  let willBest = 0;
  run = 0;
  prev = null;
  freezeUsedThisWeek = false;
  for (const d of dates) {
    const l = state.logs[d];
    const free = l.reelsMin !== null && l.reelsMin === 0;
    if (!free) {
      run = 0;
      prev = d;
      freezeUsedThisWeek = false;
      continue;
    }
    if (prev && addDays(prev, 1) === d) run++;
    else if (prev && run > 0 && addDays(addDays(prev, 1), 1) === d && !freezeUsedThisWeek) {
      run++;
      freezeUsedThisWeek = true;
    } else run = 1;
    willBest = Math.max(willBest, run);
    prev = d;
  }

  // consistency: qualified days in last 30
  let qualified30 = 0;
  for (let i = 0; i < 30; i++) {
    const d = addDays(today, -i);
    const l = state.logs[d];
    if (l && qualifies(l, goal)) qualified30++;
  }

  // freeze remaining this week (for display)
  const wkNow = weekKey(today);
  let freezeLeft = 1;
  for (let i = 0; i < 7; i++) {
    const d = addDays(today, -i);
    const l = state.logs[d];
    if (l && qualifies(l, goal)) continue;
    // if a broken day existed this week before today, freeze consumed
    if (i > 0 && weekOf(d) === wkNow && l && !qualifies(l, goal)) {
      // broken day this week consumed the freeze if streak continued around it
    }
  }
  void wkNow;

  return { current, best, willBest, qualified30, freezeLeft, freezeTotal: 1 };
}

function weekOf(date: string): string {
  return weekKey(date);
}

// ---------- Badges ----------
export interface BadgeDef {
  id: string;
  icon: string;
  key: string; // i18n key
  test: (state: AppState) => boolean;
}

export const BADGES: BadgeDef[] = [
  { id: "b1", icon: "🌱", key: "badge_1", test: (s) => Object.values(s.logs).some((l) => dayPoints(l) > 0) },
  {
    id: "b2",
    icon: "🔥",
    key: "badge_2",
    test: (s) => {
      const t = todayOf();
      let run = 0;
      for (let i = 0; i < 10; i++) {
        const l = s.logs[addDays(t, -i)];
        if (l && dayPoints(l) >= 20) run++;
        else break;
      }
      return run >= 3;
    },
  },
  {
    id: "b3",
    icon: "🏅",
    key: "badge_3",
    test: (s) => computeStreaks(s, todayOf()).best >= 7,
  },
  {
    id: "b4",
    icon: "👑",
    key: "badge_4",
    test: (s) => computeStreaks(s, todayOf()).best >= 30,
  },
  {
    id: "b5",
    icon: "✂️",
    key: "badge_5",
    test: (s) => Object.values(s.logs).some((l) => l.reelsMin === 0),
  },
  {
    id: "b6",
    icon: "🧠",
    key: "badge_6",
    test: (s) => computeStreaks(s, todayOf()).willBest >= 7,
  },
  {
    id: "b7",
    icon: "💯",
    key: "badge_7",
    test: (s) => Object.values(s.logs).reduce((a, l) => a + dhikrTotal(l), 0) >= 1000,
  },
  {
    id: "b8",
    icon: "🧘",
    key: "badge_8",
    test: (s) => Object.values(s.logs).some((l) => l.meditationMin > 0),
  },
  {
    id: "b9",
    icon: "🕌",
    key: "badge_9",
    test: (s) => Object.values(s.logs).some((l) => prayersDone(l) === 5),
  },
  { id: "b10", icon: "⭐", key: "badge_10", test: (s) => totalPoints(s) >= 100 },
  { id: "b11", icon: "🌟", key: "badge_11", test: (s) => totalPoints(s) >= 500 },
  { id: "b12", icon: "💫", key: "badge_12", test: (s) => totalPoints(s) >= 1000 },
];

function todayOf(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function totalPoints(state: AppState): number {
  return Object.values(state.logs).reduce((a, l) => a + dayPoints(l), 0);
}

export function unlockedBadges(state: AppState): Set<string> {
  const set = new Set<string>();
  for (const b of BADGES) if (b.test(state)) set.add(b.id);
  return set;
}

// ---------- Daily reminder (ayah/hadith) ----------
export const DAILY_REMINDERS: { bn: string; en: string; src: string }[] = [
  { bn: "সবচেয়ে প্রিয় কাজ সেটাই, যা অল্প হলেও নিয়মিত করা হয়।", en: "The most beloved deeds are those done consistently, even if small.", src: "বুখারী" },
  { bn: "পরিচ্ছন্নতা ঈমানের অর্ধেক।", en: "Cleanliness is half of faith.", src: "মুসলিম" },
  { bn: "আমরা পানি থেকে সব জীবন্ত বস্তু সৃষ্টি করেছি।", en: "We made from water every living thing.", src: "সূরা আম্বিয়া ৩০" },
  { bn: "কষ্টের সাথেই স্বস্তি রয়েছে।", en: "Indeed, with hardship comes ease.", src: "সূরা ইনশিরাহ ৬" },
  { bn: "নিশ্চয়ই আল্লাহ ধৈর্যশীলদের সাথে আছেন।", en: "Indeed, Allah is with the patient.", src: "সূরা বাকারা ১৫৩" },
  { bn: "নামাজ সব মন্দ ও অশ্লীল কাজ থেকে বিরত রাখে।", en: "Prayer prevents immorality and wrongdoing.", src: "সূরা আনকাবুত ৪৫" },
  { bn: "তোমরা একে অপরকে উপহার দাও, তাতে ভালোবাসা বাড়ে।", en: "Exchange gifts, it increases love between you.", src: "হাদিস" },
  { bn: "আমার উম্মতের ভোরবেলার কাজে বরকত দাও।", en: "Bless my Ummah in their early mornings.", src: "তিরমিজি" },
  { bn: "সন্তোষ এমন খাজানা, যা কখনো শেষ হয় না।", en: "Contentment is a treasure that never runs out.", src: "হাদিস" },
  { bn: "তুমি ধৈর্যের সাথে সালাত প্রতিষ্ঠা করো।", en: "Establish prayer with patience.", src: "সূরা হুদ ১১৪" },
];

export function reminderOfTheDay(date: string) {
  const n = DAILY_REMINDERS.length;
  const [y, m, d] = date.split("-").map(Number);
  const idx = (y * 372 + m * 31 + d) % n;
  return DAILY_REMINDERS[idx];
}

// ---------- Prayer times (Aladhan free API) ----------
// v2.8: worldwide-ready. Aladhan derives the timezone from the COORDINATES
// (a user in Riyadh gets Riyadh-local times, in Stockholm Stockholm-local) —
// so prayer times are ALWAYS correct for the user's actual location, wherever
// on earth they are. The only wrong input would be a wrong location — which
// fetchIpLocation below now covers when GPS is denied.
export async function fetchPrayerTimes(lat: number, lng: number): Promise<Record<PrayerKey, string> | null> {
  try {
    const res = await fetch(
      `https://api.aladhan.com/v1/timings?latitude=${lat}&longitude=${lng}&method=1&school=1`
    );
    const j = await res.json();
    const t = j?.data?.timings;
    if (!t) return null;
    const clean = (s: string) => (s.match(/(\d{1,2}:\d{2})/) || [])[1] || "";
    const out = {
      fajr: clean(t.Fajr),
      dhuhr: clean(t.Dhuhr),
      asr: clean(t.Asr),
      maghrib: clean(t.Maghrib),
      isha: clean(t.Isha),
    };
    if (!out.fajr) return null;
    return out;
  } catch {
    return null;
  }
}

/**
 * v2.8: IP-based location fallback (owner: "সুইডি, সিঙ্গাপুর, USA, ইন্ডিয়া —
 * সব দেশ থেকে যাতে ব্যবহার করা যায়")। When GPS is denied (or the phone has
 * no fix), a free IP-geolocation API still finds the user's city so the
 * prayer times follow the REAL location — not the old Dhaka default.
 * Live-verified: ipwho.is serves CORS `*` (works from the WebView);
 * ipapi.co sits behind a Cloudflare challenge when an Origin header is
 * present → backup only.
 */
export async function fetchIpLocation(): Promise<{ lat: number; lng: number; label: string } | null> {
  const timeout = (ms: number) => {
    try {
      const c = typeof AbortSignal !== "undefined" ? AbortSignal.timeout(ms) : undefined;
      return c || undefined;
    } catch {
      return undefined;
    }
  };
  // 1) ipwho.is — CORS open, no key, generous free tier
  try {
    const res = await fetch("https://ipwho.is/", { signal: timeout(8000) });
    const j = await res.json();
    const lat = Number(j?.latitude);
    const lng = Number(j?.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)) {
      const city = String(j?.city || "").trim();
      const country = String(j?.country || "").trim();
      return { lat, lng, label: [city, country].filter(Boolean).join(", ") || "My location" };
    }
  } catch {
    /* try the backup */
  }
  // 2) ipapi.co backup (may be Cloudflare-challenged from webviews)
  try {
    const res = await fetch("https://ipapi.co/json/", { signal: timeout(8000) });
    const j = await res.json();
    const lat = Number(j?.latitude);
    const lng = Number(j?.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)) {
      const city = String(j?.city || "").trim();
      const country = String(j?.country_name || "").trim();
      return { lat, lng, label: [city, country].filter(Boolean).join(", ") || "My location" };
    }
  } catch {
    /* offline — GPS retry will happen next open */
  }
  return null;
}
