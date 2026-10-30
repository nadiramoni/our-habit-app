"use client";

/**
 * ChatScreen — v4.3: MESSENGER-STYLE CHAT inside Share Notes
 * (owner: "মেসেঞ্জারের যেভাবে চ্যাট করা যায় ঐরকম একটা সিস্টেম — নামে ক্লিক
 * করলে কে কী লিখল দেখব, ছবি পাঠানো যাবে, মেসেজ দিলে মেসেঞ্জারের মত
 * নোটিফিকেশন আসবে")।
 *
 * v4.3 (owner round-18) — TWO new powers:
 *   • MESSAGE DELETE: press-and-HOLD any bubble (or right-click on a
 *     computer) → confirm → the message disappears from BOTH phones in real
 *     time (Firestore doc delete — the pairs listener resyncs instantly).
 *     The header 🗑️ button clears the WHOLE conversation in one tap
 *     (batched deletes, shared notes in the same collection stay safe).
 *   • MESSENGER-STYLE HEADS-UP POPUP: when a message arrives while the app
 *     is open, <ChatHeadsUp /> slides a banner down from the top with the
 *     sender's name + the message preview + a short "টুট" pop sound — tap
 *     it to jump into the chat. (App closed → the background service still
 *     fires the real system notification, exactly like before.)
 *
 * • openChat(uid, name) → a global event → the full-screen chat opens from
 *   anywhere (FriendsTab 💬, NotesTab, a chat notification)
 * • messenger bubbles (mine = green right, theirs = left), realtime
 *   via the Firestore pairs listener (kind:"chat" docs)
 * • <ChatWatchdog /> (mounted in page.tsx) — the engine behind the scenes:
 *     - one listener per paired friend → heads-up popup + sound when a
 *       message arrives while the app is open
 *     - writes oh_chat_state → the background OhKeepAliveService (headless
 *       WebView, same origin) picks it up → notifications EVEN WHEN THE APP
 *       IS CLOSED (messenger-like)
 *     - pushes the Reels limit + spoken warning to the background guard
 *     - mutes the service while the app is in the foreground (no doubles)
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { useServerCfg } from "@/lib/cfg";
import { ChatMsg, FbProfile, chatQueueSize, fbClearChat, fbDeleteChat, fbHideChat, fbSendChat, isPresenceOnline, listenNotes, listenProfile, pairKeyOf, touchPresence, writeChatListenerState } from "@/lib/cloud";
import { uid as newId } from "@/lib/types";
import { isNative, nativeChatServiceRunning, nativePendingOpenChat, nativeVibrate } from "@/lib/native";
import { APP_VERSION } from "@/lib/version";
import { banglaNameFromEnglish } from "@/lib/translit";
import { deviceLang, fmtDateHM, makeT } from "@/lib/i18n";

export interface ChatTarget {
  uid: string;
  name: string;
}

/** Open a chat with a friend from anywhere. */
export function openChat(uid: string, name: string): void {
  window.dispatchEvent(new CustomEvent<ChatTarget>("oh:open-chat", { detail: { uid, name } }));
}

// ---------------- image compression (photos in chat) ----------------

async function compressImage(file: File, maxSide = 1280, quality = 0.62): Promise<string | null> {
  try {
    if (!file.type.startsWith("image/")) return null;
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ""));
      r.onerror = () => reject(new Error("read"));
      r.readAsDataURL(file);
    });
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("img"));
      i.src = dataUrl;
    });
    let { width, height } = img;
    const scale = Math.min(1, maxSide / Math.max(width, height));
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", quality);
  } catch {
    return null;
  }
}

// ---------------- the chat screen ----------------

function timeOf(ts: number): string {
  // v5.0: the clock follows the DEVICE language — রাত ১২:৩০ / সকাল ৯:৩০ in
  // Bengali (Bangladesh 12-hour convention), “9:30 AM” in English.
  try {
    return fmtDateHM(ts, deviceLang());
  } catch {
    return "";
  }
}

