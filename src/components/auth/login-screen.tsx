"use client";

import { browserSupportsWebAuthn, browserSupportsWebAuthnAutofill } from "@simplewebauthn/browser";
import { ArrowRight, Check, CircleAlert, Info, KeyRound, LoaderCircle, LockKeyhole, Mail, Ticket } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode, type RefObject } from "react";
import { BrandMark } from "@/components/brand-mark";
import { ConsentLine } from "@/components/legal-links";
import { softSpring, spring } from "@/components/ui";
import { BRAND } from "@/lib/brand";
import { translate, type Locale } from "@/lib/i18n";
import { forgetCachedMail } from "@/lib/live";
import { cn } from "@/lib/utils";
import { safeNext } from "@/server/auth/safe-next";
import { GoogleMark } from "./google-mark";
import { SetupCard } from "./setup-card";
import {
  AuthApiError,
  cancelPasskeyPrompt,
  createAccount,
  describeError,
  describeRedirectError,
  sendEmailCode,
  signInWithPasskey,
  verifyEmailCode,
  type Notice,
} from "./auth-client";

type Status = "idle" | "sending" | "verifying" | "creating" | "passkey" | "google" | "success";
/** One way in for everyone: Google, or an email and the code sent to it (and a name, for a new account). */
type Step = "start" | "code" | "name";
/** A new code can be asked for after this long. */
const RESEND_AFTER_MS = 30_000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* ------------------------- Client-only values, SSR-safe ------------------------- */

const subscribeNever = () => () => {};
function useClientValue<T>(read: () => T, serverValue: T) {
  return useSyncExternalStore(subscribeNever, read, () => serverValue);
}

// Captured once: we tidy `?error=` out of the address bar after showing it.
let initialSearch: string | null = null;
const readSearch = () => (initialSearch ??= window.location.search);
const readSupport = () => (browserSupportsWebAuthn() ? "yes" : "no");

/* ---------------------------------- Screen ---------------------------------- */

/** Which ways in this server offers. All of them on kolbaba.app; a self-hosted copy has what its owner set up. */
export interface LoginWays {
  selfHosted: boolean;
  google: boolean;
  emailCode: boolean;
}

/** Rendered on the server too, so text goes through translate() with the page's locale (never t()). */
export function LoginScreen({ locale, ways }: { locale: Locale; ways: LoginWays }) {
  const reduce = useReducedMotion();
  const setupToken = new URLSearchParams(useClientValue(readSearch, "")).get("setup");
  return (
    <main className="canvas relative isolate flex min-h-dvh flex-col items-center justify-center overflow-hidden px-4 pt-[max(env(safe-area-inset-top),40px)] pb-[max(var(--safe-bottom),28px)]">
      <Ambient />
      {setupToken && ways.selfHosted ? <SetupCard locale={locale} token={setupToken} /> : <LoginCard locale={locale} ways={ways} />}
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: reduce ? 0 : 0.35, duration: 0.5 }}
        className="mt-7 max-w-[330px] text-center text-[12px] leading-relaxed text-balance text-ink-3"
      >
        <LockKeyhole size={12} className="mr-1 inline -translate-y-px" aria-hidden />
        {ways.selfHosted
          ? translate(locale, "This {app} runs on your own server. Your mail stays there.", { app: BRAND.name })
          : translate(locale, "No password to leak or forget: Google, a code by email, or a passkey once you add one.")}
      </motion.p>
    </main>
  );
}

/** Slow-drifting colour behind the glass so the blur has something to catch. */
function Ambient() {
  const reduce = useReducedMotion();
  const drift = (x: number[], y: number[], duration: number) =>
    reduce ? {} : { animate: { x, y }, transition: { duration, repeat: Infinity, repeatType: "mirror" as const, ease: "easeInOut" as const } };
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <motion.div
        {...drift([0, 50, -30], [0, -40, 20], 22)}
        className="absolute top-[18%] left-[calc(50%-300px)] size-[420px] rounded-full bg-[oklch(0.8_0.11_var(--accent-h)/0.5)] blur-[80px] dark:bg-[oklch(0.42_0.1_var(--accent-h)/0.45)]"
      />
      <motion.div
        {...drift([0, -40, 30], [0, 30, -20], 26)}
        className="absolute top-[42%] left-[calc(50%+20px)] size-[380px] rounded-full bg-[oklch(0.84_0.09_300/0.45)] blur-[90px] dark:bg-[oklch(0.36_0.09_300/0.4)]"
      />
      <motion.div
        {...drift([0, 30, -20], [0, 20, -30], 30)}
        className="absolute top-[58%] left-[calc(50%-240px)] size-[300px] rounded-full bg-[oklch(0.88_0.08_40/0.45)] blur-[90px] dark:bg-[oklch(0.34_0.07_40/0.35)]"
      />
    </div>
  );
}

