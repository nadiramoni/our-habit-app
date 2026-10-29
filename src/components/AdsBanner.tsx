"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import { useServerCfg } from "@/lib/cfg";
import { useStore } from "@/lib/store";

/**
 * Extract the Adsterra key AND declared banner size from either a raw 32-hex
 * key or the full pasted <script> snippet (atOptions + script src).
 * Beginner-proof: paste anything — the width/height inside the pasted
 * atOptions win, so a 320×50 and a 468×60 zone both render pixel-perfect.
 */
export function extractAdsterra(raw: string): { key: string; src: string; w: number; h: number } | null {
  const text = (raw || "").trim();
  if (!text) return null;
  const keyMatch = text.match(/['"]?key['"]?\s*:\s*['"]([a-f0-9]{32})['"]/i);
  const srcMatch = text.match(/https?:\/\/[^'"\s]+?\/([a-f0-9]{32})/i);
  const bare = text.match(/\b([a-f0-9]{32})\b/);
  const key = keyMatch?.[1] || srcMatch?.[1] || bare?.[1];
  if (!key) return null;
  const src = srcMatch ? srcMatch[0] : `https://bicea.org/22/${key}`; // owner's delivery domain
  const wMatch = text.match(/['"]?width['"]?\s*:\s*['"]?(\d+)['"]?/i);
  const hMatch = text.match(/['"]?height['"]?\s*:\s*['"]?(\d+)['"]?/i);
  const w = wMatch ? parseInt(wMatch[1], 10) || 468 : 468;
  const h = hMatch ? parseInt(hMatch[1], 10) || 60 : 60;
  return { key, src, w, h };
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

// v2.4: live banner health, read by the secret admin panel —
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
 * Real Adsterra banner — rendered inside a sandboxed iframe (safe, no page pollution).
 *
 * v2.0 FIX (the ad was invisible in the APK): the old code measured the
 * wrapper once on mount — if layout wasn't ready the width was 0 → scale=0 →
 * the whole banner collapsed to 0px height FOREVER (no window resize ever
 * fires inside a phone WebView). Now:
 *   • ResizeObserver watches the wrapper and refits on ANY size change
 *   • a 0-width measurement is ignored and retried (never collapses)
 *
 * v2.2.1 TRUTH-CHECK: an iframe "load" event fires even when Adsterra
 * returns an EMPTY script (new zones serve 200/0-byte until they activate —
 * verified live). So "ready" is now driven by a REAL render check: the
 * srcdoc inspects its own body after 8s and postMessages the parent whether
 * the network wrote any visible node. No render → elegant placeholder stays
 * + cache-busted retry ladder (6×45s then every 5min) → the banner appears
 * the moment Adsterra activates the zone. NO reinstall needed, ever.
 */
function AdsterraIframe({ code, w, h }: { code: string; w?: number; h?: number }) {
  const parsed = extractAdsterra(code);
  // declared size from the pasted atOptions wins; props are only a fallback
  const W = w ?? parsed?.w ?? 468;
  const H = h ?? parsed?.h ?? 60;
  const slotId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const wrapRef = useRef<HTMLDivElement>(null);
  const directRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [ready, setReady] = useState(false);
  const [bust, setBust] = useState(0);
  // v2.4: after 3 failed srcdoc attempts try the OFFICIAL injection path —
  // atOptions + script straight into the page (some networks only render there)
  const [mode, setMode] = useState<"iframe" | "direct">("iframe");
  const failsRef = useRef(0);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (!parsed) return;
    const el = wrapRef.current;
    if (!el) return;

    const fit = () => {
      const cw = el.clientWidth;
      if (cw > 0) setScale(Math.min(1, cw / W));
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

    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", fit);
    };
  }, [parsed, W]);

  // real-render verdict from inside the iframe (works even under sandbox:
  // allow-scripts lets the child postMessage the parent)
  useEffect(() => {
    if (!parsed || mode !== "iframe") return;
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { __at?: string; ok?: boolean } | null;
      if (!d || d.__at !== slotId) return;
      const ok = d.ok === true;
      loadedRef.current = ok;
      setReady(ok);
      beaconHealth(parsed.key, ok, "iframe");
      if (!ok) {
        // 3 empty verdicts → try the official direct injection path once
        failsRef.current += 1;
        if (failsRef.current >= 3) setMode("direct");
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [parsed, slotId, mode]);

  // v2.4 DIRECT INJECTION fallback — the exact usage Adsterra documents:
  // a fresh atOptions global followed by the zone script, appended to the
  // real page. One at a time (atOptions is a single global).
  useEffect(() => {
    if (!parsed || mode !== "direct") return;
    const host = directRef.current;
    if (!host) return;
    const w2 = window as unknown as { __atDirectActive?: boolean; __atDirectDone?: Record<string, boolean> };
    w2.__atDirectDone = w2.__atDirectDone || {};
    if (w2.__atDirectActive || w2.__atDirectDone[parsed.key]) return;
    w2.__atDirectActive = true;
    w2.__atDirectDone[parsed.key] = true;
    host.innerHTML = "";
    const cfgScript = document.createElement("script");
    cfgScript.text = `atOptions={'key':'${parsed.key}','format':'iframe','height':${H},'width':${W},'params':{}};`;
    const zoneScript = document.createElement("script");
    zoneScript.src = bust > 0 ? `${parsed.src}?r=${bust}` : parsed.src;
    zoneScript.async = true;
    host.appendChild(cfgScript);
    host.appendChild(zoneScript);
    const check = setTimeout(() => {
      const ok = host.querySelectorAll("iframe, a[href], img, video").length > 0;
      loadedRef.current = ok;
      setReady((r) => r || ok);
      beaconHealth(parsed.key, ok, "direct");
      w2.__atDirectActive = false;
    }, 8000);
    return () => {
      clearTimeout(check);
      host.innerHTML = "";
      w2.__atDirectActive = false;
    };
     
  }, [mode, parsed, bust]);

  // retry ladder — Adsterra zones typically activate minutes…hours after
  // creation; each rung refetches the zone script with a fresh cache-bust
  useEffect(() => {
    if (!parsed) return;
    let cancelled = false;
    let n = 0;
    let t: ReturnType<typeof setTimeout>;
    const arm = () => {
      if (cancelled) return;
      n += 1;
      t = setTimeout(() => {
        if (cancelled || loadedRef.current) return;
        setBust((b) => b + 1);
        arm();
      }, n <= 6 ? 45000 : 300000);
    };
    arm();
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [parsed]);

  if (!parsed) return null;

  const src = bust > 0 ? `${parsed.src}?r=${bust}` : parsed.src;
  const srcdoc = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;height:100%;overflow:hidden;background:transparent}body{display:flex;align-items:center;justify-content:center}</style></head><body><script>atOptions={'key':'${parsed.key}','format':'iframe','height':${H},'width':${W},'params':{}};</script><script src="${src}"></script><script>setTimeout(function(){try{var n=document.body.querySelectorAll('iframe,img,a[href],ins,div,video').length;parent.postMessage({__at:'${slotId}',ok:n>0},'*')}catch(e){parent.postMessage({__at:'${slotId}',ok:false},'*')}},8000)</script></body></html>`;

  const BH = Math.max(1, Math.round(H * (scale || 1)));

  return (
    <div ref={wrapRef} className="relative w-full overflow-hidden" style={{ height: BH }}>
      {!ready ? (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none animate-pulse">
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground/60 border border-border/60 rounded px-1.5 py-0.5">
            Ad
          </span>
        </div>
      ) : null}
      {mode === "direct" ? (
        <div ref={directRef} className="absolute inset-0 flex items-center justify-center overflow-hidden" />
      ) : (
        <iframe
          title="Advertisement"
          srcDoc={srcdoc}
          key={bust}
          width={W}
          height={H}
          scrolling="no"
          sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
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
      )}
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
 * Banner used on Home (3 slots: top / mid / bottom) + Stats / Friends.
 * variant "a" (top slot): prefer the small banner (banner300 zone = 320×50)
 * variant "b" (mid/bottom): prefer the main banner (adsterra zone = 468×60)
 * Each banner's declared atOptions width/height is parsed, so ANY Adsterra
 * banner size renders pixel-perfect — paste-anything, zero-config.
 */
export default function AdsBanner({ compact = false, variant = "b" }: { compact?: boolean; variant?: "a" | "b" }) {
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

  const renderAt = (parsed: { code: string; w: number; h: number }) => (
    <div className="py-1 flex justify-center">
      {/* keyed on the code: a config change remounts the banner with fresh state */}
      <AdsterraIframe key={parsed.code} code={parsed.code} w={parsed.w} h={parsed.h} />
    </div>
  );

  let body: React.ReactNode = null;
  if (variant === "a") {
    // TOP slot — small banner first so the page header stays compact
    if (banner300) body = renderAt({ code: at.banner300.code, w: banner300.w, h: banner300.h });
    else if (adsterra468) body = renderAt({ code: cfg.ads.adsterra.id, w: adsterra468.w, h: adsterra468.h });
  } else if (wide && banner728) {
    body = renderAt({ code: at.banner728.code, w: banner728.w, h: banner728.h });
  } else if (adsterra468) {
    body = renderAt({ code: cfg.ads.adsterra.id, w: adsterra468.w, h: adsterra468.h });
  } else if (banner300) {
    body = renderAt({ code: at.banner300.code, w: banner300.w, h: banner300.h });
  }

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
