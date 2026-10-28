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
import { useStore } from "@/lib/store";
import { useServerCfg } from "@/lib/cfg";
import {
  fbCheckVerified,
  fbEmailSignIn,
  fbEmailSignUp,
  fbGoogleSignIn,
  fbSendVerification,
  fbSignOut,
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
  const { state, setAccount, t, closeAuth } = useStore();
  const { cfg } = useServerCfg();
  const acc = state.account;
  const [skipped, setSkipped] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [mode, setMode] = useState<"auth" | "verify">("auth");
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
    await fbGoogleSignIn(cfg);
    setBusy(false);
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
        // the auth listener may have fired before updateProfile landed — set the
        // real name immediately so the app shows it (store syncs settings.name)
        if (res.uid) setAccount({ uid: res.uid, name: full, email: email.trim(), verified: false, provider: "password" });
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

            {err ? <p className="text-xs text-destructive mt-2.5 text-center">⚠️ {err}</p> : null}
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
