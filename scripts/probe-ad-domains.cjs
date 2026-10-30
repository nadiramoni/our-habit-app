#!/usr/bin/env node
/**
 * Probe known Adsterra serve-domain pool for the owner's REAL zones:
 *   Social Bar 21322694 (/91/ pattern), Popunder 21322751, Direct Link 21326167 (/4/)
 *   Banner keys d0e278b0… e29a2af5… a19161fe… (/22/ + invoke.js patterns)
 * A "hit" = HTTP 200 with plausible JS payload (not 0 bytes / 403 / 404).
 */
const DOMAINS = [
  "plyiest.com", "effectivegate.com", "nereserv.com", "otieu.com",
  "www.profitableratecpm.com", "profitableratecpm.com",
  "www.highperformanceformat.com", "highperformanceformat.com",
  "bicea.org", "copyrightaccessinputs.com", "thanksdescription.com",
  "suitablebooklet.com", "operationreape.com", "uployalhub.com",
  "staterremedy.com", "lostmethoddealing.com", "member1.uployalhub.com",
  "swiftarcher21.com", "whoursie.com", "glourdel.com",
];
const SB = "21322694", PU = "21322751", DL = "21326167";
const KEYS = ["d0e278b00806c3211340b80c8035781f", "e29a2af548bd3c9fa5512bd423e484a5", "a19161feecb13d6d32cfa3a7f599f5a2"];
const UA = "Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

async function probe(url) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 12000);
    const res = await fetch(url, { headers: { "User-Agent": UA, Referer: "https://localhost/" }, signal: ctl.signal, redirect: "manual" });
    clearTimeout(t);
    const body = res.status === 200 ? (await res.text()).slice(0, 160) : "";
    return { s: res.status, n: body.length, b: body.replace(/\s+/g, " ") };
  } catch (e) { return { s: 0, n: 0, b: e.message.slice(0, 40) }; }
}

(async () => {
  console.log("### Social Bar /91/" + SB);
  for (const d of DOMAINS) {
    const r = await probe(`https://${d}/91/${SB}`);
    if (r.s === 200 && r.n > 10) console.log(`  HIT  https://${d}/91/${SB} -> ${r.s} ${r.n}b ${r.b}`);
  }
  console.log("### Direct Link /4/" + DL);
  for (const d of ["otieu.com", "effectivegate.com", "www.profitableratecpm.com", "plyiest.com", "nereserv.com"]) {
    const r = await probe(`https://${d}/4/${DL}`);
    console.log(`  ${r.s === 302 || (r.s === 200 && r.n > 10) ? "HIT" : " -- "} https://${d}/4/${DL} -> ${r.s} ${r.n}b ${r.b.slice(0, 60)}`);
  }
  console.log("### Banner invoke.js patterns");
  for (const k of KEYS) {
    for (const u of [`https://www.highperformanceformat.com/${k}/invoke.js`, `https://bicea.org/22/${k}`]) {
      const r = await probe(u);
      if (r.s === 200 && r.n > 10) console.log(`  HIT  ${u} -> ${r.s} ${r.n}b ${r.b}`);
      else console.log(`   --  ${u} -> ${r.s} ${r.n}b`);
    }
  }
})();
