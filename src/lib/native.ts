"use client";

/**
 * native.ts — bridge to Android-native features when the app runs inside the
 * Capacitor APK shell. On the web/PWA every function safely no-ops.
 *
 * Native plugin: android-plugins/usage-tracker/UsageTrackerPlugin.java
 * (copied into the Android project by scripts/prepare-apk.mjs during CI build)
 */

type AnyRec = Record<string, any>;

export interface UsageResult {
  facebook: number;
  ytshorts: number;
  ytlong: number;
  tiktok: number;
  instagram: number;
  /** v5.8: মোবাইল টিভি/সিনেমা (লং ভিডিও) — Netflix, Prime Video, Hotstar,
   *  Hoichoi, Toffee, Bioscope, MX Player, Viu + keyword fallback। */
  mobiletv: number;
  other: number;
  granted: boolean;
  /** v2.4 REAL shorts/reels count — every ACTIVITY_RESUMED of a shorts-style
   *  activity counts as one short video opened (OS event data, no guessing). */
  shortsCount: number;
  shortsYt: number;
  shortsFb: number;
  shortsIg: number;
  /** v5.8: TikTok + অন্যান্য শর্ট অ্যাপের ভিডিও কাউন্ট — টিকটকের activity
   *  class name-এ "tiktok" নেই (com.ss.android.ugc.aweme…), তাই আগে কাউন্ট
   *  হত না; এখন pure-shorts অ্যাপে প্রতিটা খোলা = ১টা শর্ট ভিডিও। */
  shortsTt: number;
  shortsOther: number;
}

export function isNative(): boolean {
  try {
    const cap = (window as AnyRec)?.Capacitor;
    return Boolean(cap?.isNativePlatform?.());
  } catch {
    return false;
  }
}

function plugin(): AnyRec | null {
  try {
    return (window as AnyRec)?.Capacitor?.Plugins?.UsageTracker ?? null;
  } catch {
    return null;
  }
}

/** Real per-app video minutes from Android Usage Access (APK only). */
export async function nativeGetVideoUsage(): Promise<UsageResult | null> {
  if (!isNative()) return null;
  const p = plugin();
  if (!p) return null;
  try {
    const res = await p.getVideoUsage();
    return {
      facebook: Number(res?.facebook) || 0,
      ytshorts: Number(res?.ytshorts) || 0,
      ytlong: Number(res?.ytlong) || 0,
      tiktok: Number(res?.tiktok) || 0,
      instagram: Number(res?.instagram) || 0,
      mobiletv: Number(res?.mobiletv) || 0,
      other: Number(res?.other) || 0,
      granted: Boolean(res?.granted),
      shortsCount: Number(res?.shortsCount) || 0,
      shortsYt: Number(res?.shortsYt) || 0,
      shortsFb: Number(res?.shortsFb) || 0,
      shortsIg: Number(res?.shortsIg) || 0,
      shortsTt: Number(res?.shortsTt) || 0,
      shortsOther: Number(res?.shortsOther) || 0,
    };
  } catch {
    return null;
  }
}

/** Open Android's Usage Access settings so the user can grant the permission. */
export async function nativeOpenUsageAccess(): Promise<boolean> {
  const p = plugin();
  if (!p) return false;
  try {
    await p.openUsageAccessSettings();
    return true;
  } catch {
    return false;
  }
}

/**
 * Fire the NATIVE Android notification-permission dialog automatically on app
 * open (Android 13+ shows the real system "Allow" popup — no web API here).
 * Returns "granted" | "denied" | "unsupported".
 */
export async function nativeAskNotificationPermission(): Promise<"granted" | "denied" | "unsupported"> {
  if (!isNative()) return "unsupported";
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    const res = await LocalNotifications.requestPermissions();
    return res.display === "granted" ? "granted" : "denied";
  } catch {
    return "denied";
  }
}

/** Current native notification permission (APK only). */
export async function nativeNotifPermission(): Promise<"granted" | "denied" | "prompt" | "unsupported"> {
  if (!isNative()) return "unsupported";
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    const res = await LocalNotifications.checkPermissions();
    return res.display === "granted" ? "granted" : res.display === "denied" ? "denied" : "prompt";
  } catch {
    return "prompt";
  }
}

