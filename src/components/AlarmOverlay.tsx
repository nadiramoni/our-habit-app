"use client";

import React, { useEffect, useRef } from "react";
import { useStore } from "@/lib/store";
import { startAlarmMusic, stopAlarmMusic } from "@/lib/audio";

export interface ActiveAlarm {
  key: string;
  title: string;
  body: string;
  sound: boolean;
}

/** Full-screen alarm overlay with looping music — meals, Fajr, adhan. */
export default function AlarmOverlay({ alarm, onDismiss }: { alarm: ActiveAlarm | null; onDismiss: (snooze: boolean) => void }) {
  const { t } = useStore();
  const stopRef = useRef<(() => void) | null>(null);
  const dismissRef = useRef(onDismiss);
  useEffect(() => {
    dismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (alarm?.sound) {
      try {
        stopRef.current = startAlarmMusic();
      } catch {
        /* audio blocked until user interacts */
      }
    }
    // vibrate on supported phones too
    try {
      if (alarm && typeof navigator !== "undefined" && "vibrate" in navigator) {
        navigator.vibrate([400, 200, 400]);
      }
    } catch {
      /* ignore */
    }
    return () => {
      if (stopRef.current) stopRef.current();
      stopRef.current = null;
    };
  }, [alarm]);

  // Android back button dismisses the alarm overlay (round-5)
  useEffect(() => {
    const onBack = () => {
      if (alarm) {
        (window as unknown as { __ohBackHandled?: boolean }).__ohBackHandled = true;
        dismissRef.current(false);
      }
    };
    window.addEventListener("oh:back", onBack);
    return () => window.removeEventListener("oh:back", onBack);
  }, [alarm]);

  if (!alarm) return null;

  const isMeal = alarm.key.startsWith("meal_");
  const isFajr = alarm.key === "fajr" || alarm.key.startsWith("adhan_");
  const icon = isMeal ? "🍽️" : isFajr ? "🕌" : "🔔";

  const dismiss = (snooze: boolean) => {
    if (stopRef.current) stopRef.current();
    stopRef.current = null;
    try {
      if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(0);
    } catch {
      /* ignore */
    }
    onDismiss(snooze);
  };

  return (
    <div className="fixed inset-0 z-[100] bg-background/95 backdrop-blur flex flex-col items-center justify-center gap-6 p-6 text-center">
      <div className="relative">
        <div className="w-28 h-28 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center text-6xl animate-pulse">
          {icon}
        </div>
      </div>
      <div>
        <div className="text-xs font-semibold text-primary uppercase tracking-widest mb-1">{t("alarmRang")}</div>
        <h2 className="text-2xl font-extrabold">{alarm.title}</h2>
        <p className="text-sm text-muted-foreground mt-1">{alarm.body}</p>
      </div>
      <div className="flex flex-col gap-2 w-full max-w-xs">
        <button
          type="button"
          onClick={() => dismiss(false)}
          className="w-full rounded-2xl bg-primary text-primary-foreground text-base font-bold py-3.5 min-h-[52px] shadow-lg"
        >
          ✓ {t("dismiss")}
        </button>
        <button
          type="button"
          onClick={() => dismiss(true)}
          className="w-full rounded-2xl bg-secondary text-sm font-medium py-3 min-h-[48px]"
        >
          💤 {t("snooze")}
        </button>
      </div>
    </div>
  );
}
