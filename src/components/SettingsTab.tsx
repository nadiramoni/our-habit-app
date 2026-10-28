"use client";

/**
 * SettingsTab — clean & reorganized:
 *   Profile (Firebase account) → Language & Theme → Water goal →
 *   Permissions → Data & Backup (file + Firebase cloud) → About (English)
 * Meal alarms & reminder alarms now live on the HOME (alarms layer), not here.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { useServerCfg } from "@/lib/cfg";
import { Card, SectionTitle, Seg, ToggleRow } from "@/components/ui-bits";
import { AppState, Lang } from "@/lib/types";
import { APP_VERSION } from "@/lib/version";
import { SmartlinkButton } from "@/components/AdsBanner";
import { backupState, ensureFirebase, fbSignOut, restoreState } from "@/lib/cloud";
import {
  isNative,
  nativeOpenUsageAccess,
  nativePermissionStatus,
  nativeRequestBatteryExemption,
  nativeRequestNotifications,
  nativeOpenNotificationSettings,
  nativeRealTestNotification,
  PermStatus,
} from "@/lib/native";
import { PERM_FLOW_KEY } from "@/components/PermissionSetupFlow";

export default function SettingsTab() {
  const { state, updateSettings, setAccount, t, notifPerm, askNotifPerm, fireNotif, resetAll, importState, openAuth } = useStore();
  const { cfg } = useServerCfg();
  const s = state.settings;
  const fileRef = useRef<HTMLInputElement>(null);
  const [nativeOn, setNativeOn] = useState(false);
  const [fbStat, setFbStat] = useState<{ ok: boolean; projectId: string } | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setNativeOn(isNative()), 0);
    void ensureFirebase(cfg).then((st) => setFbStat({ ok: st.configured, projectId: st.projectId }));
    return () => clearTimeout(id);
     
  }, []);

  const exportData = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `our-habit-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importFile = async (f: File) => {
    try {
      const text = await f.text();
      const parsed = JSON.parse(text) as AppState;
      if (parsed && typeof parsed === "object" && parsed.settings) {
        importState(parsed);
        alert(t("importOk"));
      } else alert(t("importFail"));
    } catch {
      alert(t("importFail"));
    }
  };

  const acc = state.account;
  const [permStatus, setPermStatus] = useState<PermStatus | null>(null);

  const refreshPerm = useCallback(async () => {
    const s = await nativePermissionStatus();
    setPermStatus(s);
  }, []);

  useEffect(() => {
    const id = setTimeout(() => {
      setNativeOn(isNative());
      void refreshPerm();
    }, 0);
    void ensureFirebase(cfg).then((st) => setFbStat({ ok: st.configured, projectId: st.projectId }));
    const onVis = () => {
      if (document.visibilityState === "visible") void refreshPerm();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearTimeout(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [refreshPerm, cfg]);

  return (
    <div>
      <h1 className="text-xl font-bold mb-3">⚙️ {t("settingsTitle")}</h1>

      {/* ---------- Profile / Account (Firebase) ---------- */}
      <Card className="mb-4">
        <SectionTitle title={`👤 ${t("profile")}`} />
        {acc ? (
          <div className="rounded-xl bg-primary/10 border border-primary/25 p-3">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center text-lg font-extrabold text-primary shrink-0">
                {(acc.name || "?").slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold truncate">{acc.name || acc.email}</div>
                <div className="text-xs text-muted-foreground truncate">{acc.email}</div>
              </div>
            </div>
            <div className="text-[10px] text-primary font-semibold mt-2">
              {acc.verified ? `✓ ${t("syncOn")}` : `⏳ ${t("verifyTitle")}`}
            </div>
            <div className="text-[10px] text-muted-foreground mt-1">{t("profileNameAuto")}</div>
          </div>
        ) : (
          <div className="rounded-xl border border-primary/30 bg-gradient-to-br from-primary/10 to-transparent p-3.5">
            <p className="text-xs text-muted-foreground mb-3">{t("whyLogin")}</p>
            <button
              type="button"
              onClick={openAuth}
              className="w-full rounded-2xl btn-hero text-primary-foreground text-sm font-bold py-3 min-h-[48px] active:scale-[0.98] transition-transform"
            >
              {t("loginCta")}
            </button>
            <p className="text-[10px] text-muted-foreground mt-2 text-center">{t("loginCtaSub")}</p>
          </div>
        )}
        {acc ? (
          <button
            type="button"
            onClick={() => {
              if (!confirm(t("signOut") + "?")) return;
              try {
                localStorage.removeItem("ourhabit_skipauth");
              } catch {
                /* ignore */
              }
              void fbSignOut().then(() => setAccount(null));
            }}
            className="w-full mt-3 rounded-xl bg-secondary text-sm font-semibold py-2.5 min-h-[44px]"
          >
            ⎋ {t("signOut")}
          </button>
        ) : null}
      </Card>

      {/* ---------- Language & Theme ---------- */}
      <Card className="mb-4">
        <SectionTitle title={`🌍 ${t("language")} & ${t("theme")}`} />
        <div className="text-xs text-muted-foreground mb-1">{t("language")}</div>
        <Seg<Lang>
          value={s.language}
          onChange={(v) => updateSettings({ language: v })}
          options={[
            { value: "bn", label: "বাংলা" },
            { value: "en", label: "English" },
          ]}
          className="mb-3"
        />
        <div className="text-xs text-muted-foreground mb-1">{t("theme")}</div>
        <Seg<"dark" | "light">
          value={s.theme}
          onChange={(v) => updateSettings({ theme: v })}
          options={[
            { value: "dark", label: `🌙 ${t("dark")}` },
            { value: "light", label: `☀️ ${t("light")}` },
          ]}
        />
      </Card>

      {/* ---------- Water goal ---------- */}
      <Card className="mb-4">
        <SectionTitle title={`💧 ${t("waterGoalLabel")}`} />
        <Seg<string>
          value={String(s.waterGoalMl)}
          onChange={(v) => updateSettings({ waterGoalMl: parseInt(v, 10) })}
          options={[
            { value: "2500", label: "2.5L" },
            { value: "3000", label: "3L" },
            { value: "3500", label: "3.5L" },
            { value: "4000", label: "4L" },
          ]}
        />
      </Card>

      {/* ---------- Permissions ---------- */}
      <Card className="mb-4">
        <SectionTitle title={`🔐 ${t("permissionsTitle")}`} sub={t("permissionsSub")} />

        <div className="flex items-center gap-3 py-2.5 border-t border-border first:border-0">
          <span className="icon-chip w-10 h-10 text-lg shrink-0">🔔</span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">{t("permNotif")}</div>
            <div className="text-xs text-muted-foreground">{t("permNotifSub")}</div>
          </div>
          {permStatus?.notifications === "granted" || notifPerm === "granted" ? (
            <span className="text-xs font-bold text-primary shrink-0">✓ {t("on")}</span>
          ) : (
            <button
              type="button"
              onClick={async () => {
                if (isNative()) {
                  const ok = await nativeRequestNotifications();
                  if (!ok) await nativeOpenNotificationSettings();
                  await refreshPerm();
                } else {
                  await askNotifPerm();
                }
              }}
              className="rounded-xl bg-primary text-primary-foreground text-xs font-semibold px-3 py-2.5 min-h-[40px] shrink-0 active:scale-95 transition-transform"
            >
              {t("permNotifAsk")}
            </button>
          )}
        </div>

        {nativeOn ? (
          <div className="flex items-center gap-3 py-2.5 border-t border-border">
            <span className="icon-chip w-10 h-10 text-lg shrink-0">🔋</span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{t("permBattery")}</div>
              <div className="text-xs text-muted-foreground">{t("permBatterySub")}</div>
            </div>
            {permStatus?.battery === "granted" ? (
              <span className="text-xs font-bold text-primary shrink-0">✓ {t("on")}</span>
            ) : (
              <button
                type="button"
                onClick={async () => {
                  await nativeRequestBatteryExemption();
                  await refreshPerm();
                }}
                className="rounded-xl bg-primary text-primary-foreground text-xs font-semibold px-3 py-2.5 min-h-[40px] shrink-0 active:scale-95 transition-transform"
              >
                {t("permAllowBtn")}
              </button>
            )}
          </div>
        ) : null}

        <div className="flex items-center gap-3 py-2.5 border-t border-border">
          <span className="icon-chip w-10 h-10 text-lg shrink-0">📊</span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">{t("permUsage")}</div>
            <div className="text-xs text-muted-foreground">{t("permUsageSub")}</div>
          </div>
          {nativeOn ? (
            permStatus?.usageAccess === "granted" ? (
              <span className="text-xs font-bold text-primary shrink-0">✓ {t("on")}</span>
            ) : (
              <button
                type="button"
                onClick={() => void nativeOpenUsageAccess()}
                className="rounded-xl bg-primary text-primary-foreground text-xs font-semibold px-3 py-2.5 min-h-[40px] shrink-0 active:scale-95 transition-transform"
              >
                {t("permUsageOpen")}
              </button>
            )
          ) : (
            <span className="text-[10px] text-muted-foreground shrink-0">APK</span>
          )}
        </div>

        <div className="flex gap-2 mt-3">
          <button
            type="button"
            onClick={async () => {
              // REAL notification via the native plugin — arrives in the
              // Android notification shade ~1.5s later, even from background
              const res = await nativeRealTestNotification("🔔 Our Habit", t("testNotifBody"));
              if (res === "fired") alert(t("testNotifOk"));
              else if (res === "permDenied") alert(t("testNotifDenied"));
              else {
                // web fallback (browser notification API)
                fireNotif(t("appName"), t("testNotifBody"));
                alert(t("testNotifOk"));
              }
              await refreshPerm();
            }}
            className="flex-1 rounded-xl btn-hero text-primary-foreground text-sm font-semibold py-2.5 min-h-[44px] active:scale-[0.98] transition-transform"
          >
            📤 {t("permTest")}
          </button>
          {nativeOn ? (
            <button
              type="button"
              onClick={() => {
                try {
                  localStorage.removeItem(PERM_FLOW_KEY);
                } catch {
                  /* ignore */
                }
                window.dispatchEvent(new CustomEvent("oh:open-perm-flow"));
              }}
              className="flex-1 rounded-xl bg-secondary text-sm py-2.5 min-h-[44px]"
            >
              🛡️ {t("permRerunSetup")}
            </button>
          ) : null}
        </div>
        <p className="text-[10px] text-muted-foreground mt-2 leading-relaxed">{t("batteryNote")}</p>
      </Card>

      {/* ---------- Data & Backup ---------- */}
      <Card className="mb-4">
        <SectionTitle title={`🗄 ${t("dataBackup")}`} />
        <button type="button" onClick={exportData} className="w-full text-left rounded-xl bg-secondary p-3 mb-2">
          <div className="text-sm font-medium">⬇️ {t("exportData")}</div>
          <div className="text-xs text-muted-foreground">{t("exportSub")}</div>
        </button>
        <button type="button" onClick={() => fileRef.current?.click()} className="w-full text-left rounded-xl bg-secondary p-3 mb-2">
          <div className="text-sm font-medium">⬆️ {t("importData")}</div>
          <div className="text-xs text-muted-foreground">{t("importSub")}</div>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importFile(f);
            e.target.value = "";
          }}
        />
        {acc && fbStat?.ok ? (
          <div className="flex gap-2 mb-2">
            <button
              type="button"
              onClick={async () => {
                const okk = await backupState(state, cfg);
                alert(okk ? t("fbBackupOk") : t("error"));
              }}
              className="flex-1 rounded-xl bg-primary/10 text-primary text-sm font-semibold py-2.5 min-h-[44px]"
            >
              ☁️ {t("fbBackupNow")}
            </button>
            <button
              type="button"
              onClick={async () => {
                const st = await restoreState(acc.uid, cfg);
                if (st && st.settings) {
                  importState(st);
                  alert(t("fbRestoreOk"));
                } else alert(t("fbRestoreNone"));
              }}
              className="flex-1 rounded-xl bg-secondary text-sm py-2.5 min-h-[44px]"
            >
              ☁️ {t("fbRestore")}
            </button>
          </div>
        ) : null}
        <button
          type="button"
          onClick={() => {
            if (confirm(t("deleteConfirm"))) {
              resetAll();
              alert(t("deleted"));
            }
          }}
          className="w-full text-left rounded-xl bg-destructive/10 border border-destructive/30 p-3"
        >
          <div className="text-sm font-medium text-destructive">🗑 {t("deleteData")}</div>
          <div className="text-xs text-muted-foreground">{t("deleteSub")}</div>
        </button>
      </Card>

      {/* ---------- About (English title) ---------- */}
      <Card className="mb-2">
        <SectionTitle title={`ℹ️ About`} />
        <p className="text-xs text-muted-foreground leading-relaxed">{t("aboutText")}</p>
        <div className="flex items-center justify-between gap-2 mt-3">
          <p className="text-[10px] text-muted-foreground opacity-70">© 2026 Our Habit v{APP_VERSION}</p>
          <SmartlinkButton />
        </div>
      </Card>
    </div>
  );
}
