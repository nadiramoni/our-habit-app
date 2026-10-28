export type PrayerKey = "fajr" | "dhuhr" | "asr" | "maghrib" | "isha";

export const PRAYER_KEYS: PrayerKey[] = ["fajr", "dhuhr", "asr", "maghrib", "isha"];

export type ReelApp = "facebook" | "ytshorts" | "ytlong" | "tiktok" | "instagram" | "other";

export const REEL_APPS: { id: ReelApp; icon: string; short: boolean }[] = [
  { id: "facebook", icon: "📘", short: true },
  { id: "ytshorts", icon: "▶️", short: true },
  { id: "ytlong", icon: "📺", short: false },
  { id: "tiktok", icon: "🎵", short: true },
  { id: "instagram", icon: "📸", short: true },
  { id: "other", icon: "📱", short: true },
];

export type MealKey = "breakfast" | "lunch" | "dinner";

export const MEAL_KEYS: MealKey[] = ["breakfast", "lunch", "dinner"];

export interface DayLog {
  prayers: Record<PrayerKey, boolean>;
  prayerWater: boolean[]; // one glass after each of 5 prayers
  waterMl: number;
  reelsMin: number | null; // null = not logged today; total across apps
  reels: Record<ReelApp, number>; // minutes per video platform (auto-track in APK phase)
  dhikr: Record<string, number>; // dhikrId -> count today
  meditationMin: number;
  focusMin: number; // 25-min focus sessions completed today
  mood: number | null; // 1..5
  sleepBed: string | null; // "23:30"
  sleepWake: string | null; // "05:30"
  gratitudes: string[]; // up to 3
  note: string;
}

export interface AlarmCfg {
  on: boolean;
  time: string; // "HH:MM"
}

export type Lang = "bn" | "en";

export interface AppSettings {
  name: string;
  language: Lang;
  theme: "dark" | "light";
  waterGoalMl: number;
  checkinTime: string;
  fajrAlarm: AlarmCfg;
  adhanAlerts: Record<PrayerKey, AlarmCfg>;
  mealAlarms: Record<MealKey, AlarmCfg>;
  hourlyWater: boolean;
  ayatNotif: AlarmCfg;
  reelsLimitMin: number; // daily Reels limit — crossing it fires a tracking notification (0 = off)
  prayerTimes: Record<PrayerKey, string> | null;
  prayerTimesDate: string | null;
  location: { lat: number; lng: number; label: string } | null;
}

// ---------- Server config (secret admin panel) ----------
export interface AdSlotCfg {
  on: boolean;
  id: string; // unit id / client id / zone key
}

export interface ServerAdsCfg {
  banner: AdSlotCfg; // AdMob banner (bottom strip)
  native: AdSlotCfg; // AdMob native (inside lists)
  rewarded: AdSlotCfg; // AdMob rewarded (bonus / streak freeze)
  adsense: AdSlotCfg; // AdSense (web/PWA only — risky in APK)
  adsterra: AdSlotCfg; // Adsterra 468x60 banner (live)
}

// One Adsterra zone from the owner's dashboard — owner pastes the GET CODE
// snippet (or just the key / direct URL). Beginner-proof: accepts anything.
export interface AtZone {
  on: boolean;
  code: string;
}

// The 6 zones from the owner's Adsterra dashboard (screenshot):
// Popunder_1 21322751 · Banner 300x250 21322579 · Banner 728x90 21322033
// Smartlink DirectLink_1 21326167 · Social Bar 21322694 · Native Banner 26943959
export interface AtCfg {
  banner300: AtZone; // Home bottom (mobile friendly)
  banner728: AtZone; // wide screens (tablet/desktop)
  nativeBanner: AtZone; // blends between cards on Home
  socialBar: AtZone; // floating bar — highest CPM on mobile
  popunder: AtZone; // DEFAULT OFF (owner's choice, one toggle away)
  smartlink: AtZone; // direct link → "support developer" button
}

export interface FirebaseCfg {
  on: boolean;
  config: string; // pasted firebaseConfig JSON
}

