// Probe what the owner's CURRENT Firestore rules actually allow (REST, web API key).
const KEY = "AIzaSyAfnGjQ22LCDaJTDqj2cogaQ8NkLd1FdSY";
const PROJ = "our-habit-61587";
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJ}/databases/(default)/documents`;

async function run(name, fn) {
  try {
    const out = await fn();
    console.log(`${name}: ${out}`);
  } catch (e) {
    console.log(`${name}: ERR ${String(e.message || e).slice(0, 120)}`);
  }
}

async function writeDoc(path, fields) {
  const r = await fetch(`${BASE}/${path}?key=${KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields }),
  });
  return r.status;
}
async function readDoc(path) {
  const r = await fetch(`${BASE}/${path}?key=${KEY}`);
  return r.status;
}
async function delDoc(path) {
  const r = await fetch(`${BASE}/${path}?key=${KEY}`, { method: "DELETE" });
  return r.status;
}
const S = (v) => ({ stringValue: v });

(async () => {
  // 1. read app/meta (needed for APK ads + force-update!)
  await run("READ  app/meta", async () => {
    const s = await readDoc("app/meta");
    return s === 200 ? "200 OK ✅" : s;
  });

  // 2. write profiles/__rules_probe
  await run("WRITE profiles/__rules_probe", async () => {
    const s = await writeDoc("profiles?documentId=__rules_probe", { probe: S("v13") });
    if (s === 200) await delDoc("profiles/__rules_probe");
    return s === 200 ? "200 OK ✅" : s;
  });

  // 3. write pairs/__probe/notes/__probe
  await run("WRITE pairs/__probe/notes/__probe", async () => {
    const s = await writeDoc("pairs/__probe/notes?documentId=__probe", { text: S("v13") });
    if (s === 200) await delDoc("pairs/__probe/notes/__probe");
    return s === 200 ? "200 OK ✅" : s;
  });

  // 4. write backups/__probe
  await run("WRITE backups/__probe", async () => {
    const s = await writeDoc("backups?documentId=__probe", { probe: S("v13") });
    if (s === 200) await delDoc("backups/__probe");
    return s === 200 ? "200 OK ✅" : s;
  });

  // 5. list profiles (query needs different index/rules — used by addFriendByCode)
  await run("QUERY profiles by inviteCode", async () => {
    const r = await fetch(
      `${BASE}:runQuery?key=${KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          structuredQuery: {
            from: [{ collectionId: "profiles" }],
            where: { fieldFilter: { field: { fieldPath: "inviteCode" }, op: "EQUAL", value: { stringValue: "ZZZZZZ" } } },
            limit: 1,
          },
        }),
      }
    );
    const j = await r.json();
    if (j.error) return `ERR ${j.error.message.slice(0, 90)}`;
    return r.status === 200 ? "200 OK ✅" : r.status;
  });

  process.exit(0);
})();
