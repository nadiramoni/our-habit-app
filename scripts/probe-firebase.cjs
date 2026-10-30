// Probes the owner's Firebase project to see WHICH services are enabled.
// Tells us exactly what the owner still must click in the console.
const KEY = "AIzaSyAfnGjQ22LCDaJTDqj2cogaQ8NkLd1FdSY";
const PID = "our-habit-61587";

async function j(url, opts) {
  const r = await fetch(url, opts);
  const d = await r.json().catch(() => ({}));
  return { status: r.status, d };
}

async function main() {
  console.log("=== 1. Firestore Database check ===");
  const fs = await j(
    `https://firestore.googleapis.com/v1/projects/${PID}/databases/(default)/documents?pageSize=1&key=${KEY}`
  );
  if (fs.status === 200) console.log("✅ Firestore: CREATED & readable (test mode or open rules)");
  else console.log("❌ Firestore:", fs.status, JSON.stringify(fs.d.error || fs.d).slice(0, 200));

  console.log("\n=== 2. Auth — Email/Password check ===");
  const TEST = "oh-probe-" + Date.now() + "@ourhabit-test.local";
  const su = await j(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: TEST, password: "probe123456", returnSecureToken: true }),
  });
  const code = su.d?.error?.message;
  if (su.status === 200) {
    console.log("✅ Email/Password auth: ENABLED (created probe user, now deleting)");
    const tok = su.d.idToken;
    const del = await j(`https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: tok }),
    });
    console.log(del.status === 200 ? "   🧹 probe user deleted" : "   ⚠️ delete failed: " + del.status);
  } else if (code === "OPERATION_NOT_ALLOWED") {
    console.log("❌ Email/Password auth: DISABLED → owner must enable in console");
  } else {
    console.log("❌ Auth check:", su.status, code);
  }

  console.log("\n=== 3. Auth — anonymous probe (does Identity Toolkit respond at all) ===");
  const an = await j(`https://identitytoolkit.googleapis.com/v1/projects?key=${KEY}`);
  console.log("Identity Toolkit API:", an.status === 200 ? "reachable" : an.status);
}

main().catch((e) => { console.error("probe failed:", e.message); process.exit(1); });
