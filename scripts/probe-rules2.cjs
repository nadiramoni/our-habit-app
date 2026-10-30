// Follow-up probes: app/meta write (proper), usersIndex read/query/subcollection.
const KEY = "AIzaSyAfnGjQ22LCDaJTDqj2cogaQ8NkLd1FdSY";
const PROJ = "our-habit-61587";
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJ}/databases/(default)/documents`;
const STAMP = Date.now().toString(36);
const EMAIL = `oh.probe.${STAMP}@ourhabit-test.local`;
const PASS = "probePass9x!";

const S = (v) => ({ stringValue: v });
async function signUp() {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASS, returnSecureToken: true }),
  });
  return (await r.json()).idToken;
}

(async () => {
  const tok = await signUp();
  const H = { "Content-Type": "application/json", Authorization: `Bearer ${tok}` };

  // 1. app/meta proper PATCH (no updateMask → full replace of existing fields)
  let r = await fetch(`${BASE}/app/meta?key=${KEY}`, {
    method: "PATCH",
    headers: H,
    body: JSON.stringify({ fields: { probeTest: S("v13") } }),
  });
  console.log("AUTH-PATCH app/meta:", r.status);

  // 2. app/meta read back
  r = await fetch(`${BASE}/app/meta?key=${KEY}`);
  console.log("READ app/meta:", r.status);

  // 3. usersIndex read someone else's doc (needed to add friend)
  r = await fetch(`${BASE}/usersIndex?documentId=probeB_${STAMP}&key=${KEY}`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ fields: { inviteCode: S("ZZZZZZ"), name: S("B") } }),
  });
  console.log("AUTH-WRITE usersIndex probeB:", r.status);
  r = await fetch(`${BASE}/usersIndex/probeB_${STAMP}?key=${KEY}`, { headers: H });
  console.log("AUTH-READ usersIndex/probeB:", r.status);

  // 4. usersIndex query by inviteCode (needed for add-by-code)
  r = await fetch(`${BASE}:runQuery?key=${KEY}`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "usersIndex" }],
        where: { fieldFilter: { field: { fieldPath: "inviteCode" }, op: "EQUAL", value: { stringValue: "ZZZZZZ" } } },
        limit: 1,
      },
    }),
  });
  const j = await r.json();
  console.log("AUTH-QUERY usersIndex inviteCode:", j.error ? "ERR " + j.error.message.slice(0, 80) : r.status);

  // 5. usersIndex subcollection days
  r = await fetch(`${BASE}/usersIndex/probe_${STAMP}/days?documentId=2026-01-01&key=${KEY}`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ fields: { points: { integerValue: "5" } } }),
  });
  console.log("AUTH-WRITE usersIndex/{uid}/days/{d}:", r.status);

  // 6. cleanup
  await fetch(`${BASE}/usersIndex/probe_${STAMP}?key=${KEY}`, { method: "DELETE", headers: H });
  await fetch(`${BASE}/usersIndex/probeB_${STAMP}?key=${KEY}`, { method: "DELETE", headers: H });
  // restore meta: remove probeTest field by rewriting minimal
  await fetch(`${BASE}/app/meta?key=${KEY}`, {
    method: "PATCH",
    headers: H,
    body: JSON.stringify({ fields: {} }),
  });
  await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken: tok }),
  });
  console.log("cleanup done");
  process.exit(0);
})();
