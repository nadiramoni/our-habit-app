"use client";

/**
 * push.ts — v5.3.0 REAL FCM PUSH NOTIFICATIONS (owner: "এই দুইটা ফিক্স করে দাও —
 * মেসেজ দিলে বন্ধুর ফোনে নোটিফিকেশন আসবে + নতুন ভার্সন দিলে সবার ফোনে
 * নোটিফিকেশন যাবে")।
 *
 * WHY the old way never worked on real phones: v5.1 relied on the
 * OhKeepAliveService foreground service + a headless WebView listening to
 * Firestore. On Bangladeshi ROMs (Walton / Symphony / Xiaomi / Oppo) the OS
 * kills that service aggressively → the friend's phone showed NOTHING. FCM
 * (Firebase Cloud Messaging) is the SAME push channel WhatsApp/Messenger use:
 * Google's own servers wake the phone — it works with the app CLOSED, the
 * phone restarted, the service killed, battery saver on. Zero battery cost.
 *
 * WHAT THIS MODULE DOES:
 *   1. initPush(uid, cfg)      — register this device with FCM (native APK
 *      only), save the token into Firestore usersIndex/{uid}.fcmToken so
 *      friends can push to it. Idempotent — ChatWatchdog calls it on boot.
 *   2. "oh:chat-sent" listener — cloud.ts dispatches this after every
 *      successful chat write (send + offline-queue flush). We look up the
 *      partner's fcmToken and push the message to their phone — the
 *      notification shows the SENDER NAME + MESSAGE TEXT, tapping it opens
 *      STRAIGHT into that chat (reply box ready).
 *   3. broadcastUpdatePush()   — the admin panel's "📢 সবাইকে পাঠাও" button:
 *      reads EVERY usersIndex doc with a token and multicasts
 *      "নতুন আপডেট চলে আসছে — অ্যাপটি আপডেট করে নতুন ফিচারগুলো উপভোগ করুন"
 *      in one tap. Also fires automatically when the owner saves a newer
 *      latestVersion in the panel.
 *
 * SENDING works two ways (set by the owner in the admin panel — the relay
 * always wins when both are set):
 *   🛡 METHOD 1 (RECOMMENDED, always works): a FREE Google Apps Script relay
 *      (scripts/our-habit-push-relay.gs — the owner deploys it once). The app
 *      POSTs the messages to the script; the script signs them with the
 *      project's service account and forwards to the FCM HTTP v1 API (the
 *      CURRENT Google API — no deprecation risk). No server cost, no card.
 *   ⚡ METHOD 2 (quick, may be dead): the legacy FCM HTTP API with the project's
 *      old Server Key. Google started shutting this API down in July 2024 —
 *      kept only as a 30-second fallback for projects where it still lives.
 * Requests go through CapacitorHttp on the APK (native, no CORS); on web they
 * are plain fetch (text/plain body — a "simple" request, no CORS preflight).
 *
 * FALLBACK: when NEITHER is configured, nothing here sends — the old v5.1
 * listener (chat-listener.html) stays fully active (it checks the "fcm" flag
 * we write into oh_chat_state) so notifications keep working the old way until
 * the owner sets one up. No gap, no double notifications.
 */

import type { ServerCfg } from "./types";
import { isNative, nativeSpeakOnce } from "./native";
import { fbSavePushToken, fbGetPushToken, fbListUsers, fetchRemoteMeta, FbProfile } from "./cloud";
import { banglaNameFromEnglish } from "./translit";
import { CapacitorHttp } from "@capacitor/core";

type AnyRec = Record<string, any>;

const TOKEN_KEY = "oh_fcm_token";
const CHAT_CHANNEL = "oh_fcm_chat";
const UPDATE_CHANNEL = "oh_fcm_update";

/** module state — set by initPush, read everywhere */
let currentUid = "";
let currentToken = "";
let serverKeyCache = "";
let relayCache: { url: string; secret: string } | null = null;
let sendCfgResolved = false;
let listenersReady = false;

/** Does THIS device have a saved FCM token? (any app run that registered once) */
export function hasPushToken(): boolean {
  try {
    if (currentToken) return true;
    return Boolean(localStorage.getItem(TOKEN_KEY));
  } catch {
    return false;
  }
}

/** The full send configuration — relay (v1, recommended) + legacy key. */
interface SendCfg {
  relayUrl: string;
  relaySecret: string;
  serverKey: string;
}
const EMPTY_SEND: SendCfg = { relayUrl: "", relaySecret: "", serverKey: "" };

