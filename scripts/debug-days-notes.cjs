// Debug: write days map + note, then read back raw to see what the harness missed.
const KEY = "AIzaSyAfnGjQ22LCDaJTDqj2cogaQ8NkLd1FdSY";
const PROJ = "our-habit-61587";
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJ}/databases/(default)/documents`;
const STAMP = Date.now().toString(36);
const S = (v) => ({ stringValue: v });

(async () => {
  const su = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: `dbg.${STAMP}@ourhabit-test.local`, password: "dbgPass123!", returnSecureToken: true }),
  });
  const { idToken: tok, localId: uid } = await su.json();
  const H = { "Content-Type": "application/json", Authorization: `Bearer ${tok}` };
  const today = new Date().toISOString().slice(0, 10);

  // write days map (same as pushDay)
  const fields = { days: { mapValue: { fields: { [today]: { mapValue: { fields: { points: { integerValue: "18" }, mood: { integerValue: "4" } } } } } } } };
  let r = await fetch(`${BASE}/backups/${uid}?key=${KEY}`, { method: "PATCH", headers: H, body: JSON.stringify({ fields }) });
  console.log("write days:", r.status);

  // read raw
  r = await fetch(`${BASE}/backups/${uid}?key=${KEY}`, { headers: H });
  const j = await r.json();
  console.log("read days raw:", JSON.stringify(j.fields, null, 1).slice(0, 400));

  // subcollection query via runQuery (the REST way to do what listenNotes does)
  const pairKey = uid + "|" + "OTHERUID";
  await fetch(`${BASE}/pairs/${encodeURIComponent(pairKey)}/notes?documentId=n1&key=${KEY}`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ fields: { text: S("hello"), createdAt: S(new Date().toISOString()) } }),
  });
  const qr = await fetch(`${BASE}:runQuery?key=${KEY}`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: `pairs/${pairKey}/notes` }] } }),
  });
  const qj = await qr.json();
  console.log("query notes with plain pipe path:", qr.status, JSON.stringify(qj).slice(0, 200));

  const qr2 = await fetch(`${BASE}:runQuery?key=${KEY}`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: `pairs/${encodeURIComponent(pairKey)}/notes` }] } }),
  });
  const qj2 = await qr2.json();
  console.log("query notes with encoded pipe path:", qr2.status, JSON.stringify(qj2).slice(0, 200));

  // cleanup
  await fetch(`${BASE}/backups/${uid}?key=${KEY}`, { method: "DELETE", headers: H });
  await fetch(`${BASE}/pairs/${encodeURIComponent(pairKey)}/notes/n1?key=${KEY}`, { method: "DELETE", headers: H });
  await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken: tok }),
  });
  console.log("cleanup done");
  process.exit(0);
})();
