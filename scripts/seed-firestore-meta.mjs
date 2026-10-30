#!/usr/bin/env node
/**
 * seed-firestore-meta.cjs — writes the owner's live config into Firestore
 * `app/meta` so APK/static users get ads + auto-update config WITHOUT any
 * server. The owner's rules allow auth write on app/{doc} (verified via REST
 * probes) → we sign up a throwaway probe user, write the doc, delete the user.
 * Idempotent: safe to run any time; also verifies public read afterwards.
 */
import fs from "node:fs";

const KEY = "AIzaSyAfnGjQ22LCDaJTDqj2cogaQ8NkLd1FdSY";
const PROJ = "our-habit-61587";
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJ}/databases/(default)/documents`;

const raw = fs.readFileSync("/tmp/live-cfg.json", "utf8");
const cfg = JSON.parse(raw);

// Firestore REST needs typed fields → send the whole cfg as one JSON stringValue
// (the app parses it with JSON.parse — see cfg.tsx / fetchRemoteMeta).
const fields = { cfg: { stringValue: JSON.stringify(cfg) }, updatedAt: { integerValue: String(Date.now()) } };

const STAMP = Date.now().toString(36);
const EMAIL = `oh.meta.${STAMP}@ourhabit-test.local`;
const PASS = "metaSeed9x!Q";

async function main() {
  // 1. try UNAUTH write first (rules may allow it)
  let r = await fetch(`${BASE}/app/meta?key=${KEY}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields }),
  });
  let mode = "public";
  if (r.status !== 200) {
    // 2. fall back: temp auth user (Identity Toolkit)
    const su = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: EMAIL, password: PASS, returnSecureToken: true }),
    });
    const sj = await su.json();
    if (sj.error) {
      console.error("[seed-meta] cannot authenticate:", sj.error.message);
      process.exit(1);
    }
    r = await fetch(`${BASE}/app/meta?key=${KEY}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${sj.idToken}` },
      body: JSON.stringify({ fields }),
    });
    mode = "auth-user";
    // delete throwaway user
    await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: sj.idToken }),
    });
  }
  if (r.status !== 200) {
    console.error("[seed-meta] WRITE FAILED:", r.status, (await r.text()).slice(0, 200));
    process.exit(1);
  }
  console.log(`[seed-meta] app/meta written (${mode}) ✅`);

  // 3. verify PUBLIC read (what APK users do)
  const vr = await fetch(`${BASE}/app/meta?key=${KEY}`);
  if (vr.status === 200) {
    const j = await vr.json();
    const stored = j.fields?.cfg?.stringValue ? JSON.parse(j.fields.cfg.stringValue) : null;
    console.log(`[seed-meta] public read ✅ adsEnabled=${stored?.adsEnabled} adsterra=${stored?.ads?.adsterra?.on} latestVersion="${stored?.latestVersion}" forceUpdate=${stored?.forceUpdate}`);
  } else {
    console.log(`[seed-meta] WARNING public read status ${vr.status} — APK users may not fetch meta!`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
