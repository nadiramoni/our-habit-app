"use client";

/**
 * AuthGate — the first screen every user sees (and re-opens from inside the app).
 *
 *  • Google sign-in  → 1 tap, done.
 *  • Email sign-up   → FIRST NAME + LAST NAME (becomes the app-wide name) +
 *                      email + password → Firebase sends a verification mail →
 *                      verify gate → login.
 *  • "forced" mode   → opened from Friends/Notes/Settings via the store's
 *                      authOpen flag; closable with × / "পরে".
 *  • Boot mode       → tiny "not now" link keeps the app offline-usable.
 */

import React, { useEffect, useState } from "react";
import { useStore, rememberAccountName } from "@/lib/store";
import { useServerCfg } from "@/lib/cfg";
import {
  fbCheckVerified,
  fbEmailSignIn,
  fbEmailSignUp,
  fbGoogleSignIn,
  fbHandleRedirect,
  fbSendPasswordReset,
  fbSendVerification,
  fbSignOut,
  fbUpdateProfileName,
} from "@/lib/cloud";

const SKIP_KEY = "ourhabit_skipauth";

function GoogleG() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.3 6.1 29.4 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.3 6.1 29.4 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.6 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C36.9 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z" />
    </svg>
  );
}

export default function AuthGate({ children, forced = false }: { children: React.ReactNode; forced?: boolean }) {
  const { state, setAccount, updateSettings, t, closeAuth } = useStore();
  const { cfg } = useServerCfg();
  const acc = state.account;
  const [skipped, setSkipped] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [mode, setMode] = useState<"auth" | "verify" | "reset">("auth");
  const [isLogin, setIsLogin] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => {
      try {
        if (localStorage.getItem(SKIP_KEY) === "1") setSkipped(true);
      } catch {
        /* ignore */
      }
      setHydrated(true);
    }, 0);
    return () => clearTimeout(id);
  }, []);

  // v3.0: consume a signInWithRedirect round-trip (page reloaded after the
  // Google page) — surfaces unauthorized-domain / banned errors loudly.
  useEffect(() => {
    let dead = false;
    void fbHandleRedirect().then((e) => {
      if (!dead && e) setErr(t(e));
    });
    return () => {
      dead = true;
    };
  }, []);

  // password users must verify → gate them (and un-gate when signed out)
  useEffect(() => {
    const id = setTimeout(() => {
      if (acc && acc.provider === "password" && !acc.verified) {
        setMode("verify");
        if (!email) setEmail(acc.email);
      } else if (!acc) {
        setMode("auth");
      }
    }, 0);
    return () => clearTimeout(id);
  }, [acc?.uid, acc?.verified, acc?.provider]);

  // forced overlay: signed-in + verified → close automatically
  useEffect(() => {
    if (forced && acc && (acc.verified || acc.provider === "google")) {
      closeAuth();
    }
  }, [forced, acc?.uid, acc?.verified]);

  const reset = () => {
    setErr("");
    setInfo("");
  };

  const doGoogle = async () => {
    reset();
    setBusy(true);
    // v2.9: NATIVE account picker inside the APK (the white-screen
    // signInWithPopup flow is gone). Errors are LOUD and specific now —
    // the button can never hang on "..." again (25s hard timeout inside).
    const res = await fbGoogleSignIn(cfg);
    setBusy(false);
    if (!res.ok) {
      if (res.error === "errCancelled") return; // user closed the picker
      if (res.error === "errRedirecting") {
        setInfo(t("errRedirecting"));
        return; // page is navigating to Google — nothing else to do
      }
      if (
        res.error === "errSha1" ||
        res.error === "errTimeout" ||
        res.error === "errNetwork" ||
        res.error === "errDomain" ||
        res.error === "errBanned"
      ) {
        setErr(t(res.error));
      } else {
        setErr(t(res.error?.split(":")[0] || "errGeneric"));
      }
    }
  };

  // v3.0: forgot-password flow — Firebase emails a secure reset link.
  const sendReset = async () => {
    reset();
    if (!email.trim()) return setErr(t("errInvalidEmail"));
    setBusy(true);
    const res = await fbSendPasswordReset(email, cfg);
    setBusy(false);
    if (res.ok) {
      setInfo(t("resetSent"));
    } else {
      setErr(t(res.error || "errGeneric"));
    }
  };

  const submit = async () => {
    reset();
    if (!isLogin && !firstName.trim()) return setErr(t("firstNameNeeded"));
    if (!email.trim() || !pass) return setErr(t("errGeneric"));
    setBusy(true);
    const full = `${firstName.trim()}${lastName.trim() ? ` ${lastName.trim()}` : ""}`;
    const res = isLogin ? await fbEmailSignIn(email, pass, cfg) : await fbEmailSignUp(email, pass, full, cfg);
    setBusy(false);
    if (res.ok) {
      if (!isLogin) {
        setInfo(t("mailSent"));
        // v2.8: the REGISTERED full name is the app-wide name — mark it as
        // user-set so the Gmail/account name NEVER overwrites it later.
        // v2.9: ALSO remember it per-account NOW (the auth listener may fire
        // before updateSettings lands — no name can ever leak across accounts)
        const signed = res as { ok: boolean; error?: string; uid?: string };
        if (signed.uid) {
          rememberAccountName(signed.uid, full);
          setAccount({ uid: signed.uid, name: full, email: email.trim(), verified: false, provider: "password" });
        }
        updateSettings({ name: full, nameSet: true });
      }
      setPass("");
    } else {
      setErr(t(res.error || "errGeneric"));
    }
  };

  const checkNow = async () => {
    setChecking(true);
    const ok = await fbCheckVerified();
    setChecking(false);
    if (ok) {
      // onAuthStateChanged doesn't re-fire after reload() — update state ourselves
      if (acc) setAccount({ ...acc, verified: true });
      setMode("auth");
    } else {
      setInfo(t("verifyNotYet"));
    }
  };

  const skip = () => {
    try {
      localStorage.setItem(SKIP_KEY, "1");
    } catch {
      /* ignore */
    }
    setSkipped(true);
  };

  const dismissForced = () => {
    reset();
    closeAuth();
  };

  const allowed = Boolean(acc && (acc.verified || acc.provider === "google"));

  // boot mode: let people through when skipped or signed in (forced overlay ignores this)
  if (!forced && hydrated && (skipped || allowed)) return <>{children}</>;
  if (forced && hydrated && !acc) {
    // opened from inside but user backed out before? still show — they asked for it
  }

  return (
    <div className="fixed inset-0 z-[80] overflow-y-auto bg-gradient-to-b from-background via-background to-primary/10">
      <div className="min-h-full max-w-md mx-auto px-6 py-8 flex flex-col justify-center relative">
        {forced ? (
          <button
            type="button"
            onClick={dismissForced}
            aria-label={t("updateLater")}
            className="absolute top-2 right-2 w-10 h-10 rounded-full bg-secondary text-muted-foreground text-lg font-bold flex items-center justify-center z-10"
          >
            ×
          </button>
        ) : null}

        {/* logo */}
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-24 h-24 rounded-[28px] overflow-hidden shadow-xl shadow-primary/20 border border-primary/20 logo-float mb-4">
            <img src="/icon-512.png" alt="Our Habit" className="w-full h-full object-cover" />
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight">{t("appName")}</h1>
          <p className="text-xs text-muted-foreground mt-1">{t("tagline")}</p>
        </div>

        {mode === "auth" ? (
          <div className="rounded-3xl bg-card border border-border shadow-lg p-5 animate-slide-up">
            <h2 className="text-lg font-bold text-center">{t("authWelcome")} 👋</h2>
            <p className="text-xs text-muted-foreground text-center mt-1 mb-4">{t("authSub")}</p>
            <button
              type="button"
              onClick={() => void doGoogle()}
              disabled={busy}
              className="w-full flex items-center justify-center gap-3 rounded-2xl bg-white text-gray-900 font-bold text-sm py-3.5 min-h-[52px] shadow-md active:scale-[0.98] transition-transform disabled:opacity-60"
            >
              <GoogleG />
              {t("googleBtn")}
            </button>

            <div className="flex items-center gap-3 my-4">
              <div className="h-px flex-1 bg-border" />
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{t("orEmail")}</span>
              <div className="h-px flex-1 bg-border" />
            </div>

            <div className="flex flex-col gap-2.5">
              {!isLogin ? (
                <div className="flex gap-2.5">
                  <input
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder={t("firstName")}
                    autoComplete="given-name"
                    className="w-full bg-muted rounded-xl px-4 py-3 text-sm border border-border outline-none focus:ring-2 focus:ring-ring/50"
                  />
                  <input
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder={t("lastName")}
                    autoComplete="family-name"
                    className="w-full bg-muted rounded-xl px-4 py-3 text-sm border border-border outline-none focus:ring-2 focus:ring-ring/50"
                  />
                </div>
              ) : null}
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t("emailLabel")}
                type="email"
                inputMode="email"
                autoComplete="email"
                className="w-full bg-muted rounded-xl px-4 py-3 text-sm border border-border outline-none focus:ring-2 focus:ring-ring/50"
              />
              <input
                value={pass}
                onChange={(e) => setPass(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void submit()}
                placeholder={`${t("passLabel")} (${t("passHint")})`}
                type="password"
                autoComplete={isLogin ? "current-password" : "new-password"}
                className="w-full bg-muted rounded-xl px-4 py-3 text-sm border border-border outline-none focus:ring-2 focus:ring-ring/50"
              />
            </div>

            {/* v3.0: forgot password — only meaningful on the login card */}
            {isLogin ? (
              <button
                type="button"
                onClick={() => {
                  reset();
                  setMode("reset");
                }}
                className="text-[11px] text-primary font-bold underline underline-offset-2 mt-2.5 float-right"
              >
                {t("forgotPass")}
              </button>
            ) : null}

            {err ? (
              <div className="mt-3 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-xs text-destructive leading-relaxed text-center animate-slide-up" role="alert">
                ⚠️ {err}
              </div>
            ) : null}
            {info && !err ? <p className="text-xs text-primary mt-2.5 text-center">{info}</p> : null}

            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy}
              className="w-full rounded-2xl btn-hero text-primary-foreground font-bold text-sm py-3.5 min-h-[52px] mt-4 active:scale-[0.98] transition-transform disabled:opacity-60"
            >
              {busy ? "..." : isLogin ? t("loginBtn") : t("createAccount")}
            </button>

            <p className="text-xs text-center text-muted-foreground mt-4">
              {isLogin ? t("noAccount") : t("haveAccount")}{" "}
              <button
                type="button"
                onClick={() => {
                  reset();
                  setIsLogin((v) => !v);
                }}
                className="text-primary font-bold underline underline-offset-2"
              >
                {isLogin ? t("signupWord") : t("loginWord")}
              </button>
            </p>
          </div>
        ) : mode === "reset" ? (
          /* ---- v3.0: forgot-password card ---- */
          <div className="rounded-3xl bg-card border border-border shadow-lg p-6 text-center animate-slide-up">
            <div className="text-5xl mb-3">🔑</div>
            <h2 className="text-lg font-bold">{t("resetTitle")}</h2>
            <p className="text-xs text-muted-foreground mt-2 mb-4 leading-relaxed">{t("resetSub")}</p>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void sendReset()}
              placeholder={t("emailLabel")}
              type="email"
              inputMode="email"
              autoComplete="email"
              className="w-full bg-muted rounded-xl px-4 py-3 text-sm border border-border outline-none focus:ring-2 focus:ring-ring/50"
            />
            {err ? (
              <div className="mt-3 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-xs text-destructive leading-relaxed text-center animate-slide-up" role="alert">
                ⚠️ {err}
              </div>
            ) : null}
            {info && !err ? <p className="text-xs text-primary mt-3 leading-relaxed text-center">{info}</p> : null}
            <button
              type="button"
              onClick={() => void sendReset()}
              disabled={busy}
              className="w-full rounded-2xl btn-hero text-primary-foreground font-bold text-sm py-3.5 min-h-[52px] mt-4 active:scale-[0.98] transition-transform disabled:opacity-60"
            >
              {busy ? "..." : t("resetBtn")}
            </button>
            <button
              type="button"
              onClick={() => {
                reset();
                setMode("auth");
              }}
              className="text-xs text-muted-foreground underline underline-offset-2 py-2 mt-2"
            >
              {t("backToLogin")}
            </button>
          </div>
        ) : (
          /* ---- email verification gate ---- */
          <div className="rounded-3xl bg-card border border-border shadow-lg p-6 text-center animate-slide-up">
            <div className="text-5xl mb-3">📬</div>
            <h2 className="text-lg font-bold">{t("verifyTitle")}</h2>
            <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{t("verifySub")}</p>
            {email ? <p className="text-sm font-semibold text-primary mt-2 break-all">{email}</p> : null}
            <p className="text-[11px] text-muted-foreground mt-2">{t("verifyHint")}</p>
            {info ? <p className="text-xs text-primary mt-3">{info}</p> : null}
            <div className="flex flex-col gap-2.5 mt-5">
              <button
                type="button"
                onClick={() => void checkNow()}
                disabled={checking}
                className="w-full rounded-2xl btn-hero text-primary-foreground font-bold text-sm py-3.5 min-h-[52px] disabled:opacity-60"
              >
                {checking ? "..." : t("iVerified")}
              </button>
              <button
                type="button"
                onClick={async () => {
                  const ok = await fbSendVerification();
                  setInfo(ok ? t("mailSent") : t("errGeneric"));
                }}
                className="w-full rounded-2xl bg-secondary text-sm py-3 min-h-[48px]"
              >
                ✉️ {t("resendMail")}
              </button>
              <button
                type="button"
                onClick={() => void fbSignOut().then(() => setAccount(null))}
                className="text-xs text-muted-foreground underline underline-offset-2 py-2"
              >
                {t("signOut")}
              </button>
            </div>
          </div>
        )}

        {!forced && mode === "auth" ? (
          <button type="button" onClick={skip} className="text-[11px] text-muted-foreground/70 underline underline-offset-2 mt-5 mx-auto">
            {t("skipNow")}
          </button>
        ) : null}
      </div>
    </div>
  );
}

