"use client";

import { ArrowRight, CircleAlert, KeyRound, LoaderCircle } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useState, type FormEvent } from "react";
import { BrandMark } from "@/components/brand-mark";
import { softSpring } from "@/components/ui";
import { BRAND } from "@/lib/brand";
import { translate, type Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { addPasskey, describeError, setupLink } from "./auth-client";

type Step = "checking" | "new" | "sign-in" | "passkey" | "invalid";

const FIELD =
  "h-[50px] w-full rounded-2xl bg-solid/90 px-4 text-[15px] text-ink shadow-[inset_0_0_0_1px_var(--line)] outline-none placeholder:text-ink-3 focus:shadow-[inset_0_0_0_1.5px_var(--accent)] dark:bg-white/[0.06]";
const PRIMARY =
  "flex h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-accent text-[15px] font-medium text-on-accent transition-opacity disabled:opacity-60";

/**
 * Opened from the link `kolbaba-link` prints on a self-hosted server: creates the account or signs in,
 * then asks for a passkey straight away, because on a server with no email set up it's the way back in.
 */
export function SetupCard({ locale, token }: { locale: Locale; token: string }) {
  const reduce = useReducedMotion();
  const [step, setStep] = useState<Step>("checking");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const say = (err: unknown) => setError(describeError(locale, err)?.message ?? translate(locale, "Something went wrong on our side"));
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  const home = () => window.location.assign("/");

  useEffect(() => {
    let active = true;
    setupLink({ token, peek: true })
      .then((res) => {
        if (!active) return;
        if (res.mode === "sign-in") setEmail(res.email);
        setStep(res.mode);
      })
      .catch(async (err) => {
        // Reloaded after using it (the passkey step, say): already signed in, so just go in.
        const signedIn = await fetch("/api/auth/me", { credentials: "same-origin" }).then((res) => res.ok, () => false);
        if (!active) return;
        if (signedIn) return home();
        say(err);
        setStep("invalid");
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const submitLink = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await setupLink({ token, details: step === "new" ? { name: name.trim(), email: email.trim() } : undefined });
      if (res.hasPasskey) return home();
      setBusy(false);
      setStep("passkey");
    } catch (err) {
      setBusy(false);
      say(err);
    }
  };

  const savePasskey = async () => {
    setBusy(true);
    setError(null);
    try {
      await addPasskey();
      home();
    } catch (err) {
      setBusy(false);
      say(err);
    }
  };

  const title =
    step === "passkey"
      ? translate(locale, "One last thing: a passkey")
      : step === "sign-in"
        ? translate(locale, "Sign in to {app}", { app: BRAND.name })
        : step === "invalid"
          ? translate(locale, "This link no longer works")
          : translate(locale, "Your own {app}", { app: BRAND.name });
  const subtitle =
    step === "passkey"
      ? translate(locale, "It's how you'll sign in from now on: Face ID, Touch ID or your screen lock. There's no password to forget.")
      : step === "sign-in"
        ? translate(locale, "This link signs you in as {email}.", { email })
        : step === "invalid"
          ? translate(locale, "On your server, run {command} and open the new link.", { command: "docker compose exec kolbaba kolbaba-link" })
          : translate(locale, "Create the account for this server. Only you hold the data.");

  return (
    <motion.section
      aria-labelledby="setup-title"
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 18, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={softSpring}
      className={cn(
        "relative w-full max-w-[400px] rounded-[30px] px-6 pt-8 pb-6 sm:px-9 sm:pt-10 sm:pb-8",
        "bg-white/62 shadow-[inset_0_0_0_0.5px_var(--glass-border),inset_0_1px_0_rgb(255_255_255/0.7),var(--shadow-float)] backdrop-blur-2xl backdrop-saturate-[1.8]",
        "dark:bg-[rgb(26_30_38/0.66)] dark:shadow-[inset_0_0_0_0.5px_var(--glass-border),inset_0_1px_0_rgb(255_255_255/0.06),var(--shadow-float)]",
      )}
    >
      <div className="flex flex-col items-center text-center">
        <div className="mb-6 flex size-[60px] items-center justify-center rounded-[19px] bg-gradient-to-b from-white to-[#eef2f7] shadow-[0_0_0_0.5px_rgb(20_30_50/0.08),0_10px_24px_-10px_rgb(16_24_40/0.25),inset_0_1px_0_white] dark:from-[#2a2f3a] dark:to-[#1d2129]">
          <BrandMark size={34} />
        </div>
        <h1 id="setup-title" className="text-[23px] leading-tight font-semibold tracking-[-0.025em] text-ink">
          {title}
        </h1>
        {step !== "checking" && <p className="mx-auto mt-2 max-w-[300px] text-[14px] leading-relaxed text-balance text-ink-3">{subtitle}</p>}
      </div>

      <div className="mt-7 space-y-3">
        {error && step !== "invalid" && (
          <div role="alert" className="flex gap-2.5 rounded-xl bg-danger/10 px-3.5 py-3 text-[13px] leading-snug text-danger">
            <CircleAlert size={16} className="mt-px shrink-0" aria-hidden />
            {error}
          </div>
        )}

        {step === "checking" && <LoaderCircle size={20} className="mx-auto animate-spin text-ink-3" aria-label={translate(locale, "Loading…")} />}

        {step === "new" && (
          <form onSubmit={(e) => void submitLink(e)} className="space-y-3">
            <input autoFocus required value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder={translate(locale, "Your name")} aria-label={translate(locale, "Your name")} className={FIELD} />
            <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder={translate(locale, "Email address")} aria-label={translate(locale, "Email address")} className={FIELD} />
            <button type="submit" disabled={busy || !name.trim() || !email.trim()} className={PRIMARY}>
              {busy ? <LoaderCircle size={18} className="animate-spin" /> : <ArrowRight size={18} />}
              {translate(locale, "Create account")}
            </button>
          </form>
        )}

        {step === "sign-in" && (
          <button type="button" disabled={busy} onClick={() => void submitLink()} className={PRIMARY}>
            {busy ? <LoaderCircle size={18} className="animate-spin" /> : <ArrowRight size={18} />}
            {translate(locale, "Continue")}
          </button>
        )}

        {step === "passkey" && (
          <>
            <button type="button" disabled={busy} onClick={() => void savePasskey()} className={PRIMARY}>
              {busy ? <LoaderCircle size={18} className="animate-spin" /> : <KeyRound size={18} />}
              {translate(locale, "Save a passkey")}
            </button>
            <button type="button" disabled={busy} onClick={home} className="w-full py-1 text-center text-[13px] font-medium text-ink-3 hover:text-ink-2">
              {translate(locale, "Not now")}
            </button>
          </>
        )}
      </div>
    </motion.section>
  );
}
