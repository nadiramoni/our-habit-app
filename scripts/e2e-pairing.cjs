// FULL data-layer E2E for the usersIndex migration — simulates exactly what
// the app does for a husband & wife pair, against the OWNER'S real Firebase.
const KEY = "AIzaSyAfnGjQ22LCDaJTDqj2cogaQ8NkLd1FdSY";
const PROJ = "our-habit-61587";
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJ}/databases/(default)/documents`;
const STAMP = Date.now().toString(36);

const S = (v) => ({ stringValue: v });
const A = (v) => ({ arrayValue: { values: v } });
const M = (fields) => ({ mapValue: { fields } });

async function signUp(tag) {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: `e2e.${tag}.${STAMP}@ourhabit-test.local`, password: "e2ePass123!", returnSecureToken: true }),
  });
  const j = await r.json();
  if (j.error) throw new Error(tag + " signup: " + j.error.message);
  return { uid: j.localId, tok: j.idToken };
}
async function doc(tok, path, fields, method = "POST") {
  const url = method === "POST" ? `${BASE}/${path}?key=${KEY}` : `${BASE}/${path}?key=${KEY}`;
  const r = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json", ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
    body: method === "POST" ? JSON.stringify({ fields }) : undefined,
  });
  return { status: r.status, body: r.ok ? await r.json().catch(() => ({})) : await r.text() };
}
async function getDoc(tok, path) {
  const r = await fetch(`${BASE}/${path}?key=${KEY}`, { headers: tok ? { Authorization: `Bearer ${tok}` } : {} });
  return { status: r.status, body: r.ok ? await r.json() : null };
}
async function query(tok, collection, field, value) {
  const r = await fetch(`${BASE}:runQuery?key=${KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: collection }],
        where: { fieldFilter: { field: { fieldPath: field }, op: "EQUAL", value: { stringValue: value } } },
        limit: 2,
      },
    }),
  });
  const j = await r.json();
  if (j.error) return { status: r.status, err: j.error.message, docs: [] };
  const docs = (Array.isArray(j) ? j : []).filter((x) => x.document).map((x) => x.document);
  return { status: r.status, docs };
}

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ✅ ${name} ${extra}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

const today = new Date().toISOString().slice(0, 10);