/** Resolve how THIS build sends pushes — live cfg first, then app/meta.
 * Priority: 🛡 relay (cfg → cache) beats ⚡ legacy key (cfg → cache) — the
 * relay is the guaranteed FCM v1 path, so it must always win when present. */
async function getSendCfg(cfg?: Partial<ServerCfg> | null): Promise<SendCfg> {
  if (cfg) {
    // seed the caches from the live cfg
    if (cfg.pushRelayUrl && cfg.pushRelaySecret) relayCache = { url: cfg.pushRelayUrl, secret: cfg.pushRelaySecret };
    if (cfg.fcmServerKey) serverKeyCache = cfg.fcmServerKey;
  }
  if (relayCache) {
    sendCfgResolved = true;
    return { relayUrl: relayCache.url, relaySecret: relayCache.secret, serverKey: serverKeyCache };
  }
  if (serverKeyCache) {
    sendCfgResolved = true;
    return { ...EMPTY_SEND, serverKey: serverKeyCache };
  }
  if (sendCfgResolved) return EMPTY_SEND; // already asked — nothing configured
  try {
    const meta = (await fetchRemoteMeta(null)) as AnyRec | null;
    const url = String(meta?.pushRelayUrl || "");
    const secret = String(meta?.pushRelaySecret || "");
    const key = String(meta?.fcmServerKey || "");
    if (key) serverKeyCache = key;
    relayCache = url && secret ? { url, secret } : null;
    sendCfgResolved = true;
    return { relayUrl: url, relaySecret: secret, serverKey: key };
  } catch {
    return { ...EMPTY_SEND, serverKey: serverKeyCache };
  }
}

/** Can pushes be SENT from this build (relay or legacy key configured)? */
async function canSend(cfg?: Partial<ServerCfg> | null): Promise<boolean> {
  const c = await getSendCfg(cfg);
  return Boolean((c.relayUrl && c.relaySecret) || c.serverKey);
}

// ---------------------------------------------------------------------------
// 1. PUSH SEND — 🛡 Apps Script relay (FCM v1) first, ⚡ legacy API fallback
// ---------------------------------------------------------------------------

interface FcmResult {
  ok: boolean;
  sent: number; // tokens that were accepted
  total: number; // tokens we tried
  error?: string;
}

/** One notification, shaped once — delivered via relay (v1) or legacy. */
interface PushMsg {
  title: string;
  body: string;
  tag?: string;
  channelId?: string;
  data: AnyRec;
}

/** v5.4: one (token, message) pair — the update broadcast is PERSONALIZED
 * (each phone gets its OWN name), so tokens no longer share one shape. */
interface TokenMsg {
  token: string;
  m: PushMsg;
}

/**
 * 🛡 METHOD 1: send through the owner's Apps Script relay (scripts/
 * our-habit-push-relay.gs). The relay signs with the service account and
 * calls the CURRENT FCM v1 API. Body is text/plain so a browser treats it
 * as a "simple" request (no CORS preflight); the APK uses CapacitorHttp
 * where CORS never applies.
 */
async function sendViaRelay(
  relay: { url: string; secret: string },
  tokens: string[],
  m: PushMsg
): Promise<FcmResult> {
  const fcm = tokens.map((t) => ({
    token: t,
    notification: { title: m.title, body: m.body },
    android: {
      priority: "high",
      notification: { channel_id: m.channelId, tag: m.tag, sound: "default" },
    },
    data: m.data, // v1 requires string values — all our data fields are strings
  }));
  return sendRelayFcm(relay, fcm, tokens.length);
}