/** Open this app's system settings page (after a "Don't allow", for battery too). */
export async function nativeOpenAppSettings(): Promise<boolean> {
  if (!isNative()) return false;
  try {
    const Cap = (window as AnyRec)?.Capacitor;
    const p = Cap?.Plugins?.UsageTracker;
    if (p?.openAppSettings) {
      await p.openAppSettings();
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// ==================== AppPermissions plugin (v2.0 permission flow) ====================

function permPlugin(): AnyRec | null {
  try {
    return (window as AnyRec)?.Capacitor?.Plugins?.AppPermissions ?? null;
  } catch {
    return null;
  }
}

export interface PermStatus {
  notifications: "granted" | "denied";
  battery: "granted" | "denied";
  usageAccess: "granted" | "denied";
  sdk: number;
}

/** Live status of every special permission (APK only; null on web). */
export async function nativePermissionStatus(): Promise<PermStatus | null> {
  const p = permPlugin();
  if (!p) return null;
  try {
    const r = await p.status();
    return {
      notifications: r.notifications === "granted" ? "granted" : "denied",
      battery: r.battery === "granted" ? "granted" : "denied",
      usageAccess: r.usageAccess === "granted" ? "granted" : "denied",
      sdk: Number(r.sdk) || 0,
    };
  } catch {
    return null;
  }
}

/** Fire the REAL Android 13+ notification permission dialog. */
export async function nativeRequestNotifications(): Promise<boolean> {
  const p = permPlugin();
  if (!p) return false;
  try {
    const r = await p.requestNotifications();
    return Boolean(r?.granted);
  } catch {
    return false;
  }
}

/**
 * The REAL system dialog "Allow Our Habit to always run in the background?"
 * (battery Unrestricted). Returns granted state after the dialog closes.
 */
export async function nativeRequestBatteryExemption(): Promise<boolean> {
  const p = permPlugin();
  if (!p) return false;
  try {
    const r = await p.requestBatteryExemption();
    return Boolean(r?.granted);
  } catch {
    return false;
  }
}

export async function nativeOpenBatteryList(): Promise<boolean> {
  const p = permPlugin();
  if (!p) return false;
  try {
    await p.openBatteryOptimizationList();
    return true;
  } catch {
    return false;
  }
}

export async function nativeOpenNotificationSettings(): Promise<boolean> {
  const p = permPlugin();
  if (!p) return false;
  try {
    await p.openNotificationSettings();
    return true;
  } catch {
    return false;
  }
}

export async function nativeOpenAppInfo(): Promise<boolean> {
  const p = permPlugin();
  if (!p) return false;
  try {
    await p.openAppInfo();
    return true;
  } catch {
    return false;
  }
}

// ==================== v2.5 EXACT ALARM permission (Fajr REAL fix) ====================
// On Android 12+ the SCHEDULE_EXACT_ALARM permission is NOT granted by default
// (Android 14 denies it outright until the user flips "Alarms & reminders" in
// the app's system settings). Without it the plugin falls back to INEXACT
// windows → Fajr/adhan can be delayed many minutes or skipped in Doze. These
// helpers expose the live status + the exact system settings page.
export async function nativeExactAlarmStatus(): Promise<"granted" | "denied" | "unsupported"> {
  const p = permPlugin();
  if (!p?.exactAlarmStatus) return "unsupported";
  try {
    const r = await p.exactAlarmStatus();
    return r?.granted ? "granted" : "denied";
  } catch {
    return "unsupported";
  }
}

export async function nativeOpenExactAlarmSettings(): Promise<boolean> {
  const p = permPlugin();
  if (!p?.openExactAlarmSettings) return false;
  try {
    await p.openExactAlarmSettings();
    return true;
  } catch {
    return false;
  }
}

/**
 * Open a URL OUTSIDE the app — the APK WebView blocks window.open(), so the
 * force-update "Download" button needs this native ACTION_VIEW intent.
 */
export async function nativeOpenUrl(url: string): Promise<boolean> {
  if (!isNative()) return false;
  const p = permPlugin();
  if (!p) return false;
  try {
    await p.openUrl({ url });
    return true;
  } catch {
    return false;
  }
}

// ==================== REAL test notification (works in the APK) ====================

/**
 * Fire a REAL Android notification 1.5s from now via the official
 * @capacitor/local-notifications plugin. This is a genuine system
 * notification — it shows in the notification shade even if the app is
 * closed (unlike the old web-API demo).
 * Returns "fired" | "permDenied" | "unsupported".
 */
export async function nativeRealTestNotification(
  title: string,
  body: string
): Promise<"fired" | "permDenied" | "unsupported"> {
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    const perm = await LocalNotifications.requestPermissions();
    if (perm.display !== "granted") return "permDenied";
    await LocalNotifications.cancel({ notifications: [{ id: 424242 }] });
    await LocalNotifications.schedule({
      notifications: [
        {
          id: 424242,
          title,
          body,
          schedule: { at: new Date(Date.now() + 1500), allowWhileIdle: true },
        },
      ],
    });
    return "fired";
  } catch {
    return "unsupported";
  }
}

export interface NativeAlarm {
  id: string; // stable key, e.g. "meal-breakfast"
  time: string; // "HH:MM"
  title: string;
  body: string;
  /** raw resource inside the APK (res/raw) — "adhan.mp3" for prayer/adhan
   *  alarms, "alarm.wav" (soft bell) for everything else. The Capacitor
   *  LocalNotifications plugin auto-creates a dedicated Android channel per
   *  sound, so each alarm type rings with its own voice. */
  sound?: string;
}

/** v2.6: rich result of an alarm sync — the UI shows the OWNER the truth. */
export interface AlarmSyncResult {
  ok: boolean; // permissions + scheduling succeeded
  expected: number; // alarms we asked the OS to schedule
  pending: number; // alarms the OS ACTUALLY holds now (verified!)
  permDenied: boolean; // notification permission missing → nothing can ring
  nextAt: string; // earliest upcoming schedule time ("" if none)
}

/** Read what the OS is really holding right now (pending local notifications). */
export async function nativeAlarmPending(): Promise<{ count: number; nextAt: string; nextTitle: string }> {
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    const res = await LocalNotifications.getPending();
    const list = res?.notifications || [];
    let nextAt = "";
    let nextTitle = "";
    for (const n of list) {
      const at = (n as unknown as { schedule?: { at?: string | Date } }).schedule?.at;
      if (!at) continue;
      const d = typeof at === "string" ? new Date(at) : at;
      if (!nextAt || d < new Date(nextAt)) {
        nextAt = d.toISOString();
        nextTitle = String(n.title || "");
      }
    }
    return { count: list.length, nextAt, nextTitle };
  } catch {
    return { count: 0, nextAt: "", nextTitle: "" };
  }
}

/**
 * v2.6: the AUDIBLE toggle confirmation (owner: "যেকোনো ফাংশন অন করলে ঐটা
 * যাতে সাউন্ড করে"). Fires a REAL Android notification ~1.2s from now with a
 * fixed id (each confirmation replaces the previous — the shade never fills
 * up), so a clear sound plays through the NOTIFICATION volume stream even if
 * the media volume is low.
 */
export async function nativeConfirmNotification(title: string, body: string): Promise<boolean> {
  if (!isNative()) return false;
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    const perm = await LocalNotifications.checkPermissions();
    if (perm.display !== "granted") return false;
    await LocalNotifications.cancel({ notifications: [{ id: 424250 }] });
    await LocalNotifications.schedule({
      notifications: [
        {
          id: 424250,
          title,
          body,
          schedule: { at: new Date(Date.now() + 1200), allowWhileIdle: true },
          sound: "alarm.wav",
        },
      ],
    });
    return true;
  } catch {
    return false;
  }
}