export interface ServerCfg {
  adsEnabled: boolean;
  ads: ServerAdsCfg;
  at: AtCfg; // Adsterra 6 zones
  firebase: FirebaseCfg; // owner's own Firebase → backup + real-time notes for ALL users
  latestVersion: string;
  apkUrl: string;
  changelog: string;
  forceUpdate: boolean;
}

export function defaultAtCfg(): AtCfg {
  return {
    banner300: { on: true, code: "" },
    banner728: { on: true, code: "" },
    nativeBanner: { on: true, code: "" },
    socialBar: { on: true, code: "" },
    popunder: { on: false, code: "" }, // owner said: no surprise popunders unless he flips it
    smartlink: { on: true, code: "" },
  };
}

export function defaultServerCfg(): ServerCfg {
  return {
    adsEnabled: false,
    ads: {
      banner: { on: false, id: "" },
      native: { on: false, id: "" },
      rewarded: { on: false, id: "" },
      adsense: { on: false, id: "" },
      adsterra: { on: false, id: "" },
    },
    at: defaultAtCfg(),
    firebase: { on: false, config: "" },
    latestVersion: "",
    apkUrl: "",
    changelog: "",
    forceUpdate: false,
  };
}

export function mergeServerCfg(saved: Partial<ServerCfg> | null | undefined): ServerCfg {
  const base = defaultServerCfg();
  if (!saved) return base;
  const at = base.at;
  return {
    ...base,
    ...saved,
    ads: {
      banner: { ...base.ads.banner, ...(saved.ads?.banner || {}) },
      native: { ...base.ads.native, ...(saved.ads?.native || {}) },
      rewarded: { ...base.ads.rewarded, ...(saved.ads?.rewarded || {}) },
      adsense: { ...base.ads.adsense, ...(saved.ads?.adsense || {}) },
      adsterra: { ...base.ads.adsterra, ...(saved.ads?.adsterra || {}) },
    },
    at: {
      banner300: { ...at.banner300, ...(saved.at?.banner300 || {}) },
      banner728: { ...at.banner728, ...(saved.at?.banner728 || {}) },
      nativeBanner: { ...at.nativeBanner, ...(saved.at?.nativeBanner || {}) },
      socialBar: { ...at.socialBar, ...(saved.at?.socialBar || {}) },
      popunder: { ...at.popunder, ...(saved.at?.popunder || {}) },
      smartlink: { ...at.smartlink, ...(saved.at?.smartlink || {}) },
    },
    firebase: { ...base.firebase, ...(saved.firebase || {}) },
  };
}

// Full day details shared with partner/family (full visibility)
export interface DayDetails {
  prayers: Record<PrayerKey, boolean>;
  prayerWater: boolean[];
  waterMl: number;
  waterGoalMl: number;
  reels: Record<ReelApp, number>;
  reelsMin: number | null;
  dhikrTotal: number;
  meditationMin: number;
  focusMin: number;
  mood: number | null;
  sleepBed: string | null;
  sleepWake: string | null;
  gratitudeCount: number;
  completion: number; // 0..1
}

export interface Account {
  uid: string; // Firebase UID
  name: string;
  email: string;
  verified: boolean;
  provider: "google" | "password";
  inviteCode?: string;
}

export interface PersonalNote {
  id: string;
  title: string;
  text: string;
  date: string;
}

export interface AppState {
  settings: AppSettings;
  logs: Record<string, DayLog>; // date -> DayLog
  account: Account | null;
  personalNotes: PersonalNote[];
}

export interface FriendSummary {
  date: string;
  points: number;
  prayersDone: number;
  waterPct: number;
  reelsFree: boolean;
  streak: number;
  meditationMin: number;
  dhikrTotal: number;
  updatedAt: string;
}

export interface FriendInfo {
  username: string;
  name: string;
  today: FriendSummary | null;
  details?: DayDetails | null;
  lastSeen: string | null;
}

export interface FriendRequest {
  username: string;
  name: string;
}

export interface SharedNoteItem {
  id: string;
  author: string;
  text: string;
  done: boolean;
  doneBy: string | null;
  createdAt: string;
}