export default function ChatScreen() {
  const { state, t } = useStore();
  const { cfg } = useServerCfg();
  const acc = state.account;
  const [target, setTarget] = useState<ChatTarget | null>(null);
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  // v3.3 OFFLINE: shows "📨 অফলাইন — নেট এলে অটো যাবে" when a message was queued
  const [offlineStatus, setOfflineStatus] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);
  const readMarkedRef = useRef<string>("");

  const pairKey = useMemo(() => (acc?.uid && target ? pairKeyOf(acc.uid, target.uid) : ""), [acc?.uid, target]);

  // v4.3 DELETE: the message pending delete-confirmation, the clear-all
  // confirm, the little status line ("🗑️ মেসেজ ডিলিট হয়েছে") + busy flag
  const [delTarget, setDelTarget] = useState<ChatMsg | null>(null);
  const [clearAsk, setClearAsk] = useState(false);
  const [actionStatus, setActionStatus] = useState("");
  const [deleting, setDeleting] = useState(false);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flashStatus = useCallback((msg: string, ms = 2600) => {
    setActionStatus(msg);
    setTimeout(() => setActionStatus(""), ms);
  }, []);

  // press-and-HOLD a bubble (480ms) → delete confirm; right-click on desktop
  const startPress = useCallback((m: ChatMsg) => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = setTimeout(() => {
      pressTimer.current = null;
      setDelTarget(m);
      void nativeVibrate(18);
    }, 480);
  }, []);
  const endPress = useCallback(() => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }, []);
  useEffect(() => () => endPress(), [endPress]);

  // v5.0: hide messages the user deleted “for me” (hiddenBy) + the friend's
  // live presence dot in the header.
  const myUid = acc?.uid || "";
  const [friendSeen, setFriendSeen] = useState<number | null>(null);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!target?.uid || !cfg) return;
    const un = listenProfile(target.uid, (p) => setFriendSeen((p as unknown as { lastSeen?: number } | null)?.lastSeen ?? null), cfg);
    const iv = setInterval(() => setTick((n) => n + 1), 30_000); // recompute the dot
    return () => {
      if (un) un();
      clearInterval(iv);
    };
  }, [target?.uid, cfg]);
  const friendOnline = isPresenceOnline(friendSeen);

  // delete ONE message — TWO modes (owner round-19):
  //   "me"   → fbHideChat: gone from MY phone, STAYS on the friend's phone
  //   "both" → fbDeleteChat: gone from BOTH phones (own messages only)
  const doDelete = useCallback(
    async (m: ChatMsg, mode: "me" | "both") => {
      if (!pairKey || !myUid) return;
      setDeleting(true);
      const r = mode === "me" ? await fbHideChat(pairKey, m.id, myUid, cfg) : await fbDeleteChat(pairKey, m.id, cfg);
      setDeleting(false);
      setDelTarget(null);
      if (r === "hidden") {
        flashStatus(t("chatDeletedForMe"));
        void nativeVibrate(22);
      } else if (r === "deleted") {
        flashStatus(t("chatDeletedForBoth"));
        void nativeVibrate(22);
      } else if (r === "failed-offline") {
        flashStatus(t("chatDelFailNet"), 3600);
      } else {
        flashStatus(t("chatDeleteFail"), 3600);
      }
    },
    [pairKey, myUid, cfg, t, flashStatus]
  );

  // clear the WHOLE conversation — v5.0 rules: MY sent messages go from
  // BOTH phones; the friend's messages hide from MY phone only.
  const doClearAll = useCallback(async () => {
    if (!pairKey || !myUid) return;
    setDeleting(true);
    const r = await fbClearChat(pairKey, msgs, myUid, cfg);
    setDeleting(false);
    setClearAsk(false);
    if (r.deleted > 0 || r.hidden > 0) {
      flashStatus(
        `${t("chatCleared")}${r.deleted ? ` · ${r.deleted}⇄` : ""}${r.hidden ? ` 🙈${r.hidden}` : ""}`
      );
      void nativeVibrate(22);
    } else {
      flashStatus(t("chatClearFail"), 3600);
    }
  }, [pairKey, msgs, myUid, cfg, t, flashStatus]);

  // global open event
  useEffect(() => {
    const open = (ev: Event) => {
      const d = (ev as CustomEvent<ChatTarget>).detail;
      if (d?.uid) setTarget({ uid: d.uid, name: d.name || "…" });
    };
    window.addEventListener("oh:open-chat", open);
    return () => window.removeEventListener("oh:open-chat", open);
  }, []);

  // Android back button closes the chat first
  useEffect(() => {
    if (!target) return;
    const onBack = () => {
      if (target) {
        setTarget(null);
        window.dispatchEvent(new Event("oh:chat-closed"));
        (window as unknown as { __ohBackHandled?: boolean }).__ohBackHandled = true;
      }
    };
    window.addEventListener("oh:back", onBack);
    return () => window.removeEventListener("oh:back", onBack);
  }, [target]);

  // realtime messages
  useEffect(() => {
    if (!pairKey || !target) {
      setMsgs([]);
      return;
    }
    const un = listenNotes(
      pairKey,
      (all) => {
        // v5.0: filter out messages hidden from ME (hiddenBy) — they stay on
        // the friend's phone but never render on mine.
        const chat = (all as unknown as ChatMsg[])
          .filter((m) => (m as unknown as { kind?: string }).kind === "chat")
          .filter((m) => !((m as unknown as { hiddenBy?: string[] }).hiddenBy || []).includes(acc?.uid || ""));
        chat.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
        setMsgs(chat);
        // mark read (badge fuel)
        try {
          const last = chat.length ? String(chat[chat.length - 1].createdAt || 0) : "0";
          localStorage.setItem(`oh_chat_read_${pairKey}`, last);
          readMarkedRef.current = last;
        } catch {
          /* ignore */
        }
      },
      cfg
    );
    return () => {
      if (un) un();
    };
  }, [pairKey, target, cfg]);

  // scroll to bottom on new messages
  useEffect(() => {
    try {
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
    } catch {
      /* ignore */
    }
  }, [msgs.length, target]);

  const send = useCallback(
    async (body: { text?: string }) => {
      if (!acc?.uid || !pairKey) return;
      const msg: ChatMsg = {
        id: newId(),
        kind: "chat",
        from: acc.uid,
        fromName: state.settings.name || acc.name || "Me",
        ...(body.text ? { text: body.text } : {}),
        createdAt: Date.now(),
      };
      setBusy(true);
      const result = await fbSendChat(pairKey, msg, cfg);
      setBusy(false);
      if (result === "sent") {
        setText("");
        setOfflineStatus("");
        void nativeVibrate(15);
      } else if (result === "queued-offline") {
        const qn = chatQueueSize();
        setOfflineStatus(qn > 0 ? `📨 অফলাইন — ${qn} মেসেজ সারিতে আছে, নেট এলে অটো যাবে` : "📨 অফলাইন — মেসেজ সেভ হয়েছে, নেট এলে যাবে");
        setTimeout(() => setOfflineStatus(""), 4000);
      } else if (result === "failed-permission") {
        setOfflineStatus("⚠️ Firestore অনুমতি নেই — Firebase Console → Firestore Database → Rules এ গাইডের rules পেস্ট করে Publish করো");
        setTimeout(() => setOfflineStatus(""), 6000);
      } else {
        setOfflineStatus("⚠️ মেসেজ পাঠানো যায়নি — আবার চেষ্টা করো");
        setTimeout(() => setOfflineStatus(""), 4000);
      }
    },
    [acc?.uid, acc?.name, pairKey, cfg, state.settings.name]
  );

  if (!target) return null;

  return (
    <div className="fixed inset-0 z-[70] bg-background flex flex-col animate-slide-up">
      {/* header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-card shrink-0" style={{ paddingTop: "max(12px, env(safe-area-inset-top))" }}>
        <button
          type="button"
          onClick={() => {
            setTarget(null);
            window.dispatchEvent(new Event("oh:chat-closed"));
          }}
          aria-label={t("back")}
          className="w-10 h-10 rounded-full bg-secondary text-lg flex items-center justify-center shrink-0"
        >
          ←
        </button>
        <div className="w-10 h-10 rounded-full bg-primary/15 border border-primary/25 flex items-center justify-center text-base font-bold text-primary shrink-0">
          {(target.name || "?").slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold truncate">{target.name}</div>
          {/* v5.0: live presence — 🟢 অনলাইন (server connection active) / 🔴 অফলাইন */}
          <div className={`text-[10px] flex items-center gap-1 ${friendOnline ? "text-primary" : "text-muted-foreground"}`}>
            <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${friendOnline ? "bg-green-500" : "bg-red-500"}`} />
            {friendOnline ? `${t("onlineNow")} · ${t("presenceSub")}` : `${t("offlineNow")} · ${t("presenceOffSub")}`}
          </div>
        </div>
        {/* v4.3: clear the WHOLE conversation (owner: "এতগুলো মেসেজ আছে —
            চাইলে ডিলিট করতে পারো") */}
        <button
          type="button"
          onClick={() => msgs.length && setClearAsk(true)}
          aria-label={t("chatClearAll")}
          title={t("chatClearAll")}
          className="w-9 h-9 rounded-2xl bg-secondary flex items-center justify-center text-base shrink-0 active:scale-95 transition-transform"
        >
          🗑️
        </button>
        <div className="w-9 h-9 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-base shrink-0">💬</div>
      </div>

      {/* messages */}
      <div ref={listRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {msgs.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <p className="text-xs text-muted-foreground text-center max-w-[240px]">{t("chatNoMsgs")}</p>
          </div>
        ) : (
          <>
            {/* v4.3: teach the hold-to-delete gesture once at the top */}
            <p className="text-[10px] text-muted-foreground/70 text-center pb-1">✋ {t("chatHoldToDelete")}</p>
            {msgs.map((m) => {
              const mine = m.from === acc?.uid;
              return (
                <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                  <div
                    onTouchStart={() => startPress(m)}
                    onTouchEnd={endPress}
                    onTouchMove={endPress}
                    onTouchCancel={endPress}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setDelTarget(m);
                    }}
                    style={{ WebkitTouchCallout: "none" }}
                    className={`max-w-[78%] rounded-2xl px-3 py-2 shadow-sm select-none ${
                      mine ? "bg-primary text-primary-foreground rounded-br-md" : "bg-card border border-border rounded-bl-md"
                    }`}
                  >
                    {!mine ? <div className="text-[10px] font-bold text-primary mb-0.5">{m.fromName || t("chatTitle")}</div> : null}
                    {m.text ? <div className="text-sm leading-snug break-words whitespace-pre-wrap">{m.text}</div> : null}
                    <div className={`text-[9px] mt-0.5 text-right ${mine ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                      {timeOf(m.createdAt || 0)}
                    </div>
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* v5.0: delete-ONE sheet — TWO modes (owner round-19): hold a bubble */}
      {delTarget ? (
        <div
          className="fixed inset-0 z-[95] bg-black/60 flex items-center justify-center p-5"
          onClick={() => !deleting && setDelTarget(null)}
        >
          <div
            className="w-full max-w-sm bg-card border border-border rounded-2xl p-4 animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-sm font-bold mb-1">🗑️ {t("chatDeleteAsk")}</div>
            {delTarget.text ? (
              <div className="text-xs italic text-muted-foreground/80 bg-muted rounded-lg px-3 py-2 mb-3 line-clamp-3 break-words">
                "{delTarget.text}"
              </div>
            ) : (
              <div className="mb-3" />
            )}
            {/* Mode 1 — ALWAYS available: my phone only */}
            <button
              type="button"
              disabled={deleting}
              onClick={() => void doDelete(delTarget, "me")}
              className="w-full text-left rounded-xl border border-border bg-secondary/60 p-3 mb-2 active:scale-[0.98] transition-transform disabled:opacity-50"
            >
              <div className="text-sm font-bold">🙈 {t("chatDelForMe")}</div>
              <div className="text-[11px] text-muted-foreground">{t("chatDelForMeSub")}</div>
            </button>
            {/* Mode 2 — only for messages I SENT: both phones */}
            {delTarget.from === acc?.uid ? (
              <button
                type="button"
                disabled={deleting}
                onClick={() => void doDelete(delTarget, "both")}
                className="w-full text-left rounded-xl border border-red-500/40 bg-red-500/10 p-3 mb-2 active:scale-[0.98] transition-transform disabled:opacity-50"
              >
                <div className="text-sm font-bold text-destructive">🗑️ {t("chatDelForBoth")}</div>
                <div className="text-[11px] text-muted-foreground">{t("chatDelForBothSub")}</div>
              </button>
            ) : (
              <p className="text-[10px] text-muted-foreground mb-2 text-center">{t("chatDelOnlyMe")}</p>
            )}
            <button
              type="button"
              onClick={() => setDelTarget(null)}
              disabled={deleting}
              className="w-full rounded-xl bg-secondary py-2.5 text-sm font-bold active:scale-95 transition-transform"
            >
              {t("cancel")}
            </button>
          </div>
        </div>
      ) : null}

      {/* v4.3: clear-ALL confirm sheet (header 🗑️) */}
      {clearAsk ? (
        <div
          className="fixed inset-0 z-[95] bg-black/60 flex items-center justify-center p-5"
          onClick={() => !deleting && setClearAsk(false)}
        >
          <div
            className="w-full max-w-sm bg-card border border-border rounded-2xl p-4 animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-sm font-bold mb-1">🗑️ {t("chatClearAll")}</div>
            <div className="text-xs text-muted-foreground mb-3">{t("chatClearAsk")}</div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setClearAsk(false)}
                disabled={deleting}
                className="flex-1 rounded-xl bg-secondary py-2.5 text-sm font-bold active:scale-95 transition-transform"
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                onClick={() => void doClearAll()}
                disabled={deleting}
                className="flex-1 rounded-xl bg-red-500/90 text-white py-2.5 text-sm font-bold active:scale-95 transition-transform disabled:opacity-50"
              >
                {deleting ? "…" : `🗑️ ${t("chatClearAll")}`}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* composer */}
      {actionStatus && (
        <div style={{ padding: "8px 14px 4px", background: "rgba(74,222,128,.08)", borderTop: "1px solid rgba(74,222,128,.25)", color: "#4ade80", fontSize: "11px", textAlign: "center" }}>
          {actionStatus}
        </div>
      )}
      {offlineStatus && (
        <div style={{ padding: "8px 14px 4px", background: "rgba(125,211,252,.08)", borderTop: "1px solid rgba(125,211,252,.25)", color: "#7dd3fc", fontSize: "11px", textAlign: "center" }}>
          {offlineStatus}
        </div>
      )}
      <div className="border-t border-border bg-card px-3 py-2.5 flex items-end gap-2 shrink-0" style={{ paddingBottom: "max(10px, env(safe-area-inset-bottom))" }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && text.trim()) void send({ text: text.trim() });
          }}
          placeholder={t("chatPlaceholder")}
          className="flex-1 bg-muted rounded-2xl px-4 py-3 text-sm border border-border outline-none focus:ring-2 focus:ring-ring/50 min-h-[44px]"
        />
        <button
          type="button"
          onClick={() => text.trim() && void send({ text: text.trim() })}
          disabled={busy || !text.trim()}
          className="w-11 h-11 rounded-full btn-hero text-primary-foreground text-lg font-bold flex items-center justify-center shrink-0 disabled:opacity-40 active:scale-95 transition-transform"
        >
          {busy ? "…" : "➤"}
        </button>
      </div>
    </div>
  );
}