/** Ask for (or re-ask) the notification permission. Returns granted state. */
export async function nativeEnsureNotifPermission(): Promise<boolean> {
  if (!isNative()) return true; // web — nothing to do
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    const cur = await LocalNotifications.checkPermissions();
    if (cur.display === "granted") return true;
    const req = await LocalNotifications.requestPermissions();
    return req.display === "granted";
  } catch {
    return false;
  }
}

/** Schedule exact alarm notifications (meal / Fajr / adhan) — APK only. */
const ALARM_CHANNELS: { id: string; name: string; sound: string }[] = [
  { id: "sound_adhan", name: "Adhan / prayer alarms", sound: "adhan.mp3" },
  { id: "sound_alarm", name: "Reminders", sound: "alarm.wav" },
  { id: "sound_mealalarm", name: "Meal alarms", sound: "mealalarm.mp3" },
  { id: "sound_mealmusic1", name: "Meal music (track 2)", sound: "mealmusic1.mp3" },
  { id: "sound_wateralarm", name: "Water reminders", sound: "wateralarm.mp3" },
];

/**
 * Pre-create the alarm channels WITH vibration (owner round-5: alarms must
 * vibrate even when the sound is missed). The Capacitor plugin only
 * auto-creates a channel when it does not exist yet — so our vibrating
 * versions (IMPORTANCE_HIGH) win and are reused verbatim.
 */
