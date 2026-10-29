"use client";

/**
 * NotesTab v2.0 — Offline-first notes.
 *
 * 🔒 Personal notes — this device only (instant, always works offline)
 * 👥 Shared notes — REAL-TIME between partners with FULL offline support:
 *    • write with no internet → saved on the phone, status ⏳ Pending
 *    • internet back → auto-sent, no duplicates (stable ids)
 *    • both edit offline → conflict card: keep mine / theirs / both
 *    • 📡 Nearby sync → transfer DIRECTLY phone-to-phone (Bluetooth/WiFi
 *      Direct) even when NEITHER side has internet
 *    • per-note status: 📱 local · ⏳ pending · ➤ sent · ✓ synced · ⚠ failed
 */

import React, { useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { useServerCfg } from "@/lib/cfg";
import { Card, SectionTitle, Seg } from "@/components/ui-bits";
import { SharedNoteItem } from "@/lib/types";
import { FbProfile, fbPutNote, listenNotes, listenProfile, pairKeyOf } from "@/lib/cloud";
import {
  addLocalNote,
  applyPartnerPayload,
  deleteLocalNote,
  editLocalNote,
  exportForNearby,
  flushPair,
  isOnline,
  NoteConflict,
  NoteStatus,
  registerFbWriter,
  resolveConflict,
  retryNote,
  startAutoSync,
  subscribePair,
  SyncNote,
  toggleLocalDone,
} from "@/lib/note-sync";
import {
  NearbySyncSession,
  NearbySessionState,
  nearbyAvailable,
  nearbyStopAll,
} from "@/lib/nearby";
import { nativeShareText, nativeVibrate } from "@/lib/native";
import AdsBanner from "@/components/AdsBanner";

// ---------- v2.4: beautiful share format (owner round-6 #6) ----------
// Title FIRST, a clear separator, then the body — plus a soft footer.
function formatNoteShare(title: string, body: string, footer: string): string {
  const t = (title || "").trim();
  const b = (body || "").trim();
  const lines: string[] = [];
  if (t) {
    lines.push(`📌 ${t}`);
    lines.push("──────────────");
  }
  if (b) lines.push(b);
  if (!t && !b) return "";
  lines.push("");
  lines.push(footer);
  return lines.join("\n");
}

function useShareNote() {
  const { t, state } = useStore();
  const [busy, setBusy] = useState(false);
  const share = async (title: string, body: string) => {
    // v2.8: the share footer carries the REGISTERED full name (owner: "ওর
    // জিমেইলের নামটা থাকবে না") — settings.name is the registered name.
    const myName = (state.settings.name || "").trim();
    const footer = myName ? `— ${myName} · ${t("shareViaApp")}` : t("shareViaApp");
    const text = formatNoteShare(title, body, footer);
    if (!text) return;
    setBusy(true);
    void nativeVibrate(20);
    const how = await nativeShareText(title || t("appName"), text, t("shareNoteDialog"));
    setBusy(false);
    if (how === "copied") alert(t("shareCopied"));
    // "native"/"web" = the system share sheet opened (user picked an app)
  };
  return { share, busy };
}

type SubTab = "personal" | "shared";

// ---------- status chip ----------
function StatusChip({ status, onRetry, onPrimary = false }: { status: NoteStatus; onRetry: () => void; onPrimary?: boolean }) {
  const { t } = useStore();
  const map: Record<NoteStatus, { cls: string; label: string }> = onPrimary
    ? {
        synced: { cls: "bg-white/25 text-white", label: `✓ ${t("stSynced")}` },
        sent: { cls: "bg-white/25 text-white", label: `➤ ${t("stSent")}` },
        pending: { cls: "bg-amber-200/30 text-amber-100", label: `⏳ ${t("stPending")}` },
        local: { cls: "bg-white/20 text-white/90", label: `📱 ${t("stLocal")}` },
        failed: { cls: "bg-white/30 text-white", label: `⚠ ${t("stFailed")}` },
      }
    : {
        synced: { cls: "bg-primary/15 text-primary", label: `✓ ${t("stSynced")}` },
        sent: { cls: "bg-sky-500/15 text-sky-500", label: `➤ ${t("stSent")}` },
        pending: { cls: "bg-amber-500/15 text-amber-500", label: `⏳ ${t("stPending")}` },
        local: { cls: "bg-muted text-muted-foreground", label: `📱 ${t("stLocal")}` },
        failed: { cls: "bg-destructive/15 text-destructive", label: `⚠ ${t("stFailed")}` },
      };
  const s = map[status];
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`text-[9px] font-bold rounded-full px-2 py-0.5 ${s.cls} ${status === "pending" ? "st-pending" : ""}`}>{s.label}</span>
      {status === "failed" ? (
        <button
          type="button"
          onClick={onRetry}
          className={`text-[9px] font-bold rounded-full px-2 py-0.5 underline ${onPrimary ? "bg-white/30 text-white" : "bg-destructive/15 text-destructive"}`}
        >
          {t("stRetry")}
        </button>
      ) : null}
    </span>
  );
}

