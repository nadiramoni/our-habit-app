"use client";

import React, { useEffect, useRef, useState } from "react";
import { useServerCfg } from "@/lib/cfg";
import { useStore } from "@/lib/store";

/**
 * Extract the Adsterra key from either a raw 32-hex key or the full pasted
 * <script> snippet (atOptions + script src). Beginner-proof: paste anything.
 */
export function extractAdsterra(raw: string): { key: string; src: string } | null {
  const text = (raw || "").trim();
  if (!text) return null;
  const keyMatch = text.match(/['"]?key['"]?\s*:\s*['"]([a-f0-9]{32})['"]/i);
  const srcMatch = text.match(/https?:\/\/[^'"\s]+?\/([a-f0-9]{32})/i);
  const bare = text.match(/\b([a-f0-9]{32})\b/);
  const key = keyMatch?.[1] || srcMatch?.[1] || bare?.[1];
  if (!key) return null;
  const src = srcMatch ? srcMatch[0] : `https://bicea.org/22/${key}`; // owner's delivery domain
  return { key, src };
}

/**
 * Extract any script/direct URL from pasted Adsterra code (Social Bar,
 * Popunder, Native Banner, Smartlink). Accepts full <script> snippet,
 * protocol-relative "//host/..." or a bare URL.
 */
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
 * Real Adsterra banner — rendered inside a sandboxed iframe (safe, no page pollution).
 *
 * v2.0 FIX (the ad was invisible in the APK): the old code measured the
 * wrapper once on mount — if layout wasn't ready the width was 0 → scale=0 →
 * the whole banner collapsed to 0px height FOREVER (no window resize ever
 * fires inside a phone WebView). Now:
 *   • ResizeObserver watches the wrapper and refits on ANY size change
 *   • a 0-width measurement is ignored and retried (never collapses)
 *   • if the ad script fails to load in 12s it reloads ONCE with a cache-bust
 */
function AdsterraIframe({ code, w, h }: { code: string; w: number; h: number }) {
  const parsed = extractAdsterra(code);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [ready, setReady] = useState(false);
  const [bust, setBust] = useState(0);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (!parsed) return;
    loadedRef.current = false;
    const el = wrapRef.current;
    if (!el) return;

    const id = setTimeout(() => setReady(false), 0);
    const fit = () => {
      const cw = el.clientWidth;
      if (cw > 0) setScale(Math.min(1, cw / w));
      // cw === 0 → layout not ready yet; ResizeObserver will fire again
    };
    fit();

    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(fit);
    });
    ro.observe(el);
    window.addEventListener("resize", fit);

    // one-shot retry with cache-bust if the ad network stalls
    const retryT = setTimeout(() => {
      if (!loadedRef.current) {
        setScale(Math.min(1, (el.clientWidth || w) / w));
        if (bust === 0) setBust(1);
      }
    }, 12000);

    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", fit);
      clearTimeout(retryT);
    };
  }, [parsed, w, bust]);

  if (!parsed) return null;

  const src = bust > 0 ? `${parsed.src}?r=${bust}` : parsed.src;
  const srcdoc = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;height:100%;overflow:hidden;background:transparent}body{display:flex;align-items:center;justify-content:center}</style></head><body><script>atOptions={'key':'${parsed.key}','format':'iframe','height':${h},'width':${w},'params':{}};</script><script src="${src}"></script></body></html>`;

  const H = Math.max(1, Math.round(h * (scale || 1)));

  return (
    <div ref={wrapRef} className="relative w-full overflow-hidden" style={{ height: H }}>
      {!ready ? (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground/60 border border-border/60 rounded px-1.5 py-0.5">
            Ad
          </span>
        </div>
      ) : null}
      <iframe
        title="Advertisement"
        srcDoc={srcdoc}
        width={w}
        height={h}
        scrolling="no"
        sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        onLoad={() => {
          loadedRef.current = true;
          setReady(true);
        }}
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

  // clean up when zone turns off / unmount
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
 * Slim bottom banner used on Home / Stats / Friends.
 * Wide screens: banner728 → adsterra468 → banner300 → placeholder
 * Narrow (phones): adsterra468 → banner300 → placeholder
 * AdMob/AdSense configured but no Adsterra → labeled placeholder (real SDK in APK phase).
 */
export default function AdsBanner({ compact = false }: { compact?: boolean }) {
  const { cfg, loaded } = useServerCfg();
  const { t } = useStore();
  const [wide, setWide] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  if (!loaded || !cfg.adsEnabled) return null;

  const at = cfg.at;
  const banner728 = at?.banner728?.on && extractAdsterra(at.banner728.code);
  const banner300 = at?.banner300?.on && extractAdsterra(at.banner300.code);
  const adsterra468 = cfg.ads.adsterra.on && extractAdsterra(cfg.ads.adsterra.id);
  const admobBanner = cfg.ads.banner.on && cfg.ads.banner.id;
  const adsense = cfg.ads.adsense.on && cfg.ads.adsense.id;

  const renderAt = (code: string, w: number, h: number) => (
    <div className="py-1 flex justify-center">
      <AdsterraIframe code={code} w={w} h={h} />
    </div>
  );

  let body: React.ReactNode = null;
  if (wide && banner728) body = renderAt(at.banner728.code, 728, 90);
  else if (!wide && adsterra468) body = renderAt(cfg.ads.adsterra.id, 468, 60);
  else if (!wide && banner300) body = renderAt(at.banner300.code, 300, 250);
  else if (wide && adsterra468) body = renderAt(cfg.ads.adsterra.id, 468, 60);
  else if (banner300) body = renderAt(at.banner300.code, 300, 250);

  if (!body && !admobBanner && !adsense) return null;

  return (
    <div role="complementary" aria-label="Advertisement" className="rounded-xl border border-border bg-card/60 overflow-hidden">
      {body ? (
        body
      ) : (
        <div className="flex items-center justify-center gap-2 px-3" style={{ minHeight: compact ? 44 : 56 }}>
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground border border-border rounded px-1 py-0.5">
            {admobBanner ? "AdMob" : adsense ? "AdSense" : "Ad"}
          </span>
          <span className="text-[11px] text-muted-foreground text-center">{t("adsPlaceholder")}</span>
        </div>
      )}
    </div>
  );
}