async function ensureAlarmChannels(): Promise<void> {
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    for (const ch of ALARM_CHANNELS) {
      try {
        await LocalNotifications.createChannel({
          id: ch.id,
          name: ch.name,
          importance: 4, // IMPORTANCE_HIGH → heads-up + sound + vibration
          sound: ch.sound,
          vibration: true,
          visibility: 1, // PUBLIC → visible on the lock screen
        });
      } catch {
        /* channel may exist already — fine, soundChannelId() reuses it */
      }
    }
  } catch {
    /* plugin missing — non-fatal */
  }
}

export async function nativeScheduleAlarms(alarms: NativeAlarm[]): Promise<AlarmSyncResult> {
  const fail = (permDenied: boolean): AlarmSyncResult => ({
    ok: false,
    expected: alarms.length,
    pending: 0,
    permDenied,
    nextAt: "",
  });
  if (!isNative()) return fail(false);
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    const perm = await LocalNotifications.requestPermissions();
    if (perm.display !== "granted") return fail(true);
    await ensureAlarmChannels();
    await registerWaterActions();
    await LocalNotifications.cancelAll();
    // ⚠️ v2.4 ROOT-CAUSE FIX (owner: "Fajr alarm does not ring"): the old code
    // passed year/month/day in schedule.on → the plugin treats that as a ONE-SHOT
    // date (its DateMatch.postponeTriggerIfNeeded even pushes a missed date one
    // whole YEAR ahead). With ONLY {hour, minute} the plugin recurs DAILY —
    // verified in the plugin source (unit=HOUR_OF_DAY → postponed by 1 day).
    // Every alarm below now rings EVERY DAY until the user turns it off.
    // ⚠️ ID SAFETY: a collision would silently REPLACE one alarm with another
    // (the plugin keys by id) — the owner's "sometimes the alarm doesn't ring".
    // Deterministic + collision-free: base hash, then skip ids already used.
    const usedIds = new Set<number>();
    const list = alarms
      .filter((a) => /^\d{1,2}:\d{2}$/.test(a.time))
      .map((a) => {
        const [h, m] = a.time.split(":").map(Number);
        let nid = Math.abs(hashCode(a.id)) % 100000;
        while (usedIds.has(nid)) nid = (nid + 1) % 100000;
        usedIds.add(nid);
        return {
          id: nid,
          title: a.title,
          body: a.body,
          schedule: { on: { hour: h, minute: m }, allowWhileIdle: true },
          sound: a.sound || "alarm.wav",
          // water reminders get the "Mark as Done / Remind later" buttons
          actionTypeId: a.id.startsWith("water_") ? "water" : "",
        };
      });
    if (list.length) {
      const r = await LocalNotifications.schedule({ notifications: list });
      if (r?.warning) console.warn("[alarms] scheduled (some inexact):", r.warning.message);
    }
    // v2.6: VERIFY — read back what the OS actually holds. If the OS didn't
    // take the alarms, the UI shows a red warning instead of silence.
    const pend = await nativeAlarmPending();
    return {
      ok: true,
      expected: list.length,
      pending: pend.count,
      permDenied: false,
      nextAt: pend.nextAt,
    };
  } catch {
    return fail(false);
  }
}