// ---------- Personal notes ----------
function PersonalNotes() {
  const { state, addPersonalNote, deletePersonalNote, t } = useStore();
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const { share, busy } = useShareNote();

  const add = () => {
    if (!title.trim() && !text.trim()) return;
    addPersonalNote(title.trim() || "Untitled", text.trim());
    setTitle("");
    setText("");
    setOpen(false);
  };

  return (
    <div>
      <SectionTitle
        title={`🔒 ${t("personalNotes")}`}
        sub={t("personalNotesSub")}
        right={
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="rounded-xl bg-primary text-primary-foreground text-xs font-semibold px-3 py-2 min-h-[36px] active:scale-95 transition-transform"
          >
            {open ? "×" : `+ ${t("newNote")}`}
          </button>
        }
      />
      {open ? (
        <Card className="mb-4 animate-slide-up">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("noteTitle")}
            className="w-full bg-muted rounded-xl px-3 py-2.5 text-sm border border-border outline-none focus:ring-2 focus:ring-ring/40 mb-2"
          />
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("noteText")}
            rows={3}
            className="w-full bg-muted rounded-xl px-3 py-2.5 text-sm border border-border outline-none focus:ring-2 focus:ring-ring/40 resize-none mb-2"
          />
          <button
            type="button"
            onClick={add}
            className="w-full rounded-xl bg-primary text-primary-foreground text-sm font-semibold py-2.5 min-h-[44px] shadow-sm shadow-primary/20 active:scale-[0.98] transition-transform"
          >
            {t("addNote")}
          </button>
        </Card>
      ) : null}
      {state.personalNotes.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">{t("noNotes")}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {state.personalNotes.map((n) => (
            <Card key={n.id} className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                {/* v2.4: TITLE first, then the body — clear separation */}
                <div className="text-sm font-extrabold text-primary leading-snug">{n.title}</div>
                {n.text ? <p className="text-xs text-foreground/90 whitespace-pre-wrap mt-1.5 leading-relaxed border-l-2 border-primary/30 pl-2.5">{n.text}</p> : null}
                <div className="text-[10px] text-muted-foreground mt-1.5 flex items-center gap-1.5">
                  <span>📱 {t("stLocal")}</span>
                  <span>· {n.date}</span>
                </div>
              </div>
              <div className="flex flex-col gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => void share(n.title, n.text)}
                  disabled={busy}
                  aria-label={t("shareNote")}
                  className="text-xs text-primary rounded-lg bg-primary/10 px-2 py-1.5 active:scale-95 transition-transform disabled:opacity-50"
                >
                  📤
                </button>
                <button
                  type="button"
                  onClick={() => deletePersonalNote(n.id)}
                  aria-label="delete note"
                  className="text-xs text-destructive rounded-lg bg-destructive/10 px-2 py-1.5 active:scale-95 transition-transform"
                >
                  🗑
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Nearby (device-to-device) panel ----------
function NearbyPanel({ pairKey, meUid, meName }: { pairKey: string; meUid: string; meName: string }) {
  const { t } = useStore();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<NearbySessionState>("idle");
  const [log, setLog] = useState<string[]>([]);
  const [available, setAvailable] = useState(false);
  const sessionRef = useRef<NearbySyncSession | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setAvailable(nearbyAvailable()), 0);
    return () => clearTimeout(id);
  }, []);

  const addLog = (line: string) => setLog((l) => [...l.slice(-4), line]);

  const start = async () => {
    setLog([]);
    const session = new NearbySyncSession(pairKey, meName || "OurHabit", {
      onState: (s) => setState(s),
      onLog: addLog,
      onForeignDevice: () => addLog(t("nearbyForeign")),
    });
    session.onSendNotes = async (notes) => {
      for (const n of notes) {
        await (await import("@/lib/nearby")).nearbySend(JSON.stringify({ t: "note", note: n }));
      }
    };
    session.onReceiveNotes = (notes) => {
      const { received, deliveredMine } = applyPartnerPayload(pairKey, notes as never[]);
      addLog(`✓ ${received} ${t("nearbyReceived")} · ${deliveredMine} ${t("nearbyDelivered")}`);
    };
    sessionRef.current = session;
    const ok = await session.start();
    if (!ok) setState("error");
  };

  const stop = async () => {
    await sessionRef.current?.stop();
    await nearbyStopAll();
    setState("idle");
  };

  useEffect(() => {
    return () => {
      void sessionRef.current?.stop();
      void nearbyStopAll();
    };
  }, []);

  const stateLabel: Record<NearbySessionState, string> = {
    idle: "",
    advertising: t("nearbyStAdvertising"),
    discovering: t("nearbyStDiscovering"),
    connecting: t("nearbyStConnecting"),
    exchanging: t("nearbyStExchanging"),
    done: t("nearbyStDone"),
    error: t("nearbyStError"),
  };
  const active = ["advertising", "discovering", "connecting", "exchanging"].includes(state);

  return (
    <div className="rounded-2xl border border-sky-500/25 bg-sky-500/5 overflow-hidden mb-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 p-3.5 text-left"
      >
        <span className="w-10 h-10 rounded-xl bg-sky-500/15 flex items-center justify-center text-xl shrink-0">
          📡
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold">{t("nearbyTitle")}</div>
          <div className="text-[11px] text-muted-foreground leading-snug">{t("nearbySub")}</div>
        </div>
        <span className="text-muted-foreground/60 text-base leading-none">{open ? "▲" : "▼"}</span>
      </button>

      {open ? (
        <div className="px-3.5 pb-3.5">
          {!available ? (
            <p className="text-[11px] text-muted-foreground leading-relaxed bg-muted rounded-xl p-2.5">
              {t("nearbyApkOnly")}
            </p>
          ) : (
            <>
              {state === "idle" || state === "done" || state === "error" ? (
                <button
                  type="button"
                  onClick={() => void start()}
                  className="w-full rounded-xl bg-sky-500 text-white text-sm font-bold py-3 min-h-[48px] shadow-sm active:scale-[0.98] transition-transform"
                >
                  📶 {state === "error" ? t("nearbyTryAgain") : t("nearbyStart")}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void stop()}
                  className="w-full rounded-xl bg-secondary text-sm font-bold py-3 min-h-[48px]"
                >
                  ✕ {t("nearbyStop")}
                </button>
              )}
              {stateLabel[state] ? (
                <div className={`text-xs font-semibold mt-2 flex items-center gap-2 ${state === "error" ? "text-destructive" : state === "done" ? "text-primary" : "text-sky-500"}`}>
                  {active ? <span className="w-2 h-2 rounded-full bg-sky-500 animate-pulse" /> : null}
                  {stateLabel[state]}
                </div>
              ) : null}
              {log.length ? (
                <div className="mt-1.5 text-[10px] text-muted-foreground space-y-0.5">
                  {log.map((l, i) => (
                    <div key={i}>{l}</div>
                  ))}
                </div>
              ) : null}
              <p className="text-[10px] text-muted-foreground mt-2 leading-relaxed">{t("nearbyHint")}</p>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

// ---------- Conflict dialog ----------
function ConflictModal({ pairKey, conflict }: { pairKey: string; conflict: NoteConflict }) {
  const { t } = useStore();
  return (
    <div className="fixed inset-0 z-[85] bg-background/85 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-3xl bg-card border border-amber-500/40 shadow-2xl p-5 animate-slide-up max-h-[85vh] overflow-y-auto">
        <div className="text-center mb-4">
          <div className="text-4xl mb-2">⚔️</div>
          <h3 className="text-base font-extrabold">{t("conflictTitle")}</h3>
          <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">{t("conflictSub")}</p>
        </div>
        <div className="grid grid-cols-1 gap-2 mb-4">
          <div className="rounded-2xl border border-primary/30 bg-primary/5 p-3">
            <div className="text-[10px] font-bold text-primary mb-1">🫵 {conflict.mineName} — {t("conflictMine")}</div>
            <p className="text-xs whitespace-pre-wrap">{conflict.mine}</p>
          </div>
          <div className="rounded-2xl border border-sky-500/30 bg-sky-500/5 p-3">
            <div className="text-[10px] font-bold text-sky-500 mb-1">👤 {conflict.theirsName} — {t("conflictTheirs")}</div>
            <p className="text-xs whitespace-pre-wrap">{conflict.theirs}</p>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => resolveConflict(pairKey, conflict.id, "both")}
            className="w-full rounded-2xl bg-primary text-primary-foreground text-sm font-bold py-3 min-h-[48px] shadow-md shadow-primary/25 active:scale-[0.98] transition-transform"
          >
            🤝 {t("conflictKeepBoth")}
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => resolveConflict(pairKey, conflict.id, "mine")}
              className="flex-1 rounded-2xl bg-secondary text-sm font-semibold py-2.5 min-h-[44px]"
            >
              {t("conflictKeepMine")}
            </button>
            <button
              type="button"
              onClick={() => resolveConflict(pairKey, conflict.id, "theirs")}
              className="flex-1 rounded-2xl bg-secondary text-sm font-semibold py-2.5 min-h-[44px]"
            >
              {t("conflictKeepTheirs")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- Shared notes (offline-first engine) ----------
function SharedNotes() {
  const { state, t, openAuth } = useStore();
  const { cfg } = useServerCfg();
  const { share } = useShareNote();
  const acc = state.account;
  const [me, setMe] = useState<FbProfile | null>(null);
  const [partnerUid, setPartnerUid] = useState<string>("");
  const [text, setText] = useState("");
  const [, forceTick] = useState(0);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [conflict, setConflict] = useState<NoteConflict | null>(null);

  // profile (invite code + friends)
  useEffect(() => {
    if (!acc?.uid) {
      const id = setTimeout(() => setMe(null), 0);
      return () => clearTimeout(id);
    }
    const un = listenProfile(acc.uid, (p) => setMe(p), cfg);
    return () => {
      if (un) un();
    };
  }, [acc?.uid, cfg]);

  // hand the Firestore writer to the offline engine
  useEffect(() => {
    registerFbWriter((pairKey, note) => fbPutNote(pairKey, note as unknown as Record<string, unknown>, cfg));
    return () => registerFbWriter(() => Promise.resolve(false));
  }, [cfg]);

  const friends = me?.friends || [];

  useEffect(() => {
    if (friends.length === 0) return;
    const id = setTimeout(() => setPartnerUid((p) => p || friends[0].uid), 0);
    return () => clearTimeout(id);
  }, [friends.length]);

  const partner = friends.find((f) => f.uid === partnerUid);
  const pKey = me && partner ? pairKeyOf(me.uid, partner.uid) : "";

  // live notes + pending counter + conflicts from the sync engine
  const [notes, setNotes] = useState<SyncNote[]>([]);
  const [pending, setPending] = useState(0);
  const [online, setOnline] = useState(isOnline());

  useEffect(() => {
    if (!pKey) {
      const id = setTimeout(() => {
        setNotes([]);
        setPending(0);
      }, 0);
      return () => clearTimeout(id);
    }
    const un = subscribePair(
      pKey,
      (items, meta) => {
        setNotes(items);
        setPending(meta.pending);
        setOnline(meta.online);
      },
      (conflicts) => setConflict(conflicts[0] || null)
    );
    return un;
  }, [pKey]);

  // auto-sync loop: flush on online / every 30s + Firestore realtime listener
  useEffect(() => {
    if (!pKey) return;
    return startAutoSync(pKey, {
      listen: (cb) => {
        const un = listenNotes(pKey, (items: SharedNoteItem[]) => cb(items as never[]), cfg);
        return un || (() => undefined);
      },
    });
  }, [pKey, cfg]);

  if (!acc || !acc.verified) {
    return (
      <Card className="border-primary/30 bg-gradient-to-br from-primary/10 to-transparent">
        <div className="text-center py-3">
          <div className="text-4xl mb-2">📝</div>
          <p className="text-sm font-semibold">{t("signInToShare")}</p>
          <p className="text-xs text-muted-foreground mt-1 mb-4">{t("whyLogin")}</p>
          <button
            type="button"
            onClick={openAuth}
            className="w-full rounded-2xl bg-primary text-primary-foreground text-sm font-bold py-3.5 min-h-[52px] shadow-md shadow-primary/25 active:scale-[0.98] transition-transform"
          >
            {t("loginCta")}
          </button>
          <p className="text-[10px] text-muted-foreground mt-2">{t("loginCtaSub")}</p>
        </div>
      </Card>
    );
  }

  // v2.8: the REGISTERED name (settings.name) wins over the Firestore/Google
  // account name — owner: "ওর জিমেইলের নামটা থাকবে না"
  const myName = (state.settings.name || me?.name || acc.name || "Me").split(" ")[0];

  const add = () => {
    const v = text.trim();
    if (!v || !me || !partner) return;
    setText("");
    addLocalNote(pKey, v, me.uid, myName);
  };

  const syncNow = async () => {
    await flushPair(pKey);
    forceTick((x) => x + 1);
  };

  return (
    <div>
      <SectionTitle title={`👥 ${t("sharedNotes")}`} sub={t("sharedNotesSub")} />

      {friends.length === 0 ? (
        <Card>
          <p className="text-sm text-muted-foreground text-center py-4">
            {t("noFriends")} — {t("nav_friends")} {t("addFriendBtn")} 🧑‍🤝‍🧑
          </p>
        </Card>
      ) : (
        <>
          {/* partner picker */}
          <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2 mb-3">
            {friends.map((f) => (
              <button
                key={f.uid}
                type="button"
                onClick={() => setPartnerUid(f.uid)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border min-h-[36px] transition-colors shrink-0 ${
                  partnerUid === f.uid
                    ? "bg-primary text-primary-foreground border-primary shadow-sm shadow-primary/20"
                    : "bg-secondary text-secondary-foreground border-transparent"
                }`}
              >
                {f.name}
              </button>
            ))}
          </div>

          {/* sync status bar */}
          <div className={`rounded-2xl border p-3 mb-3 flex items-center gap-3 ${online ? "border-primary/25 bg-primary/5" : "border-amber-500/30 bg-amber-500/5"}`}>
            <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${online ? "bg-primary" : "bg-amber-500 animate-pulse"}`} />
            <div className="min-w-0 flex-1 text-[11px] leading-snug">
              {online ? (
                <span className="text-primary font-semibold">⚡ {t("liveSyncOn")}</span>
              ) : (
                <span className="text-amber-500 font-semibold">{t("offlineBanner")}</span>
              )}
              {pending > 0 ? (
                <div className="text-muted-foreground mt-0.5">
                  ⏳ {pending} {t("pendingNotes")}
                </div>
              ) : null}
            </div>
            {pending > 0 ? (
              <button
                type="button"
                onClick={() => void syncNow()}
                className="rounded-xl bg-primary text-primary-foreground text-[11px] font-bold px-3 py-2 min-h-[38px] shrink-0 active:scale-95 transition-transform"
              >
                🔄 {t("syncNow")}
              </button>
            ) : null}
          </div>

          {/* Nearby direct transfer (works with NO internet on both sides) */}
          {partner ? <NearbyPanel pairKey={pKey} meUid={me!.uid} meName={myName} /> : null}

          {/* input row */}
          <div className="flex gap-2 mb-3">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add()}
              placeholder={t("addItem")}
              className="flex-1 bg-muted rounded-xl px-3 py-2.5 text-sm border border-border outline-none focus:ring-2 focus:ring-ring/40 min-h-[46px]"
            />
            <button
              type="button"
              onClick={add}
              className="rounded-xl bg-primary text-primary-foreground text-sm font-semibold px-4 min-h-[46px] shadow-sm shadow-primary/20 active:scale-95 transition-transform"
            >
              {t("addSharedNote")}
            </button>
          </div>

          {/* chat-style notes — mine right (gradient), partner left */}
          {notes.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">{t("emptyList")}</p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {notes.map((n) => {
                const mine = n.author === me?.uid;
                return (
                  <div key={n.id} className={`flex flex-col animate-slide-up ${mine ? "items-end" : "items-start"}`}>
                    <div className={`max-w-[86%] px-3.5 py-2.5 ${mine ? "bubble-mine" : "bubble-theirs"} ${n.done ? "bubble-done" : ""}`}>
                      {editing?.id === n.id ? (
                        <div className="min-w-[220px]">
                          <textarea
                            value={editing.text}
                            onChange={(e) => setEditing({ id: n.id, text: e.target.value })}
                            rows={3}
                            className="w-full bg-muted rounded-xl px-3 py-2 text-sm text-foreground border border-border outline-none focus:ring-2 focus:ring-ring/40 resize-none"
                          />
                          <div className="flex gap-2 mt-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                if (editing.text.trim()) editLocalNote(pKey, n.id, editing.text);
                                setEditing(null);
                              }}
                              className="rounded-lg bg-primary text-primary-foreground text-[11px] font-bold px-3 py-1.5"
                            >
                              ✓ {t("saveEdit")}
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditing(null)}
                              className="rounded-lg bg-secondary text-[11px] font-semibold px-3 py-1.5"
                            >
                              {t("cancelEdit")}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <p className={`text-sm whitespace-pre-wrap break-words leading-snug ${n.done ? "line-through" : ""}`}>{n.text}</p>
                          <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                            <span className="text-[9px] font-bold rounded-full px-2 py-0.5 bubble-chip">
                              {mine ? `🫵 ${myName}` : `👤 ${partner?.name || "—"}`}
                            </span>
                            {mine ? (
                              <StatusChip status={n.status} onRetry={() => retryNote(pKey, n.id)} onPrimary />
                            ) : (
                              <span className="text-[9px] font-bold rounded-full px-2 py-0.5 bubble-chip">📥 {t("stFromPartner")}</span>
                            )}
                            {n.done && n.doneBy ? (
                              <span className={`text-[9px] ${mine ? "text-white/80" : "text-muted-foreground"}`}>· ✓ {t("doneBy")}</span>
                            ) : null}
                          </div>
                        </>
                      )}
                    </div>
                    {editing?.id !== n.id ? (
                      <div className="flex gap-1 mt-1 px-1">
                        <button
                          type="button"
                          onClick={() => toggleLocalDone(pKey, n.id, me!.uid)}
                          aria-label="toggle done"
                          className={`text-[11px] rounded-lg px-2 py-1 transition-transform active:scale-95 ${n.done ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground"}`}
                        >
                          {n.done ? "✓" : "○"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditing({ id: n.id, text: n.text })}
                          aria-label="edit note"
                          className="text-[11px] bg-secondary text-muted-foreground rounded-lg px-2 py-1 active:scale-95 transition-transform"
                        >
                          ✏️
                        </button>
                        {/* v2.4: share this note via the native share sheet */}
                        <button
                          type="button"
                          onClick={() => void share("", n.text)}
                          aria-label={t("shareNote")}
                          className="text-[11px] bg-primary/10 text-primary rounded-lg px-2 py-1 active:scale-95 transition-transform"
                        >
                          📤
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteLocalNote(pKey, n.id)}
                          aria-label="delete note"
                          className="text-[11px] bg-destructive/10 text-destructive rounded-lg px-2 py-1 active:scale-95 transition-transform"
                        >
                          🗑
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}

          <p className="text-[10px] text-muted-foreground mt-3 leading-relaxed text-center">
            {t("offlineSyncFootnote")}
          </p>
        </>
      )}

      {conflict ? <ConflictModal pairKey={pKey} conflict={conflict} /> : null}
    </div>
  );
}

export default function NotesTab() {
  const { t } = useStore();
  const [tab, setTab] = useState<SubTab>("personal");
  return (
    <div>
      <h1 className="text-xl font-bold mb-3">📝 {t("notesTitle")}</h1>
      {/* v2.8: ads on every page */}
      <AdsBanner variant="a" />
      <Seg<SubTab>
        value={tab}
        onChange={setTab}
        options={[
          { value: "personal", label: `🔒 ${t("tab_personal")}` },
          { value: "shared", label: `👥 ${t("tab_shared")}` },
        ]}
        className="mb-4"
      />
      {tab === "personal" ? <PersonalNotes /> : <SharedNotes />}
      {/* v2.8: ads on every page */}
      <AdsBanner variant="b" />
    </div>
  );
}
