"use client";

/**
 * PermissionSetupFlow — the v2.0 onboarding (owner's point 3+4).
 *
 * First time the APK opens: a calm, beautiful step-by-step flow fires the REAL
 * Android system dialogs, exactly like mainstream apps (Imo, WhatsApp):
 *   1. 🔔 Notifications  → Android 13+ POST_NOTIFICATIONS system dialog
 *   2. 🔋 Battery        → "Allow ignoring battery optimizations?" dialog
 *   3. 📊 Usage Access   → system settings list (Reels auto-tracking)
 * Each step explains WHY it is needed in Bangla, shows live ✓ status, and can
 * be skipped — Android never allows forcing, we guide instead (owner's note).
 * Re-runnable any time from Settings ("সেটআপ আবার চালান").
 */

import React, { useCallback, useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import {
  isNative,
  nativePermissionStatus,
  nativeRequestBatteryExemption,
  nativeRequestNotifications,
  nativeOpenUsageAccess,
  nativeOpenNotificationSettings,
  PermStatus,
} from "@/lib/native";

export const PERM_FLOW_KEY = "ourhabit_permflow_done_v2";

type Step = "welcome" | "notif" | "battery" | "usage" | "done";

/** Static summary row — declared at module level (React Compiler rule). */
function PermRow({ ok, icon, label, sub }: { ok: boolean; icon: string; label: string; sub: string }) {
  return (
    <div
      className={`flex items-center gap-3 rounded-2xl border p-3 transition-colors ${
        ok ? "border-primary/40 bg-primary/10" : "border-border bg-secondary/40"
      }`}
    >
      <span className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0 ${ok ? "bg-primary/20" : "bg-muted"}`}>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-bold flex items-center gap-1.5">
          {label}
          {ok ? <span className="text-primary text-xs">✓</span> : null}
        </div>
        <div className="text-[11px] text-muted-foreground leading-snug">{sub}</div>
      </div>
    </div>
  );
}

export default function PermissionSetupFlow({ onFinished }: { onFinished: () => void }) {
  const { t } = useStore();
  const [step, setStep] = useState<Step>("welcome");
  const [status, setStatus] = useState<PermStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState(false);
  const [deniedHint, setDeniedHint] = useState(false);

  const refresh = useCallback(async () => {
    const s = await nativePermissionStatus();
    setStatus(s);
    return s;
  }, []);

  // re-check when the user comes back from a system settings screen
  useEffect(() => {
    const id = setTimeout(() => void refresh(), 0);
    const onVis = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearTimeout(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [refresh]);

  const finish = () => {
    try {
      localStorage.setItem(PERM_FLOW_KEY, "1");
    } catch {
      /* ignore */
    }
    onFinished();
  };

  const skipAll = () => finish();

  const askNotif = async () => {
    setBusy(true);
    setDeniedHint(false);
    await nativeRequestNotifications();
    const s = await refresh();
    setBusy(false);
    if (s?.notifications === "granted") {
      setStep("battery");
    } else {
      // the system dialog may be permanently dismissed ("don't ask again") —
      // take the user straight to the notification settings instead of stuck
      setDeniedHint(true);
      await nativeOpenNotificationSettings();
    }
  };

  const askBattery = async () => {
    setBusy(true);
    setDeniedHint(false);
    await nativeRequestBatteryExemption();
    const s = await refresh();
    setBusy(false);
    if (s?.battery === "granted") {
      setStep("usage");
    } else {
      setDeniedHint(true);
      await nativeOpenBatteryList();
    }
  };

  const openUsage = async () => {
    setHint(true);
    await nativeOpenUsageAccess();
  };

  // ---------- step auto-skip if already granted ----------
  useEffect(() => {
    if (!status) return;
    const id = setTimeout(() => {
      if (step === "notif" && status.notifications === "granted") setStep("battery");
      if (step === "battery" && status.battery === "granted") setStep("usage");
      if (step === "usage" && status.usageAccess === "granted") setStep("done");
    }, 0);
    return () => clearTimeout(id);
  }, [status, step]);

  if (!isNative()) return null;

  const notifOk = status?.notifications === "granted";
  const batteryOk = status?.battery === "granted";
  const usageOk = status?.usageAccess === "granted";

  return (
    <div className="fixed inset-0 z-[75] bg-background/95 backdrop-blur-sm flex items-end sm:items-center justify-center p-3 sm:p-6">
      <div className="w-full max-w-md rounded-[28px] bg-card border border-border shadow-2xl overflow-hidden animate-slide-up">
        {/* header strip */}
        <div className="relative bg-gradient-to-br from-primary/15 via-primary/5 to-transparent px-5 pt-5 pb-4">
          <div className="flex items-center gap-2">
            {(["notif", "battery", "usage"] as Step[]).map((s, i) => {
              const active = step === s || (step === "done" && i === 2);
              const passed =
                (s === "notif" && notifOk) || (s === "battery" && batteryOk) || (s === "usage" && usageOk);
              return (
                <span
                  key={s}
                  className={`h-1.5 flex-1 rounded-full transition-colors ${
                    passed || active ? "bg-primary" : "bg-muted"
                  }`}
                />
              );
            })}
          </div>
        </div>

        <div className="px-5 pb-5 pt-1">
          {step === "welcome" ? (
            <div className="text-center">
              <div className="w-16 h-16 mx-auto rounded-3xl bg-primary/15 border border-primary/25 flex items-center justify-center text-3xl logo-float mb-3">
                🛡️
              </div>
              <h2 className="text-lg font-extrabold">{t("pfWelcome")}</h2>
              <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{t("pfWelcomeSub")}</p>
              <div className="flex flex-col gap-2 mt-5">
                <button
                  type="button"
                  onClick={() => setStep("notif")}
                  className="w-full rounded-2xl bg-primary text-primary-foreground text-sm font-bold py-3.5 min-h-[52px] shadow-md shadow-primary/25 active:scale-[0.98] transition-transform"
                >
                  {t("pfStart")}
                </button>
                <button type="button" onClick={skipAll} className="text-xs text-muted-foreground py-2 underline underline-offset-2">
                  {t("pfLater")}
                </button>
              </div>
            </div>
          ) : null}

          {step === "notif" ? (
            <div>
              <div className="text-center mb-4">
                <div className="w-16 h-16 mx-auto rounded-3xl bg-primary/15 border border-primary/25 flex items-center justify-center text-3xl mb-3">
                  🔔
                </div>
                <h2 className="text-lg font-extrabold">{t("pfNotifTitle")}</h2>
                <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{t("pfNotifSub")}</p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => void askNotif()}
                className="w-full rounded-2xl bg-primary text-primary-foreground text-sm font-bold py-3.5 min-h-[52px] shadow-md shadow-primary/25 disabled:opacity-60 active:scale-[0.98] transition-transform"
              >
                {busy ? "..." : t("pfAllowBtn")}
              </button>
              <p className="text-[10px] text-muted-foreground text-center mt-2">{t("pfSystemDialogNote")}</p>
              {deniedHint ? <p className="text-[11px] text-amber-500 text-center mt-1.5 font-medium">⚙️ {t("pfDeniedHint")}</p> : null}
              <button type="button" onClick={() => setStep("battery")} className="w-full text-xs text-muted-foreground py-2.5 mt-1 underline underline-offset-2">
                {t("pfSkipThis")}
              </button>
            </div>
          ) : null}

          {step === "battery" ? (
            <div>
              <div className="text-center mb-4">
                <div className="w-16 h-16 mx-auto rounded-3xl bg-primary/15 border border-primary/25 flex items-center justify-center text-3xl mb-3">
                  🔋
                </div>
                <h2 className="text-lg font-extrabold">{t("pfBatteryTitle")}</h2>
                <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{t("pfBatterySub")}</p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => void askBattery()}
                className="w-full rounded-2xl bg-primary text-primary-foreground text-sm font-bold py-3.5 min-h-[52px] shadow-md shadow-primary/25 disabled:opacity-60 active:scale-[0.98] transition-transform"
              >
                {busy ? "..." : t("pfAllowBtn")}
              </button>
              <p className="text-[10px] text-muted-foreground text-center mt-2">{t("pfSystemDialogNote")}</p>
              {deniedHint ? <p className="text-[11px] text-amber-500 text-center mt-1.5 font-medium">⚙️ {t("pfDeniedHint")}</p> : null}
              <button type="button" onClick={() => setStep("usage")} className="w-full text-xs text-muted-foreground py-2.5 mt-1 underline underline-offset-2">
                {t("pfSkipThis")}
              </button>
            </div>
          ) : null}

          {step === "usage" ? (
            <div>
              <div className="text-center mb-4">
                <div className="w-16 h-16 mx-auto rounded-3xl bg-primary/15 border border-primary/25 flex items-center justify-center text-3xl mb-3">
                  📊
                </div>
                <h2 className="text-lg font-extrabold">{t("pfUsageTitle")}</h2>
                <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{t("pfUsageSub")}</p>
                {hint ? <p className="text-[11px] text-primary mt-2 font-semibold">⚙️ {t("pfUsageHint")}</p> : null}
              </div>
              <button
                type="button"
                onClick={() => void openUsage()}
                className="w-full rounded-2xl bg-primary text-primary-foreground text-sm font-bold py-3.5 min-h-[52px] shadow-md shadow-primary/25 active:scale-[0.98] transition-transform"
              >
                {t("pfUsageOpen")}
              </button>
              <button type="button" onClick={() => setStep("done")} className="w-full text-xs text-muted-foreground py-2.5 mt-1 underline underline-offset-2">
                {t("pfSkipThis")}
              </button>
            </div>
          ) : null}

          {step === "done" ? (
            <div>
              <div className="text-center mb-4">
                <div className="w-16 h-16 mx-auto rounded-3xl bg-primary/15 border border-primary/25 flex items-center justify-center text-3xl mb-3">
                  {notifOk && batteryOk && usageOk ? "🎉" : "✅"}
                </div>
                <h2 className="text-lg font-extrabold">{t("pfDoneTitle")}</h2>
                <p className="text-xs text-muted-foreground mt-2">{t("pfDoneSub")}</p>
              </div>
              <div className="flex flex-col gap-2 mb-4">
                <PermRow ok={notifOk} icon="🔔" label={t("permNotif")} sub={t("pfNotifShort")} />
                <PermRow ok={batteryOk} icon="🔋" label={t("pfBatteryShort")} sub={t("pfBatteryShortSub")} />
                <PermRow ok={usageOk} icon="📊" label={t("permUsage")} sub={t("pfUsageShort")} />
              </div>
              {!notifOk ? (
                <button
                  type="button"
                  onClick={() => void nativeOpenNotificationSettings()}
                  className="w-full rounded-2xl bg-secondary text-sm font-semibold py-2.5 min-h-[44px] mb-2"
                >
                  ⚙️ {t("pfOpenNotifSettings")}
                </button>
              ) : null}
              <button
                type="button"
                onClick={finish}
                className="w-full rounded-2xl bg-primary text-primary-foreground text-sm font-bold py-3.5 min-h-[52px] shadow-md shadow-primary/25 active:scale-[0.98] transition-transform"
              >
                {t("pfFinish")} 🚀
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