export interface ChallengeInfo {
  id: string;
  fromUser: string;
  toUser: string;
  days: number;
  startDate: string;
  endDate: string;
  status: string; // pending | active
  myTotal: number;
  friendTotal: number;
  friendName: string;
  iAmStarter: boolean;
}

export const DHIKRS: { id: string; ar: string; bn: string; en: string }[] = [
  { id: "subhanallah", ar: "سُبْحَانَ اللّٰه", bn: "সুবহানাল্লাহ", en: "SubhanAllah" },
  { id: "alhamdulillah", ar: "اَلْحَمْدُ لِلّٰه", bn: "আলহামদুলিল্লাহ", en: "Alhamdulillah" },
  { id: "allahuakbar", ar: "اَللّٰهُ أَكْبَر", bn: "আল্লাহু আকবার", en: "Allahu Akbar" },
  { id: "lailaha", ar: "لَا إِلٰهَ إِلَّا اللّٰه", bn: "লা ইলাহা ইল্লাল্লাহ", en: "La ilaha illallah" },
  { id: "astaghfirullah", ar: "أَسْتَغْفِرُ اللّٰه", bn: "আস্তাগফিরুল্লাহ", en: "Astaghfirullah" },
  { id: "hawla", ar: "لَا حَوْلَ وَلَا قُوَّةَ إِلَّا بِاللّٰه", bn: "লা হাওলা ওয়ালা কুওয়াতা", en: "La hawla wala quwwata" },
];

export function emptyReels(): Record<ReelApp, number> {
  return { facebook: 0, ytshorts: 0, ytlong: 0, tiktok: 0, instagram: 0, other: 0 };
}

export function emptyLog(): DayLog {
  return {
    prayers: { fajr: false, dhuhr: false, asr: false, maghrib: false, isha: false },
    prayerWater: [false, false, false, false, false],
    waterMl: 0,
    reelsMin: null,
    reels: emptyReels(),
    dhikr: {},
    meditationMin: 0,
    focusMin: 0,
    mood: null,
    sleepBed: null,
    sleepWake: null,
    gratitudes: ["", "", ""],
    note: "",
  };
}

export function defaultSettings(): AppSettings {
  return {
    name: "",
    language: "bn",
    theme: "dark",
    waterGoalMl: 3000,
    checkinTime: "21:00",
    fajrAlarm: { on: true, time: "04:45" },
    adhanAlerts: {
      fajr: { on: false, time: "05:00" },
      dhuhr: { on: false, time: "12:30" },
      asr: { on: false, time: "16:15" },
      maghrib: { on: false, time: "17:45" },
      isha: { on: false, time: "19:00" },
    },
    hourlyWater: false,
    ayatNotif: { on: true, time: "07:00" },
    reelsLimitMin: 60,
    prayerTimes: null,
    prayerTimesDate: null,
    location: null,
    mealAlarms: {
      breakfast: { on: true, time: "08:00" },
      lunch: { on: true, time: "14:00" },
      dinner: { on: true, time: "21:00" },
    },
  };
}

export function defaultState(): AppState {
  return { settings: defaultSettings(), logs: {}, account: null, personalNotes: [] };
}

const pad = (n: number) => String(n).padStart(2, "0");

export function dateStr(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayStr(): string {
  return dateStr(new Date());
}

export function nowHM(): string {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function addDays(s: string, delta: number): string {
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + delta);
  return dateStr(dt);
}

export function getLog(state: AppState, date: string): DayLog {
  return state.logs[date] ?? emptyLog();
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// Kaaba coordinates for Qibla
export const KAABA = { lat: 21.4225, lng: 39.8262 };

export function qiblaBearing(lat: number, lng: number): number {
  const phiK = (KAABA.lat * Math.PI) / 180;
  const lambdaK = (KAABA.lng * Math.PI) / 180;
  const phi = (lat * Math.PI) / 180;
  const lambda = (lng * Math.PI) / 180;
  const y = Math.sin(lambdaK - lambda);
  const x = Math.cos(phi) * Math.tan(phiK) - Math.sin(phi) * Math.cos(lambdaK - lambda);
  return (Math.atan2(y, x) * 180) / Math.PI;
}