/** v5.4 core: POST pre-built FCM v1 messages to the relay in chunks of 100. */
async function sendRelayFcm(
  relay: { url: string; secret: string },
  fcm: AnyRec[],
  total: number
): Promise<FcmResult> {
  let sent = 0;
  let firstError = "";
  for (let i = 0; i < fcm.length; i += 100) {
    const chunk = fcm.slice(i, i + 100);
    const bodyStr = JSON.stringify({ secret: relay.secret, messages: chunk });
    try {
      let resp: { status: number; data: AnyRec };
      if (isNative()) {
        const r = await CapacitorHttp.post({
          url: relay.url,
          headers: { "Content-Type": "text/plain" },
          data: bodyStr,
        });
        resp = { status: r.status, data: (r.data || {}) as AnyRec };
      } else {
        const r = await fetch(relay.url, {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: bodyStr,
        });
        resp = { status: r.status, data: (await r.json().catch(() => ({}))) as AnyRec };
      }
      if (resp.data && resp.data.ok) sent += Number(resp.data.sent) || 0;
      else if (!firstError) firstError = String(resp.data?.error || `http_${resp.status}`);
    } catch (e: any) {
      if (!firstError) firstError = String(e?.message || e || "network");
    }
  }
  return sent > 0 ? { ok: true, sent, total } : { ok: false, sent: 0, total, error: firstError || "relay_failed" };
}

/**
 * ⚡ METHOD 2: raw FCM legacy send (may be shut down by Google — kept as the
 * zero-setup fallback). Payload: single "to" token OR "registration_ids".
 */
export async function sendFcmRaw(serverKey: string, payload: AnyRec): Promise<FcmResult> {
  const tried = Array.isArray(payload.registration_ids)
    ? payload.registration_ids.length
    : 1;
  if (!serverKey) return { ok: false, sent: 0, total: tried, error: "no_server_key" };
  try {
    let resp: { status: number; data: AnyRec } | null = null;
    if (isNative()) {
      // native — no CORS, no prefetch, exactly what the APK needs
      resp = await CapacitorHttp.post({
        url: "https://fcm.googleapis.com/fcm/send",
        headers: { "Content-Type": "application/json", Authorization: `key=${serverKey}` },
        data: payload,
      });
    } else {
      const r = await fetch("https://fcm.googleapis.com/fcm/send", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `key=${serverKey}` },
        body: JSON.stringify(payload),
      });
      resp = { status: r.status, data: (await r.json().catch(() => ({}))) as AnyRec };
    }
    const d = resp.data || {};
    if (resp.status === 200 && (d.success === undefined || Number(d.success) > 0)) {
      let sent = Number(d.success) || 0;
      if (!sent && d.message_id) sent = 1; // single-token success shape
      const okCount = Array.isArray(d.results)
        ? d.results.filter((x: AnyRec) => !x?.error).length
        : 0;
      return { ok: true, sent: Math.max(sent, okCount), total: tried };
    }
    return {
      ok: false,
      sent: 0,
      total: tried,
      error: String(d.error || `http_${resp.status}`),
    };
  } catch (e: any) {
    return { ok: false, sent: 0, total: tried, error: String(e?.message || e || "network") };
  }
}

/**
 * Deliver one notification to any number of tokens. Picks the send path
 * automatically: 🛡 relay (v1) when configured, else ⚡ legacy key, else a
 * no-op with a clear error. `override` lets the admin panel use its UNSAVED
 * draft values (test before Save).
 */
async function deliverPush(
  tokens: string[],
  m: PushMsg,
  override?: { serverKey?: string; relayUrl?: string; relaySecret?: string }
): Promise<FcmResult> {
  if (!tokens.length) return { ok: false, sent: 0, total: 0, error: "no_devices" };
  let relay: { url: string; secret: string } | null = null;
  let key = "";
  if (override?.relayUrl && override?.relaySecret) {
    relay = { url: override.relayUrl, secret: override.relaySecret };
  } else {
    const c = await getSendCfg(null);
    if (c.relayUrl && c.relaySecret) relay = { url: c.relayUrl, secret: c.relaySecret };
    key = override?.serverKey || c.serverKey;
  }
  if (relay) return sendViaRelay(relay, tokens, m);
  if (key) {
    // legacy multicast — chunks of 100
    let sent = 0;
    let err = "";
    for (let i = 0; i < tokens.length; i += 100) {
      const chunk = tokens.slice(i, i + 100);
      const payload: AnyRec = chunk.length === 1
        ? { to: chunk[0], priority: "high", notification: { title: m.title, body: m.body, channel_id: m.channelId, sound: "default", tag: m.tag }, data: m.data }
        : { registration_ids: chunk, priority: "high", collapse_key: m.tag || undefined, notification: { title: m.title, body: m.body, channel_id: m.channelId, sound: "default", tag: m.tag }, data: m.data };
      const r = await sendFcmRaw(key, payload);
      sent += r.sent;
      if (!r.ok && !err) err = r.error || "legacy_failed";
    }
    return sent > 0 ? { ok: true, sent, total: tokens.length } : { ok: false, sent: 0, total: tokens.length, error: err };
  }
  return { ok: false, sent: 0, total: tokens.length, error: "no_server_key" };
}

