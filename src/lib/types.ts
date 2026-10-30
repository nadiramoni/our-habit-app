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
  // v2.5: user-created habits (নতুন হ্যাবিট) — habitId -> done today
  customDone?: Record<string, boolean>;
}

// v2.5: a habit the user added themselves (owner round-7: ঘুমের পাশে
// "নতুন হ্যাবিট" অপশন — নিজের মতো অ্যাক্টিভিটি যোগ করা যাবে)
export interface CustomHabit {
  id: string;
  name: string;
  icon: string;
}

export interface AlarmCfg {
  on: boolean;
  time: string; // "HH:MM"
}

// v2.4 Water Alarm — interval-based hydration reminders (owner round-6:
// "নির্দিষ্ট সময় পরপর পানি পান করার নোটিফিকেশন")
export interface WaterAlarmCfg {
  on: boolean;
  intervalMin: number; // 30 | 60 | 120 | 180 — gap between glasses
  from: string; // active window start "HH:MM"
  to: string; // active window end "HH:MM"
}

export type Lang = "bn" | "en";

export interface AppSettings {
  name: string;
  language: Lang;
  theme: "dark" | "light";
  waterGoalMl: number;
  checkinTime: string;
  sleepAlarm?: AlarmCfg; // optional daily bedtime reminder (round-5)
  fajrAlarm: AlarmCfg;
  adhanAlerts: Record<PrayerKey, AlarmCfg>;
  mealAlarms: Record<MealKey, AlarmCfg>;
  hourlyWater: boolean; // legacy v2.x toggle (kept for migration)
  waterAlarm?: WaterAlarmCfg; // v2.4 interval-based water alarm
  habitsAlarm?: AlarmCfg; // v2.4 daily "track your habits" reminder (owner: প্রতিদিন একটা করে অ্যালার্ট)
  mealPreAlert?: boolean; // v2.4 notify 15 min BEFORE each meal (owner: নির্ধারিত সময়ের আগেই জানাবে)
  ayatNotif: AlarmCfg;
  reelsLimitMin: number; // daily Reels limit — crossing it fires a tracking notification (0 = off)
  prayerTimes: Record<PrayerKey, string> | null;
  prayerTimesDate: string | null;
  location: { lat: number; lng: number; label: string; tz?: string } | null;
  // v2.5: নামাজের রিমাইন্ডার অটো সেট — once true, adhan alarm times ALWAYS
  // follow the location's prayer times (on/off states stay user-controlled)
  adhanAutoSet?: boolean;
  // v2.8: the chosen azan recitation (see AZAN_SOUNDS) — default "adhan.mp3"
  azanSound?: string;
  // v2.8: the name the user REGISTERED with (first + last). This is the
  // single source of truth for every name display + share — the Google/Gmail
  // account name never overwrites it (owner: "ওর জিমেইলের নামটা থাকবে না")
  nameSet?: boolean;
  // v3.3: the same name written in BENGALI script (optional). The alarm VOICE
  // reads this when the app language is Bangla → perfect Bangladeshi
  // pronunciation, while every DISPLAY keeps the English name.
  // Owner: "নাম ইংলিশে থাকবে, কিন্তু কথা বলবে বাংলাতে — বাংলাদেশি উচ্চারণ"
  nameBn?: string;
  // v4.2 (owner round-17): the alarm voice speaks BANGLA by default again —
  // the ORIGINAL system: the name is called like before and the sentence is
  // Bangla ("Sakib" → Bangla-script name + Bangla sentence). No Bangla TTS
  // voice on the phone → auto-English fallback so the call is never silent.
  // English stays as an option in Settings (owner: "আগের সিস্টেম — ঐরকম নাম
  // ধরে ডাকবে কিন্তু কথাটা বলবে বাংলায়।").
  voiceLang?: "en" | "bn";
  // v3.3: the user's gender — the alarm voice TRIES to pick a female voice for
  // girls and a male voice for boys (depends on the phone's TTS engine).
  gender?: "male" | "female";
  // v2.9: messenger-like chat notifications — the background service keeps
  // listening even when the app is closed (Settings toggle)
  chatNotif?: boolean;
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
  bannerUpgrade?: AtZone; // v2.7: ONE fresh banner GET CODE — leads every baked ladder
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
      ...(saved.at?.bannerUpgrade
        ? { bannerUpgrade: { on: true, code: "", ...(saved.at.bannerUpgrade || {}) } }
        : {}),
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
  customHabits?: CustomHabit[]; // v2.5 user-created habits
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
    customDone: {},
  };
}