(async () => {
  console.log("== E2E: pairing + days + notes (usersIndex migration) ==\n");

  // 1. two users (husband/wife)
  const hus = await signUp("hus");
  const wif = await signUp("wif");
  console.log("users created:", hus.uid.slice(0, 6), wif.uid.slice(0, 6));

  // 2. ensureProfile both (usersIndex write, like the app)
  const CODE_H = "H" + STAMP.slice(-5).toUpperCase();
  const CODE_W = "W" + STAMP.slice(-5).toUpperCase();
  let r = await doc(hus.tok, `usersIndex?documentId=${hus.uid}`, { name: S("Rahim Uddin"), email: S("hus@test.local"), inviteCode: S(CODE_H), friends: A([]) });
  ok("ensureProfile(husband) usersIndex", r.status === 200);
  r = await doc(wif.tok, `usersIndex?documentId=${wif.uid}`, { name: S("Ayesha"), email: S("wif@test.local"), inviteCode: S(CODE_W), friends: A([]) });
  ok("ensureProfile(wife) usersIndex", r.status === 200);

  // 3. husband adds wife by code (query usersIndex by inviteCode)
  const q = await query(hus.tok, "usersIndex", "inviteCode", CODE_W);
  ok("addFriendByCode: query inviteCode", q.status === 200 && q.docs.length === 1, q.err || "");
  const wifeDoc = q.docs[0];
  const wifeUid = wifeDoc.name.split("/").pop();
  const wifeFields = wifeDoc.fields;
  r = await doc(hus.tok, `usersIndex/${hus.uid}`, { friends: A([M({ uid: S(wifeUid), name: wifeFields.name, email: wifeFields.email })]) }, "PATCH");
  ok("write friends[] on husband doc", r.status === 200);
  r = await doc(wif.tok, `usersIndex/${wifeUid}`, { friends: A([M({ uid: S(hus.uid), name: S("Rahim Uddin"), email: S("hus@test.local") })]) }, "PATCH");
  ok("write friends[] on wife doc (both sides)", r.status === 200);

  // 4. husband pushes today's summary (backups/{uid} at days.{date})
  const daySummary = { date: today, points: 18, prayers: { fajr: true, dhuhr: true, asr: false, maghrib: false, isha: false }, prayerWater: [true, true, false, false, false], waterMl: 1500, waterGoalMl: 3000, reels: { facebook: 10, ytshorts: 0, ytlong: 0, tiktok: 0, instagram: 0, other: 0 }, reelsMin: 10, dhikrTotal: 33, meditationMin: 5, focusMin: 25, mood: 4, sleepBed: "23:00", sleepWake: "05:30", completion: 0.55, streak: 3 };
  r = await doc(hus.tok, `backups/${hus.uid}`, { days: M({ [today]: M(daySummaryFields(daySummary)) }) }, "PATCH");
  ok("pushDay → backups/{uid}.days", r.status === 200);

  // 5. wife LIVE-reads husband's day (listenDay path)
  r = await getDoc(wif.tok, `backups/${hus.uid}`);
  const days = r.body?.fields?.days?.mapValue?.fields || {};
  const gotToday = days[today]?.mapValue?.fields;
  ok("listenDay: wife reads husband's summary", r.status === 200 && gotToday && gotToday.points.integerValue === "18", `points=${gotToday?.points?.integerValue}`);

  // 6. shared notes (pairs/{pairKey}/notes)
  const pairKey = [hus.uid, wifeUid].sort().join("|");
  const noteId = "n" + STAMP;
  r = await doc(hus.tok, `pairs/${encodeURIComponent(pairKey)}/notes?documentId=${noteId}`, { author: S(hus.uid), text: S("বাজার থেকে আলু কিনে আসো"), done: { booleanValue: false }, doneBy: { nullValue: null }, createdAt: S(new Date().toISOString()) });
  ok("mirrorNoteAdd (husband writes from market)", r.status === 200);

  // wife listens (ordered query like listenNotes)
  const nq = await query(wif.tok, `pairs/${encodeURIComponent(pairKey)}/notes`, "author", hus.uid);
  ok("listenNotes: wife sees husband's note realtime", nq.status === 200 && nq.docs.length === 1, `count=${nq.docs.length} ${nq.err || ""}`);
  const noteText = nq.docs[0]?.fields?.text?.stringValue;
  ok("note text intact (Bangla)", noteText === "বাজার থেকে আলু কিনে আসো", noteText || "");

  // 7. wife toggles done (updateDoc patch)
  r = await doc(wif.tok, `pairs/${encodeURIComponent(pairKey)}/notes/${noteId}`, { done: { booleanValue: true }, doneBy: S(wifeUid) }, "PATCH");
  ok("mirrorNoteUpdate (wife checks it off)", r.status === 200);

  // 8. cleanup everything
  await doc(hus.tok, `usersIndex/${hus.uid}`, {}, "DELETE");
  await doc(wif.tok, `usersIndex/${wifeUid}`, {}, "DELETE");
  await doc(hus.tok, `backups/${hus.uid}`, {}, "DELETE");
  await doc(wif.tok, `pairs/${encodeURIComponent(pairKey)}/notes/${noteId}`, {}, "DELETE");
  for (const [tag, t2] of [["hus", hus], ["wif", wif]]) {
    const dr = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: t2.tok }),
    });
    console.log(`cleanup ${tag}: auth ${dr.status}`);
  }

  console.log(`\n== RESULT: ${pass} passed, ${fail} failed ==`);
  process.exit(fail ? 1 : 0);
})();

function daySummaryFields(o) {
  const out = {};
  for (const [k, v] of Object.entries(o)) {
    if (v === null) out[k] = { nullValue: null };
    else if (typeof v === "number") out[k] = Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    else if (typeof v === "boolean") out[k] = { booleanValue: v };
    else if (typeof v === "string") out[k] = { stringValue: v };
    else if (Array.isArray(v)) out[k] = { arrayValue: { values: v.map((x) => (typeof x === "boolean" ? { booleanValue: x } : { stringValue: String(x) })) } };
    else if (typeof v === "object") {
      const inner = {};
      for (const [k2, v2] of Object.entries(v)) inner[k2] = { integerValue: String(v2) };
      out[k] = { mapValue: { fields: inner } };
    }
  }
  return out;
}