// ==================== ChatWatchdog — the background engine ====================

/**
 * Mounted once in page.tsx. Responsibilities:
 *  • listens to every paired friend's chat in real time → in-app
 *    notification + vibration + sound when a message arrives (app open)
 *  • writes oh_chat_state → the native OhKeepAliveService headless WebView
 *    reads it (same origin) → REAL notifications even when the app is closed
 *  • starts/stops the service with the account + the Settings toggle
 *  • mutes the service while the app is foreground (no duplicate rings)
 *  • pushes the Reels limit + spoken warning text to the background guard
 *  • SPEAKS the Reels-limit warning when the app itself detects the crossing
 */
export function ChatWatchdog() {
  const { state, t, fireNotif } = useStore();
  const { cfg } = useServerCfg();
  const acc = state.account;
  const openPairRef = useRef<string>("");
  // v5.0: live account ref for the deep-link effect (its deps are [] so it
  // must read the CURRENT account without re-subscribing).
  const accRef = useRef(acc);
  accRef.current = acc;

  // remember which chat is open (suppress its notifications)
  useEffect(() => {
    const open = (ev: Event) => {
      const d = (ev as CustomEvent<ChatTarget>).detail;
      openPairRef.current = d?.uid && acc?.uid ? pairKeyOf(acc.uid, d.uid) : "";
    };
    const close = () => {
      openPairRef.current = "";
    };
    window.addEventListener("oh:open-chat", open);
    window.addEventListener("oh:chat-closed", close);
    return () => {
      window.removeEventListener("oh:open-chat", open);
      window.removeEventListener("oh:chat-closed", close);
    };
  }, [acc?.uid]);

  const chatNotifOn = state.settings.chatNotif !== false;

  // v4.1→v4.2 (owner round-17): the SPOKEN reels warning — follows the VOICE
  // language setting, which is BANGLA by default again (the ORIGINAL system:
  // name called like before + Bangla sentence). reelsWarnTextEn is the English
  // copy the native side speaks when the phone has no Bangla TTS voice
  // installed — the warning never goes silent. (Also fixes a v4.0 latent
  // bug: banglaNameFromEnglish was used here without being imported — the
  // reels warning crashed at runtime.)
  const vlang: "en" | "bn" = state.settings.voiceLang === "en" ? "en" : "bn";
  const reelsWarnText = useCallback(
    () =>
      `${
        vlang === "bn" && (state.settings.nameBn || "").trim()
          ? (state.settings.nameBn || "").trim()
          : vlang === "bn"
            ? banglaNameFromEnglish(state.settings.name || "") || (state.settings.name || "")
            : (state.settings.name || "").trim()
      }${makeT(vlang)("speakReelsWarn")}`,
    [vlang, state.settings.name, state.settings.nameBn]
  );
  const reelsWarnTextEn = useCallback(
    () => `${(state.settings.name || "").trim()}${makeT("en")("speakReelsWarn")}`,
    [state.settings.name]
  );

  // per-pair listeners + last-seen bookkeeping
  useEffect(() => {
    if (!acc?.uid || !acc.verified) return;
    let unsubs: (() => void)[] = [];
    let cancelled = false;

    (async () => {
      const { ensureFirebase } = await import("@/lib/cloud");
      const st = await ensureFirebase(cfg);
      const { listenProfile } = await import("@/lib/cloud");
      if (!st.configured || cancelled) return;
      const profile = await new Promise<FbProfile | null>((resolve) => {
        const un = listenProfile(acc.uid, (p) => {
          resolve(p);
          if (un) un();
        }, cfg);
        setTimeout(() => resolve(null), 8000);
      });
      if (cancelled || !profile) return;
      const friends = profile.friends || [];
      const { listenNotes, pairKeyOf: pk, writeChatListenerState: wcs } = await import("@/lib/cloud");
      const pairs = friends.map((f) => ({ key: pk(acc.uid, f.uid), name: f.name, uid: f.uid }));

      // the state the background service listener page needs
      try {
        const raw = localStorage.getItem("oh-fb-test");
        let fbCfg: Record<string, unknown> | null = null;
        try {
          const baked = (await import("@/lib/firebase-baked")).BAKED_FIREBASE;
          const src = cfg.firebase?.on ? cfg.firebase.config : raw || baked;
          fbCfg = src ? (JSON.parse(src) as Record<string, unknown>) : null;
        } catch {
          fbCfg = null;
        }
        wcs({
          cfg: fbCfg,
          myUid: acc.uid,
          // v5.0: the uid rides along so the background notification can
          // deep-link STRAIGHT INTO the chat when tapped (owner round-19:
          // "নোটিফিকেশনে ক্লিক করলে সরাসরি সংশ্লিষ্ট চ্যাটে প্রবেশ করতে পারবে")।
          pairs: pairs.map((p) => ({ key: p.key, name: p.name, uid: p.uid })),
          // v5.0: the language follows the DEVICE (owner round-19) — the
          // background page builds its notification strings from it.
          lang: deviceLang(),
          reelsLimitMin: state.settings.reelsLimitMin || 0,
          reelsWarn: reelsWarnText(), // v4.1: follows the VOICE language setting
          reelsWarnEn: reelsWarnTextEn(), // v4.1: English copy for the no-bn-voice fallback
          reelsLang: vlang,
          buildVersion: APP_VERSION, // v3.3: background listener fires update notifs against this
        });
      } catch {
        /* ignore */
      }

      // one realtime listener per pair → in-app notifications
      for (const p of pairs) {
        const lastKey = `oh_chat_last_${p.key}`;
        let known = "";
        try {
          known = localStorage.getItem(lastKey) || "";
        } catch {
          /* ignore */
        }
        const un = listenNotes(
          p.key,
          (all) => {
            // v5.0: apply the SAME two rules as the chat screen — kind:chat
            // + not hidden from me (hiddenBy).
            const chat = (all as unknown as ChatMsg[])
              .filter((m) => (m as unknown as { kind?: string }).kind === "chat")
              .filter((m) => !((m as unknown as { hiddenBy?: string[] }).hiddenBy || []).includes(acc.uid));
            if (!chat.length) return;
            chat.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
            const last = chat[chat.length - 1];
            try {
              localStorage.setItem(lastKey, String(last.createdAt || 0));
            } catch {
              /* ignore */
            }
            window.dispatchEvent(new CustomEvent("oh:chatmsg", { detail: { pair: p.key, at: last.createdAt } }));
            const isNew = !known || String(last.createdAt || 0) > known;
            known = String(last.createdAt || 0); // v4.3: keep the closure fresh (was stale → notifications died after snapshot 1)
            // v4.3: the first sync no longer swallows a FRESH message — a
            // pair's very FIRST "Hello" pops up too (owner round-18: both in
            // the app, one sends → the other must see it). Old history stays
            // silent because of the 60s freshness window below.
            if (
              isNew &&
              last.from !== acc.uid &&
              openPairRef.current !== p.key &&
              (last.createdAt || 0) > Date.now() - 60_000
            ) {
              // v4.3: notification body (text, or the photo/voice fallbacks)
              const body =
                last.text ||
                ((last as unknown as { image?: string }).image ? t("chatImageMsg") : "") ||
                ((last as unknown as { audio?: string }).audio ? t("chatAudioMsg") : "") ||
                t("chatNewMsg");
              const appVisible =
                typeof document !== "undefined" && document.visibilityState === "visible";
              if (appVisible) {
                // v4.3 (owner round-18): "মেসেঞ্জারে দেখো না টুট করে একটা পপ আপ
                // এসে মেসেজটা সিন হয়" — the app is OPEN → the heads-up popup
                // IS the notification: banner + টুট sound + vibrate (rendered
                // by <ChatHeadsUp />, mounted in page.tsx). No shade notif →
                // no doubles, exactly like Messenger in-app.
                window.dispatchEvent(
                  new CustomEvent("oh:chat-popup", {
                    detail: {
                      uid: p.uid,
                      name: last.fromName || p.name,
                      text: body,
                      at: last.createdAt,
                    },
                  })
                );
              } else {
                // v5.0: app HIDDEN. On the APK the headless OhKeepAliveService
                // is the SINGLE notification authority whenever it is alive
                // (it deep-links into the chat on tap) — the watchdog must NOT
                // fire a duplicate LocalNotification next to it. Only when the
                // service is dead (Android killed it) does the watchdog take
                // over. On the WEB there is no service → always fire.
                void (async () => {
                  const svcAlive = isNative() ? await nativeChatServiceRunning() : false;
                  if (svcAlive) return; // the service posts it (with the deep link)
                  fireNotif(`💬 ${last.fromName || p.name}`, body, "alarm.wav");
                  void nativeVibrate(40);
                })();
              }
            }
          },
          cfg
        );
        if (un) unsubs.push(un);
      }
    })();

    return () => {
      cancelled = true;
      unsubs.forEach((u) => u());
      unsubs = [];
    };

  }, [acc?.uid, acc?.verified, cfg, reelsWarnText]);

  // v5.0: PRESENCE HEARTBEAT — every 45s while the app is alive the signed-in
  // user merge-writes usersIndex/{uid}.lastSeen. The headless background
  // service does the SAME on its side while the app is CLOSED (owner:
  // "অ্যাপ বন্ধ থাকলেও বন্ধু অনলাইন দেখাবে — সার্ভারের সাথে প্রকৃত সংযোগ
  // থাকলে")। If the connection dies the writes stop → the dot goes red.
  useEffect(() => {
    if (!acc?.uid || !acc.verified) return;
    let alive = true;
    const beat = () => {
      if (!alive) return;
      void touchPresence(acc.uid, cfg).catch(() => undefined);
    };
    beat(); // immediately on mount
    const iv = setInterval(beat, 45_000);
    // also beat when the app comes back to the foreground
    let un: (() => void) | null = null;
    void (async () => {
      try {
        const { App: CapApp } = await import("@capacitor/app");
        const l = await CapApp.addListener("appStateChange", (s: { isActive: boolean }) => {
          if (s.isActive) beat();
        });
        un = () => void l.remove();
      } catch {
        /* plugin missing on the web */
      }
    })();
    return () => {
      alive = false;
      clearInterval(iv);
      if (un) un();
    };
  }, [acc?.uid, acc?.verified, cfg]);

  // v5.0: DEEP LINK — when the user TAPS a background chat notification, the
  // service's PendingIntent carries the friend's uid+name; MainActivity saves
  // them and this effect (mount + every app resume) consumes them and jumps
  // straight into that chat (owner: "নোটিফিকেশনে ক্লিক করলে সরাসরি সংশ্লিষ্ট
  // চ্যাটে প্রবেশ করতে পারবে এবং সেখান থেকে উত্তর দিতে পারবে")।
  useEffect(() => {
    if (!isNative()) return;
    let alive = true;
    const tryConsume = async () => {
      if (!alive) return;
      // the account may still be restoring (cold start) — retry for up to 30s
      for (let i = 0; i < 15 && alive; i++) {
        if (accRef.current?.verified) break;
        await new Promise((r) => setTimeout(r, 2000));
      }
      if (!alive) return;
      try {
        const p = await nativePendingOpenChat();
        if (p?.uid && alive) openChat(p.uid, p.name || "…");
      } catch {
        /* not native / no plugin */
      }
    };
    void tryConsume();
    let un: (() => void) | null = null;
    void (async () => {
      try {
        const { App: CapApp } = await import("@capacitor/app");
        const l = await CapApp.addListener("appStateChange", (s: { isActive: boolean }) => {
          if (s.isActive) void tryConsume();
        });
        un = () => void l.remove();
      } catch {
        /* plugin missing */
      }
    })();
    return () => {
      alive = false;
      if (un) un();
    };
  }, []);

  // v4.0: THE SERVICE NOW RUNS HEADLESS — NO NOTIFICATION AT ALL.
  // Owner (round-15): "অ্যাপস থেকে বের হলে ওই খালি 'Our Habit' নোটিফিকেশনটা
  // আসে — পুরাটাই উঠাই ফেলবা, এটা রাখবা না।"
  // OhKeepAliveService is now a PLAIN background service (no startForeground
  // → Android never shows anything). It keeps listening while the app is
  // open AND after the user leaves; while the app is in the FOREGROUND its
  // chat notifications are MUTED (the in-app ChatWatchdog handles those —
  // no doubles). Android may stop it when memory is needed; opening the
  // app restarts it — that's the honest trade-off for zero notifications.
  useEffect(() => {
    if (!acc?.uid || !acc.verified || !chatNotifOn) {
      void import("@/lib/native").then(({ nativeChatServiceStop }) => nativeChatServiceStop());
      return;
    }
    // logged in + toggle ON → make sure the headless service is running
    // (idempotent) and muted while we're in the foreground
    void import("@/lib/native").then(async ({ nativeChatServiceStart, nativeChatServiceSetMuted }) => {
      await nativeChatServiceStart();
      await nativeChatServiceSetMuted(true);
    });
  }, [acc?.uid, acc?.verified, chatNotifOn]);

  // v4.0: app foreground → MUTE the service's notifications (in-app watchdog
  // already shows/sounds them); app background → UNMUTE (real notifications
  // while the user is away). The service itself keeps running the whole time —
  // there is no notification to show or hide anymore.
  useEffect(() => {
    let un: (() => void) | null = null;
    void (async () => {
      try {
        const { App: CapApp } = await import("@capacitor/app");
        const { nativeChatServiceStart, nativeChatServiceSetMuted } = await import("@/lib/native");
        const l = await CapApp.addListener("appStateChange", (s: { isActive: boolean }) => {
          if (s.isActive) {
            void nativeChatServiceSetMuted(true); // in-app watchdog takes over
          } else {
            void nativeChatServiceStart(); // ensure running (e.g. after a kill)
            void nativeChatServiceSetMuted(false); // real chat notifs now
          }
        });
        un = () => void l.remove();
      } catch {
        /* plugin missing */
      }
    })();
    return () => {
      if (un) un();
    };
  }, []);

  // push the reels limit + warning to the background guard (throttled by effect deps)
  useEffect(() => {
    void import("@/lib/native").then(({ nativeSetReelsLimit }) =>
      nativeSetReelsLimit(
        state.settings.reelsLimitMin || 0,
        reelsWarnText(),
        vlang,
        reelsWarnTextEn()
      )
    );

  }, [state.settings.reelsLimitMin, reelsWarnText, reelsWarnTextEn, vlang]);

  // SPEAK the reels warning when the app itself sees the limit crossed
  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    const log = state.logs[today];
    const limit = state.settings.reelsLimitMin || 0;
    const mins = log?.reelsMin ?? 0;
    if (limit > 0 && mins >= limit && acc?.uid) {
      void import("@/lib/native").then(({ nativeSpeakOnce }) =>
        nativeSpeakOnce("reelsWarn", reelsWarnText(), vlang, 30, reelsWarnTextEn())
      );
    }

  }, [state.logs[new Date().toISOString().slice(0, 10)]?.reelsMin, state.settings.reelsLimitMin, reelsWarnText]);

  return null;
}

