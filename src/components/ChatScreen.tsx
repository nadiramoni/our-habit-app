"use client";

/**
 * ChatScreen — v2.9: MESSENGER-STYLE CHAT inside Share Notes
 * (owner: "মেসেঞ্জারের যেভাবে চ্যাট করা যায় ঐরকম একটা সিস্টেম — নামে ক্লিক
 * করলে কে কী লিখল দেখব, ছবি পাঠানো যাবে, মেসেজ দিলে মেসেঞ্জারের মত
 * নোটিফিকেশন আসবে")।
 *
 * • openChat(uid, name) → a global event → the full-screen chat opens from
 *   anywhere (FriendsTab 💬, NotesTab, a chat notification)
 * • messenger bubbles (mine = green right, theirs = left), photos, realtime
 *   via the Firestore pairs listener (kind:"chat" docs)
 * • <ChatWatchdog /> (mounted in page.tsx) — the engine behind the scenes:
 *     - one listener per paired friend → in-app notification + sound when a
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
import { ChatMsg, FbProfile, chatQueueSize, fbSendChat, listenNotes, listenProfile, pairKeyOf, writeChatListenerState, fbChatDeleteForAll, fbChatHideForMe } from "@/lib/cloud";
import { uid as newId } from "@/lib/types";
import { nativeVibrate } from "@/lib/native";
import { makeT, fmtClock } from "@/lib/i18n";
import { APP_VERSION } from "@/lib/version";

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

/** v5.1: 12-hour AM/PM (owner: "আমাদেশে ১২-ঘণ্টা হিসাব") — never the 24h
 * "14:30" form, regardless of the device locale. */
function timeOf(ts: number): string {
  return fmtClock(ts);
}