// ---------- v2.4: water-notification ACTION buttons ("Mark as Done / Remind later") ----------
// The owner showed the My Habito reference: water notifications must have
// action buttons. Registered once; page.tsx listens for the taps.
let waterActionsRegistered = false;
export async function registerWaterActions(): Promise<void> {
  if (waterActionsRegistered) return;
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    await LocalNotifications.registerActionTypes({
      types: [
        {
          id: "water",
          actions: [
            { id: "waterDone", title: "✓ Drink" },
            { id: "waterSnooze", title: "💤 Later" },
          ],
        },
      ],
    });
    waterActionsRegistered = true;
  } catch {
    /* plugin missing or Android < 7 — notifications still work, just no buttons */
  }
}

export interface WaterActionEvent {
  action: "waterDone" | "waterSnooze";
}

export async function listenWaterActions(handler: (ev: WaterActionEvent) => void): Promise<void> {
  if (!isNative()) return;
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    await LocalNotifications.addListener("localNotificationActionPerformed", (ev) => {
      const actionId = String(ev?.actionId || "");
      if (actionId === "waterDone") handler({ action: "waterDone" });
      else if (actionId === "waterSnooze") handler({ action: "waterSnooze" });
    });
  } catch {
    /* ignore */
  }
}

/** Schedule ONE extra water notification N minutes from now (snooze).
 *  v5.7: QUIET — the snooze is a reminder too, so no sound, just the
 *  notification (owner: "কোনো অ্যালার্ম আসবে না")। */
export async function nativeSnoozeWater(minutes: number, title: string, body: string): Promise<void> {
  if (!isNative()) return;
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    await registerWaterActions();
    await ensureQuietLocalChannel();
    await LocalNotifications.schedule({
      notifications: [
        {
          id: 424243,
          title,
          body,
          schedule: { at: new Date(Date.now() + minutes * 60000), allowWhileIdle: true },
          channelId: QUIET_LOCAL_CHANNEL,
          actionTypeId: "water",
        },
      ],
    });
  } catch {
    /* ignore */
  }
}

// ---------------- v5.7: QUIET notification channel (APK) ----------------
// Owner: "বাকি যেগুলো আছে এগুলো জাস্ট নোটিফিকেশন… কোন মানে ইয়া দিবে না। মানে
// আছে না কোন অ্যালার্ম আসবে না।" Every notification the JS side fires on
// the APK (in-app reminders, snoozes, confirmations) goes through THIS silent
// channel — no sound, no vibration. The ONLY loud thing left is the azan
// (ExactAlarmPlugin's azan channels + full-screen popup).

const QUIET_LOCAL_CHANNEL = "oh_quiet";
let quietLocalChannelReady = false;

/** Create (once) the silent LocalNotifications channel. Safe to call often. */
export async function ensureQuietLocalChannel(): Promise<void> {
  if (quietLocalChannelReady) return;
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    await LocalNotifications.createChannel({
      id: QUIET_LOCAL_CHANNEL,
      name: "রিমাইন্ডার (নোটিফিকেশন)",
      importance: 3, // DEFAULT — visible in the shade, NO sound, NO heads-up
      vibration: false,
      visibility: 1, // PUBLIC
    });
    quietLocalChannelReady = true;
  } catch {
    /* plugin missing — non-fatal */
  }
}

/** v5.7: phones upgraded from v5.6- still carry the LOUD meal/water MUSIC
 *  channels from the old plugin schedules. Reminders never ring now — delete
 *  those channels once so nothing can ever ring for a reminder again. */
export async function pruneLegacyLoudChannels(): Promise<void> {
  if (!isNative()) return;
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    for (const id of ["sound_mealalarm", "sound_mealmusic1", "sound_wateralarm"]) {
      try {
        await LocalNotifications.deleteChannel({ id });
      } catch {
        /* channel may not exist — fine */
      }
    }
  } catch {
    /* ignore */
  }
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return h;
}

