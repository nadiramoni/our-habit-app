#!/usr/bin/env node
/** Read live Firestore app/meta config via REST (read-only probe). */
const API_KEY = "AIzaSyAfnGjQ22LCDaJTDqj2cogaQ8NkLd1FdSY";
const PROJECT = "our-habit-61587";
const META_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/app/meta?key=${API_KEY}`;

(async () => {
  try {
    const res = await fetch(META_URL, { method: "GET" });
    const txt = await res.text();
    console.log("HTTP", res.status);
    if (!res.ok) { console.log(txt.slice(0, 500)); return; }
    const doc = JSON.parse(txt);
    const cfgField = doc.fields?.cfg?.mapValue?.fields || {};
    // deep dump of at.* maps (need real code values)
    const at = cfgField.at?.mapValue?.fields || {};
    for (const [k, v] of Object.entries(at)) {
      const f = v.mapValue?.fields || {};
      console.log(`at.${k}: on=${f.on?.booleanValue} code=${JSON.stringify(f.code?.stringValue || "")}`);
    }
    const ads = cfgField.ads?.mapValue?.fields || {};
    for (const [k, v] of Object.entries(ads)) {
      const f = v.mapValue?.fields || {};
      console.log(`ads.${k}: on=${f.on?.booleanValue} id=${JSON.stringify((f.id?.stringValue || "").slice(0, 60))}`);
    }
    console.log("latestVersion:", cfgField.latestVersion?.stringValue, "apkUrl:", cfgField.apkUrl?.stringValue, "changelog:", cfgField.changelog?.stringValue);
  } catch (e) {
    console.error("ERR", e.message);
  }
})();
