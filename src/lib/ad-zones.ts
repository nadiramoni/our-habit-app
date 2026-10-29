/**
 * ad-zones.ts — v2.7: the owner's REAL Adsterra banner zones, baked into the
 * app itself. NO manual paste needed — banners always try to render, and the
 * app LEARNS which zone actually fills on this device.
 *
 * v2.7 upgrades over v2.6:
 *   • LEARNED ROTATION — every zone keeps a fail counter (localStorage
 *     "oh_adzone_fail"). The ladder is walked in order of fewest failures
 *     first, so a dead zone is naturally demoted and a live zone wins every
 *     slot without any manual help.
 *   • OWNER ZONE UPGRADE — the admin panel can paste ONE fresh banner GET
 *     CODE (Firestore cfg.at.bannerUpgrade). When present it leads every
 *     ladder: the owner's newest Active zone serves before the baked trio.
 *     (One-time paste; the baked zones stay as the offline fallback.)
 *
 * Zones (owner's Adsterra account, delivery domain bicea.org):
 *   • 320×50  a19161fe…  — compact slot
 *   • 468×60  d0e278b0…  — main
 *   • 468×60  e29a2af5…  — alternate
 */

export interface AdZone {
  key: string;
  w: number;
  h: number;
  src: string;
}

const zone = (key: string, w: number, h: number): AdZone => ({
  key,
  w,
  h,
  src: `https://bicea.org/22/${key}`,
});

export const AD_ZONES = {
  /** compact 320×50 — preferred for the top slot (keeps the header slim) */
  top: zone("a19161feecb13d6d32cfa3a7f599f5a2", 320, 50),
  /** 468×60 main — confirmed loading on the owner's device (health ✓) */
  main: zone("d0e278b00806c3211340b80c8035781f", 468, 60),
  /** 468×60 alternate — rotation target when main has no fill */
  alt: zone("e29a2af548bd3c9fa5512bd423e484a5", 468, 60),
} as const;

// ---------- v2.7: learned rotation (fail counts persist per device) ----------
const LS_KEY = "oh_adzone_fail";

function readFails(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || "{}") as Record<string, number>;
  } catch {
    return {};
  }
}

export function zoneFails(key: string): number {
  return readFails()[key] || 0;
}

/** Called by AdFrame after a full no-render cycle for a zone. */
export function recordZoneFail(key: string): void {
  try {
    const f = readFails();
    f[key] = (f[key] || 0) + 1;
    localStorage.setItem(LS_KEY, JSON.stringify(f));
  } catch {
    /* ignore */
  }
}

/** Called when a zone REALLY renders — a success is worth 3 cleared fails. */
export function recordZoneWin(key: string): void {
  try {
    const f = readFails();
    f[key] = Math.max(0, (f[key] || 0) - 3);
    localStorage.setItem(LS_KEY, JSON.stringify(f));
  } catch {
    /* ignore */
  }
}

/**
 * Build the walk order for one slot: fewest failures first, ties keep the
 * given order. `upgrade` (owner-pasted fresh zone) always leads while its own
 * fail count is below 4 — even a bad upgrade can't lock out the baked trio.
 */
export function buildLadder(base: AdZone[], upgrade?: AdZone | null): AdZone[] {
  const fails = readFails();
  const all = upgrade ? [upgrade, ...base] : [...base];
  return all
    .map((z, i) => ({ z, i, f: fails[z.key] || 0 }))
    .sort((a, b) => {
      if (upgrade && a.z.key === upgrade.key && a.f < 4) return -1;
      if (upgrade && b.z.key === upgrade.key && b.f < 4) return 1;
      if (a.f !== b.f) return a.f - b.f;
      return a.i - b.i;
    })
    .map((e) => e.z);
}

/** Preference order per slot variant — always walked through buildLadder(). */
export const ZONE_BASE: Record<"a" | "b", AdZone[]> = {
  a: [AD_ZONES.top, AD_ZONES.main, AD_ZONES.alt],
  b: [AD_ZONES.main, AD_ZONES.alt, AD_ZONES.top],
};

/** Back-compat name used by smoke tests. */
export const ZONE_LADDER = ZONE_BASE;