// ==================== v2.8: EXACT ALARM ENGINE (the azan REAL fix) ====================
// Owner: "আজান যে টাইম সেট করি, ঐটা পরে দিয়ে দেয় — ওই টাইমেই দিতে হবে,
// অবশ্যই ফুল স্ক্রিনে আসবে"। The LocalNotifications plugin uses
// setExactAndAllowWhileIdle which aggressive OEM battery-killers (realme/
// Oppo/Vivo) still defer by minutes. Our own ExactAlarmPlugin uses
// AlarmManager.setAlarmClock() — the alarm-clock API OEMs never delay — plus
// a full-screen intent notification that LAUNCHES the azan view when the
// screen is off/locked. Re-armed after reboot by ExactBootReceiver.

export interface ExactAlarmSpec {
  id: string; // unique, e.g. "adhan_dhuhr@2026-10-29"
  at: number; // epoch ms — MUST be a local datetime built with dateAtHM()
  key: string; // alarm kind, e.g. "adhan_dhuhr" (routes the overlay)
  time: string; // "HH:MM" display
  title: string;
  body: string;
  sound: string; // res/raw file, e.g. "adhan.mp3"
  /** v2.9: the sentence SPOKEN at ring time with the user's registered name
   * ("ইয়াসিন, পানি খাওয়ার সময় হইছে…") — empty for adhan
   * (owner: "আজানের ক্ষেত্রে না ভাই"). */
  speak?: string;
  /** TTS language for the spoken sentence ("bn" | "en"). */
  lang?: string;
  /** v5.7 SOUND POLICY (owner: "শুধু আজানের ক্ষেত্রে শুধু আজান দিবে… বাকি
   * সবগুলো জাস্ট নোটিফিকেশন — কোনো অ্যালার্ম আসবে না"):
   * "azan" → loud azan sound + full-screen popup (UNCHANGED);
   * "remind" → silent notification + the name-call voice, nothing else. */
  mode?: "azan" | "remind";
}

function exactPlugin(): AnyRec | null {
  try {
    return (window as AnyRec)?.Capacitor?.Plugins?.ExactAlarm ?? null;
  } catch {
    return null;
  }
}

/** Schedule EXACT alarm-clock alarms (azan / Fajr / meals / water / sleep) —
 *  v2.9: each alarm may carry a spoken name-call (`speak` + `lang`). APK only. */
export async function nativeScheduleExactAlarms(alarms: ExactAlarmSpec[]): Promise<{ scheduled: number }> {
  if (!isNative()) return { scheduled: 0 };
  const p = exactPlugin();
  if (!p) return { scheduled: 0 };
  try {
    const res = await p.schedule({
      alarms: alarms.map((a) => ({
        id: a.id,
        at: a.at,
        key: a.key,
        time: a.time,
        title: a.title,
        body: a.body,
        sound: a.sound,
        speak: a.speak || "",
        lang: a.lang || "bn",
        mode: a.mode || "",
      })),
    });
    return { scheduled: Number(res?.scheduled) || 0 };
  } catch {
    return { scheduled: 0 };
  }
}

export async function nativeCancelExactAlarms(): Promise<void> {
  const p = exactPlugin();
  if (!p) return;
  try {
    await p.cancelAll();
  } catch {
    /* ignore */
  }
}

/** v5.6: schedule ONE extra alarm WITHOUT touching the existing schedule —
 *  the "⏰ টেস্ট অ্যালার্ম" button uses it to verify the exact-time ring +
 *  the name-call in about a minute. APK only. */
export async function nativeScheduleOneAlarm(a: ExactAlarmSpec): Promise<boolean> {
  if (!isNative()) return false;
  const p = exactPlugin();
  if (!p) return false;
  try {
    await p.scheduleOne({
      id: a.id,
      at: a.at,
      key: a.key,
      time: a.time,
      title: a.title,
      body: a.body,
      sound: a.sound,
      speak: a.speak || "",
      lang: a.lang || "bn",
      mode: a.mode || "remind",
    });
    return true;
  } catch {
    return false;
  }
}

export async function nativeExactPending(): Promise<{ count: number; nextAt: number; nextTitle: string }> {
  const p = exactPlugin();
  if (!p) return { count: 0, nextAt: 0, nextTitle: "" };
  try {
    const r = await p.pending();
    return { count: Number(r?.count) || 0, nextAt: Number(r?.nextAt) || 0, nextTitle: String(r?.nextTitle || "") };
  } catch {
    return { count: 0, nextAt: 0, nextTitle: "" };
  }
}

