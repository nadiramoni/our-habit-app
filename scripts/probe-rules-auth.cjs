// Probe Firestore rules AS A SIGNED-IN USER (exactly what the app does).
const KEY = "AIzaSyAfnGjQ22LCDaJTDqj2cogaQ8NkLd1FdSY";
const PROJ = "our-habit-61587";
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJ}/databases/(default)/documents`;

const STAMP = Date.now().toString(36);
const EMAIL = `oh.probe.${STAMP}@ourhabit-test.local`;
const PASS = "probePass9x!";

async function signUp() {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASS, returnSecureToken: true }),
  });
  const j = await r.json();
  if (j.error) throw new Error("signup: " + j.error.message);
  return j.idToken;
}

async function wr(tok, path, fields, method = "POST") {
  const url = method === "POST" ? `${BASE}/${path}?key=${KEY}` : `${BASE}/${path}?key=${KEY}`;
  const r = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
    body: method === "POST" ? JSON.stringify({ fields }) : undefined,
  });
  return r.status;
}
async function rd(tok, path) {
  const r = await fetch(`${BASE}/${path}?key=${KEY}`, { headers: { Authorization: `Bearer ${tok}` } });
  return r.status;
}
async function dl(tok, path) {
  const r = await fetch(`${BASE}/${path}?key=${KEY}`, { method: "DELETE", headers: { Authorization: `Bearer ${tok}` } });
  return r.status;
}
const S = (v) => ({ stringValue: v });

(async () => {
  let tok;
  try {
    tok = await signUp();
  } catch (e) {
    console.log("SIGNUP FAILED:", e.message);
    process.exit(1);
  }
  console.log("signed up probe user OK");

  const F = { probe: S("v13auth"), owner: S(tok.slice(0, 10)) };

  await run("AUTH-WRITE profiles/{uid}", () => wr(tok, "profiles?documentId=probe_" + STAMP, F));
  await run("AUTH-READ  profiles/{uid}", () => rd(tok, "profiles/probe_" + STAMP));
  await run("AUTH-WRITE profiles/{uid}/days/{d}", () => wr(tok, "profiles/probe_" + STAMP + "/days?documentId=2026-01-01", F));
  await run("AUTH-WRITE app/meta (merge patch)", async () => {
    const r = await fetch(`${BASE}/app/meta?key=${KEY}&updateMask.probe=x`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ fields: { probe: S("v13auth") } }),
    });
    return r.status;
  });
  await run("AUTH-WRITE usersIndex/{uid}", () => wr(tok, "usersIndex?documentId=probe_" + STAMP, F));
  await run("AUTH-QUERY profiles by inviteCode", async () => {
    const r = await fetch(`${BASE}:runQuery?key=${KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: "profiles" }],
          where: { fieldFilter: { field: { fieldPath: "inviteCode" }, op: "EQUAL", value: { stringValue: "ZZZZZZ" } } },
          limit: 1,
        },
      }),
    });
    const j = await r.json();
    if (j.error) return "ERR " + j.error.message.slice(0, 90);
    return r.status === 200 ? "200 OK ✅" : r.status;
  });

  // cleanup: delete probe docs + auth user
  await dl(tok, "profiles/probe_" + STAMP);
  await dl(tok, "usersIndex/probe_" + STAMP);
  const dr = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken: tok }),
  });
  console.log("cleanup auth delete:", dr.status);

  async function run(name, fn) {
    try {
      console.log(`${name}: ${await fn()}`);
    } catch (e) {
      console.log(`${name}: ERR ${String(e.message || e).slice(0, 100)}`);
    }
  }
  process.exit(0);
})();