/** Unread count for a pair (badge fuel — FriendsTab/NotesTab read this). */
export function chatUnreadCount(pairKey: string): number {
  try {
    const last = Number(localStorage.getItem(`oh_chat_last_${pairKey}`) || 0);
    const read = Number(localStorage.getItem(`oh_chat_read_${pairKey}`) || 0);
    return last > read ? 1 : 0; // any unread → 1 badge dot
  } catch {
    return 0;
  }
}

// ==================== v4.3: ChatHeadsUp — the messenger-style popup ====================

/**
 * Owner round-18: "মেসেঞ্জারে দেখো না টুট করে একটা পপ আপ এসে মেসেজটা সিন হয়,
 * এরকম জাতি মেসেজটা আসে" — when a chat message arrives while the app is open
 * (and that chat is NOT on screen), a banner slides down from the top with the
 * sender's avatar + name + message preview, plays the short "টুট" pop sound
 * and vibrates — exactly like Messenger's heads-up notification.
 *
 * • tap the banner → jumps straight into that chat
 * • ✕ dismisses it; it also auto-hides after 5.5s
 * • up to 3 banners stack (one per friend)
 * • ChatWatchdog only dispatches oh:chat-popup while the app is VISIBLE;
 *   app closed → the background service fires the system notification.
 *
 * Mounted once in page.tsx, ABOVE every screen (z-80: over tabs and even over
 * an open chat with a DIFFERENT friend; the AlarmOverlay stays above it).
 */
