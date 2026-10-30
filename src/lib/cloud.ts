 
"use client";

/**
 * cloud.ts — the owner's OWN Firebase bridge.
 *
 * Where the config comes from (first match wins):
 *   1. server cfg  → /api/config → cfg.firebase (owner saved it in the secret admin panel)
 *   2. baked cfg   → firebase-baked.ts (injected at APK build time via GitHub secret)
 *   3. local test  → localStorage "oh-fb-test" (owner testing before saving)
 *
 * Everything degrades gracefully: no config → every function is a no-op,
 * app keeps working exactly as before (offline-first, server pairing).
 *
 * v2.9 LOGIN ROOT-CAUSE FIXES (owner: "সাদা হয়ে যায় — লগইন/সাইন আপ কোনোটাই
 * কাজ করতেছে না"):
 *   • AUTH PERSISTENCE = localStorage (browserLocalPersistence). The SDK's
 *     DEFAULT IndexedDB persistence can HANG forever inside the Android
 *     WebView (its auth IndexedDB open never completes on some OEM WebViews)
 *     → every sign-in call waited on that dead promise → the button stayed
 *     "..." forever. localStorage is synchronous and 100% WebView-safe —
 *     AND it is shared with the OhKeepAliveService headless WebView (same
 *     origin), which is how background chat notifications restore the
 *     session.
 *   • Google sign-in = NATIVE account picker (GoogleAuthPlugin) inside the
 *     APK → idToken → signInWithCredential. The old signInWithPopup opened
 *     the system browser (Firefox) at a blank firebaseapp.com page and the
 *     promise never resolved (the white-screen bug).
 *   • EVERY auth call is wrapped in a 25s TIMEOUT — the UI can NEVER get
 *     stuck on "..." again; a loud Bengali error with the raw Firebase code
 *     is shown instead.
 */

import { AppState, ServerCfg, SharedNoteItem } from "./types";
import { BAKED_FIREBASE } from "./firebase-baked";

type AnyRec = Record<string, unknown>;

let fbApp: any = null;
let fsDb: any = null;
let fbAuth: any = null;
let initErr = "";

export interface FbStatus {
  configured: boolean;
  projectId: string;
  error: string;
}

function parseCfg(raw: string): AnyRec | null {
  try {
    const o = JSON.parse(raw) as AnyRec;
    return o && o.apiKey && o.projectId ? o : null;
  } catch {
    return null;
  }
}

export function currentFbRaw(serverCfg?: Partial<ServerCfg> | null): string | null {
  const fromServer = serverCfg?.firebase?.on ? serverCfg.firebase.config : null;
  if (fromServer && parseCfg(fromServer)) return fromServer;
  if (BAKED_FIREBASE && parseCfg(BAKED_FIREBASE)) return BAKED_FIREBASE;
  try {
    const local = localStorage.getItem("oh-fb-test");
    if (local && parseCfg(local)) return local;
  } catch {
    /* ignore */
  }
  return null;
}

/** Lazily initialize Firebase (dynamic import → tiny chunk only when used). */
export async function ensureFirebase(serverCfg?: Partial<ServerCfg> | null): Promise<FbStatus> {
  if (fbApp && fsDb) {
    return { configured: true, projectId: (fbApp.options?.projectId as string) || "", error: "" };
  }
  if (initErr) return { configured: false, projectId: "", error: initErr };
  const raw = currentFbRaw(serverCfg);
  if (!raw) return { configured: false, projectId: "", error: "" };
  const cfgObj = parseCfg(raw);
  if (!cfgObj) return { configured: false, projectId: "", error: "bad_config" };
  try {
    const [{ initializeApp, getApps, getApp }, { getFirestore }] = await Promise.all([
      import("firebase/app"),
      import("firebase/firestore"),
    ]);
    fbApp = getApps().length ? getApp() : initializeApp(cfgObj);
    fsDb = getFirestore(fbApp);
    return { configured: true, projectId: (cfgObj.projectId as string) || "", error: "" };
  } catch (e) {
    initErr = String(e);
    return { configured: false, projectId: "", error: initErr };
  }
}

/**
 * v2.9: the SHARED auth instance — initialized with localStorage-based
 * persistence (browserLocalPersistence), NOT the SDK default IndexedDB.
 * • fixes the WebView hang ("..." forever) on realme/Oppo/vivo WebViews
 * • the OhKeepAliveService headless WebView loads chat-listener.html on the
 *   SAME https://localhost origin → reads the SAME localStorage key → the
 *   session is restored there for background chat notifications.
 * Never throws: falls back to getAuth() when initializeAuth is unavailable.
 */
async function getFbAuth(): Promise<any> {
  const st = await ensureFirebase();
  if (!st.configured || !fbApp) throw new Error("not_configured");
  if (fbAuth) return fbAuth;
  const authMod: any = await import("firebase/auth");
  try {
    fbAuth = authMod.initializeAuth(fbApp, {
      persistence: [authMod.browserLocalPersistence, authMod.browserSessionPersistence],
    });
  } catch {
    fbAuth = authMod.getAuth(fbApp);
  }
  return fbAuth;
}

/**
 * v2.9: never let the UI hang again — every auth promise is raced against a
 * hard timeout. The white-screen bug left the sign-in button on "..."
 * forever because the underlying promise never settled.
 */
function withTimeout<T>(p: Promise<T>, ms = 25000, label = "timeout"): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(label)), ms)),
  ]);
}

export function fbConfigured(serverCfg?: Partial<ServerCfg> | null): boolean {
  return Boolean(currentFbRaw(serverCfg));
}

// ---------- Auth (Google sign-in for personal backup) ----------

/** web client id (client_type 3 of google-services.json — stable). */
const GOOGLE_WEB_CLIENT_ID = "570611135763-otc19ruqa5vs6dbl44982559iqhpp8de.apps.googleusercontent.com";

export interface GoogleSignInResult {
  ok: boolean;
  name?: string;
  email?: string;
  /** raw machine code — AuthGate maps it to a clear Bengali message */
  error?: string;
}

/**
 * v2.9 GOOGLE SIGN-IN — two REAL paths, zero popups:
 *  • APK  → GoogleAuthPlugin.signIn() (native account picker sheet slides up
 *           INSIDE the app, Play Services returns a real idToken) →
 *           signInWithCredential(GoogleAuthProvider.credential(idToken)).
 *           No browser, no redirect, no white screen — works on every phone.
 *  • Web  → signInWithPopup as before (browsers handle popups fine).
 */