/** v5.3.0: push ONE chat message to the partner's phone. */
export async function pushChatToPartner(
  pairKey: string,
  msg: { from: string; fromName?: string; text?: string },
  cfg?: Partial<ServerCfg> | null
): Promise<boolean> {
  try {
    if (!pairKey || !msg?.from) return false;
    const partnerUid = pairKey.split("|").find((x) => x && x !== msg.from);
    if (!partnerUid) return false;
    const sendable = await canSend(cfg);
    if (!sendable) return false; // no relay/key yet → old listener covers it
    const token = await fbGetPushToken(partnerUid, cfg);
    if (!token) return false; // partner's app hasn't registered yet
    const fromName = msg.fromName || "Our Habit";
    const body = msg.text
      ? msg.text.slice(0, 300)
      : "📷 ছবি পাঠিয়েছে"; // photo/audio keep their old look
    const r = await deliverPush([token], {
      title: `💬 ${fromName}`,
      body,
      tag: `oh_chat_${pairKey.replace(/[^a-zA-Z0-9]/g, "")}`, // one tray entry per chat
      channelId: CHAT_CHANNEL,
      data: { ohChat: "1", fromUid: msg.from, fromName, ts: String(Date.now()) },
    });
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * v5.6: deliver the update with TWO messages per phone — THE OLD-VERSION FIX
 * (owner: "আগের যারা 5.30 অথবা 5.20 অথবা 5.40 ওদের ঐখানে ওই সাউন্ডটা আসতেছে না")।
 *
 *  📢 MESSAGE A — notification + data: the SYSTEM tray displays it on EVERY
 *     app version (5.2 / 5.3 / 5.4 / 5.5 / 5.6) when the app is closed or
 *     backgrounded. This is the exact same shape chat pushes use — the one
 *     format that has ALWAYS been visible. Old apps (v5.4+) even speak the
 *     name on tap (their tap handler reads d.speak + d.speakText).
 *
 *  🗣 MESSAGE B — DATA-ONLY (no notification block): data messages wake the
 *     app's PushSpeakService even when the process is KILLED, so v5.6+ phones
 *     SPEAK the personalized name-call the moment it lands. On old versions
 *     this message is a harmless no-op (their plugin service has no bridge).
 *
 *  v5.6 PushSpeakService dedupes by `ts` (both messages share it), speaks
 *  once, and posts its own tray entry ONLY while the app is in the FOREGROUND
 *  (where the system does NOT display message A) — so there is never a
 *  double notification or a double name-call.
 */
async function deliverMany(
  pairs: TokenMsg[],
  override?: { serverKey?: string; relayUrl?: string; relaySecret?: string }
): Promise<FcmResult> {
  if (!pairs.length) return { ok: false, sent: 0, total: 0, error: "no_devices" };
  const total = pairs.length;
  let relay: { url: string; secret: string } | null = null;
  let key = "";
  if (override?.relayUrl && override?.relaySecret) {
    relay = { url: override.relayUrl, secret: override.relaySecret };
  } else {
    const c = await getSendCfg(null);
    if (c.relayUrl && c.relaySecret) relay = { url: c.relayUrl, secret: c.relaySecret };
    key = override?.serverKey || c.serverKey;
  }
  if (relay) {
    // two FCM HTTP v1 messages per phone (A = notification+data, B = data-only)
    const fcm: AnyRec[] = [];
    for (const { token, m } of pairs) {
      fcm.push({
        token,
        notification: { title: m.title, body: m.body },
        android: {
          priority: "high",
          notification: { channel_id: m.channelId, tag: m.tag, sound: "default", priority: "high" },
        },
        data: { ohUpdate: "1", version: String(m.data.version || ""), ts: String(m.data.ts || ""), speak: "1", speakText: String(m.data.speakText || ""), sysTray: "1" },
      });
      fcm.push({
        token,
        android: { priority: "high" },
        data: { ...m.data, sysTray: "0" },
      });
    }
    const r = await sendRelayFcm(relay, fcm, fcm.length);
    // report in PHONES (2 messages per phone), not raw message count
    const phones = Math.min(total, Math.round(r.sent / 2));
    return { ok: r.ok, sent: phones, total, error: r.ok ? undefined : r.error };
  }
  if (key) {
    let sent = 0;
    let err = "";
    for (const { token, m } of pairs) {
      // A) notification+data — the tray entry every version shows
      const payloadA: AnyRec = {
        to: token,
        priority: "high",
        collapse_key: m.tag || "oh_update",
        notification: { title: m.title, body: m.body, channel_id: m.channelId, tag: m.tag, sound: "default" },
        data: { ohUpdate: "1", version: String(m.data.version || ""), ts: String(m.data.ts || ""), speak: "1", speakText: String(m.data.speakText || ""), sysTray: "1" },
      };
      // B) data-only — the v5.6+ arrival voice
      const payloadB: AnyRec = {
        to: token,
        priority: "high",
        collapse_key: m.tag || "oh_update",
        data: { ...m.data, sysTray: "0" },
      };
      const ra = await sendFcmRaw(key, payloadA);
      const rb = await sendFcmRaw(key, payloadB);
      if (ra.ok || rb.ok) sent++;
      if (!ra.ok && !rb.ok && !err) err = ra.error || rb.error || "legacy_failed";
    }
    return sent > 0 ? { ok: true, sent, total } : { ok: false, sent: 0, total, error: err };
  }
  return { ok: false, sent: 0, total, error: "no_server_key" };
}

/**
 * v5.4: broadcast the "new update" notification — PERSONALIZED per phone
 * (owner: "নোটিফিকেশন যাওয়ার সাথে নাম ধরে রাখবে — আলাউদ্দিন সাকিব, অ্যাপসে
 * নতুন আপডেট চলে এসেছে, দয়া করে অ্যাপসটা আপডেট করে নিন")। Each phone gets
 * its OWN name in the body AND a `speakText` data field — when the phone
 * receives it (app open) or the user taps it, the app SPEAKS the name-call
 * aloud through the TTS engine (the same voice that calls the alarms).
 */
export async function broadcastUpdatePush(opts: {
  version: string;
  changelog?: string;
  serverKey?: string; // admin panel passes its unsaved draft values so the
  relayUrl?: string; // 📢 button works immediately after pasting (pre-Save)
  relaySecret?: string;
}): Promise<{ sent: number; total: number; error?: string; via?: string }> {
  try {
    // v5.5: the tray body is JUST the personalized name-call (the version
    // itself shows inside the app on the UpdateBar — cleaner notification)
    const users = (await fbListUsers(null)) as (FbProfile & { fcmToken?: string; name?: string })[];
    const pairs: TokenMsg[] = users
      .filter((u) => String(u.fcmToken || "").trim())
      .map((u) => {
        const name = String(u.name || "").trim() || "বন্ধু";
        // v5.6: নোটিফিকেশনের লেখায় রেজিস্টার্ড নাম, আর TTS ভয়েসে বাংলা
        // উচ্চারণ (Yasin→ইয়াসিন) — bn ভয়েস ল্যাটিন অক্ষর সুন্দর পড়ে না
        const spoken = banglaNameFromEnglish(name);
        const line = `${name}, অ্যাপসে নতুন আপডেট চলে এসেছে। দয়া করে অ্যাপটা আপডেট করে নিন।`;
        const speakLine = `${spoken}, অ্যাপসে নতুন আপডেট চলে এসেছে। দয়া করে অ্যাপটা আপডেট করে নিন।`;
        return {
          token: String(u.fcmToken),
          m: {
            title: "🔄 নতুন আপডেট চলে আসছে!",
            body: line, // the tray shows the personalized name-call
            tag: "oh_update", // one update notification at a time in the tray
            channelId: UPDATE_CHANNEL,
            data: {
              ohUpdate: "1",
              version: opts.version || "",
              ts: String(Date.now()),
              speak: "1",
              speakText: speakLine, // PushSpeakService SPEAKS exactly this sentence
              title: "🔄 নতুন আপডেট চলে আসছে!",
              body: line,
            },
          } as PushMsg,
        };
      });
    if (!pairs.length) return { sent: 0, total: 0, error: "no_devices" };
    const r = await deliverMany(pairs, {
      serverKey: opts.serverKey,
      relayUrl: opts.relayUrl,
      relaySecret: opts.relaySecret,
    });
    const via = opts.relayUrl || (await getSendCfg(null)).relayUrl ? "relay" : "legacy";
    return { sent: r.sent, total: r.total, error: r.ok ? undefined : r.error, via };
  } catch (e: any) {
    return { sent: 0, total: 0, error: String(e?.message || e || "error") };
  }
}

// ---------------------------------------------------------------------------
// 2. PUSH RECEIVE (register the device + route taps) — native APK only
// ---------------------------------------------------------------------------

/** Token landed → save it everywhere it is needed. */
async function onToken(token: string): Promise<void> {
  currentToken = token;
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* ignore */
  }
  // flag the background listener to stand down (FCM covers notifications now)
  try {
    const sendable = await canSend(null);
    if (sendable) {
      const raw = localStorage.getItem("oh_chat_state");
      if (raw) {
        const st = JSON.parse(raw) as { fcm?: boolean };
        if (st && !st.fcm) {
          st.fcm = true;
          localStorage.setItem("oh_chat_state", JSON.stringify(st));
        }
      }
    }
  } catch {
    /* ignore */
  }
  // persist under MY profile so friends/admin can push to this phone
  if (currentUid) void fbSavePushToken(currentUid, token);
}

/**
 * v5.4: SPEAK the update announcement aloud — the same AlarmSpeakService
 * voice that calls the alarms (owner: "ভয়েস ওদেরকে যাবে আরকি")। Throttle
 * key includes the version so a NEW version always speaks again.
 */
async function speakUpdateAloud(text: string, version?: string, ts?: string): Promise<void> {
  try {
    if (!isNative() || !text.trim()) return;
    // v5.5 DEDUP: PushSpeakService already spoke this exact broadcast when it
    // arrived (app closed). The ts check makes a replayed delivery (or the
    // notification tap) a silent no-op instead of a second name-call.
    try {
      const key = `oh_upd_spoken_${String(ts || "")}`;
      if (ts && localStorage.getItem(key)) return;
      if (ts) localStorage.setItem(key, "1");
    } catch {
      /* ignore */
    }
    const key = `upd_${String(version || "x").replace(/[^a-zA-Z0-9]/g, "")}_${Math.floor(Date.now() / 60000)}`;
    await nativeSpeakOnce(key, text, "bn", 0);
  } catch {
    /* voice is best-effort — the notification itself already shows the name */
  }
}

/**
 * Boot the push engine. Called by ChatWatchdog once the account exists —
 * safe to call repeatedly (listeners attach once, uid/key refresh freely).
 */
export function initPush(uid: string, cfg?: Partial<ServerCfg> | null): void {
  if (typeof window === "undefined") return;
  if (uid && uid !== currentUid) currentUid = uid;
  void getSendCfg(cfg); // warm the send config cache (relay/key) — no-op when resolved

  // (a) react to every successful chat write — cloud.ts dispatches this
  if (!listenersReady) {
    listenersReady = true;
    try {
      window.addEventListener("oh:chat-sent", (ev) => {
        const d = (ev as CustomEvent<{ pairKey: string; msg: { from: string; fromName?: string; text?: string } }>).detail;
        if (d?.pairKey && d?.msg) void pushChatToPartner(d.pairKey, d.msg, null);
      });
    } catch {
      /* ignore */
    }
  }

  // (b) the rest needs the native plugin — web stops here
  if (!isNative()) return;

  void (async () => {
    try {
      const { PushNotifications } = await import("@capacitor/push-notifications");

      // notification channels (sound + heads-up); if creation fails FCM uses
      // its default channel — either way the notification is audible
      try {
        await PushNotifications.createChannel({
          id: CHAT_CHANNEL,
          name: "চ্যাট মেসেজ",
          importance: 5,
          vibration: true,
          visibility: 1,
          sound: "alarm.wav",
        });
        await PushNotifications.createChannel({
          id: UPDATE_CHANNEL,
          name: "অ্যাপ আপডেট",
          importance: 4,
          vibration: true,
          visibility: 1,
          sound: "alarm.wav",
        });
      } catch {
        /* plugin version without channels — default channel is fine */
      }

      // lifetime listeners — attach exactly once per app process
      if (!(window as AnyRec).__ohPushWired) {
        (window as AnyRec).__ohPushWired = true;
        try {
          await PushNotifications.addListener("registration", (t: { value: string }) => {
            void onToken(String(t?.value || ""));
          });
          await PushNotifications.addListener("registrationError", (e: AnyRec) => {
            try {
              console.warn("[push] registration failed:", e?.message || e);
            } catch {
              /* ignore */
            }
          });
          // foreground: system does NOT display these — the app decides.
          // chat → the in-app popup (ChatWatchdog) already fired; update →
          // pull the fresh cfg so the UpdateBar appears immediately.
          // v5.5.1: the VOICE on arrival now belongs to PushSpeakService
          // (native) in EVERY app state — speaking here too would call the
          // name TWICE (native + JS). The tap-path below still speaks on
          // purpose (tapping an old entry hours later re-announces it).
          await PushNotifications.addListener("pushNotificationReceived", (n: AnyRec) => {
            try {
              const d = n?.data || {};
              if (d.ohUpdate) {
                window.dispatchEvent(new Event("oh:refresh-cfg"));
              }
            } catch {
              /* ignore */
            }
          });
          // tap on a notification (app closed or background) → route it
          await PushNotifications.addListener("pushNotificationActionPerformed", (ev: AnyRec) => {
            try {
              const d = ev?.notification?.data || {};
              if (d.ohChat && d.fromUid) {
                const name = String(d.fromName || "…");
                try {
                  localStorage.setItem(
                    "oh_open_chat",
                    JSON.stringify({ uid: d.fromUid, name, at: Date.now() })
                  );
                } catch {
                  /* ignore */
                }
                // ChatScreen's tap-router listens for exactly this
                window.dispatchEvent(
                  new CustomEvent("oh:open-chat", { detail: { uid: d.fromUid, name } })
                );
              } else if (d.ohUpdate) {
                try {
                  localStorage.setItem("oh_refresh_cfg", "1");
                } catch {
                  /* ignore */
                }
                window.dispatchEvent(new Event("oh:refresh-cfg"));
                // v5.4: the phone was CALLED by name in the notification —
                // say it aloud too; v5.5: skipped when PushSpeakService
                // already spoke on arrival (same ts)
                if (d.speak && d.speakText) void speakUpdateAloud(String(d.speakText), d.version, String(d.ts || ""));
              }
            } catch {
              /* ignore */
            }
          });
        } catch {
          /* listeners failed — push receive disabled, app still works */
        }
        // retry the registration every time the app comes back to the front
        // (covers "permission granted later" + token rotation for free)
        try {
          const { App: CapApp } = await import("@capacitor/app");
          await CapApp.addListener("appStateChange", (s: { isActive: boolean }) => {
            if (s?.isActive) void attemptRegister();
          });
        } catch {
          /* @capacitor/app missing — registration happens on each cold boot */
        }
      }

      await attemptRegister();
    } catch {
      /* plugin not installed on this platform — silent (web/dev) */
    }
  })();
}

let registering = false;
async function attemptRegister(): Promise<void> {
  if (!isNative() || registering) return;
  registering = true;
  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    let perm = await PushNotifications.checkPermissions();
    if (perm.receive === "prompt") {
      perm = await PushNotifications.requestPermissions();
    }
    if (perm.receive === "granted") {
      await PushNotifications.register(); // → "registration" event → onToken
    }
  } catch {
    /* ignore — retried on next resume */
  } finally {
    registering = false;
  }
}

// ---------------------------------------------------------------------------
// 3. TEST HOOK — only active when localStorage.oh_debug === "1" (verify suite)
// ---------------------------------------------------------------------------
try {
  if (typeof window !== "undefined" && localStorage.getItem("oh_debug") === "1") {
    (window as AnyRec).OH_DEBUG_PUSH = {
      setTestKey: (k: string) => {
        serverKeyCache = k;
        relayCache = null;
        sendCfgResolved = true;
      },
      setTestRelay: (url: string, secret: string) => {
        relayCache = { url, secret };
        sendCfgResolved = true;
      },
      pushChat: (pairKey: string, msg: { from: string; fromName?: string; text?: string }) =>
        pushChatToPartner(pairKey, msg, null),
      broadcast: (version: string, changelog?: string) =>
        broadcastUpdatePush({ version, changelog }),
      broadcastVia: (version: string, changelog: string, relayUrl: string, relaySecret: string, serverKey?: string) =>
        broadcastUpdatePush({ version, changelog, relayUrl, relaySecret, serverKey }),
      simulateToken: (token: string) => onToken(token),
      state: () => ({ currentUid, currentToken, serverKeyCache, relayCache, sendCfgResolved }),
    };
  }
} catch {
  /* ignore */
}
