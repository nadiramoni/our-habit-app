/**
 * ad-zones.ts — v2.6: the owner's REAL Adsterra banner zones, baked into the
 * app itself. NO manual paste, NO server config — banners always render.
 *
 * Owner decision (round 8): "ম্যানুয়াল অ্যাডস কনফিগ টোটালি ক্লোজ করো — তুমি
 * নিজে করতেছো, যেভাবে অ্যাড রান করবে সেভাবে করে দাও" → banners are 100%
 * developer-owned now. The admin panel's master toggle (adsEnabled) stays as
 * the only kill-switch.
 *
 * Zones (owner's Adsterra account, delivery domain bicea.org):
 *   • 320×50  a19161fe…  — compact top slot
 *   • 468×60  d0e278b0…  — main (health-verified loading on the owner's phone)
 *   • 468×60  e29a2af5…  — alternate (rotation fallback)
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
  /** 468×60 main — confirmed serving on the owner's device (banner health ✓) */
  main: zone("d0e278b00806c3211340b80c8035781f", 468, 60),
  /** 468×60 alternate — rotation target when main has no fill */
  alt: zone("e29a2af548bd3c9fa5512bd423e484a5", 468, 60),
} as const;

/** Preference order per slot variant — rotation walks this list. */
export const ZONE_LADDER: Record<"a" | "b", AdZone[]> = {
  a: [AD_ZONES.top, AD_ZONES.main, AD_ZONES.alt],
  b: [AD_ZONES.main, AD_ZONES.alt, AD_ZONES.top],
};