interface ChatPopupItem {
  key: number;
  uid: string;
  name: string;
  text: string;
}

export function ChatHeadsUp() {
  const [items, setItems] = useState<ChatPopupItem[]>([]);
  const openUidRef = useRef<string>("");

  // remember which chat is open on screen (its popups are suppressed — the
  // user is already reading those messages live)
  useEffect(() => {
    const open = (ev: Event) => {
      const d = (ev as CustomEvent<ChatTarget>).detail;
      openUidRef.current = d?.uid || "";
    };
    const close = () => {
      openUidRef.current = "";
    };
    window.addEventListener("oh:open-chat", open);
    window.addEventListener("oh:chat-closed", close);
    return () => {
      window.removeEventListener("oh:open-chat", open);
      window.removeEventListener("oh:chat-closed", close);
    };
  }, []);

  const remove = useCallback((key: number) => {
    setItems((prev) => prev.filter((x) => x.key !== key));
  }, []);

  useEffect(() => {
    const onPop = (ev: Event) => {
      const d = (ev as CustomEvent<{ uid: string; name: string; text: string; at?: number }>).detail;
      if (!d?.uid) return;
      if (openUidRef.current === d.uid) return; // that chat is on screen
      const item: ChatPopupItem = {
        key: Date.now() + Math.random(),
        uid: d.uid,
        name: d.name || "…",
        text: d.text || "",
      };
      setItems((prev) => [...prev.slice(-2), item]); // max 3 stacked
      // the "টুট" sound + a short vibration
      void import("@/lib/audio").then(({ playChatPop }) => playChatPop());
      void nativeVibrate(35);
      // auto-hide this banner after 5.5s
      setTimeout(() => remove(item.key), 5500);
    };
    window.addEventListener("oh:chat-popup", onPop);
    return () => window.removeEventListener("oh:chat-popup", onPop);
  }, [remove]);

  if (!items.length) return null;

  return (
    <div
      className="fixed top-0 inset-x-0 z-[80] px-3 pointer-events-none"
      style={{ paddingTop: "max(12px, env(safe-area-inset-top))" }}
    >
      <div className="max-w-md mx-auto space-y-2">
        {items.map((it) => (
          <div key={it.key} className="pointer-events-auto animate-slide-down">
            <div
              role="button"
              tabIndex={0}
              onClick={() => {
                openChat(it.uid, it.name);
                remove(it.key);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  openChat(it.uid, it.name);
                  remove(it.key);
                }
              }}
              className="flex items-center gap-3 bg-card/95 backdrop-blur border border-border rounded-2xl px-3 py-2.5 shadow-xl active:scale-[0.98] transition-transform cursor-pointer"
            >
              <div className="w-10 h-10 rounded-full bg-primary/15 border border-primary/25 flex items-center justify-center text-base font-bold text-primary shrink-0">
                {(it.name || "?").slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold truncate">{it.name}</div>
                <div className="text-[11px] text-muted-foreground truncate">{it.text}</div>
              </div>
              <button
                type="button"
                aria-label="✕"
                onClick={(e) => {
                  e.stopPropagation();
                  remove(it.key);
                }}
                className="w-7 h-7 rounded-full bg-secondary text-muted-foreground text-xs flex items-center justify-center shrink-0"
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