export default function ChatScreen() {
  const { state, t } = useStore();
  const { cfg } = useServerCfg();
  const acc = state.account;
  const [target, setTarget] = useState<ChatTarget | null>(null);
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  // v5.1 DELETE RULES: the message long-pressed right now (bottom sheet)
  const [pending, setPending] = useState<ChatMsg | null>(null);
  const [delBusy, setDelBusy] = useState(false);
  // v5.1 PRESENCE: the friend's lastAt heartbeat (green ≤ 2 min)
  const [peerLastAt, setPeerLastAt] = useState<number | null>(null);
  // v3.3 OFFLINE: shows "📨 অফলাইন — নেট এলে অটো যাবে" when a message was queued
  const [offlineStatus, setOfflineStatus] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);
  const readMarkedRef = useRef<string>("");

  // global open event + v5.1 NOTIFICATION-TAP ROUTER
  useEffect(() => {
    const open = (ev: Event) => {
      const d = (ev as CustomEvent<ChatTarget>).detail;
      if (d?.uid) setTarget({ uid: d.uid, name: d.name || "…" });
    };
    window.addEventListener("oh:open-chat", open);
    // v5.1 TAP ROUTER: the background listener writes oh_open_chat right
    // before posting a notification. When the user taps it, Android launches
    // the app — on boot AND on every resume this consumes the flag and jumps
    // STRAIGHT into that chat. Runs INSIDE this effect (after the listener
    // above is attached) so the dispatched event can never be lost — mounting
    // it in a sibling that mounts BEFORE ChatScreen (e.g. outside AuthGate)
    // silently ate the event.
    const route = () => {
      try {
        const raw = localStorage.getItem("oh_open_chat");
        if (!raw) return;
        localStorage.removeItem("oh_open_chat");
        const d = JSON.parse(raw) as { uid?: string; name?: string };
        if (d?.uid) window.dispatchEvent(new CustomEvent("oh:open-chat", { detail: { uid: d.uid, name: d.name || "…" } }));
      } catch {
        /* ignore */
      }
    };
    route();
    let un: (() => void) | null = null;
    void (async () => {
      try {
        const { App: CapApp } = await import("@capacitor/app");
        const l = await CapApp.addListener("appStateChange", (s: { isActive: boolean }) => {
          if (s.isActive) route();
        });
        un = () => void l.remove();
      } catch {
        /* plugin missing */
      }
    })();
    return () => {
      window.removeEventListener("oh:open-chat", open);
      if (un) un();
    };
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

  const pairKey = useMemo(() => (acc?.uid && target ? pairKeyOf(acc.uid, target.uid) : ""), [acc?.uid, target]);

  // realtime messages
  useEffect(() => {
    if (!pairKey || !target) {
      setMsgs([]);
      return;
    }
    const un = listenNotes(
      pairKey,
      (all) => {
        const chat = (all as unknown as ChatMsg[]).filter((m) => (m as unknown as { kind?: string }).kind === "chat");
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

  // v5.1 PRESENCE: live lastAt for the friend (🟢 ≤ 2 min, else 🔴)
  useEffect(() => {
    if (!target?.uid) return;
    const un = listenProfile(target.uid, (p) => setPeerLastAt(p?.lastAt || null), cfg);
    return () => {
      if (un) un();
    };
  }, [target?.uid, cfg]);
  const peerOnline = peerLastAt != null && Date.now() - peerLastAt < 120_000;

  // v5.1 DELETE RULES — the two actions (owner: "মেসেজ ডিলিট করার নিয়ম")
  const doDelete = useCallback(
    async (mode: "all" | "me") => {
      if (!pending || !pairKey || !acc?.uid) return;
      setDelBusy(true);
      const ok =
        mode === "all"
          ? await fbChatDeleteForAll(pairKey, pending.id, cfg) // own message → gone from BOTH phones
          : await fbChatHideForMe(pairKey, pending.id, acc.uid, cfg); // any message → hidden on MY phone only
      setDelBusy(false);
      if (ok) {
        setPending(null);
        void nativeVibrate(20);
      }
    },
    [pending, pairKey, acc?.uid, cfg]
  );
  const holdRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startHold = (m: ChatMsg) => {
    if (holdRef.current) clearTimeout(holdRef.current);
    holdRef.current = setTimeout(() => {
      holdRef.current = null;
      setPending(m);
    }, 480);
  };
  const cancelHold = () => {
    if (holdRef.current) {
      clearTimeout(holdRef.current);
      holdRef.current = null;
    }
  };

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
      const ok = await fbSendChat(pairKey, msg, cfg);
      setBusy(false);
      if (!ok) {
        // v3.3 OFFLINE: message is queued in localStorage — tell the user
        const qn = chatQueueSize();
        setOfflineStatus(qn > 0 ? `📨 অফলাইন — ${qn} মেসেজ সারিতে আছে, নেট এলে অটো যাবে` : "📨 অফলাইন — মেসেজ সেভ হয়েছে, নেট এলে যাবে");
        setTimeout(() => setOfflineStatus(""), 4000);
      } else {
        setText("");
        setOfflineStatus("");
        void nativeVibrate(15);
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
          <div className={`text-[10px] font-semibold ${peerOnline ? "text-green-600 dark:text-green-400" : "text-red-500"}`}>
            ● {peerOnline ? t("chatOnline") : t("chatOffline")}
          </div>
        </div>
        <div className="w-9 h-9 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-base shrink-0">💬</div>
      </div>

      {/* messages */}
      <div ref={listRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {(() => {
          // v5.1: hiddenBy (hide-for-me) messages stay invisible on MY phone
          const visible = msgs.filter((m) => !((m.hiddenBy || []).includes(acc?.uid || "")));
          if (visible.length === 0) {
            return (
              <div className="h-full flex items-center justify-center">
                <p className="text-xs text-muted-foreground text-center max-w-[240px]">{t("chatNoMsgs")}</p>
              </div>
            );
          }
          return visible.map((m) => {
            const mine = m.from === acc?.uid;
            return (
              <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div
                  onPointerDown={() => startHold(m)}
                  onPointerUp={cancelHold}
                  onPointerLeave={cancelHold}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setPending(m);
                  }}
                  className={`max-w-[78%] rounded-2xl px-3 py-2 shadow-sm ${
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
          });
        })()}
      </div>

      {/* composer */}
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
      {/* v5.1 DELETE RULES bottom sheet */}
      {pending ? (
        <div className="fixed inset-0 z-[75] bg-black/50 flex items-end" onClick={() => setPending(null)}>
          <div
            className="w-full max-w-md mx-auto rounded-t-3xl bg-card border-t border-border p-4 animate-slide-up"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 18px)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-sm font-bold mb-1">{t("chatDeleteTitle")}</div>
            <div className="text-[11px] text-muted-foreground mb-3 truncate">{pending.text || "📷"}</div>
            {pending.from === acc?.uid ? (
              <button
                type="button"
                disabled={delBusy}
                onClick={() => void doDelete("all")}
                className="w-full text-left rounded-xl bg-destructive/10 border border-destructive/30 px-3 py-3 mb-2 disabled:opacity-50"
              >
                <div className="text-sm font-bold text-destructive">{t("delForAll")}</div>
                <div className="text-[10px] text-muted-foreground">{t("delForAllSub")}</div>
              </button>
            ) : null}
            <button
              type="button"
              disabled={delBusy}
              onClick={() => void doDelete("me")}
              className="w-full text-left rounded-xl bg-secondary px-3 py-3 mb-2 disabled:opacity-50"
            >
              <div className="text-sm font-bold">{t("delForMe")}</div>
              <div className="text-[10px] text-muted-foreground">{t("delForMeSub")}</div>
            </button>
            <button type="button" onClick={() => setPending(null)} className="w-full rounded-xl bg-muted px-3 py-2.5 text-sm">
              {t("cancelBtn")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

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
  // v5.1: spoken reels warning is ALWAYS Bengali — locked to the bn dict,
  // independent of the UI language (owner: "ডাক বাংলায়")
  const tBn = useMemo(() => makeT("bn"), []);

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

  // per-pair listeners + last-seen bookkeeping
  // v5.1 FIX: dropped the acc.verified gate — an UNVERIFIED account never
  // started the background service/listener state, so those users got ZERO
  // chat notifications with the app closed (the friend-notification root
  // cause #2). Signed-in is enough; Firestore rules only need auth.
  useEffect(() => {
    if (!acc?.uid) return;
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
          pairs: pairs.map((p) => ({ key: p.key, name: p.name })),
          lang: state.settings.language || "bn",
          reelsLimitMin: state.settings.reelsLimitMin || 0,
          reelsWarn: `${state.settings.name || ""}${tBn("speakReelsWarn")}`,
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
            const chat = (all as unknown as ChatMsg[]).filter((m) => (m as unknown as { kind?: string }).kind === "chat");
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
            if (!known) {
              // first sync — remember, don't notify the whole history.
              // v5.1 FIX: also update the CLOSURE — the old code only wrote
              // localStorage, so on a fresh device `known` stayed "" forever
              // and EVERY later message took this early-return → the in-app
              // notification/popup never fired at all.
              known = String(last.createdAt || 0);
              return;
            }
            if (
              isNew &&
              last.from !== acc.uid &&
              openPairRef.current !== p.key &&
              (last.createdAt || 0) > Date.now() - 60_000
            ) {
              // v3.3: notification body — text-only chat
              const body = last.text || t("chatNewMsg");
              const title = `💬 ${last.fromName || p.name}`;
              fireNotif(title, body, "alarm.wav");
              void nativeVibrate(40);
              // v5.1: in-app heads-up popup (slides down, auto-hides in 5.5s,
              // tap → jumps into that chat) — Messenger-style
              window.dispatchEvent(
                new CustomEvent("oh:chat-popup", {
                  detail: { title, body, uid: last.from, name: last.fromName || p.name },
                })
              );
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
     
  }, [acc?.uid, acc?.verified, cfg]);

  // start/stop the background service + foreground mute
  useEffect(() => {
    if (!acc?.uid || !acc.verified || !chatNotifOn) {
      void import("@/lib/native").then(({ nativeChatServiceStop }) => nativeChatServiceStop());
      return;
    }
    void (async () => {
      const { nativeChatServiceStart, nativeChatServiceSetMuted, isNative } = await import("@/lib/native");
      if (!isNative()) return;
      await nativeChatServiceStart();
      await nativeChatServiceSetMuted(true); // app is in the foreground now
    })();
  }, [acc?.uid, acc?.verified, chatNotifOn]);

  // mute/unmute the background service on app foreground/background
  useEffect(() => {
    let un: (() => void) | null = null;
    void (async () => {
      try {
        const { App: CapApp } = await import("@capacitor/app");
        const { nativeChatServiceSetMuted } = await import("@/lib/native");
        const l = await CapApp.addListener("appStateChange", (s: { isActive: boolean }) => {
          void nativeChatServiceSetMuted(s.isActive);
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

  // v5.1 NOTIFICATION-TAP ROUTER lives in ChatScreen (see above) — it must
  // run where the oh:open-chat listener is attached, never in a sibling that
  // mounts earlier.

  // push the reels limit + warning to the background guard (throttled by effect deps)
  useEffect(() => {
    void import("@/lib/native").then(({ nativeSetReelsLimit }) =>
      nativeSetReelsLimit(
        state.settings.reelsLimitMin || 0,
        `${state.settings.name || ""}${tBn("speakReelsWarn")}`,
        "bn" // v5.1: the spoken warning is always Bengali
      )
    );

  }, [state.settings.reelsLimitMin, state.settings.name, tBn]);

  // SPEAK the reels warning when the app itself sees the limit crossed
  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    const log = state.logs[today];
    const limit = state.settings.reelsLimitMin || 0;
    const mins = log?.reelsMin ?? 0;
    if (limit > 0 && mins >= limit && acc?.uid) {
      void import("@/lib/native").then(({ nativeSpeakOnce }) =>
        nativeSpeakOnce("reelsWarn", `${state.settings.name || ""}${tBn("speakReelsWarn")}`, "bn", 30)
      );
    }
     
  }, [state.logs[new Date().toISOString().slice(0, 10)]?.reelsMin, state.settings.reelsLimitMin]);

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

// ==================== v5.1: in-app heads-up chat popup ====================

/**
 * Messenger-style transient banner: when a message arrives while the user is
 * somewhere ELSE in the app (not inside that chat), it slides down from the
 * top, shows sender + text, auto-hides after 5.5s — tapping it jumps straight
 * into the conversation. Mounted once in page.tsx (next to ChatWatchdog).
 */
export function ChatPopupHost() {
  const [pop, setPop] = useState<{ title: string; body: string; uid: string; name: string } | null>(null);
  useEffect(() => {
    const on = (ev: Event) => {
      const d = (ev as CustomEvent<{ title: string; body: string; uid: string; name: string }>).detail;
      if (!d?.uid) return;
      setPop(d);
      // auto-hide 5.5s later (only if the same popup is still showing)
      setTimeout(() => {
        setPop((cur) => (cur && cur.uid === d.uid && cur.body === d.body ? null : cur));
      }, 5500);
    };
    window.addEventListener("oh:chat-popup", on);
    return () => window.removeEventListener("oh:chat-popup", on);
  }, []);
  if (!pop) return null;
  return (
    <div className="fixed left-0 right-0 z-[80] mx-auto max-w-md px-3 animate-slide-down" style={{ top: "max(10px, env(safe-area-inset-top))" }}>
      <button
        type="button"
        onClick={() => {
          setPop(null);
          openChat(pop.uid, pop.name);
        }}
        className="w-full text-left rounded-2xl border border-border bg-card/95 backdrop-blur shadow-lg shadow-black/20 p-3 flex items-start gap-3 active:scale-[0.99] transition-transform"
      >
        <div className="w-9 h-9 rounded-full bg-primary/15 border border-primary/25 flex items-center justify-center text-base shrink-0">💬</div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold truncate">{pop.title}</div>
          <div className="text-xs text-muted-foreground truncate">{pop.body}</div>
        </div>
        <div className="text-[10px] text-muted-foreground shrink-0 pt-1">↩</div>
      </button>
    </div>
  );
}
