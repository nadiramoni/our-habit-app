// Cross-user read tests: can wife READ husband's backups doc? (partner card needs this)
const KEY = "AIzaSyAfnGjQ22LCDaJTDqj2cogaQ8NkLd1FdSY";
const PROJ = "our-habit-61587";
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJ}/databases/(default)/documents`;
const STAMP = Date.now().toString(36);

async function signUp(tag) {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: `xu.${tag}.${STAMP}@ourhabit-test.local`, password: "xPass123!", returnSecureToken: true }),
  });
  const j = await r.json();
  return { tok: j.idToken, uid: j.localId };
}

(async () => {
  const a = await signUp("a");
  const b = await signUp("b");
  const H = { "Content-Type": "application/json", Authorization: `Bearer ${a.tok}` };

  // A writes a doc
  let r = await fetch(`${BASE}/backups/${a.uid}?key=${KEY}`, {
    method: "PATCH",
    headers: H,
    body: JSON.stringify({ fields: { marker: { stringValue: "A-data" } } }),
  });
  console.log("A writes own backups doc:", r.status);

  // B reads A's doc (the partner-card path)
  r = await fetch(`${BASE}/backups/${a.uid}?key=${KEY}`, { headers: { Authorization: `Bearer ${b.tok}` } });
  const j = r.ok ? await r.json() : await r.text();
  console.log("B (other user) reads A's backups doc:", r.status, typeof j === "string" ? j.slice(0, 120) : JSON.stringify(j.fields));

  // unauth read
  r = await fetch(`${BASE}/backups/${a.uid}?key=${KEY}`);
  console.log("UNAUTH read A's backups doc:", r.status);

  // B reads a note inside a pair subcollection (A wrote it)
  const pairKey = a.uid + "|" + b.uid;
  r = await fetch(`${BASE}/pairs/${encodeURIComponent(pairKey)}/notes?documentId=n9&key=${KEY}`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ fields: { text: { stringValue: "market list" } } }),
  });
  console.log("A writes pair note:", r.status);
  r = await fetch(`${BASE}/pairs/${encodeURIComponent(pairKey)}/notes/n9?key=${KEY}`, { headers: { Authorization: `Bearer ${b.tok}` } });
  const j2 = r.ok ? await r.json() : await r.text();
  console.log("B reads A's note (direct doc get):", r.status, typeof j2 === "string" ? j2.slice(0, 100) : JSON.stringify(j2.fields));

  // cleanup
  await fetch(`${BASE}/backups/${a.uid}?key=${KEY}`, { method: "DELETE", headers: H });
  await fetch(`${BASE}/pairs/${encodeURIComponent(pairKey)}/notes/n9?key=${KEY}`, { method: "DELETE", headers: H });
  for (const t of [a.tok, b.tok]) {
    await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: t }),
    });
  }
  console.log("cleanup done");
  process.exit(0);
})();