/** The alarm that launched the app (full-screen intent / notification tap) —
 *  consumed ONCE: shows the full-screen azan overlay + plays the real adhan. */
export async function nativeConsumeAlarmLaunch(): Promise<ExactAlarmSpec | null> {
  if (!isNative()) return null;
  const p = exactPlugin();
  if (!p) return null;
  try {
    const r = await p.consumeLaunch();
    if (!r?.has) return null;
    return {
      id: `launch_${r.key}_${r.time}`,
      at: Date.now(),
      key: String(r.key || ""),
      time: String(r.time || ""),
      title: String(r.title || ""),
      body: String(r.body || ""),
      sound: String(r.sound || "adhan.mp3"),
    };
  } catch {
    return null;
  }
}

export async function nativeAlarmEngineStatus(): Promise<{ exactAlarm: boolean; fullScreen: boolean } | null> {
  const p = exactPlugin();
  if (!p || !isNative()) return null;
  try {
    const r = await p.status();
    return { exactAlarm: Boolean(r?.exactAlarm), fullScreen: Boolean(r?.fullScreen) };
  } catch {
    return null;
  }
}

export async function nativeOpenFullScreenSettings(): Promise<boolean> {
  const p = exactPlugin();
  if (!p) return false;
  try {
    await p.openFullScreenSettings();
    return true;
  } catch {
    return false;
  }
}

// ==================== v2.9: NAMED VOICE ALERTS (TTS) ====================
// Owner: "আমার নাম আনোয়ারুল সন সাকিব — আমাকে ডাকবে: আনোয়ারুল সন সাকিব,
// তোমার পানি খাওয়ার সময় হইছে, পানি খাও"। ExactAlarmSpec.speak carries the
// personalized sentence; at ring time AlarmSpeakService SPEAKS it on the
// ALARM stream first, then the alarm sound follows.

/**
 * v2.9: never let the UI hang again — every auth promise is raced against a
 * hard timeout (see cloud.ts). This native wrapper SPEAKS an alert right now
 * (throttled per key) — used by the Reels-limit warning while the app is
 * open (the background guard covers app-closed).
 */
export async function nativeSpeakOnce(key: string, text: string, lang = "bn", throttleMin = 30): Promise<boolean> {
  if (!isNative()) return false;
  const p = exactPlugin();
  if (!p?.speakOnce) return false;
  try {
    const r = await p.speakOnce({ key, text, lang, throttleMin });
    return Boolean(r?.spoken);
  } catch {
    return false;
  }
}

// ==================== v2.9: CHAT NOTIFICATION SERVICE ====================
// The OhKeepAliveService (headless WebView + Firestore listener + reels
// guard) — started on sign-in, stopped on sign-out / settings toggle.

function chatPlugin(): AnyRec | null {
  try {
    return (window as AnyRec)?.Capacitor?.Plugins?.ChatService ?? null;
  } catch {
    return null;
  }
}

export async function nativeChatServiceStart(): Promise<boolean> {
  if (!isNative()) return false;
  const p = chatPlugin();
  if (!p?.start) return false;
  try {
    await p.start();
    return true;
  } catch {
    return false;
  }
}

export async function nativeChatServiceStop(): Promise<void> {
  const p = chatPlugin();
  if (!p?.stop) return;
  try {
    await p.stop();
  } catch {
    /* ignore */
  }
}

/** Mute chat notifications while the app is in the FOREGROUND (no doubles). */
export async function nativeChatServiceSetMuted(muted: boolean): Promise<void> {
  const p = chatPlugin();
  if (!p?.setMuted) return;
  try {
    await p.setMuted({ muted });
  } catch {
    /* ignore */
  }
}

/** Push the daily Reels limit + spoken warning to the background guard. */
export async function nativeSetReelsLimit(limitMin: number, warnText: string, lang: string): Promise<void> {
  const p = chatPlugin();
  if (!p?.setReelsLimit) return;
  try {
    await p.setReelsLimit({ limitMin, warnText, lang });
  } catch {
    /* ignore */
  }
}