export async function fbGoogleSignIn(serverCfg?: Partial<ServerCfg> | null): Promise<GoogleSignInResult> {
  const st = await ensureFirebase(serverCfg);
  if (!st.configured) return { ok: false, error: "errNetwork" };
  try {
    let idToken: string | null = null;
    let gName = "";
    let gEmail = "";

    const isNative =
      typeof window !== "undefined" &&
      Boolean((window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } })?.Capacitor?.isNativePlatform?.());

    if (isNative) {
      // ---- NATIVE: the real account picker ----
      const gplugin: any = (window as unknown as { Capacitor?: { Plugins?: Record<string, any> } })?.Capacitor?.Plugins?.GoogleAuth;
      if (!gplugin?.signIn) return { ok: false, error: "errNativePlugin" };
      try {
        const res = (await withTimeout(gplugin.signIn({ webClientId: GOOGLE_WEB_CLIENT_ID }), 60000, "timeout")) as {
          idToken?: string; email?: string; name?: string;
        };
        idToken = res?.idToken || null;
        gName = res?.name || "";
        gEmail = res?.email || "";
      } catch (e) {
        const msg = String((e as { code?: string })?.code || (e as { message?: string })?.message || e || "");
        if (msg.includes("cancelled")) return { ok: false, error: "errCancelled" };
        if (msg.includes("google_10") || msg.includes("DEVELOPER_ERROR")) return { ok: false, error: "errSha1" };
        if (msg.includes("timeout")) return { ok: false, error: "errTimeout" };
        return { ok: false, error: `errGoogle:${msg.slice(0, 60)}` };
      }
      if (!idToken) return { ok: false, error: "errNoToken" };
    }

    const [{ GoogleAuthProvider, signInWithCredential, signInWithPopup, signInWithRedirect }, { doc, setDoc }] = await Promise.all([
      import("firebase/auth"),
      import("firebase/firestore"),
    ]);
    const auth = await getFbAuth();

    let u: any = null;
    if (idToken) {
      const cred = GoogleAuthProvider.credential(idToken);
      const res = await withTimeout(signInWithCredential(auth, cred), 25000, "timeout");
      u = res?.user ?? null;
    } else {
      // ---- WEB: popup first; if the popup is blocked or the browser kills
      // it, fall back to a FULL-PAGE redirect (survives every mobile
      // browser). unauthorized-domain is surfaced separately because a
      // redirect can NEVER fix that — the owner must whitelist the domain.
      try {
        const res = await withTimeout(signInWithPopup(auth, new GoogleAuthProvider()), 60000, "timeout");
        u = res?.user ?? null;
      } catch (popErr) {
        const pc = String((popErr as { code?: string })?.code || "");
        if (pc.includes("unauthorized-domain")) return { ok: false, error: "errDomain" };
        if (pc.includes("user-disabled")) return { ok: false, error: "errBanned" };
        if (pc.includes("cancelled") || pc.includes("closed-by-user")) return { ok: false, error: "errCancelled" };
        if (pc.includes("timeout")) return { ok: false, error: "errTimeout" };
        // popup blocked / operation-not-supported → redirect flow: the page
        // navigates away; on return the auth listener picks the user up.
        await withTimeout(signInWithRedirect(auth, new GoogleAuthProvider()), 15000, "timeout");
        return { ok: false, error: "errRedirecting" };
      }
    }
    if (u?.uid) {
      try {
        // v3.2: provider recorded → the CLOUD admin panel (GitHub Pages, no
        // server) can show Google vs Email for every account.
        await setDoc(doc(fsDb!, "usersIndex", u.uid), { name: u.displayName || gName || "", email: u.email || gEmail || "", provider: "google" }, { merge: true });
      } catch {
        /* profile write is best-effort */
      }
      return { ok: true, name: u.displayName || gName || "", email: u.email || gEmail || "" };
    }
    return { ok: false, error: "errNoUser" };
  } catch (e) {
    const code = String((e as { code?: string })?.code || (e as Error)?.message || e || "");
    if (code.includes("unauthorized-domain")) return { ok: false, error: "errDomain" };
    if (code.includes("user-disabled")) return { ok: false, error: "errBanned" };
    if (code.includes("popup")) return { ok: false, error: "errPopupBlocked" };
    if (code.includes("timeout")) return { ok: false, error: "errTimeout" };
    return { ok: false, error: `errGoogle:${code.slice(0, 60)}` };
  }
}

/**
 * v3.0: after a signInWithRedirect round-trip the page reloads — call this
 * ONCE on boot. It consumes the redirect result (user already restored by
 * the auth listener) and surfaces any redirect error loud and clear.
 */
export async function fbHandleRedirect(): Promise<string | null> {
  try {
    const { getRedirectResult } = await import("firebase/auth");
    const auth = await getFbAuth();
    await withTimeout(getRedirectResult(auth), 20000, "timeout");
    return null;
  } catch (e) {
    const code = String((e as { code?: string })?.code || "");
    if (code.includes("unauthorized-domain")) return "errDomain";
    if (code.includes("user-disabled")) return "errBanned";
    return null; // silent — the auth listener still handles the success path
  }
}

/**
 * v3.0 FORGOT PASSWORD: Firebase emails the user a secure reset LINK —
 * they click it in their inbox and set a new password themselves. Works
 * for any registered email; never reveals whether the account exists.
 */
export async function fbSendPasswordReset(email: string, serverCfg?: Partial<ServerCfg> | null): Promise<{ ok: boolean; error?: string }> {
  const st = await ensureFirebase(serverCfg);
  if (!st.configured) return { ok: false, error: "errNetwork" };
  try {
    const { sendPasswordResetEmail } = await import("firebase/auth");
    const auth = await getFbAuth();
    await withTimeout(sendPasswordResetEmail(auth, email.trim()), 25000, "timeout");
    return { ok: true };
  } catch (e) {
    const code = String((e as { code?: string })?.code || e || "");
    if (code.includes("invalid-email")) return { ok: false, error: "errInvalidEmail" };
    if (code.includes("user-not-found")) return { ok: false, error: "resetNoUser" };
    if (code.includes("too-many-requests")) return { ok: false, error: "errTooMany" };
    if (code.includes("network") || code.includes("timeout")) return { ok: false, error: "errNetwork" };
    return { ok: false, error: "errGeneric" };
  }
}

/** Sign out of BOTH Firebase and the native Google client (fresh account
 *  picker next time — the owner switches accounts). */
export async function fbSignOut(): Promise<void> {
  try {
    const { signOut } = await import("firebase/auth");
    await withTimeout(signOut(await getFbAuth()), 10000, "timeout").catch(() => undefined);
  } catch {
    /* ignore */
  }
  try {
    const gp: any = (window as unknown as { Capacitor?: { Plugins?: Record<string, any> } })?.Capacitor?.Plugins?.GoogleAuth;
    if (gp?.signOut) await gp.signOut().catch(() => undefined);
  } catch {
    /* ignore */
  }
}

/**
 * v2.8: set the user's REGISTERED full name everywhere (owner: the Gmail
 * account name must NOT be what people see — the registered first+last
 * name must). Updates the Firebase Auth displayName + the usersIndex
 * profile doc so friends/shared notes show the right name on every device.
 */