/* ----------------------------------- Card ----------------------------------- */

function LoginCard({ locale, ways }: { locale: Locale; ways: LoginWays }) {
  const reduce = useReducedMotion();
  const search = useClientValue(readSearch, "");
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const next = params.get("next") ? safeNext(params.get("next")) : undefined;
  const urlError = params.get("error");
  const support = useClientValue(readSupport, "unknown" as "yes" | "no" | "unknown");

  const [step, setStep] = useState<Step>("start");
  const [status, setStatus] = useState<Status>("idle");
  /** `undefined` until the user does something: until then we show the `?error=` from a redirect. */
  const [notice, setNotice] = useState<Notice | null | undefined>(undefined);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [resendAt, setResendAt] = useState(0);
  const [autofillRound, setAutofillRound] = useState(0);
  const emailRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const shown = notice === undefined ? (urlError ? describeRedirectError(locale, urlError) : null) : notice;
  const busy = status !== "idle";

  const finish = useCallback((redirectTo: string) => {
    setStatus("success");
    setTimeout(() => window.location.assign(redirectTo), 520);
  }, [setStatus]);

  // Already signed in (e.g. opened /login from a bookmark)? Go straight in. Signed out: the mail an
  // ended session left cached on this device goes (unsent emails wait for the same person, see claimDevice).
  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me", { credentials: "same-origin" })
      .then((res) => {
        if (res.status === 401) void forgetCachedMail();
        if (!cancelled && res.ok) window.location.replace(next ?? "/");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [next]);

  // Keep the address bar clean once the redirect error has been read.
  useEffect(() => {
    if (!urlError) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("error");
    window.history.replaceState(window.history.state, "", url);
  }, [urlError]);

  // Coming back from Google with the back button restores this page from bfcache mid-"loading".
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => e.persisted && setStatus("idle");
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  // Someone who added a passkey is offered it right in the email field's autofill (conditional UI),
  // and is signed in without a code.
  useEffect(() => {
    if (step !== "start" || support !== "yes" || !ways.emailCode) return;
    let active = true;
    (async () => {
      if (!(await browserSupportsWebAuthnAutofill()) || !active) return;
      try {
        const result = await signInWithPasskey({ autofill: true, next });
        if (active) finish(result.redirectTo);
      } catch (err) {
        // Background ceremony: browser-side hiccups stay silent; only a real server answer is shown.
        if (!active || !(err instanceof AuthApiError)) return;
        setNotice(describeError(locale, err));
      }
    })();
    return () => {
      active = false;
      cancelPasskeyPrompt();
    };
  }, [step, support, next, finish, autofillRound, locale, ways.emailCode]);

  const goTo = (to: Step, focus?: RefObject<HTMLInputElement | null>) => {
    setStep(to);
    setFieldError(null);
    if (focus) setTimeout(() => focus.current?.focus(), 50);
  };

  const askForCode = async () => {
    if (!EMAIL_RE.test(email.trim())) {
      setFieldError(email.trim() ? translate(locale, "That doesn't look like an email address") : translate(locale, "Enter your email address"));
      emailRef.current?.focus();
      return;
    }
    setNotice(null);
    setStatus("sending");
    try {
      await sendEmailCode(email.trim());
      setCode("");
      setResendAt(Date.now() + RESEND_AFTER_MS);
      setStatus("idle");
      goTo("code", codeRef);
    } catch (err) {
      setStatus("idle");
      setNotice(describeError(locale, err));
    }
  };

  /** Checks the code as soon as all six digits are in: signed in, or on to the name for a new account. */
  const submitCode = async (value: string) => {
    const digits = value.replace(/\D/g, "");
    if (digits.length !== 6) {
      setFieldError(translate(locale, "Enter the 6-digit code from the email"));
      codeRef.current?.focus();
      return;
    }
    setNotice(null);
    setStatus("verifying");
    try {
      const result = await verifyEmailCode(digits, next);
      if ("redirectTo" in result) return finish(result.redirectTo);
      setStatus("idle");
      goTo("name", nameRef);
    } catch (err) {
      const n = describeError(locale, err);
      setStatus("idle");
      setFieldError(n?.message ?? null);
      codeRef.current?.select();
    }
  };

  const create = async () => {
    setNotice(null);
    setStatus("creating");
    try {
      finish((await createAccount(name.trim(), next)).redirectTo);
    } catch (err) {
      const n = describeError(locale, err);
      setStatus("idle");
      // The code ran out meanwhile: back to the start, with the email still there.
      if (n?.code === "email_unconfirmed") goTo("start", emailRef);
      setNotice(n);
    }
  };

  const signInWithPasskeyNow = async () => {
    if (busy) return;
    setNotice(null);
    cancelPasskeyPrompt();
    setStatus("passkey");
    try {
      finish((await signInWithPasskey({ next })).redirectTo);
    } catch (err) {
      setStatus("idle");
      setNotice(describeError(locale, err));
      setAutofillRound((r) => r + 1);
    }
  };

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (busy) return;
    if (step === "start") void askForCode();
    else if (step === "code") void submitCode(code);
    else void create();
  };

  const googleHref = `/api/auth/google${next ? `?next=${encodeURIComponent(next)}` : ""}`;

  const title =
    step === "code" ? translate(locale, "Check your email") : step === "name" ? translate(locale, "Nice to meet you") : translate(locale, "Welcome to {app}", { app: BRAND.name });
  const subtitle =
    step === "code"
      ? translate(locale, "We sent a 6-digit code to {email}.", { email: email.trim() })
      : step === "name"
        ? translate(locale, "What should we call you? You can change it later.")
        : ways.emailCode
          ? translate(locale, "Sign in or create an account. No password needed.")
          : translate(locale, "Sign in with the passkey you saved when you set it up.");

  return (
    <motion.section
      aria-labelledby="login-title"
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 18, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={softSpring}
      onKeyDown={(e) => {
        if (e.key === "Escape" && step !== "start" && !busy) goTo("start", emailRef);
      }}
      className={cn(
        "relative w-full max-w-[400px] rounded-[30px] px-6 pt-8 pb-6 sm:px-9 sm:pt-10 sm:pb-8",
        "bg-white/62 shadow-[inset_0_0_0_0.5px_var(--glass-border),inset_0_1px_0_rgb(255_255_255/0.7),var(--shadow-float)] backdrop-blur-2xl backdrop-saturate-[1.8]",
        "dark:bg-[rgb(26_30_38/0.66)] dark:shadow-[inset_0_0_0_0.5px_var(--glass-border),inset_0_1px_0_rgb(255_255_255/0.06),var(--shadow-float)]",
      )}
    >
      {/* Brand */}
      <div className="flex flex-col items-center text-center">
        <motion.div
          initial={reduce ? false : { scale: 0.6, opacity: 0, rotate: -8 }}
          animate={{ scale: 1, opacity: 1, rotate: 0 }}
          transition={{ ...spring, delay: 0.08 }}
          className="mb-6 flex size-[60px] items-center justify-center rounded-[19px] bg-gradient-to-b from-white to-[#eef2f7] shadow-[0_0_0_0.5px_rgb(20_30_50/0.08),0_1px_2px_rgb(16_24_40/0.06),0_10px_24px_-10px_rgb(16_24_40/0.25),inset_0_1px_0_white] dark:from-[#2a2f3a] dark:to-[#1d2129] dark:shadow-[0_0_0_0.5px_rgb(255_255_255/0.1),0_10px_24px_-10px_rgb(0_0_0/0.7),inset_0_1px_0_rgb(255_255_255/0.08)]"
        >
          <BrandMark size={34} />
        </motion.div>

        <AutoHeight>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={step}
              initial={{ opacity: 0, y: 6, filter: "blur(2px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: -6, filter: "blur(2px)" }}
              transition={spring}
              className="w-full"
            >
              <h1 id="login-title" className="text-[23px] leading-tight font-semibold tracking-[-0.025em] text-ink">
                {title}
              </h1>
              <p className="mx-auto mt-2 max-w-[300px] text-[14px] leading-relaxed text-balance text-ink-3">{subtitle}</p>
            </motion.div>
          </AnimatePresence>
        </AutoHeight>
      </div>

      {/* Google first: one tap for most people, and the mailbox they'll connect anyway. */}
      <AnimatePresence initial={false}>
        {step === "start" && ways.google && (
          <Collapse key="google">
            <div className="pt-7">
              <GoogleButton
                locale={locale}
                href={googleHref}
                primary
                pending={status === "google"}
                disabled={busy}
                onNavigate={() => {
                  setNotice(null);
                  setStatus("google");
                }}
              />
              <div className="my-5 flex items-center gap-3 text-[11.5px] font-medium tracking-[0.04em] text-ink-3 uppercase" aria-hidden>
                <span className="h-px flex-1 bg-line" />
                {translate(locale, "or")}
                <span className="h-px flex-1 bg-line" />
              </div>
            </div>
          </Collapse>
        )}
      </AnimatePresence>

      {ways.emailCode ? (
      <form onSubmit={submit} noValidate className={step === "start" ? undefined : "mt-7"}>
        <AnimatePresence initial={false} mode="popLayout">
          {step === "start" && (
            <Collapse key="email">
              <div className="pb-3">
                <label htmlFor="login-email" className="sr-only">
                  {translate(locale, "Email address")}
                </label>
                <input
                  id="login-email"
                  ref={emailRef}
                  type="email"
                  inputMode="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setFieldError(null);
                  }}
                  placeholder={translate(locale, "Email address")}
                  // "webauthn" lets the browser offer a saved passkey right here (conditional UI).
                  autoComplete="email webauthn"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint="go"
                  aria-invalid={!!fieldError}
                  aria-describedby={fieldError ? "login-email-error" : undefined}
                  disabled={busy}
                  className={cn(
                    "h-12 w-full rounded-2xl bg-solid px-4 text-[16px] text-ink outline-none placeholder:text-ink-3 disabled:opacity-70",
                    "shadow-[inset_0_0_0_1px_var(--line)] transition-shadow duration-200",
                    "focus:shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--accent)_60%,transparent),0_0_0_4px_var(--accent-soft)]",
                    fieldError && "shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--danger)_55%,transparent)]",
                  )}
                />
                <AnimatePresence initial={false}>
                  {fieldError && (
                    <Collapse key="field-error">
                      <p id="login-email-error" className="px-1 pt-2 text-[12.5px] text-danger">
                        {fieldError}
                      </p>
                    </Collapse>
                  )}
                </AnimatePresence>
              </div>
            </Collapse>
          )}
          {step === "code" && (
            <Collapse key="code">
              <CodeField
                locale={locale}
                inputRef={codeRef}
                value={code}
                error={fieldError}
                disabled={busy}
                resendAt={resendAt}
                onChange={(value) => {
                  setCode(value);
                  setFieldError(null);
                  if (value.replace(/\D/g, "").length === 6 && !busy) void submitCode(value);
                }}
                onResend={() => void askForCode()}
                onChangeEmail={() => {
                  setNotice(null);
                  goTo("start", emailRef);
                }}
              />
            </Collapse>
          )}
          {step === "name" && (
            <Collapse key="name">
              <div className="pb-3">
                <label htmlFor="login-name" className="sr-only">
                  {translate(locale, "Your name")}
                </label>
                <input
                  id="login-name"
                  ref={nameRef}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={translate(locale, "Your name")}
                  autoComplete="name"
                  autoCapitalize="words"
                  enterKeyHint="go"
                  maxLength={80}
                  disabled={busy}
                  className={cn(
                    "h-12 w-full rounded-2xl bg-solid px-4 text-[16px] text-ink outline-none placeholder:text-ink-3 disabled:opacity-70",
                    "shadow-[inset_0_0_0_1px_var(--line)] transition-shadow duration-200",
                    "focus:shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--accent)_60%,transparent),0_0_0_4px_var(--accent-soft)]",
                  )}
                />
              </div>
            </Collapse>
          )}
        </AnimatePresence>

        {/* Inline notice: calm for "cancelled", amber for invite-only, red only for real errors */}
        <div role="status" aria-live="polite">
          <AnimatePresence initial={false}>
            {shown && (
              <Collapse key="notice">
                <div className="pb-3">
                  <NoticeView notice={shown} locale={locale} />
                </div>
              </Collapse>
            )}
          </AnimatePresence>
        </div>

        <PrimaryButton status={status} type="submit" quiet={step === "start"}>
          {status === "success" ? (
            <Label k="success" icon={<Check size={19} strokeWidth={2.4} />}>
              {translate(locale, "You're in")}
            </Label>
          ) : status === "passkey" ? (
            <Label k="passkey" icon={<LoaderCircle size={18} className="animate-spin" />}>
              {translate(locale, "Waiting for your passkey…")}
            </Label>
          ) : status === "sending" || status === "verifying" || status === "creating" ? (
            <Label k={status} icon={<LoaderCircle size={18} className="animate-spin" />}>
              {status === "sending" ? translate(locale, "Sending a code…") : status === "verifying" ? translate(locale, "Checking the code…") : translate(locale, "Creating your account…")}
            </Label>
          ) : step === "name" ? (
            <Label k="name" icon={<ArrowRight size={18} strokeWidth={2.1} />}>
              {translate(locale, "Create account")}
            </Label>
          ) : (
            <Label k={step} icon={step === "start" ? <Mail size={18} strokeWidth={2} /> : <ArrowRight size={18} strokeWidth={2.1} />}>
              {step === "start" ? translate(locale, "Continue with email") : translate(locale, "Continue")}
            </Label>
          )}
        </PrimaryButton>
      </form>

      ) : (
        <div className="mt-7 space-y-5">
          {shown && <NoticeView notice={shown} locale={locale} />}
          <button
            type="button"
            disabled={busy}
            onClick={() => void signInWithPasskeyNow()}
            className="flex h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-accent text-[15px] font-medium text-on-accent transition-opacity disabled:opacity-60"
          >
            {busy ? <LoaderCircle size={18} className="animate-spin" /> : <KeyRound size={18} strokeWidth={2} />}
            {translate(locale, "Sign in with a passkey")}
          </button>
          <p className="text-center text-[12.5px] leading-relaxed text-balance text-ink-3">
            {translate(locale, "No passkey on this device? Get a sign-in link from your server:")}{" "}
            <code className="rounded bg-[color-mix(in_oklab,var(--ink)_6%,transparent)] px-1 py-0.5 text-[11.5px] break-all">docker compose exec kolbaba kolbaba-link</code>
          </p>
        </div>
      )}

      {/* For people who added a passkey and whose browser didn't offer it in the field. */}
      {step === "start" && support === "yes" && ways.emailCode && (
        <p className="mt-5 text-center text-[13px] text-ink-3">
          <button
            type="button"
            onClick={() => void signInWithPasskeyNow()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md font-medium text-ink-2 underline-offset-[3px] hover:text-ink hover:underline disabled:opacity-50"
          >
            <KeyRound size={13} />
            {translate(locale, "Sign in with a passkey")}
          </button>
        </p>
      )}

      {!ways.selfHosted && <ConsentLine locale={locale} className="mx-auto mt-5 max-w-[300px] text-center text-[11.5px] leading-relaxed text-balance text-ink-3" />}
    </motion.section>
  );
}

/* --------------------------------- Pieces --------------------------------- */

/** The 6-digit code from the email. iPhone and Android offer it from Mail right above the keyboard. */
function CodeField({
  locale,
  inputRef,
  value,
  error,
  disabled,
  resendAt,
  onChange,
  onResend,
  onChangeEmail,
}: {
  locale: Locale;
  inputRef: RefObject<HTMLInputElement | null>;
  value: string;
  error: string | null;
  disabled: boolean;
  resendAt: number;
  onChange: (value: string) => void;
  onResend: () => void;
  onChangeEmail: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (resendAt <= Date.now()) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [resendAt]);
  const wait = Math.max(0, Math.ceil((resendAt - now) / 1000));
  const link = "rounded-md font-medium text-accent-text underline-offset-[3px] hover:underline disabled:text-ink-3 disabled:no-underline";
  return (
    <div className="pb-3">
      <label htmlFor="login-code" className="sr-only">
        {translate(locale, "Code from the email")}
      </label>
      <input
        id="login-code"
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d ]/g, "").slice(0, 7))}
        inputMode="numeric"
        autoComplete="one-time-code"
        enterKeyHint="go"
        placeholder="000 000"
        aria-invalid={!!error}
        aria-describedby={error ? "login-code-error" : undefined}
        disabled={disabled}
        className={cn(
          "h-14 w-full rounded-2xl bg-solid text-center text-[24px] font-semibold tracking-[0.35em] text-ink tabular-nums outline-none placeholder:text-ink-3/50 disabled:opacity-70",
          "shadow-[inset_0_0_0_1px_var(--line)] transition-shadow duration-200",
          "focus:shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--accent)_60%,transparent),0_0_0_4px_var(--accent-soft)]",
          error && "shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--danger)_55%,transparent)]",
        )}
      />
      <AnimatePresence initial={false}>
        {error && (
          <Collapse key="code-error">
            <p id="login-code-error" className="px-1 pt-2 text-center text-[12.5px] text-danger">
              {error}
            </p>
          </Collapse>
        )}
      </AnimatePresence>
      <div className="flex items-center justify-center gap-4 pt-3 text-[13px]">
        <button type="button" onClick={onResend} disabled={disabled || wait > 0} className={link}>
          {wait > 0 ? translate(locale, "New code in {s} s", { s: wait }) : translate(locale, "Send a new code")}
        </button>
        <span aria-hidden className="h-3 w-px bg-line" />
        <button type="button" onClick={onChangeEmail} disabled={disabled} className={link}>
          {translate(locale, "Use a different email")}
        </button>
      </div>
    </div>
  );
}

