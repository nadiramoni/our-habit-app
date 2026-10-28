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
  other: number;
  granted: boolean;
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
      other: Number(res?.other) || 0,
      granted: Boolean(res?.granted),
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

/** Schedule exact alarm notifications (meal / Fajr / adhan) — APK only. */
const ALARM_CHANNELS: { id: string; name: string; sound: string }[] = [
  { id: "sound_adhan", name: "Adhan / prayer alarms", sound: "adhan.mp3" },
  { id: "sound_alarm", name: "Reminders", sound: "alarm.wav" },
  { id: "sound_mealalarm", name: "Meal alarms", sound: "mealalarm.mp3" },
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

export async function nativeScheduleAlarms(alarms: NativeAlarm[]): Promise<boolean> {
  if (!isNative()) return false;
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    const perm = await LocalNotifications.requestPermissions();
    if (perm.display !== "granted") return false;
    await ensureAlarmChannels();
    await LocalNotifications.cancelAll();
    const now = new Date();
    const list = alarms
      .filter((a) => /^\d{1,2}:\d{2}$/.test(a.time))
      .map((a, i) => {
        const [h, m] = a.time.split(":").map(Number);
        return {
          id: (Math.abs(hashCode(a.id)) % 100000) + i,
          title: a.title,
          body: a.body,
          schedule: { on: { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate(), hour: h, minute: m }, allowWhileIdle: true },
          sound: a.sound || "alarm.wav",
          actionTypeId: "",
        };
      })
      .filter((n) => {
        const sch = n.schedule.on as { hour: number; minute: number };
        return sch.hour * 60 + sch.minute > now.getHours() * 60 + now.getMinutes();
      });
    if (list.length) await LocalNotifications.schedule({ notifications: list });
    return true;
  } catch {
    return false;
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