// ==================== v2.8: NAME CAPTURE (the registered full name) ====================
// Owner: "যখন শেয়ার করে যায়, যে ফুল নাম (ফার্স্ট + লাস্ট নাম) দিয়ে রেজিস্টার
// করে সেটাই থাকবে — ওর জিমেইলের নামটা থাকবে না"। After signing in (any
// method), ONE friendly step asks for the first + last name. That name is
// saved as the app-wide name (settings.name + nameSet) AND pushed to
// Firebase (displayName + usersIndex) so friends and shared notes see the
// REGISTERED name on every device — never the Gmail display name.
export function NameCapture() {
  const { state, updateSettings, setAccount, t } = useStore();
  const acc = state.account;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // prefill from whatever name we already have (Google name split, etc.)
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  // v3.3 gender (the voice tries to pick a female voice for girls / male for
  // boys). v5.2 (owner round-22): the Bengali-spelling field is GONE — the
  // alarm now says the name AS ENTERED ("নামও বলবে — তোমার যে ইংলিশ নামটা
  // ঐটা বলবে"), so there is nothing left to spell in Bangla script.
  const [gender, setGender] = useState<"" | "male" | "female">("");

  useEffect(() => {
    if (!acc) return;
    if (state.settings.nameSet) return; // already registered — never ask again
    // deferred (async) so the compiler never sees setState inside the effect
    // body — prefill + open after the splash settles
    const id = setTimeout(() => {
      const cur = (state.settings.name || acc.name || "").trim();
      const parts = cur.split(/\s+/).filter(Boolean);
      setFirst(parts[0] || "");
      setLast(parts.length > 1 ? parts.slice(1).join(" ") : "");
      setOpen(true);
    }, 900);
    return () => clearTimeout(id);
  }, [acc?.uid, state.settings.nameSet]);

  if (!acc || !open || state.settings.nameSet) return null;

  const save = async () => {
    const full = `${first.trim()}${last.trim() ? ` ${last.trim()}` : ""}`;
    if (!first.trim()) return;
    setBusy(true);
    updateSettings({
      name: full,
      nameSet: true,
      // v3.3 gender for the spoken alarm voice (v5.2: nameBn is retired —
      // the English name itself is spoken now)
      ...(gender ? { gender } : {}),
    });
    setAccount({ ...acc, name: full });
    await fbUpdateProfileName(full); // Firebase displayName + usersIndex
    setBusy(false);
    setOpen(false);
  };

  const skip = () => {
    // keep whatever name exists — but never nag again
    updateSettings({ nameSet: true });
    setOpen(false);
  };

  return (
    <div className="fixed inset-0 z-[85] bg-background/95 backdrop-blur-sm flex items-end sm:items-center justify-center">
      <div className="w-full max-w-md bg-card border border-border rounded-t-3xl sm:rounded-3xl p-5 animate-slide-up shadow-2xl">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-12 h-12 rounded-2xl bg-primary/15 border border-primary/30 flex items-center justify-center text-2xl shrink-0">🤝</div>
          <div>
            <h3 className="text-base font-bold">{t("yourNameQ")}</h3>
            <p className="text-[11px] text-muted-foreground leading-snug">{t("yourNameSub")}</p>
          </div>
        </div>
        <div className="flex gap-2.5 mb-3">
          <input
            value={first}
            onChange={(e) => setFirst(e.target.value)}
            placeholder={t("firstName")}
            autoComplete="given-name"
            className="w-full bg-muted rounded-xl px-4 py-3 text-sm border border-border outline-none focus:ring-2 focus:ring-ring/50"
          />
          <input
            value={last}
            onChange={(e) => setLast(e.target.value)}
            placeholder={t("lastName")}
            autoComplete="family-name"
            className="w-full bg-muted rounded-xl px-4 py-3 text-sm border border-border outline-none focus:ring-2 focus:ring-ring/50"
          />
        </div>
        <p className="text-[10px] text-muted-foreground mb-3 leading-relaxed">{t("yourNameNote")}</p>
        {/* v3.3: gender — the alarm voice tries female for girls, male for boys */}
        <div className="flex gap-2 mb-1">
          {([
            ["male", `👦 ${t("genderBoy")}`],
            ["female", `👧 ${t("genderGirl")}`],
          ] as const).map(([g, label]) => (
            <button
              key={g}
              type="button"
              onClick={() => setGender(gender === g ? "" : (g as "male" | "female"))}
              className={`flex-1 rounded-xl text-xs font-bold py-2.5 min-h-[40px] border transition-colors ${
                gender === g
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-muted text-muted-foreground border-border"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground mb-3 leading-relaxed">{t("genderNote")}</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy || !first.trim()}
            className="flex-1 rounded-2xl btn-hero text-primary-foreground font-bold text-sm py-3 min-h-[48px] disabled:opacity-50 active:scale-[0.98] transition-transform"
          >
            {busy ? "..." : t("saveBtn")}
          </button>
          <button
            type="button"
            onClick={skip}
            className="rounded-2xl bg-secondary text-sm py-3 px-4 min-h-[48px]"
          >
            {t("later")}
          </button>
        </div>
      </div>
    </div>
  );
}