export async function nativeChatServiceRunning(): Promise<boolean> {
  if (!isNative()) return false;
  const p = chatPlugin();
  if (!p?.status) return false;
  try {
    const r = await p.status();
    return Boolean(r?.running);
  } catch {
    return false;
  }
}

/** Haptic feedback — real device vibration (round-5: tasbih = vibration, no sound). */
export async function nativeVibrate(ms = 20): Promise<void> {
  try {
    if (isNative()) {
      const { Haptics, ImpactStyle } = await import("@capacitor/haptics");
      if (ms <= 30) await Haptics.impact({ style: ImpactStyle.Light });
      else if (ms <= 90) await Haptics.impact({ style: ImpactStyle.Medium });
      else await Haptics.impact({ style: ImpactStyle.Heavy });
      return;
    }
  } catch {
    /* fall through to web API */
  }
  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(ms);
  } catch {
    /* ignore */
  }
}

export interface BackHandlers {
  /** return true if the press was consumed (overlay closed etc.) */
  onBack: () => boolean;
  /** nothing left in-app → exit the app */
  onExit: () => void;
}

/**
 * Android hardware back button — round-5 (owner): back must NEVER instantly
 * kill the app. Order: close the top layer (detail pages / admin panel /
 * alarm overlay — via the "oh:back" DOM event) → go Home → only then exit.
 */
export async function nativeHandleBackButton(handlers: BackHandlers): Promise<void> {
  if (!isNative()) return;
  try {
    const { App: CapApp } = await import("@capacitor/app");
    await CapApp.addListener("backButton", () => {
      try {
        (window as AnyRec).__ohBackHandled = false;
        window.dispatchEvent(new CustomEvent("oh:back"));
        // listeners run synchronously → by now the flag is set if consumed
        setTimeout(() => {
          if ((window as AnyRec).__ohBackHandled) return;
          handlers.onBack(); // app-level: switch to Home tab (returns true = consumed)
          if (!(window as AnyRec).__ohBackHandled) handlers.onExit();
        }, 60);
      } catch {
        /* ignore */
      }
    });
  } catch {
    /* plugin missing — stock WebView behaviour */
  }
}

// ==================== v2.4: NATIVE SHARE SHEET (owner round-6 #9) ====================

/**
 * Open the REAL Android Share Sheet with beautifully formatted text.
 * Uses the official @capacitor/share plugin (added in v2.4); falls back to
 * navigator.share, then to clipboard. Returns how it was shared.
 */
export async function nativeShareText(title: string, text: string, dialogTitle: string): Promise<"native" | "web" | "copied" | "failed"> {
  // 1) official native plugin — proper Android Share Sheet with app chooser
  try {
    const mod = await import("@capacitor/share");
    const Share = mod.Share;
    if (Share && typeof Share.canShare === "function") {
      const can = await Share.canShare();
      if (can?.value) {
        await Share.share({ title, text, dialogTitle });
        return "native";
      }
    }
  } catch {
    /* plugin missing (web build) → try the Web Share API */
  }
  // 2) Web Share API (works on mobile browsers)
  try {
    if (typeof navigator !== "undefined" && navigator.share) {
      await navigator.share({ title, text });
      return "web";
    }
  } catch {
    /* user cancelled or unsupported */
  }
  // 3) last resort: copy to clipboard so nothing is lost
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return "copied";
    }
  } catch {
    /* ignore */
  }
  return "failed";
}

/**
 * v2.4: one-shot geolocation with a timeout — used for the FIRST-OPEN
 * location request (owner round-6 #4: prayer times must follow the user's
 * location automatically). Requires ACCESS_FINE_LOCATION in the manifest,
 * which prepare-apk now adds WITHOUT the old maxSdkVersion=30 cap that
 * silently disabled location on Android 12+.
 */
export async function getCurrentLocation(timeoutMs = 10000): Promise<{ lat: number; lng: number } | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return null;
  try {
    const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        timeout: timeoutMs,
        maximumAge: 600000,
        enableHighAccuracy: false,
      });
    });
    return { lat: pos.coords.latitude, lng: pos.coords.longitude };
  } catch {
    return null;
  }
}