/** `quiet`: as calm as the Google button above it, so the two ways in weigh the same. */
function PrimaryButton({ status, children, type, quiet = false }: { status: Status; children: ReactNode; type: "submit" | "button"; quiet?: boolean }) {
  const busy = status !== "idle";
  if (quiet && status !== "success")
    return (
      <motion.button
        type={type}
        aria-busy={busy}
        aria-disabled={busy}
        whileTap={busy ? undefined : { scale: 0.975 }}
        transition={spring}
        className={cn(
          "relative flex h-[52px] w-full items-center justify-center overflow-hidden rounded-2xl text-[15px] font-medium text-ink transition-[background-color,box-shadow] duration-200",
          "bg-solid/90 shadow-[inset_0_0_0_1px_var(--line),0_1px_2px_rgb(16_24_40/0.05)] hover:bg-solid hover:shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--ink)_14%,transparent),0_2px_8px_-2px_rgb(16_24_40/0.1)]",
          "dark:bg-white/[0.06] dark:hover:bg-white/[0.1]",
          busy && "cursor-default",
        )}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          {children}
        </AnimatePresence>
      </motion.button>
    );
  return (
    <motion.button
      type={type}
      aria-busy={status === "passkey" || status === "sending" || status === "verifying" || status === "creating"}
      aria-disabled={busy}
      whileTap={busy ? undefined : { scale: 0.975 }}
      transition={spring}
      className={cn(
        "relative flex h-[52px] w-full items-center justify-center overflow-hidden rounded-2xl text-[15.5px] font-medium tracking-[-0.005em] text-on-accent",
        "shadow-[0_1px_2px_rgb(0_0_0/0.14),0_10px_24px_-10px_var(--accent),inset_0_1px_0_rgb(255_255_255/0.22)] transition-[background-color,box-shadow] duration-300",
        status === "success" ? "bg-success shadow-[0_1px_2px_rgb(0_0_0/0.14),0_10px_24px_-10px_var(--success),inset_0_1px_0_rgb(255_255_255/0.22)]" : "bg-accent hover:bg-accent-hover",
        busy && "cursor-default",
      )}
    >
      {/* Soft sheen so the button reads as glass-lit rather than flat. */}
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/14 to-transparent" />
      <AnimatePresence mode="popLayout" initial={false}>
        {children}
      </AnimatePresence>
    </motion.button>
  );
}

