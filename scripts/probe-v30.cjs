// v3.0 round-12 probe: WHY is Google login failing + what do the Firestore
// rules actually allow (for the new admin website)?
// 1) Google provider status: signInWithIdp with a dummy idToken
//    OPERATION_NOT_ALLOWED → provider DISABLED (the likely Google bug!)
//    INVALID_IDP_RESPONSE / anything else → provider ENABLED
// 2) Rules: create a temp user, then try Firestore writes to
//    app/meta, usersIndex/{uid}, backups/{uid}, devices/{id} → then clean up.
const KEY = "AIzaSyAfnGjQ22LCDaJTDqj2cogaQ8NkLd1FdSY";
const PID = "our-habit-61587";

async function j(url, opts) {
  const r = await fetch(url, opts);
  const d = await r.json().catch(() => ({}));
  return { status: r.status, d };
}

async function main() {
  console.log("=== 1. Google sign-in provider check (signInWithIdp, dummy token) ===");
  const g = await j(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      postBody: "id_token=dummyprobe&providerId=google.com",
      requestUri: `https://${PID}.firebaseapp.com/__/auth/handler`,
      returnSecureToken: true,
    }),
  });
  const gmsg = g.d?.error?.message || "";
  if (gmsg.includes("OPERATION_NOT_ALLOWED")) {
    console.log("❌❌ ROOT CAUSE FOUND: Google provider DISABLED in Firebase Console!");
    console.log("   → owner must enable: Authentication → Sign-in method → Google → Enable");
  } else if (gmsg.includes("INVALID_IDP_RESPONSE") || gmsg.includes("INVALID_CREDENTIAL") || gmsg.includes("id_token")) {
    console.log("✅ Google provider: ENABLED (rejected our dummy token as expected: " + gmsg.slice(0, 60) + ")");
  } else {
    console.log("⚠️ Unexpected:", g.status, gmsg.slice(0, 120));
  }

  console.log("\n=== 2. Password reset email probe (sendOobCode, fake user) ===");
  const pr = await j(`https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requestType: "PASSWORD_RESET", email: "nonexistent-probe@ourhabit-test.local" }),
  });
  console.log(pr.status === 200 ? "✅ PASSWORD_RESET email API works (always 200 — even unknown emails)" : "⚠️ " + pr.status + " " + (pr.d?.error?.message || "").slice(0, 100));

  console.log("\n=== 3. Firestore rules probe (temp user) ===");
  const TEST = "oh-probe-" + Date.now() + "@ourhabit-test.local";
  const su = await j(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: TEST, password: "probe123456", returnSecureToken: true }),
  });
  if (su.status !== 200) {
    console.log("❌ could not create probe user:", su.status, su.d?.error?.message);
    return;
  }
  const tok = su.d.idToken;
  const uid = su.d.localId;
  const fsBase = `https://firestore.googleapis.com/v1/projects/${PID}/databases/(default)/documents`;

  async function tryWrite(label, path, body) {
    const r = await j(`${fsBase}/${path}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
      body: JSON.stringify(body),
    });
    const ok = r.status === 200;
    console.log(`${ok ? "✅" : "❌"} ${label}: ${ok ? "WRITE OK" : r.status + " " + (r.d?.error?.message || "").slice(0, 80)}`);
    return ok;
  }

  const w1 = await tryWrite("usersIndex/{uid} write (admin site user list + ban)", `usersIndex/${uid}?currentDocument.exists=false`, {
    fields: { name: { stringValue: "Probe" }, email: { stringValue: TEST }, provider: { stringValue: "password" } },
  });
  const w2 = await tryWrite("app/meta write (admin site ads save)", `app/meta?updateMask.fieldPaths=probe`, {
    fields: { probe: { stringValue: "1" } },
  });
  await tryWrite("backups/{uid} write (stats)", `backups/${uid}`, {
    fields: { probe: { stringValue: "1" } },
  });
  await tryWrite("devices/{id} write (no-account ping)", `devices/probe-device?currentDocument.exists=false`, {
    fields: { v: { stringValue: "3.0.0" }, seen: { integerValue: String(Date.now()) } },
  });

  // list usersIndex (admin site needs this)
  const ls = await j(`${fsBase}/usersIndex?pageSize=5`, { headers: { Authorization: `Bearer ${tok}` } });
  console.log(`${ls.status === 200 ? "✅" : "❌"} usersIndex LIST: ${ls.status === 200 ? (ls.d.documents || []).length + " docs (readable)" : (ls.d?.error?.message || "").slice(0, 80)}`);

  // public read of app/meta (no auth)
  const pub = await j(`${fsBase}/app/meta`);
  console.log(`${pub.status === 200 ? "✅" : "❌"} app/meta PUBLIC read: ${pub.status === 200 ? "OK" : (pub.d?.error?.message || "").slice(0, 80)}`);

  // cleanup: delete written docs + the probe user
  if (w1) await j(`${fsBase}/usersIndex/${uid}`, { method: "DELETE", headers: { Authorization: `Bearer ${tok}` } });
  if (w2) {
    // remove probe field by deleting just that field via updateMask trick — simplest: delete whole doc? DANGEROUS: app/meta holds live cfg!
    // Never delete app/meta. Instead we wrote only via updateMask=probe — remove the probe field:
    await j(`https://firestore.googleapis.com/v1/projects/${PID}/databases/(default)/documents/app/meta?updateMask.fieldPaths=probe`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ fields: {} }),
    }).then((r) => console.log(r.status === 200 ? "🧹 app/meta probe field cleared" : "⚠️ probe field clear: " + r.status));
  }
  const del = await j(`https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken: tok }),
  });
  console.log(del.status === 200 ? "🧹 probe user deleted" : "⚠️ delete failed: " + del.status);
}

main().catch((e) => { console.error("probe failed:", e.message); process.exit(1); });