export async function fbUpdateProfileName(fullName: string): Promise<boolean> {
  const clean = (fullName || "").trim();
  if (!clean) return false;
  try {
    const [{ getAuth, updateProfile }, { doc, setDoc }] = await Promise.all([
      import("firebase/auth"),
      import("firebase/firestore"),
    ]);
    const u = getAuth(fbApp!).currentUser;
    if (u) {
      await updateProfile(u, { displayName: clean });
      await setDoc(doc(fsDb!, "usersIndex", u.uid), { name: clean }, { merge: true });
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export async function fbCurrentUser(): Promise<{ name: string; email: string } | null> {
  try {
    const { getAuth } = await import("firebase/auth");
    const u = getAuth(fbApp!).currentUser;
    return u ? { name: u.displayName || "", email: u.email || "" } : null;
  } catch {
    return null;
  }
}

// ---------- Full backup / restore + live day summaries ----------
// NOTE: we store EVERYTHING under backups/{uid}:  { state, days:{date:summary} }.
// Days live INSIDE the doc (not a subcollection) because the owner's Firestore
// rules allow the backups collection itself — verified live via REST probes.

export async function backupState(state: AppState, serverCfg?: Partial<ServerCfg> | null): Promise<boolean> {
  const st = await ensureFirebase(serverCfg);
  if (!st.configured) return false;
  try {
    const { doc, setDoc, serverTimestamp } = await import("firebase/firestore");
    const key = state.account?.uid || "local";
    // merge:true — never wipe the days map that pushDay keeps in the same doc
    await setDoc(
      doc(fsDb!, "backups", key),
      { state: JSON.parse(JSON.stringify(state)), updatedAt: serverTimestamp() },
      { merge: true }
    );
    return true;
  } catch {
    return false;
  }
}

export async function restoreState(username: string, serverCfg?: Partial<ServerCfg> | null): Promise<AppState | null> {
  const st = await ensureFirebase(serverCfg);
  if (!st.configured) return null;
  try {
    const { doc, getDoc } = await import("firebase/firestore");
    const snap = await getDoc(doc(fsDb!, "backups", username));
    if (!snap.exists()) return null;
    const data = snap.data() as { state?: AppState };
    return data.state ?? null;
  } catch {
    return null;
  }
}

// ---------- Remote meta (ads cfg + auto-update) for APK/static users ----------

export async function mirrorMeta(cfg: ServerCfg, serverCfg?: Partial<ServerCfg> | null): Promise<boolean> {
  const st = await ensureFirebase(serverCfg);
  if (!st.configured) return false;
  try {
    const { doc, setDoc, serverTimestamp } = await import("firebase/firestore");
    await setDoc(
      doc(fsDb!, "app", "meta"),
      { cfg: JSON.parse(JSON.stringify(cfg)), updatedAt: serverTimestamp() },
      { merge: true }
    );
    return true;
  } catch {
    return false;
  }
}

export async function fetchRemoteMeta(serverCfg?: Partial<ServerCfg> | null): Promise<Partial<ServerCfg> | null> {
  const st = await ensureFirebase(serverCfg);
  if (!st.configured) return null;
  try {
    const { doc, getDoc } = await import("firebase/firestore");
    const snap = await getDoc(doc(fsDb!, "app", "meta"));
    if (!snap.exists()) return null;
    const data = snap.data() as { cfg?: Partial<ServerCfg> | string };
    // accepts BOTH shapes: object (admin panel mirror) or JSON string (seed script)
    if (!data.cfg) return null;
    if (typeof data.cfg === "string") {
      try {
        return JSON.parse(data.cfg) as Partial<ServerCfg>;
      } catch {
        return null;
      }
    }
    return data.cfg as Partial<ServerCfg>;
  } catch {
    return null;
  }
}

/**
 * RAW meta read — returns the whole app/meta doc (including fields OUTSIDE
 * cfg, e.g. adminPin). Used by the in-app Admin Panel (APK has no server).
 */
export async function readRawMeta(): Promise<Record<string, unknown> | null> {
  const st = await ensureFirebase();
  if (!st.configured) return null;
  try {
    const { doc, getDoc } = await import("firebase/firestore");
    const snap = await getDoc(doc(fsDb!, "app", "meta"));
    if (!snap.exists()) return null;
    return snap.data() as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * RAW meta write — merges arbitrary top-level fields (cfg and/or adminPin)
 * into app/meta. Same write path the admin panel's mirror uses, so app
 * installs pick the values up on their next 5-minute config refresh.
 */
export async function writeRawMeta(fields: Record<string, unknown>): Promise<boolean> {
  const st = await ensureFirebase();
  if (!st.configured) return false;
  try {
    const { doc, setDoc, serverTimestamp } = await import("firebase/firestore");
    await setDoc(doc(fsDb!, "app", "meta"), { ...fields, updatedAt: serverTimestamp() }, { merge: true });
    return true;
  } catch {
    return false;
  }
}

// ---------- v4.2 (owner round-17): THE UPDATE-SAVE ROOT-CAUSE FIX ----------
// Symptom: opening the in-app admin panel and hitting Save on the auto-update
// card showed "সমস্যা হয়েছে — আবার চেষ্টা করো" and NO user ever received the
// update. Root cause: under the v4.0 Firestore rules, updating app/meta is
// only allowed for the CLAIMED admin (adminUid == the signed-in uid) — and
// the in-app panel never wrote adminUid (only the retired GitHub-Pages panel
// did), so every mirrorMeta() write was silently permission-denied.
// Fix: the panel now writes its own adminUid claim TOGETHER with the cfg
// (the rules' "first-claim" branch allows exactly that while adminUid is
// missing), and reports a precise reason so the UI can show a real fix
// instead of the generic error.
export type PanelSaveReason =
  | "ok"
  | "no-account" // not signed in — request.auth would be null
  | "not-configured" // Firebase config unavailable
  | "claimed-other" // admin already claimed by a DIFFERENT account
  | "denied" // rules rejected the write (old rules deployed?)
  | "offline";

export interface PanelSaveResult {
  reason: PanelSaveReason;
  adminEmail?: string; // who holds the claim (claimed-other)
}

export async function panelSaveCfg(
  cfg: ServerCfg,
  me: { uid: string; email?: string } | null
): Promise<PanelSaveResult> {
  if (!me?.uid) return { reason: "no-account" };
  const st = await ensureFirebase();
  if (!st.configured || !fsDb) return { reason: "not-configured" };
  try {
    const { doc, setDoc, serverTimestamp } = await import("firebase/firestore");
    await setDoc(
      doc(fsDb, "app", "meta"),
      {
        cfg: JSON.parse(JSON.stringify(cfg)),
        adminUid: me.uid, // claim (or re-confirm) THIS account as the admin
        adminEmail: me.email || "",
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    return { reason: "ok" };
  } catch (e) {
    const msg = String((e as { code?: string })?.code || (e as { message?: string })?.message || e || "");
    if (/permission|unauthorized/i.test(msg)) {
      // Reads are public — see who actually holds the claim.
      try {
        const raw = await readRawMeta();
        const claimedUid = raw && typeof raw.adminUid === "string" ? raw.adminUid : "";
        if (claimedUid && claimedUid !== me.uid) {
          const adminEmail = raw && typeof raw.adminEmail === "string" ? raw.adminEmail : "";
          return { reason: "claimed-other", adminEmail };
        }
      } catch {
        /* ignore */
      }
      return { reason: "denied" };
    }
    return { reason: "offline" };
  }
}

// ---------- Real-time shared notes (works even without our server) ----------

export function pairKeyOf(a: string, b: string): string {
  return [a, b].sort().join("|");
}

// ==================== v2.9: MESSENGER-STYLE CHAT (Share Notes) ====================
// Owner: "মেসেঞ্জারের মত চ্যাট — নামে ক্লিক করলে কে কী লিখল দেখব, ছবি পাঠানো
// যাবে, মেসেজ দিলে নোটিফিকেশন আসবে"।
// Storage reuses the ALREADY-ALLOWED pairs/{pairKey}/notes collection (the
// owner's Firestore rules permit it — verified via REST probes) with
// kind:"chat" docs. The notes UI filters them OUT; the chat UI shows ONLY
// them. No rule change, no server, real-time via the existing listener.
export interface ChatMsg {
  id: string;
  kind: "chat";
  from: string; // sender uid
  fromName: string; // sender's REGISTERED name
  text?: string;
  image?: string; // compressed dataURL (≤ ~700KB — Firestore doc limit safety)
  audio?: string; // v3.3: voice message — base64 dataURL of an .webm/.opus clip
  audioDur?: number; // v3.3: voice duration in seconds (for UI display)
  createdAt: number;
  // v5.0 (owner round-19): per-user “delete for me” — uids that hid this
  // message on their own phone. The doc STAYS (the friend still sees it);
  // every client filters out docs whose hiddenBy contains its own uid.
  hiddenBy?: string[];
}

/** Send a chat message (text and/or photo) to a paired friend. */
export type ChatSendResult = "sent" | "queued-offline" | "failed-permission" | "failed-other";
export async function fbSendChat(
  pairKey: string,
  msg: ChatMsg,
  serverCfg?: Partial<ServerCfg> | null
): Promise<ChatSendResult> {
  // v3.3: only show "offline" when the network is actually down. Permission-
  // denied and other errors get their own message so the user knows the real
  // reason instead of being told "offline" when they have signal.
  const isOffline = typeof navigator !== "undefined" && navigator.onLine === false;
  const st = await ensureFirebase(serverCfg);
  if (!st.configured) {
    if (isOffline) queueChatMessage(pairKey, msg);
    return isOffline ? "queued-offline" : "failed-other";
  }
  try {
    const { doc, setDoc } = await import("firebase/firestore");
    await setDoc(
      doc(fsDb!, "pairs", pairKey, "notes", msg.id),
      JSON.parse(JSON.stringify(msg)),
      { merge: true }
    );
    return "sent";
  } catch (e: any) {
    const code = String(e?.code || e || "");
    if (code.match(/unavailable|offline|network|failed-precondition/i)) {
      queueChatMessage(pairKey, msg);
      return "queued-offline";
    }
    if (code.includes("permission-denied") || code.includes("PERMISSION_DENIED")) {
      return "failed-permission";
    }
    // network truly down → queue for later (catches offline between ensureFirebase and setDoc)
    if (isOffline) {
      queueChatMessage(pairKey, msg);
      return "queued-offline";
    }
    return "failed-other";
  }
}

// ---------- v3.3: OFFLINE CHAT QUEUE (store-and-forward) ----------
// Owner: "নেট না থাকলেও চ্যাট লিখব — সেভ থাকবে, নেট এলে অটো যাবে।"
// Queue lives in localStorage (small, persists across app restarts). A single
// flusher (debounced + online listener) drains the queue when the network
// returns. Each queued message keeps the SAME id → no duplicate sends.

const QUEUE_KEY = "oh_chat_queue";
interface QueuedMsg { pairKey: string; msg: ChatMsg; attempts: number; }

function readQueue(): QueuedMsg[] {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]"); } catch { return []; }
}
function writeQueue(q: QueuedMsg[]) {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(0, 500))); } catch { /* ignore */ }
}
function queueChatMessage(pairKey: string, msg: ChatMsg) {
  const q = readQueue();
  // dedupe by id — never queue the same message twice
  if (!q.some((x) => x.msg.id === msg.id)) q.push({ pairKey, msg, attempts: 0 });
  writeQueue(q);
  scheduleFlush();
}
let flushTimer: any = null;
async function flushChatQueue() {
  const q = readQueue();
  if (!q.length) return;
  const st = await ensureFirebase(null);
  if (!st.configured) return;
  const { doc, setDoc } = await import("firebase/firestore");
  const remaining: QueuedMsg[] = [];
  for (const item of q) {
    try {
      await setDoc(
        doc(fsDb!, "pairs", item.pairKey, "notes", item.msg.id),
        JSON.parse(JSON.stringify(item.msg)),
        { merge: true }
      );
      // success — drop from queue
    } catch (e: any) {
      item.attempts++;
      // keep retrying for up to 50 attempts (then give up to avoid infinite queue)
      if (item.attempts < 50) remaining.push(item);
    }
  }
  writeQueue(remaining);
}
function scheduleFlush() {
  if (flushTimer) return;
  // try now, then every 30s until queue drains
  flushTimer = setInterval(() => {
    flushChatQueue().catch(() => {}).finally(() => {
      if (!readQueue().length) { clearInterval(flushTimer); flushTimer = null; }
    });
  }, 30_000);
  void flushChatQueue().catch(() => {});
}
// on app start + when the browser comes online, drain the queue
if (typeof window !== "undefined") {
  window.addEventListener("online", () => void flushChatQueue().catch(() => {}));
  // try a flush 5s after every page load (catches messages queued in a prior session)
  setTimeout(() => void flushChatQueue().catch(() => {}), 5000);
}
/** Public helper: returns how many messages are currently queued (offline). */
export function chatQueueSize(): number { return readQueue().length; }

// ---------- v4.3→v5.0: MESSAGE DELETE — TWO MODES (owner round-19) ----------
// Owner: “নিজের কাছ থেকে ডিলিট করলে বন্ধুর চ্যাট থেকে সেই মেসেজ ডিলিট হবে না” +
// “নিজের পাঠানো মেসেজ উভয় পক্ষের কাছ থেকে ডিলিট করতে পারবে — অন্যের
// পাঠানোটা শুধু নিজের কাছ থেকে”।
//   fbHideChat  = FOR ME ONLY → arrayUnion(myUid) on hiddenBy; the doc lives
//                  on the friend's phone exactly as before.
//   fbDeleteChat = FOR BOTH SIDES → deleteDoc (only allowed by the UI for
//                  messages the user SENT — enforced in the sheet, and the
//                  listener/headless page applies the same rule).
export type ChatDeleteResult = "deleted" | "hidden" | "failed-offline" | "failed-other";

/** Hide ONE message on MY phone only (owner round-19 ক). */
export async function fbHideChat(
  pairKey: string,
  msgId: string,
  myUid: string,
  serverCfg?: Partial<ServerCfg> | null
): Promise<ChatDeleteResult> {
  const isOffline = typeof navigator !== "undefined" && navigator.onLine === false;
  const st = await ensureFirebase(serverCfg);
  if (!st.configured) return isOffline ? "failed-offline" : "failed-other";
  if (!myUid) return "failed-other";
  try {
    const { doc, updateDoc, arrayUnion } = await import("firebase/firestore");
    await updateDoc(doc(fsDb!, "pairs", pairKey, "notes", msgId), {
      hiddenBy: arrayUnion(myUid),
    });
    return "hidden";
  } catch {
    return isOffline ? "failed-offline" : "failed-other";
  }
}

/**
 * Delete ONE chat message for BOTH sides (owner round-19 খ) — only offered
 * for messages the user SENT. Deleting the doc removes it from both phones
 * in real time (the pairs listener fires on delete).
 */
export async function fbDeleteChat(
  pairKey: string,
  msgId: string,
  serverCfg?: Partial<ServerCfg> | null
): Promise<ChatDeleteResult> {
  const isOffline = typeof navigator !== "undefined" && navigator.onLine === false;
  const st = await ensureFirebase(serverCfg);
  if (!st.configured) return isOffline ? "failed-offline" : "failed-other";
  try {
    const { doc, deleteDoc } = await import("firebase/firestore");
    await deleteDoc(doc(fsDb!, "pairs", pairKey, "notes", msgId));
    return "deleted";
  } catch {
    return isOffline ? "failed-offline" : "failed-other";
  }
}

/**
 * Clear the WHOLE conversation with the v5.0 permission rules built in
 * (owner round-19): the messages *I* sent are deleted from BOTH phones;
 * the friend's messages are only hidden from MY phone (arrayUnion me on
 * hiddenBy — they stay untouched on the friend's side). One writeBatch —
 * Firestore allows 500 ops per batch; only kind:"chat" docs are touched.
 */
export async function fbClearChat(
  pairKey: string,
  msgs: ChatMsg[],
  myUid: string,
  serverCfg?: Partial<ServerCfg> | null
): Promise<{ deleted: number; hidden: number }> {
  const st = await ensureFirebase(serverCfg);
  if (!st.configured || !msgs.length) return { deleted: 0, hidden: 0 };
  const out = { deleted: 0, hidden: 0 };
  try {
    const { doc, writeBatch, arrayUnion } = await import("firebase/firestore");
    const items = msgs.filter((m) => (m as unknown as { kind?: string }).kind === "chat");
    for (let i = 0; i < items.length; i += 400) {
      const batch = writeBatch(fsDb!);
      for (const m of items.slice(i, i + 400)) {
        const ref = doc(fsDb!, "pairs", pairKey, "notes", m.id);
        if (m.from === myUid) {
          batch.delete(ref); // mine → both phones
          out.deleted++;
        } else {
          batch.update(ref, { hiddenBy: arrayUnion(myUid) }); // theirs → my phone only
          out.hidden++;
        }
      }
      await batch.commit();
    }
  } catch {
    /* partial failure — return what we got; the listener resyncs the rest */
  }
  return out;
}

/**
 * The state the background OhKeepAliveService listener page needs — the MAIN
 * app writes it to localStorage (same https://localhost origin → the headless
 * WebView reads it): firebase config + signed-in uid + every pair to listen
 * to + the reels-limit warning text (spoken by the background guard).
 */
export function writeChatListenerState(data: {
  cfg: AnyRec | null;
  myUid: string;
  pairs: { key: string; name: string; uid?: string }[];
  lang: string;
  reelsLimitMin: number;
  reelsWarn: string;
  /** v4.1: the reels warning in ENGLISH + the VOICE language — the background
   * guard speaks the En copy when the phone has no Bangla TTS voice. */
  reelsWarnEn?: string;
  reelsLang?: string;
  /** v3.3: this APK's build version (e.g. "2.9.1") — the background listener
   * compares it against app/meta.latestVersion to fire update notifications. */
  buildVersion?: string;
}): void {
  try {
    localStorage.setItem("oh_chat_state", JSON.stringify(data));
    // v3.3: also stash the version standalone so the listener finds it even
    // before the main app writes oh_chat_state (cold start after install).
    if (data.buildVersion) {
      try { localStorage.setItem("oh_app_version", data.buildVersion); } catch { /* ignore */ }
    }
  } catch {
    /* ignore */
  }
}

/**
 * Raw note writer for the offline queue engine (note-sync.ts).
 * setDoc with the SAME note id + merge → retries can never create duplicates.
 */
export async function fbPutNote(
  pairKey: string,
  note: Record<string, unknown>,
  serverCfg?: Partial<ServerCfg> | null
): Promise<boolean> {
  const st = await ensureFirebase(serverCfg);
  if (!st.configured) return false;
  try {
    const { doc, setDoc } = await import("firebase/firestore");
    await setDoc(
      doc(fsDb!, "pairs", pairKey, "notes", String(note.id)),
      JSON.parse(JSON.stringify(note)),
      { merge: true }
    );
    return true;
  } catch {
    return false;
  }
}

export async function mirrorNoteAdd(
  pairKey: string,
  item: SharedNoteItem,
  serverCfg?: Partial<ServerCfg> | null
): Promise<void> {
  const st = await ensureFirebase(serverCfg);
  if (!st.configured) return;
  try {
    const { doc, setDoc } = await import("firebase/firestore");
    await setDoc(doc(fsDb!, "pairs", pairKey, "notes", item.id), JSON.parse(JSON.stringify(item)));
  } catch {
    /* ignore */
  }
}

export async function mirrorNoteUpdate(
  pairKey: string,
  noteId: string,
  patch: { done: boolean; doneBy: string | null },
  serverCfg?: Partial<ServerCfg> | null
): Promise<void> {
  const st = await ensureFirebase(serverCfg);
  if (!st.configured) return;
  try {
    const { doc, updateDoc } = await import("firebase/firestore");
    await updateDoc(doc(fsDb!, "pairs", pairKey, "notes", noteId), patch);
  } catch {
    /* ignore */
  }
}

export async function mirrorNoteDelete(pairKey: string, noteId: string, serverCfg?: Partial<ServerCfg> | null): Promise<void> {
  const st = await ensureFirebase(serverCfg);
  if (!st.configured) return;
  try {
    const { doc, deleteDoc } = await import("firebase/firestore");
    await deleteDoc(doc(fsDb!, "pairs", pairKey, "notes", noteId));
  } catch {
    /* ignore */
  }
}

/** Live listener for a pair's notes. Returns an unsubscribe function (or null). */
export function listenNotes(
  pairKey: string,
  cb: (notes: SharedNoteItem[]) => void,
  serverCfg?: Partial<ServerCfg> | null
): (() => void) | null {
  if (!fbConfigured(serverCfg)) return null;
  // v3.3 FIX: return a REAL unsubscribe that waits for the async onSnapshot
  // registration to finish, then calls its returned unsubscribe. Without this,
  // the old `() => undefined` left the listener leaking AND — worse — the
  // caller's useEffect cleanup fired before onSnapshot ever registered, so
  // listeners were silently dropped on quick re-renders (chat stopped updating).
  let realUnsub: (() => void) | null = null;
  let cancelled = false;
  ensureFirebase(serverCfg).then((st) => {
    if (!st.configured || cancelled) return;
    import("firebase/firestore").then(({ collection, onSnapshot, orderBy, query }) => {
      if (cancelled) return;
      const q = query(collection(fsDb!, "pairs", pairKey, "notes"), orderBy("createdAt", "asc"));
      realUnsub = onSnapshot(
        q,
        (snap) => {
          const out: SharedNoteItem[] = [];
          snap.forEach((d) => out.push(d.data() as SharedNoteItem));
          cb(out);
        },
        (err: any) => {
          // v3.3: surface the error so the user knows WHY chat is silent
          // (usually: Firestore rules denied, OR network offline)
          console.warn("[listenNotes] error on", pairKey, err?.code || err);
        }
      );
    });
  });
  return () => {
    cancelled = true;
    try { if (realUnsub) realUnsub(); } catch { /* ignore */ }
  };
}

// ==================== v5.0: PRESENCE (online/offline, green/red) ====================
// Owner round-19: “বন্ধু অনলাইনে আছে কি না সেটি বোঝার জন্য একটি স্ট্যাটাস
// ইন্ডিকেটর” — green = the user's app (or its headless background service)
// REALLY holds a live connection to OUR server; red = no heartbeat within
// the freshness window. The heartbeat is a tiny merge-write of
// usersIndex/{uid}.lastSeen — done every 45s by the app while open AND by
// the OhKeepAliveService listener page while the app is closed (owner:
// “শুধু ইন্টারনেট চালু থাকলেই সব সময় অনলাইন দেখানো যাবে না — সার্ভারের
// সঙ্গে প্রকৃত সংযোগ যাচাই হতে হবে”)। If the internet dies the writes
// fail silently → lastSeen goes stale → every friend sees RED within the
// 120s window — never stuck green for long after a disconnect.
export const PRESENCE_ONLINE_MS = 120_000; // fresh heartbeat window

/** Is a lastSeen timestamp “online” right now? */
export function isPresenceOnline(lastSeen?: number | null, now = Date.now()): boolean {
  return typeof lastSeen === "number" && lastSeen > 0 && now - lastSeen < PRESENCE_ONLINE_MS;
}

/** Heartbeat: merge-write usersIndex/{uid}.lastSeen (throttle at the caller). */
export async function touchPresence(myUid: string, serverCfg?: Partial<ServerCfg> | null): Promise<boolean> {
  if (!myUid) return false;
  const st = await ensureFirebase(serverCfg);
  if (!st.configured) return false;
  try {
    const { doc, setDoc } = await import("firebase/firestore");
    await setDoc(doc(fsDb!, "usersIndex", myUid), { lastSeen: Date.now() }, { merge: true });
    return true;
  } catch {
    return false; // offline / rules — the dot just goes red on its own
  }
}

// ==================== AUTH: Email/Password + verification ====================

export interface FbUser { uid: string; name: string; email: string; emailVerified: boolean; provider: "google" | "password" }

// When a user signs up, onAuthStateChanged can fire BEFORE updateProfile()
// lands — the listener would then read displayName=null and fall back to the
// email prefix. Remember the chosen name here so the listener uses it instead.
let pendingDisplayName = "";

function mapAuthErr(e: unknown): string {
  const code = String((e as { code?: string })?.code || e || "");
  if (code.includes("email-already-in-use")) return "errEmailInUse";
  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found")) return "errWrongPass";
  if (code.includes("user-disabled")) return "errBanned"; // v3.0: admin banned this account
  if (code.includes("weak-password")) return "errWeakPass";
  if (code.includes("invalid-email")) return "errInvalidEmail";
  if (code.includes("too-many-requests")) return "errTooMany";
  if (code.includes("network")) return "errNetwork";
  return "errGeneric";
}

export async function fbEmailSignUp(email: string, password: string, name: string, serverCfg?: Partial<ServerCfg> | null): Promise<{ ok: boolean; error?: string; uid?: string }> {
  const st = await ensureFirebase(serverCfg);
  if (!st.configured) return { ok: false, error: "errNetwork" };
  try {
    const { createUserWithEmailAndPassword, updateProfile, sendEmailVerification } = await import("firebase/auth");
    const auth = await getFbAuth();
    const cred = await withTimeout(createUserWithEmailAndPassword(auth, email.trim(), password), 25000, "timeout");
    pendingDisplayName = name;
    if (name) await withTimeout(updateProfile(cred.user, { displayName: name }), 15000, "timeout").catch(() => undefined);
    try { await withTimeout(sendEmailVerification(cred.user), 15000, "timeout"); } catch { /* quota */ }
    return { ok: true, uid: cred.user.uid };
  } catch (e) {
    console.error("fbAuthErr(signUp)", e);
    return { ok: false, error: mapAuthErr(e) };
  }
}

export async function fbEmailSignIn(email: string, password: string, serverCfg?: Partial<ServerCfg> | null): Promise<{ ok: boolean; error?: string }> {
  const st = await ensureFirebase(serverCfg);
  if (!st.configured) return { ok: false, error: "errNetwork" };
  try {
    const { signInWithEmailAndPassword } = await import("firebase/auth");
    const auth = await getFbAuth();
    await withTimeout(signInWithEmailAndPassword(auth, email.trim(), password), 25000, "timeout");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: mapAuthErr(e) };
  }
}

export async function fbSendVerification(): Promise<boolean> {
  try {
    const { sendEmailVerification } = await import("firebase/auth");
    const auth = await getFbAuth();
    const u = auth.currentUser;
    if (!u) return false;
    await withTimeout(sendEmailVerification(u), 15000, "timeout");
    return true;
  } catch {
    return false;
  }
}

export async function fbCheckVerified(): Promise<boolean> {
  try {
    const auth = await getFbAuth();
    const u = auth.currentUser;
    if (!u) return false;
    await withTimeout(u.reload(), 15000, "timeout");
    return Boolean(u.emailVerified);
  } catch {
    return false;
  }
}

/** Live auth state → cb(null) when signed out. Returns unsubscribe. */
export function fbListenAuth(cb: (u: FbUser | null) => void, serverCfg?: Partial<ServerCfg> | null): () => void {
  let un: (() => void) | null = null;
  let cancelled = false;
  ensureFirebase(serverCfg)
    .then(async (st) => {
      if (!st.configured || cancelled) return;
      const { onAuthStateChanged } = await import("firebase/auth");
      const auth = await getFbAuth();
      if (cancelled) return;
      un = onAuthStateChanged(auth, (u: any) => {
        if (!u) {
          pendingDisplayName = "";
          return cb(null);
        }
        cb({
          uid: u.uid,
          name: u.displayName || pendingDisplayName || (u.email ? u.email.split("@")[0] : ""),
          email: u.email || "",
          emailVerified: u.emailVerified,
          provider: u.providerData?.[0]?.providerId === "google.com" ? "google" : "password",
        });
      });
    })
    .catch(() => cb(null));
  return () => {
    cancelled = true;
    if (un) un();
  };
}

// ==================== PROFILES: pairing by invite code (Firestore) ====================

export interface FbProfile {
  uid: string;
  name: string;
  email: string;
  inviteCode: string;
  friends: { uid: string; name: string; email: string }[];
}

export interface DaySummary {
  date: string;
  points: number;
  prayers: Record<string, boolean>;
  prayerWater: boolean[];
  waterMl: number;
  waterGoalMl: number;
  reels: Record<string, number>;
  // v5.0: precise per-app seconds (optional — old days lack it).
  reelsSec?: Record<string, number>;
  reelsMin: number;
  dhikrTotal: number;
  meditationMin: number;
  focusMin: number;
  mood: number | null;
  sleepBed: string | null;
  sleepWake: string | null;
  completion: number;
  streak: number;
  updatedAt?: unknown;
}

function makeCode(): string {
  const A = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}

/**
 * v3.2 CLOUD-BAN: reads usersIndex/{uid}.banned — a flag the CLOUD admin
 * panel (GitHub Pages, no server, no admin-sdk-key) writes directly to
 * Firestore. The app checks it on boot, every 5 minutes and on every resume;
 * a banned account is signed out within minutes and sees the ban message.
 * Offline / any read error → false (never lock someone out by mistake).
 */
export async function fbIsBanned(uid: string, serverCfg?: Partial<ServerCfg> | null): Promise<boolean> {
  const st = await ensureFirebase(serverCfg);
  if (!st.configured) return false;
  try {
    const { doc, getDoc } = await import("firebase/firestore");
    const snap = await getDoc(doc(fsDb!, "usersIndex", uid));
    if (!snap.exists()) return false;
    return Boolean((snap.data() as { banned?: boolean }).banned);
  } catch {
    return false;
  }
}

/**
 * Create (or refresh) the user's profile doc; returns the profile with a stable invite code.
 * Lives in usersIndex/{uid} — the owner's rules allow auth read/write/QUERY there
 * (profiles/* is blocked by their rules, verified via REST probes).
 */
export async function ensureProfile(u: FbUser, serverCfg?: Partial<ServerCfg> | null): Promise<FbProfile | null> {
  const st = await ensureFirebase(serverCfg);
  if (!st.configured) return null;
  try {
    const { doc, getDoc, setDoc } = await import("firebase/firestore");
    const ref = doc(fsDb!, "usersIndex", u.uid);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const p = snap.data() as Partial<FbProfile>;
      const profile: FbProfile = {
        uid: u.uid,
        name: p.name || u.name,
        email: p.email || u.email,
        inviteCode: p.inviteCode || makeCode(),
        friends: (p.friends as FbProfile["friends"]) || [],
      };
      // keep name/email/code fresh (merge — never lose friends/code)
      // v3.2: provider self-heals on every login → the cloud admin panel
      // can always show Google vs Email, even for pre-3.2 accounts.
      await setDoc(
        ref,
        { name: profile.name, email: profile.email, inviteCode: profile.inviteCode, provider: u.provider },
        { merge: true }
      );
      return profile;
    }
    const p: FbProfile = { uid: u.uid, name: u.name || "Friend", email: u.email, inviteCode: makeCode(), friends: [] };
    await setDoc(ref, JSON.parse(JSON.stringify({ ...p, provider: u.provider })));
    return p;
  } catch {
    return null;
  }
}

export function listenProfile(uid: string, cb: (p: FbProfile | null) => void, serverCfg?: Partial<ServerCfg> | null): () => void {
  if (!fbConfigured(serverCfg)) { cb(null); return () => undefined; }
  ensureFirebase(serverCfg).then((st) => {
    if (!st.configured) { cb(null); return; }
    import("firebase/firestore").then(({ doc, onSnapshot }) => {
      return onSnapshot(
        doc(fsDb!, "usersIndex", uid),
        (snap) => cb(snap.exists() ? ({ ...(snap.data() as FbProfile), uid }) : null),
        () => cb(null)
      );
    });
  });
  return () => undefined;
}

/** Add a friend (both sides) by invite code — queried on usersIndex (auth-required by rules). */
export async function addFriendByCode(me: FbProfile, code: string, serverCfg?: Partial<ServerCfg> | null): Promise<{ ok: boolean; error?: string }> {
  const st = await ensureFirebase(serverCfg);
  if (!st.configured) return { ok: false, error: "errNetwork" };
  try {
    const { collection, query, where, limit, getDocs, doc, getDoc, setDoc } = await import("firebase/firestore");
    const q = query(collection(fsDb!, "usersIndex"), where("inviteCode", "==", code.trim().toUpperCase()), limit(1));
    const snap = await getDocs(q);
    if (snap.empty) return { ok: false, error: "codeNotFound" };
    const otherDoc = snap.docs[0];
    const other = otherDoc.data() as FbProfile;
    if (other.uid === me.uid) return { ok: false, error: "friendExists" };
    if ((me.friends || []).some((f) => f.uid === other.uid)) return { ok: false, error: "friendExists" };
    const mineRef = doc(fsDb!, "usersIndex", me.uid);
    const theirRef = doc(fsDb!, "usersIndex", other.uid);
    await setDoc(mineRef, { friends: [...(me.friends || []), { uid: other.uid, name: other.name, email: other.email }] }, { merge: true });
    const theirSnap = await getDoc(theirRef);
    const their = theirSnap.exists() ? (theirSnap.data() as FbProfile) : { ...other, friends: [] };
    await setDoc(theirRef, { friends: [...(their.friends || []), { uid: me.uid, name: me.name, email: me.email }] }, { merge: true });
    return { ok: true };
  } catch {
    return { ok: false, error: "errGeneric" };
  }
}

export async function removeFriend(me: FbProfile, friendUid: string, serverCfg?: Partial<ServerCfg> | null): Promise<void> {
  const st = await ensureFirebase(serverCfg);
  if (!st.configured) return;
  try {
    const { doc, getDoc, setDoc } = await import("firebase/firestore");
    const mineRef = doc(fsDb!, "usersIndex", me.uid);
    await setDoc(mineRef, { friends: (me.friends || []).filter((f) => f.uid !== friendUid) }, { merge: true });
    const theirRef = doc(fsDb!, "usersIndex", friendUid);
    const theirSnap = await getDoc(theirRef);
    if (theirSnap.exists()) {
      const their = theirSnap.data() as FbProfile;
      await setDoc(theirRef, { friends: (their.friends || []).filter((f) => f.uid !== me.uid) }, { merge: true });
    }
  } catch {
    /* ignore */
  }
}

/**
 * Push today's summary → backups/{uid} at days.{date} (merge).
 * Days live inside the doc because subcollections are blocked by the owner's rules.
 * The map is trimmed to the last 14 days so the doc stays small.
 */
export async function pushDay(uid: string, summary: DaySummary, serverCfg?: Partial<ServerCfg> | null): Promise<void> {
  const st = await ensureFirebase(serverCfg);
  if (!st.configured) return;
  try {
    const { doc, setDoc, getDoc, serverTimestamp } = await import("firebase/firestore");
    const ref = doc(fsDb!, "backups", uid);
    // read existing days to trim (cheap: only every 60s per user)
    const snap = await getDoc(ref);
    const prev = (snap.exists() ? ((snap.data() as { days?: Record<string, DaySummary> }).days || {}) : {});
    const days: Record<string, DaySummary> = { ...prev, [summary.date]: summary };
    const keys = Object.keys(days).sort();
    if (keys.length > 14) for (const k of keys.slice(0, keys.length - 14)) delete days[k];
    await setDoc(
      ref,
      { days: JSON.parse(JSON.stringify(days)), updatedAt: serverTimestamp() },
      { merge: true }
    );
  } catch {
    /* ignore */
  }
}

/** Live-listen a friend's day summary from backups/{uid}.days — realtime for the partner card. */
export function listenDay(uid: string, date: string, cb: (d: DaySummary | null) => void, serverCfg?: Partial<ServerCfg> | null): () => void {
  if (!fbConfigured(serverCfg)) { cb(null); return () => undefined; }
  // v3.3 FIX: return a REAL unsubscribe (same bug as listenNotes — the old
  // `() => undefined` left listeners leaking AND dropped them on re-render,
  // which is why friends' daily status never showed up).
  let realUnsub: (() => void) | null = null;
  let cancelled = false;
  ensureFirebase(serverCfg).then((st) => {
    if (!st.configured || cancelled) return;
    import("firebase/firestore").then(({ doc, onSnapshot }) => {
      if (cancelled) return;
      realUnsub = onSnapshot(
        doc(fsDb!, "backups", uid),
        (snap) => {
          if (!snap.exists()) return cb(null);
          const days = (snap.data() as { days?: Record<string, DaySummary> }).days || {};
          cb(days[date] ?? null);
        },
        (err: any) => {
          console.warn("[listenDay] error for", uid, err?.code || err);
          cb(null);
        }
      );
    });
  });
  return () => {
    cancelled = true;
    try { if (realUnsub) realUnsub(); } catch { /* ignore */ }
  };
}

// ==================== v5.1: in-app ADMIN STATUS (round-21) ====================
// The GitHub-Pages status panel is RETIRED — the owner asked for everything
// INSIDE the app (“অ্যাপসেই অ্যাডমিন প্যানেল দিয়ে দাও, আলাদা করার দরকার নাই”).
// Data source is the OWNER'S OWN Firebase, read with the normal signed-in
// client (the v4.0 rules allow auth read on usersIndex + backups), so this
// works in the APK with NO server and NO admin-sdk-key — anywhere.
// NO passwords or login credentials are ever shown: name, friends, video
// time and habit status only (same privacy line the old panel kept).

export interface FbStatusUser {
  uid: string;
  name: string;
  email: string;
  provider: "google" | "password";
  banned: boolean;
  lastSeen: number | null; // presence heartbeat (usersIndex.lastSeen)
  online: boolean;
  friendsCount: number;
  friendNames: string[];
  days: number; // logged day count (backups.days)
  streak: number;
  points: number;
  lastActive: number | null; // backups.updatedAt (ms)
  videoToday: Record<string, number> | null; // per-app minutes (days[today].reels)
  videoTotalMin: number | null; // days[today].reelsMin
  habitsToday: {
    prayers: number;
    waterMl: number;
    dhikr: number;
    meditationMin: number;
    focusMin: number;
  } | null;
}

export interface FbStatusSnapshot {
  stats: {
    total: number;
    google: number;
    email: number;
    banned: number;
    activeToday: number;
    onlineNow: number;
  };
  users: FbStatusUser[];
  app: { latestVersion: string | null; changelog: string | null };
  fetchedAt: number;
}

/** Read the whole user status snapshot from Firestore (client SDK).
 *  Requires a signed-in account (rules). Returns null when Firebase isn't
 *  reachable — the panel then shows its offline card. */
export async function fbReadStatus(serverCfg?: Partial<ServerCfg> | null): Promise<FbStatusSnapshot | null> {
  const st = await ensureFirebase(serverCfg);
  if (!st.configured) return null;
  try {
    const { collection, getDocs, doc, getDoc } = await import("firebase/firestore");
    const todayKey = new Date().toISOString().slice(0, 10);
    const now = Date.now();
    const ONLINE_MS = 120_000; // same freshness window as presence (PRESENCE_ONLINE_MS)

    // 1) every profile
    const profiles = await getDocs(collection(fsDb!, "usersIndex"));
    const users: FbStatusUser[] = profiles.docs.map((d) => {
      const p = d.data() as Record<string, unknown>;
      const friends = Array.isArray(p.friends) ? (p.friends as { name?: string }[]) : [];
      const lastSeen = typeof p.lastSeen === "number" && p.lastSeen > 0 ? p.lastSeen : null;
      return {
        uid: d.id,
        name: String(p.name || ""),
        email: String(p.email || ""),
        provider: p.provider === "google" ? "google" : "password",
        banned: Boolean(p.banned),
        lastSeen,
        online: lastSeen !== null && now - lastSeen < ONLINE_MS,
        friendsCount: friends.length,
        friendNames: friends.map((f) => String(f?.name || "")).filter(Boolean).slice(0, 20),
        days: 0,
        streak: 0,
        points: 0,
        lastActive: null,
        videoToday: null,
        videoTotalMin: null,
        habitsToday: null,
      };
    });

    // 2) each user's backup (days/streak/points) — batched in parallel chunks
    const CHUNK = 10;
    for (let i = 0; i < users.length; i += CHUNK) {
      const slice = users.slice(i, i + CHUNK);
      await Promise.all(
        slice.map(async (u) => {
          try {
            const snap = await getDoc(doc(fsDb!, "backups", u.uid));
            if (!snap.exists()) return;
            const data = snap.data() as {
              days?: Record<string, DaySummary>;
              state?: { points?: number; logs?: Record<string, { streak?: number }> };
              updatedAt?: { toDate?: () => Date } | number;
            };
            const days = data.days || {};
            u.days = Object.keys(days).length;
            const d = days[todayKey];
            if (d) {
              u.streak = Number(d.streak) || 0;
              u.points = Number(d.points) || 0;
              u.videoTotalMin = typeof d.reelsMin === "number" ? d.reelsMin : null;
              const reels = (d.reels || {}) as Record<string, number>;
              if (reels && typeof reels === "object" && Object.keys(reels).length) u.videoToday = reels;
              u.habitsToday = {
                prayers: Object.values(d.prayers || {}).filter(Boolean).length,
                waterMl: Number(d.waterMl) || 0,
                dhikr: Number(d.dhikrTotal) || 0,
                meditationMin: Number(d.meditationMin) || 0,
                focusMin: Number(d.focusMin) || 0,
              };
            } else if (typeof data.state?.points === "number") {
              u.points = data.state.points;
            }
            const ua = data.updatedAt;
            if (ua && typeof ua === "object" && typeof ua.toDate === "function") u.lastActive = ua.toDate().getTime();
            else if (typeof ua === "number") u.lastActive = ua;
          } catch {
            /* one bad doc never kills the snapshot */
          }
        })
      );
    }

    // 3) app version line (from app/meta — public read)
    let app: FbStatusSnapshot["app"] = { latestVersion: null, changelog: null };
    try {
      const raw = await readRawMeta();
      const cfg = (raw?.cfg || {}) as { latestVersion?: string; changelog?: string };
      app = { latestVersion: cfg.latestVersion || null, changelog: cfg.changelog || null };
    } catch {
      /* version line is optional */
    }

    return {
      stats: {
        total: users.length,
        google: users.filter((u) => u.provider === "google").length,
        email: users.filter((u) => u.provider === "password").length,
        banned: users.filter((u) => u.banned).length,
        activeToday: users.filter((u) => u.habitsToday !== null).length,
        onlineNow: users.filter((u) => u.online).length,
      },
      users,
      app,
      fetchedAt: Date.now(),
    };
  } catch (e) {
    console.warn("[fbReadStatus]", (e as Error)?.message || e);
    return null;
  }
}