function Label({ k, icon, children }: { k: string; icon: ReactNode; children: ReactNode }) {
  return (
    <motion.span
      key={k}
      initial={{ opacity: 0, y: 10, filter: "blur(3px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      exit={{ opacity: 0, y: -10, filter: "blur(3px)" }}
      transition={spring}
      className="relative flex items-center gap-2.5"
    >
      {icon}
      {children}
    </motion.span>
  );
}

function GoogleButton({
  locale,
  href,
  primary,
  pending,
  disabled,
  onNavigate,
}: {
  locale: Locale;
  href: string;
  primary: boolean;
  pending: boolean;
  disabled: boolean;
  onNavigate: () => void;
}) {
  return (
    <motion.a
      href={href}
      onClick={(e) => {
        if (disabled) {
          e.preventDefault();
          return;
        }
        onNavigate();
      }}
      aria-disabled={disabled}
      whileTap={disabled ? undefined : { scale: 0.975 }}
      transition={spring}
      className={cn(
        "flex h-[52px] w-full items-center justify-center gap-3 rounded-2xl text-[15px] font-medium text-ink transition-[background-color,box-shadow,opacity] duration-200",
        "bg-solid/90 shadow-[inset_0_0_0_1px_var(--line),0_1px_2px_rgb(16_24_40/0.05)] hover:bg-solid hover:shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--ink)_14%,transparent),0_2px_8px_-2px_rgb(16_24_40/0.1)]",
        "dark:bg-white/[0.06] dark:hover:bg-white/[0.1]",
        primary && "h-[52px] shadow-[inset_0_0_0_1px_var(--line),0_1px_2px_rgb(16_24_40/0.06),0_10px_24px_-12px_rgb(16_24_40/0.3)]",
        disabled && !pending && "pointer-events-none opacity-50",
        pending && "cursor-default",
      )}
    >
      {pending ? <LoaderCircle size={18} className="animate-spin text-ink-3" /> : <GoogleMark size={18} />}
      {pending ? translate(locale, "Opening Google…") : translate(locale, "Continue with Google")}
    </motion.a>
  );
}

const TONES = {
  calm: { box: "bg-[color-mix(in_oklab,var(--ink)_5%,transparent)] text-ink-2", icon: Info, iconClass: "text-ink-3" },
  warn: { box: "bg-warning/12 text-ink", icon: Ticket, iconClass: "text-[oklch(0.62_0.15_60)] dark:text-warning" },
  error: { box: "bg-danger/10 text-danger", icon: CircleAlert, iconClass: "text-danger" },
} as const;

function NoticeView({ notice, locale }: { notice: Notice; locale: Locale }) {
  const tone = TONES[notice.tone];
  const Icon = tone.icon;
  return (
    <motion.div
      key={notice.message}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      className={cn("flex gap-2.5 rounded-xl px-3.5 py-3 text-left text-[13px] leading-snug", tone.box)}
    >
      <Icon size={16} className={cn("mt-px shrink-0", tone.iconClass)} aria-hidden />
      <div>
        <div className={notice.tone === "warn" ? "font-medium" : undefined}>{notice.message}</div>
        {notice.code === "invite_only" && (
          <div className="mt-0.5 text-ink-3">{translate(locale, "We're letting people in gradually. Thanks for your patience.")}</div>
        )}
      </div>
    </motion.div>
  );
}

/** Height-animated reveal; children should carry their own spacing so the collapse is complete. */
function Collapse({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={softSpring}
      // A little bleed so focus rings and soft shadows aren't clipped while animating.
      className="-mx-1.5 overflow-hidden px-1.5 pt-1.5 -mt-1.5"
    >
      {children}
    </motion.div>
  );
}

/** Smoothly follows its content's height (for cross-fading blocks of different length). */
function AutoHeight({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | "auto">("auto");
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <motion.div initial={false} animate={{ height }} transition={softSpring} className="relative w-full">
      <div ref={ref}>{children}</div>
    </motion.div>
  );
}

