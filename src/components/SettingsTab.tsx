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
import AdsBanner from "@/components/AdsBanner";
import { AppState, Lang } from "@/lib/types";
import { APP_VERSION } from "@/lib/version";
import { SmartlinkButton } from "@/components/AdsBanner";
import { backupState, ensureFirebase, fbSignOut, fbUpdateProfileName, restoreState } from "@/lib/cloud";
import { totalPoints, levelInfo } from "@/lib/logic";
import {
  isNative,
  nativeOpenUsageAccess,
  nativePermissionStatus,
  nativeRequestBatteryExemption,
  nativeRequestNotifications,
  nativeOpenNotificationSettings,
  nativeRealTestNotification,
  nativeExactAlarmStatus,
  nativeOpenExactAlarmSettings,
  nativeAlarmEngineStatus,
  nativeOpenFullScreenSettings,
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
  // v2.8: profile name editor + location card state
  const [editName, setEditName] = useState(false);
  const [fName, setFName] = useState("");
  const [lName, setLName] = useState("");
  const [nameSaved, setNameSaved] = useState(false);
  const [locBusy, setLocBusy] = useState(false);
  const [fullScreenPerm, setFullScreenPerm] = useState<boolean | null>(null);

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
  const [exactPerm, setExactPerm] = useState<"granted" | "denied" | "unsupported">("unsupported");

  const refreshPerm = useCallback(async () => {
    const s = await nativePermissionStatus();
    setPermStatus(s);
    // v2.5: Fajr REAL fix — exact alarms are a special access on Android 12+;
    // if denied, Fajr/adhan can be late or skipped in Doze.
    setExactPerm(await nativeExactAlarmStatus());
    // v2.8: full-screen azan permission (Android 14+ can disable it — the
    // full-screen azan view then needs this flip turned back on)
    const eng = await nativeAlarmEngineStatus();
    setFullScreenPerm(eng ? eng.fullScreen : null);
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

      {/* v2.8: ads on EVERY page (owner round-10 #1) */}
      <AdsBanner variant="a" />

      {/* ---------- Profile / Account (Firebase) ---------- */}
      <Card className="mb-4">
        <SectionTitle title={`👤 ${t("profile")}`} />
        {acc ? (
          <div className="rounded-xl bg-primary/10 border border-primary/25 p-3">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center text-lg font-extrabold text-primary shrink-0">
                {(s.name || acc.name || "?").slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                {/* v2.8: the REGISTERED full name (settings.name) — never the
                    Gmail display name (owner: "ওর জিমেইলের নামটা থাকবে না") */}
                <div className="text-sm font-bold break-words">{s.name || acc.name || acc.email}</div>
                <div className="text-xs text-muted-foreground break-all">{acc.email}</div>
              </div>
            </div>

            {/* v2.8: EDIT NAME (first + last) — the registered name is the
                single source of truth for every display + share */}
            {editName ? (
              <div className="mt-3 rounded-xl bg-background/60 border border-border p-2.5">
                <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2">✏️ {t("editNameTitle")}</div>
                <div className="flex gap-2 mb-2">
                  <input
                    value={fName}
                    onChange={(e) => setFName(e.target.value)}
                    placeholder={t("firstName")}
                    autoComplete="given-name"
                    className="w-full bg-muted rounded-lg px-3 py-2.5 text-sm border border-border outline-none focus:ring-1 focus:ring-ring"
                  />
                  <input
                    value={lName}
                    onChange={(e) => setLName(e.target.value)}
                    placeholder={t("lastName")}
                    autoComplete="family-name"
                    className="w-full bg-muted rounded-lg px-3 py-2.5 text-sm border border-border outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={!fName.trim()}
                    onClick={async () => {
                      const full = `${fName.trim()}${lName.trim() ? ` ${lName.trim()}` : ""}`;
                      updateSettings({ name: full, nameSet: true });
                      setAccount({ ...acc, name: full });
                      await fbUpdateProfileName(full);
                      setNameSaved(true);
                      setEditName(false);
                      setTimeout(() => setNameSaved(false), 2200);
                    }}
                    className="flex-1 rounded-xl bg-primary text-primary-foreground text-xs font-bold py-2.5 min-h-[40px] disabled:opacity-40 active:scale-[0.98] transition-transform"
                  >
                    ✓ {t("saveBtn")}
                  </button>
                  <button type="button" onClick={() => setEditName(false)} className="rounded-xl bg-secondary text-xs py-2.5 px-3 min-h-[40px]">
                    {t("cancel")}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => {
                    const cur = (s.name || acc.name || "").trim();
                    const parts = cur.split(/\s+/).filter(Boolean);
                    setFName(parts[0] || "");
                    setLName(parts.length > 1 ? parts.slice(1).join(" ") : "");
                    setEditName(true);
                  }}
                  className="rounded-xl bg-secondary text-xs font-semibold px-3 py-2 min-h-[36px] active:scale-95 transition-transform"
                >
                  ✏️ {t("editNameBtn")}
                </button>
                {nameSaved ? <span className="text-[11px] font-bold text-primary">✓ {t("nameSavedOk")}</span> : null}
              </div>
            )}

            {/* round-5: points LIVE here now (moved off the home header) */}
            <div className="mt-3 rounded-xl bg-background/60 border border-border px-3 py-2.5 flex items-center justify-between gap-2">
              <div>
                <div className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">{t("pointsTotal")}</div>
                <div className="text-lg font-extrabold text-primary leading-tight">⚡ {totalPoints(state)}</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">{t("levelLabel")}</div>
                <div className="text-lg font-extrabold leading-tight">{levelInfo(totalPoints(state)).level}</div>
              </div>
            </div>
            <div className="text-[10px] text-primary font-semibold mt-2">
              {acc.verified ? `✓ ${t("syncOn")}` : `⏳ ${t("verifyTitle")}`}
            </div>
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

      {/* ---------- v2.8: LOCATION & TIMEZONE (worldwide — owner: "যে কোনো
          দেশ থেকে সবাই যাতে ব্যবহার করতে পারে, টাইমজোন অটো ডিটেক্ট") ---------- */}
      <Card className="mb-4 border-primary/25 bg-gradient-to-br from-primary/5 to-transparent">
        <SectionTitle title={`🌍 ${t("locCardTitle")}`} sub={t("locCardSub")} />
        {(() => {
          const loc = s.location;
          let gmt = "";
          try {
            const off = -new Date().getTimezoneOffset() / 60;
            gmt = `GMT${off >= 0 ? "+" : ""}${off}`;
          } catch {
            gmt = "";
          }
          let tzName = "";
          try {
            tzName = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
          } catch {
            tzName = "";
          }
          return (
            <>
              <div className="rounded-xl bg-secondary/50 border border-border px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-lg shrink-0">📍</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-bold truncate">{loc?.label || t("locDetecting")}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {tzName ? `${tzName} · ${gmt}` : gmt} · 🕌 {t("prayerTimesAuto")}
                    </div>
                  </div>
                </div>
              </div>
              <button
                type="button"
                disabled={locBusy}
                onClick={async () => {
                  setLocBusy(true);
                  try {
                    const { fetchPrayerTimes, fetchIpLocation } = await import("@/lib/logic");
                    const { getCurrentLocation } = await import("@/lib/native");
                    let pos: { lat: number; lng: number } | null = await getCurrentLocation();
                    let label = "My location";
                    if (!pos) {
                      const ip = await fetchIpLocation();
                      if (ip) {
                        pos = { lat: ip.lat, lng: ip.lng };
                        label = ip.label;
                      }
                    }
                    if (pos) {
                      const times = await fetchPrayerTimes(pos.lat, pos.lng);
                      updateSettings({
                        location: { lat: pos.lat, lng: pos.lng, label, tz: tzName },
                        ...(times ? { prayerTimes: times, prayerTimesDate: new Date().toISOString().slice(0, 10) } : {}),
                      });
                    }
                  } catch {
                    /* offline */
                  }
                  setLocBusy(false);
                }}
                className="w-full mt-2.5 rounded-xl bg-primary/10 text-primary text-xs font-bold py-2.5 min-h-[42px] active:scale-[0.98] transition-transform disabled:opacity-50"
              >
                {locBusy ? "⏳ ..." : `🔄 ${t("locRefresh")}`}
              </button>
              <p className="text-[10px] text-muted-foreground mt-2 leading-relaxed">✈️ {t("locTravelNote")}</p>
            </>
          );
        })()}
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

        {nativeOn ? (
          <div className="flex items-center gap-3 py-2.5 border-t border-border">
            <span className="icon-chip w-10 h-10 text-lg shrink-0">⏰</span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{t("permExact")}</div>
              <div className="text-xs text-muted-foreground">{t("permExactSub")}</div>
            </div>
            {exactPerm === "granted" ? (
              <span className="text-xs font-bold text-primary shrink-0">✓ {t("on")}</span>
            ) : exactPerm === "denied" ? (
              <button
                type="button"
                onClick={async () => {
                  await nativeOpenExactAlarmSettings();
                  setTimeout(() => void refreshPerm(), 1500);
                }}
                className="rounded-xl bg-destructive/10 border border-destructive/30 text-destructive text-xs font-semibold px-3 py-2.5 min-h-[40px] shrink-0 active:scale-95 transition-transform"
              >
                ⚠️ {t("permExactAllow")}
              </button>
            ) : (
              <span className="text-xs font-bold text-primary shrink-0">✓</span>
            )}
          </div>
        ) : null}

        {nativeOn ? (
          <div className="flex items-center gap-3 py-2.5 border-t border-border">
            <span className="icon-chip w-10 h-10 text-lg shrink-0">🖼️</span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{t("permFullScreen")}</div>
              <div className="text-xs text-muted-foreground">{t("permFullScreenSub")}</div>
            </div>
            {fullScreenPerm === false ? (
              <button
                type="button"
                onClick={async () => {
                  await nativeOpenFullScreenSettings();
                  setTimeout(() => void refreshPerm(), 1500);
                }}
                className="rounded-xl bg-destructive/10 border border-destructive/30 text-destructive text-xs font-semibold px-3 py-2.5 min-h-[40px] shrink-0 active:scale-95 transition-transform"
              >
                ⚠️ {t("permAllowBtn")}
              </button>
            ) : (
              <span className="text-xs font-bold text-primary shrink-0">✓</span>
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

      {/* v2.8: ads on EVERY page */}
      <AdsBanner variant="b" />
    </div>
  );
}