export function defaultSettings(): AppSettings {
  return {
    name: "",
    language: "bn",
    // v4.2 (owner round-17): the alarm VOICE speaks BANGLA by default again —
    // the ORIGINAL system (নাম আগের মতো ডাকবে, কথাটা বলবে বাংলায়)। No Bangla
    // TTS voice on the phone → auto-English fallback; English stays as an
    // option in Settings → প্রোফাইল.
    voiceLang: "bn",
    theme: "dark",
    waterGoalMl: 3000,
    checkinTime: "21:00",
    sleepAlarm: { on: false, time: "22:30" },
    waterAlarm: { on: false, intervalMin: 60, from: "09:00", to: "22:00" },
    habitsAlarm: { on: false, time: "20:00" },
    mealPreAlert: true,
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
    adhanAutoSet: true,
    mealAlarms: {
      breakfast: { on: true, time: "08:00" },
      lunch: { on: true, time: "14:00" },
      dinner: { on: true, time: "21:00" },
    },
  };
}

// v2.4: count of 250ml glasses logged today (water tile shows glasses,
// owner round-6: "আমি কত গ্লাস পানি খেয়েছি")
export function glassesOf(ml: number): number {
  return Math.floor(ml / 250);
}

/** v2.4 water-alarm schedule: all reminder times (HH:MM) across today's window. */
export function waterAlarmTimes(w: WaterAlarmCfg): string[] {
  const out: string[] = [];
  const toMin = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };
  const from = toMin(w.from || "09:00");
  const to = toMin(w.to || "22:00");
  const step = Math.max(15, w.intervalMin || 60);
  for (let m = from; m <= to; m += step) {
    out.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  }
  return out;
}

export function shiftTime(t: string, deltaMin: number): string {
  const [h, m] = t.split(":").map(Number);
  let total = h * 60 + m + deltaMin;
  total = ((total % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function defaultState(): AppState {
  return { settings: defaultSettings(), logs: {}, account: null, personalNotes: [], customHabits: [] };
}

/** v2.5: the two REAL music files bundled in the APK for meal alarms —
 *  the owner's request: খাওয়ার অ্যালার্মে র‍্যান্ডম মিউজিক বাজবে (একটার পর
 *  একটা). Picked fresh every time the alarms re-sync. */
export const MEAL_MUSIC = ["mealalarm.mp3", "mealmusic1.mp3"] as const;
export function randomMealMusic(): string {
  return MEAL_MUSIC[Math.floor(Math.random() * MEAL_MUSIC.length)];
}

const pad = (n: number) => String(n).padStart(2, "0");

export function dateStr(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** v2.8: epoch-ms timestamp of "HH:MM" on a given date string (local time). */
export function dateAtHM(date: string, hhmm: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const [h, min] = hhmm.split(":").map(Number);
  return new Date(y, (m || 1) - 1, d || 1, h || 0, min || 0, 0, 0).getTime();
}

/** v2.8: the 5 bundled azan recitations (res/raw + public/) — the in-app
 * picker (আজানের ধ্বনি) writes one of these file keys into settings.azanSound.
 * adhan.mp3 = the owner's own recording (আজান ১, the default). */
export const AZAN_SOUNDS: { file: string; labelBn: string; labelEn: string }[] = [
  { file: "adhan.mp3", labelBn: "আজান ১ (আমার রেকর্ডিং)", labelEn: "Azan 1 (mine)" },
  { file: "azan2.mp3", labelBn: "আজান ২", labelEn: "Azan 2" },
  { file: "azan3.mp3", labelBn: "আজান ৩", labelEn: "Azan 3" },
  { file: "azan4.mp3", labelBn: "আজান ৪", labelEn: "Azan 4" },
  { file: "azan5.mp3", labelBn: "আজান ৫", labelEn: "Azan 5" },
];

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
