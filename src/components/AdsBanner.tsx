"use client";

import React, { useEffect, useRef, useState } from "react";
import { useServerCfg } from "@/lib/cfg";
import { useStore } from "@/lib/store";
import { AdZone, ZONE_BASE, buildLadder, recordZoneFail, recordZoneWin } from "@/lib/ad-zones";

/**
 * Extract the Adsterra key AND declared banner size from either a raw 32-hex
 * key or the full pasted <script> snippet (atOptions + script src).
 * Used by the admin panel's paste validation (Social Bar / Popunder / …).
 */
export function extractAdsterra(raw: string): { key: string; src: string; w: number; h: number } | null {
  const text = (raw || "").trim();
  if (!text) return null;
  const keyMatch = text.match(/['"]?key['"]?\s*:\s*['"]([a-f0-9]{32})['"]/i);
  const srcMatch = text.match(/https?:\/\/[^'"\s]+?\/([a-f0-9]{32})/i);
  const bare = text.match(/\b([a-f0-9]{32})\b/);
  const key = keyMatch?.[1] || srcMatch?.[1] || bare?.[1];
  if (!key) return null;
  const src = srcMatch ? srcMatch[0] : `https://bicea.org/22/${key}`;
  const wMatch = text.match(/['"]?width['"]?\s*:\s*['"]?(\d+)['"]?/i);
  const hMatch = text.match(/['"]?height['"]?\s*:\s*['"]?(\d+)['"]?/i);
  const w = wMatch ? parseInt(wMatch[1], 10) || 468 : 468;
  const h = hMatch ? parseInt(hMatch[1], 10) || 60 : 60;
  return { key, src, w, h };
}

/** Extract any script/direct URL from pasted Adsterra code (Social Bar,
 * Popunder, Native Banner, Smartlink). */
export function extractScriptUrl(raw: string): string | null {
  const text = (raw || "").trim();
  if (!text) return null;
  const m = text.match(/(?:https?:)?\/\/[^\s'"<>]+/i);
  if (!m) return null;
  let url = m[0];
  if (url.startsWith("//")) url = `https:${url}`;
  return url;
}

/** Native Banner container id — from pasted <div id="container-..."> or derived from the src path. */
export function extractContainerId(raw: string): string | null {
  const text = (raw || "").trim();
  const div = text.match(/id=["']?(container-[a-zA-Z0-9_-]+)/i);
  if (div) return div[1];
  const derived = text.match(/\/([a-z0-9]{8,})\/invoke\.js/i);
  if (derived) return `container-${derived[1]}`;
  return null;
}

/** Guard so a zone script is injected only once per page load (StrictMode-safe). */
const injected = new Set<string>();

// live banner health, read by the secret admin panel —
// window.__atHealth[key] = { ok, mode, at }
export function beaconHealth(key: string, ok: boolean, mode: string): void {
  try {
    const w = window as unknown as { __atHealth?: Record<string, { ok: boolean; mode: string; at: number }> };
    w.__atHealth = w.__atHealth || {};
    w.__atHealth[key] = { ok, mode, at: Date.now() };
  } catch {
    /* ignore */
  }
}

function useZoneScript(url: string | null, zoneKey: string) {
  useEffect(() => {
    if (!url) return;
    const flag = `atjs:${zoneKey}`;
    if (injected.has(flag)) return;
    injected.add(flag);
    const s = document.createElement("script");
    s.async = true;
    s.src = url;
    s.setAttribute("data-zone", zoneKey);
    s.setAttribute("data-cfasync", "false");
    document.body.appendChild(s);
  }, [url, zoneKey]);
}

/**
 * v2.6 AdFrame — the REAL banner fix.
 *
 * History: v2.2–v2.5 rendered the banner inside a SANDBOXED srcdoc iframe.
 * On the owner's phone the Adsterra script even loaded (health beacon ✓) but
 * the creative never displayed — a sandbox without allow-same-origin means an
 * OPAQUE ORIGIN: no cookies, no referrer, blocked nested context — Adsterra's
 * ad server serves nothing visible.
 *
 * Now each banner slot renders a NORMAL iframe pointing at /ad.html (our own
 * origin — exactly how a website embeds Adsterra). Cookies work, creatives
 * display. Each iframe is its own document → no atOptions collisions between
 * the 3 slots.
 *
 * Reliability:
 *  • /ad.html self-checks for a REAL render (iframe with visible size) over a
 *    ~87s phase ladder and postMessages the verdict
 *  • final-fail → parent remounts with a cache-bust; every 2nd cycle rotates
 *    to the next zone (v2.7: sorted by each zone's learned fail count —
 *    dead zones sink, live zones win)
 *  • after 6 cycles the remount ladder slows to every 5 minutes
 *  • every verdict beacons to window.__atHealth → admin panel truth display
 */
function AdFrame({ ladder }: { ladder: AdZone[] }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [ready, setReady] = useState(false);
  const [bust, setBust] = useState(0);
  const [zoneIdx, setZoneIdx] = useState(0);
  const failsRef = useRef(0);
  const cyclesRef = useRef(0);
  const doneRef = useRef(false);

  // v2.7 learned rotation: the walk order itself is re-sorted by each zone's
  // persistent fail count, so stepping forward always lands on the least
  // failed zone first.
  const ordered = buildLadder(ladder);
  const active = ordered[zoneIdx % ordered.length];

  // fit to container width (never collapse on 0-width measurement)
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const fit = () => {
      const cw = el.clientWidth;
      if (cw > 0) setScale(Math.min(1, cw / active.w));
    };
    fit();
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(fit);
    });
    ro.observe(el);
    window.addEventListener("resize", fit);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", fit);
    };
  }, [active]);

  // verdicts from /ad.html
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { __atAd?: boolean; key?: string; ok?: boolean; phase?: number } | null;
      if (!d || d.__atAd !== true || d.key !== active.key) return;
      if (d.ok) {
        doneRef.current = true;
        setReady(true);
        recordZoneWin(active.key);
        beaconHealth(active.key, true, "frame");
      } else if (d.phase === 99) {
        // full ladder failed in this document → cache-busted remount (+rotation)
        if (doneRef.current) return;
        failsRef.current += 1;
        cyclesRef.current += 1;
        recordZoneFail(active.key);
        beaconHealth(active.key, false, "frame");
        setReady(false);
        if (failsRef.current % 2 === 0) setZoneIdx((i) => i + 1); // rotate zone
        setBust((b) => b + 1); // fresh document + fresh ad request
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [active]);

  // long-run throttle: after 6 failed cycles, refetch at most every 5 min
  useEffect(() => {
    if (bust === 0 || cyclesRef.current < 6) return;
    const t = setTimeout(() => setBust((b) => b + 1), 5 * 60 * 1000);
    return () => clearTimeout(t);
  }, [bust]);

  const src = `/ad.html?k=${active.key}&w=${active.w}&h=${active.h}&src=${encodeURIComponent(active.src)}&r=${bust}`;
  const BH = Math.max(1, Math.round(active.h * (scale || 1)));

  return (
    <div ref={wrapRef} className="relative w-full overflow-hidden" style={{ height: BH }}>
      {!ready ? (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground/60 border border-border/60 rounded px-1.5 py-0.5 animate-pulse">
            Ad
          </span>
        </div>
      ) : null}
      <iframe
        title="Advertisement"
        src={src}
        key={`${active.key}-${bust}`}
        width={active.w}
        height={active.h}
        scrolling="no"
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        style={{
          border: 0,
          position: "absolute",
          top: 0,
          left: 0,
          transformOrigin: "top left",
          transform: `scale(${scale || 1})`,
        }}
      />
    </div>
  );
}

/** Native Banner — container div on the real page + Adsterra invoke script. Blends with the UI. */
export function AtNativeInline() {
  const { cfg, loaded } = useServerCfg();
  const zone = cfg.at?.nativeBanner;
  const url = loaded && cfg.adsEnabled && zone?.on ? extractScriptUrl(zone.code) : null;
  const containerId = zone ? extractContainerId(zone.code) : null;
  const ref = useRef<HTMLDivElement>(null);

  useZoneScript(url, "at-native-banner");

  useEffect(() => {
    if (!url && ref.current) ref.current.innerHTML = "";
  }, [url]);

  if (!url) return null;
  return (
    <div
      role="complementary"
      aria-label="Advertisement"
      className="rounded-xl border border-border bg-card/60 overflow-hidden my-1"
    >
      <div ref={ref} id={containerId || "at-native-container"} className="w-full min-h-[250px]" />
    </div>
  );
}

/** Social Bar + Popunder — page-level scripts from the secret admin config. */
export function AtGlobalScripts() {
  const { cfg, loaded } = useServerCfg();
  const sb = cfg.at?.socialBar;
  const pu = cfg.at?.popunder;
  const sbUrl = loaded && cfg.adsEnabled && sb?.on ? extractScriptUrl(sb.code) : null;
  const puUrl = loaded && cfg.adsEnabled && pu?.on ? extractScriptUrl(pu.code) : null;
  useZoneScript(sbUrl, "at-social-bar");
  useZoneScript(puUrl, "at-popunder");
  return null;
}

/** Smartlink Direct Link — small "support developer" button. */
export function SmartlinkButton({ className = "" }: { className?: string }) {
  const { cfg, loaded } = useServerCfg();
  const { t } = useStore();
  const url = loaded && cfg.adsEnabled && cfg.at?.smartlink?.on ? extractScriptUrl(cfg.at.smartlink.code) : null;
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1.5 rounded-full bg-primary/10 border border-primary/25 px-3 py-1.5 text-[11px] font-semibold text-primary min-h-[32px] ${className}`}
    >
      💖 {t("smartSupport")}
    </a>
  );
}

/**
 * The app's banner ad — v2.7: 100% baked-in zones (src/lib/ad-zones.ts) plus
 * the owner's optional ONE-TIME zone upgrade (admin panel → Firestore
 * cfg.at.bannerUpgrade) which leads every ladder while it fills. Renders in
 * exactly 3 places (Home top / mid / bottom):
 *   variant "a" → compact 320×50 first (header stays slim)
 *   variant "b" → the main 468×60 first
 * Rotation is learned per device: zones that never render sink to the end.
 * The master toggle (admin panel) is the only kill-switch left.
 */
export default function AdsBanner({ variant = "b" }: { compact?: boolean; variant?: "a" | "b" }) {
  const { cfg, loaded } = useServerCfg();
  const up = cfg.at?.bannerUpgrade;
  const upgradeZone =
    loaded && cfg.adsEnabled && up?.on ? extractAdsterra(up.code || "") : null;
  if (!loaded || !cfg.adsEnabled) return null;
  return (
    <div role="complementary" aria-label="Advertisement" className="rounded-xl border border-border bg-card/60 overflow-hidden">
      <div className="py-1 flex justify-center">
        <AdFrame key={variant} ladder={buildLadder(ZONE_BASE[variant], upgradeZone)} />
      </div>
    </div>
  );
}
