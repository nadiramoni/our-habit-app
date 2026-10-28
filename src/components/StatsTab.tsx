"use client";

import React, { useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { Bar, Card, Ring, SectionTitle } from "@/components/ui-bits";
import AdsBanner from "@/components/AdsBanner";
import { addDays, getLog } from "@/lib/types";
import {
  BADGES,
  MAX_POINTS,
  dayPoints,
  dhikrTotal,
  levelInfo,
  unlockedBadges,
  computeStreaks,
} from "@/lib/logic";

function LevelCard() {
  const { state, today, t } = useStore();
  const total = useMemo(() => Object.values(state.logs).reduce((a, l) => a + dayPoints(l), 0), [state.logs]);
  const lv = levelInfo(total);
  const todayPts = dayPoints(getLog(state, today));
  const bn = state.settings.language === "bn";
  return (
    <Card className="mb-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs text-muted-foreground">{t("level")}</div>
          <div className="text-2xl font-extrabold">
            {lv.level} <span className="text-sm font-semibold text-primary">· {bn ? lv.title : lv.titleEn}</span>
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {t("totalPoints")}: <b className="text-foreground">{total}</b>
          </div>
        </div>
        <Ring pct={lv.inLevel / 100} size={84} stroke={8}>
          <span className="text-xs font-bold">{lv.inLevel}/100</span>
        </Ring>
      </div>
      <div className="mt-3">
        <Bar pct={lv.inLevel / 100} />
        <div className="text-[11px] text-muted-foreground mt-1">
          {lv.toNext} {t("toNextLevel")}
        </div>
      </div>
      {todayPts < MAX_POINTS ? (
        <div className="mt-3 rounded-xl bg-yellow-500/10 border border-yellow-500/30 px-3 py-2 text-xs text-yellow-600 dark:text-yellow-400 font-medium">
          ⚠️ {t("skipWarning")} <b>{MAX_POINTS - todayPts}</b> {t("skipWarning2")}
        </div>
      ) : null}
    </Card>
  );
}

function TodayRing() {
  const { state, today, t } = useStore();
  const log = getLog(state, today);
  const checks = useMemo(
    () => ({
      prayers: Object.values(log.prayers).filter(Boolean).length === 5,
      prayerWater: log.prayerWater.every(Boolean),
      water: log.waterMl >= state.settings.waterGoalMl,
      reels: log.reelsMin !== null && log.reelsMin === 0,
      dhikr: dhikrTotal(log) >= 100,
      meditation: log.meditationMin >= 10,
      focus: log.focusMin >= 25,
      mood: log.mood !== null,
      gratitude: log.gratitudes.filter((g) => g.trim()).length >= 3,
      sleep: Boolean(log.sleepBed && log.sleepWake),
    }),
    [log, state.settings.waterGoalMl]
  );
  const done = Object.values(checks).filter(Boolean).length;
  const pct = done / Object.keys(checks).length;
  return (
    <Card className="mb-4">
      <SectionTitle title={t("overallProgress")} />
      <div className="flex items-center gap-4">
        <Ring pct={pct} size={120} stroke={11}>
          <span className="text-2xl font-extrabold">{Math.round(pct * 100)}%</span>
          <span className="text-[10px] text-muted-foreground">{done}/10</span>
        </Ring>
        <div className="flex-1 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
          {(
            [
              ["🕌", "habit_prayers", checks.prayers],
              ["🥤", "habit_prayerWater", checks.prayerWater],
              ["💧", "habit_water", checks.water],
              ["✂️", "habit_reels", checks.reels],
              ["📿", "habit_dhikr", checks.dhikr],
              ["🧘", "habit_meditation", checks.meditation],
              ["🎯", "habit_focus", checks.focus],
              ["💛", "habit_mood", checks.mood],
              ["🙏", "habit_gratitude", checks.gratitude],
              ["😴", "habit_sleep", checks.sleep],
            ] as [string, string, boolean][]
          ).map(([icon, key, ok]) => (
            <div key={key} className={`flex items-center gap-1 ${ok ? "text-primary" : "text-muted-foreground"}`}>
              <span>{icon}</span>
              <span className="truncate">{t(key)}</span>
              <span className="ml-auto">{ok ? "✓" : "—"}</span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

function WeeklyBars() {
  const { state, today, t } = useStore();
  const days = useMemo(() => {
    const out = [];
    for (let i = 6; i >= 0; i--) {
      const d = addDays(today, -i);
      const l = state.logs[d];
      out.push({ d, pts: l ? dayPoints(l) : 0 });
    }
    return out;
  }, [state.logs, today]);
  const max = Math.max(MAX_POINTS, ...days.map((x) => x.pts));
  const lbl = (d: string) => {
    const [y, m, dd] = d.split("-").map(Number);
    return new Intl.DateTimeFormat(state.settings.language === "bn" ? "bn-BD" : "en-GB", { weekday: "narrow" }).format(
      new Date(y, m - 1, dd)
    );
  };
  return (
    <Card className="mb-4">
      <SectionTitle title={t("weeklyBars")} />
      <div className="flex items-end justify-between gap-2 h-32">
        {days.map((x) => (
          <div key={x.d} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
            <span className="text-[9px] text-muted-foreground">{x.pts > 0 ? x.pts : ""}</span>
            <div
              className={`w-full rounded-t-lg ${x.d === today ? "bg-primary" : "bg-primary/40"}`}
              style={{ height: `${Math.max(3, (x.pts / max) * 100)}%` }}
            />
            <span className={`text-[10px] ${x.d === today ? "text-primary font-bold" : "text-muted-foreground"}`}>
              {lbl(x.d)}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Records() {
  const { state, today, t } = useStore();
  const st = useMemo(() => computeStreaks(state, today), [state, today]);
  const totalDhikr = useMemo(
    () => Object.values(state.logs).reduce((a, l) => a + dhikrTotal(l), 0),
    [state.logs]
  );
  const totalMed = useMemo(
    () => Object.values(state.logs).reduce((a, l) => a + l.meditationMin + l.focusMin, 0),
    [state.logs]
  );
  const reelsFree = useMemo(
    () => Object.values(state.logs).filter((l) => l.reelsMin === 0).length,
    [state.logs]
  );
  const cards: { icon: string; label: string; value: string }[] = [
    { icon: "🔥", label: t("currentStreak"), value: `${st.current} ${t("days")}` },
    { icon: "🏆", label: t("bestStreak"), value: `${st.best} ${t("days")}` },
    { icon: "💪", label: t("willpowerBest"), value: `${st.willBest} ${t("days")}` },
    { icon: "📊", label: t("consistency"), value: `${Math.round((st.qualified30 / 30) * 100)}%` },
    { icon: "✂️", label: t("reelsFreeDays"), value: `${reelsFree}` },
    { icon: "📿", label: t("totalDhikr"), value: `${totalDhikr}` },
    { icon: "🧘", label: t("totalMeditation"), value: `${(totalMed / 60).toFixed(1)} h` },
    {
      icon: "🧊",
      label: t("streakFreeze"),
      value: `${st.freezeLeft}/1 ${t("available")}`,
    },
  ];
  return (
    <Card className="mb-4">
      <SectionTitle title={t("personalRecords")} />
      <div className="grid grid-cols-2 gap-2">
        {cards.map((c) => (
          <div key={c.label} className="rounded-xl bg-secondary p-3">
            <div className="text-lg leading-none mb-1">{c.icon}</div>
            <div className="text-[11px] text-muted-foreground leading-tight">{c.label}</div>
            <div className="text-sm font-bold mt-0.5">{c.value}</div>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-muted-foreground mt-2">🧊 {t("streakFreezeSub")}</p>
    </Card>
  );
}

function Badges() {
  const { state, t } = useStore();
  const unlocked = useMemo(() => unlockedBadges(state), [state]);
  return (
    <Card className="mb-4">
      <SectionTitle title={t("badges")} sub={`${unlocked.size}/${BADGES.length} · ${t("badgesSub")}`} />
      <div className="grid grid-cols-4 gap-2">
        {BADGES.map((b) => {
          const on = unlocked.has(b.id);
          return (
            <div
              key={b.id}
              className={`rounded-xl p-2 flex flex-col items-center text-center gap-1 ${
                on ? "bg-primary/10 border border-primary/30" : "bg-secondary opacity-50"
              }`}
            >
              <span className={`text-xl leading-none ${on ? "" : "grayscale"}`}>{on ? b.icon : "🔒"}</span>
              <span className="text-[9px] leading-tight">{t(b.key)}</span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function HabitProgress() {
  const { state, today, t } = useStore();
  const rows = useMemo(() => {
    const goal = state.settings.waterGoalMl;
    const ids = [
      { id: "habit_prayers", f: (l: ReturnType<typeof getLog>) => Object.values(l.prayers).every(Boolean) },
      { id: "habit_prayerWater", f: (l: ReturnType<typeof getLog>) => l.prayerWater.every(Boolean) },
      { id: "habit_water", f: (l: ReturnType<typeof getLog>) => l.waterMl >= goal },
      { id: "habit_reels", f: (l: ReturnType<typeof getLog>) => l.reelsMin !== null && l.reelsMin === 0 },
      { id: "habit_dhikr", f: (l: ReturnType<typeof getLog>) => dhikrTotal(l) >= 100 },
      { id: "habit_meditation", f: (l: ReturnType<typeof getLog>) => l.meditationMin >= 10 },
      { id: "habit_focus", f: (l: ReturnType<typeof getLog>) => l.focusMin >= 25 },
      { id: "habit_mood", f: (l: ReturnType<typeof getLog>) => l.mood !== null },
      { id: "habit_gratitude", f: (l: ReturnType<typeof getLog>) => l.gratitudes.filter((g) => g.trim()).length >= 3 },
      { id: "habit_sleep", f: (l: ReturnType<typeof getLog>) => Boolean(l.sleepBed && l.sleepWake) },
    ];
    return ids.map((row) => {
      let count = 0;
      let best = 0;
      let run = 0;
      for (let i = 29; i >= 0; i--) {
        const d = addDays(today, -i);
        const l = state.logs[d];
        const ok = l ? row.f(l) : false;
        if (ok) {
          count++;
          run++;
          best = Math.max(best, run);
        } else run = 0;
      }
      return { id: row.id, count, best };
    });
  }, [state.logs, today, state.settings.waterGoalMl]);

  return (
    <Card className="mb-4">
      <SectionTitle title={t("habitProgress")} sub={t("habitProgressSub")} />
      <div className="flex flex-col gap-2.5">
        {rows.map((r) => (
          <div key={r.id}>
            <div className="flex justify-between text-xs mb-1">
              <span>{t(r.id)}</span>
              <span className="text-muted-foreground">
                <b className="text-foreground">{r.count}</b>/30 · {t("best")} {r.best}
              </span>
            </div>
            <Bar pct={r.count / 30} />
          </div>
        ))}
      </div>
    </Card>
  );
}

function CalendarCard() {
  const { state, today, t } = useStore();
  const [ym, setYm] = useState(() => {
    const [y, m] = today.split("-").map(Number);
    return { y, m };
  });
  const goal = state.settings.waterGoalMl;

  const first = new Date(ym.y, ym.m - 1, 1);
  const daysInMonth = new Date(ym.y, ym.m, 0).getDate();
  const startDow = (first.getDay() + 6) % 7; // Monday=0
  const cells: (string | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(`${ym.y}-${String(ym.m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  }

  const monthLabel = new Intl.DateTimeFormat(state.settings.language === "bn" ? "bn-BD" : "en-GB", {
    month: "long",
    year: "numeric",
  }).format(first);

  const monthStats = useMemo(() => {
    let pts = 0;
    let active = 0;
    for (const c of cells) {
      if (!c) continue;
      const l = state.logs[c];
      if (l) {
        const p = dayPoints(l);
        pts += p;
        if (p > 0) active++;
      }
    }
    return { pts, active };
     
  }, [state.logs, ym]);

  const dowLabels = useMemo(() => {
    const loc = state.settings.language === "bn" ? "bn-BD" : "en-GB";
    // Jan 1 2024 was a Monday — gives Mon..Sun
    return Array.from({ length: 7 }, (_, i) =>
      new Intl.DateTimeFormat(loc, { weekday: "narrow" }).format(new Date(2024, 0, 1 + i))
    );
  }, [state.settings.language]);

  const ringColor = (pct: number): React.CSSProperties | undefined => {
    if (pct <= 0) return undefined;
    const deg = Math.round(pct * 360);
    return { background: `conic-gradient(var(--primary) ${deg}deg, var(--muted) ${deg}deg)` };
  };

  return (
    <Card className="mb-4">
      <SectionTitle
        title={`📅 ${t("calendar")}`}
        right={
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setYm(({ y, m }) => (m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 }))}
              className="w-8 h-8 rounded-lg bg-secondary"
              aria-label="prev month"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={() => setYm(({ y, m }) => (m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 }))}
              className="w-8 h-8 rounded-lg bg-secondary"
              aria-label="next month"
            >
              ›
            </button>
          </div>
        }
      />
      <div className="text-sm font-semibold mb-2">{monthLabel}</div>
      <div className="grid grid-cols-7 gap-1.5 text-center">
        {dowLabels.map((d, i) => (
          <div key={i} className="text-[10px] text-muted-foreground">{d}</div>
        ))}
        {cells.map((c, i) =>
          c === null ? (
            <div key={`e${i}`} />
          ) : (
            <div key={c} className="flex items-center justify-center aspect-square">
              <div
                className={`w-9 h-9 rounded-full flex items-center justify-center text-[10px] font-semibold ${
                  c === today ? "ring-2 ring-primary" : ""
                }`}
                style={ringColor(dayCompletionCached(state, c, goal))}
              >
                <span className="w-7 h-7 rounded-full bg-card flex items-center justify-center">
                  {parseInt(c.slice(-2), 10)}
                </span>
              </div>
            </div>
          )
        )}
      </div>
      <p className="text-[10px] text-muted-foreground mt-2">{t("calendarLegend")}</p>
      <div className="mt-3 pt-3 border-t border-border grid grid-cols-2 gap-2 text-center">
        <div className="rounded-xl bg-secondary p-2">
          <div className="text-[10px] text-muted-foreground">{t("activeDays")}</div>
          <div className="text-lg font-bold">{monthStats.active}</div>
        </div>
        <div className="rounded-xl bg-secondary p-2">
          <div className="text-[10px] text-muted-foreground">{t("monthPoints")}</div>
          <div className="text-lg font-bold text-primary">{monthStats.pts}</div>
        </div>
      </div>
    </Card>
  );
}

function dayCompletionCached(state: ReturnType<typeof useStore>["state"], date: string, goal: number): number {
  const l = state.logs[date];
  if (!l) return 0;
  let done = 0;
  const total = 10;
  if (Object.values(l.prayers).every(Boolean)) done++;
  if (l.prayerWater.every(Boolean)) done++;
  if (l.waterMl >= goal) done++;
  if (l.reelsMin !== null && l.reelsMin === 0) done++;
  if (dhikrTotal(l) >= 100) done++;
  if (l.meditationMin >= 10) done++;
  if (l.focusMin >= 25) done++;
  if (l.mood !== null) done++;
  if (l.gratitudes.filter((g) => g.trim()).length >= 3) done++;
  if (l.sleepBed && l.sleepWake) done++;
  return done / total;
}

export default function StatsTab() {
  const { t } = useStore();
  return (
    <div>
      <h1 className="text-xl font-bold mb-3">📊 {t("nav_stats")}</h1>
      <LevelCard />
      <TodayRing />
      <WeeklyBars />
      <Records />
      <Badges />
      <HabitProgress />
      <CalendarCard />
      <div className="mt-1 mb-2">
        <AdsBanner compact />
      </div>
    </div>
  );
}
