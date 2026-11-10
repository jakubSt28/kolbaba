"use client";

import { ArrowRight, Check, ChevronDown, CircleAlert, KeyRound, Loader, Server, ShieldCheck } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Fragment, useEffect, useRef, useState } from "react";
import { t, tk } from "@/lib/i18n";
import { api, ApiError, LIVE } from "@/lib/live";
import { randomHue, useMail } from "@/lib/store";
import type { Account, Provider } from "@/lib/types";
import type { Detection as ServerDetection } from "@/server/autodetect/types";
import { sourceLabel } from "@/server/autodetect/types";
import { cn } from "@/lib/utils";
import { spring } from "./ui";

type Detection = {
  provider: Provider;
  name: string;
  method: "oauth" | "password";
  via: string;
  imap?: string;
  smtp?: string;
  appPasswordHint?: { label: string; url: string };
  /** Live mode: the server's answer, sent back when connecting. */
  server?: ServerDetection;
};

type Security = "ssl" | "starttls";
type ServerFields = { imapHost: string; imapPort: string; imapSecurity: Security; smtpHost: string; smtpPort: string; smtpSecurity: Security };

/** Usual ports per encryption: implicit TLS ("SSL/TLS") or STARTTLS. Unencrypted connections aren't offered. */
const PORTS = { imap: { ssl: "993", starttls: "143" }, smtp: { ssl: "465", starttls: "587" } } as const;

const guessServers = (domain: string): ServerFields => ({
  imapHost: `imap.${domain}`,
  imapPort: PORTS.imap.ssl,
  imapSecurity: "ssl",
  smtpHost: `smtp.${domain}`,
  smtpPort: PORTS.smtp.ssl,
  smtpSecurity: "ssl",
});

/** "imap.firma.cz:993 · SSL" (see describe) back into editable fields. */
function parseServer(text: string | undefined, kind: "imap" | "smtp", domain: string) {
  const m = text?.match(/^(.+):(\d+) · (SSL|STARTTLS)$/);
  const guess = guessServers(domain);
  return m
    ? { host: m[1], port: m[2], security: (m[3] === "SSL" ? "ssl" : "starttls") as Security }
    : { host: guess[`${kind}Host`], port: guess[`${kind}Port`], security: guess[`${kind}Security`] };
}

const describe = (c?: { host: string; port: number; secure: boolean }) => (c ? `${c.host}:${c.port} · ${c.secure ? "SSL" : "STARTTLS"}` : undefined);

function fromServer(d: ServerDetection): Detection {
  return {
    provider: d.provider === "gmail" ? "gmail" : /seznam/i.test(d.providerLabel) ? "seznam" : "imap",
    name: d.providerLabel,
    method: d.method,
    via: sourceLabel(d.source),
    imap: describe(d.imap),
    smtp: describe(d.smtp),
    appPasswordHint: d.appPassword ? { label: d.appPassword.label, url: d.appPassword.url } : undefined,
    server: d,
  };
}

/** Port → TLS mode the way mail apps expect: 993/465 implicit TLS, anything else STARTTLS. */
const serverConfig = (kind: "imap" | "smtp", host: string, port: string, security: Security) => ({
  host: host.trim().toLowerCase(),
  port: Number(port) || Number(PORTS[kind][security]),
  secure: security === "ssl",
});

const KNOWN: Record<string, Detection> = {
  "gmail.com": { provider: "gmail", name: "Gmail", method: "oauth", via: "Known provider" },
  "googlemail.com": { provider: "gmail", name: "Gmail", method: "oauth", via: "Known provider" },
  "seznam.cz": {
    provider: "seznam",
    name: "Seznam",
    method: "password",
    via: "Thunderbird database",
    imap: "imap.seznam.cz:993 · SSL",
    smtp: "smtp.seznam.cz:465 · SSL",
    appPasswordHint: { label: tk("Using two-factor login? Create an app password"), url: "https://o-seznam.cz/napoveda/ucet/dvoufazove-overeni/" },
  },
  "icloud.com": {
    provider: "imap",
    name: "iCloud",
    method: "password",
    via: "Known provider",
    imap: "imap.mail.me.com:993 · SSL",
    smtp: "smtp.mail.me.com:587 · STARTTLS",
    appPasswordHint: { label: tk("iCloud needs an app-specific password"), url: "https://support.apple.com/102654" },
  },
};
KNOWN["email.cz"] = KNOWN["post.cz"] = KNOWN["seznam.cz"];
KNOWN["me.com"] = KNOWN["icloud.com"];

const STEPS = ["Known providers", "Thunderbird database", "Domain autoconfig", "MX records"];
const STEP_LABELS = [tk("Checking known providers…"), tk("Checking Thunderbird database…"), tk("Checking domain autoconfig…"), tk("Checking MX records…")];

/** The line under "Found …", keyed by where the settings came from (the server's sourceLabel, or the demo's). */
const VIA: Record<string, string> = {
  "Known provider": tk("via known provider"),
  "MX records": tk("via MX records"),
  [sourceLabel("known")]: tk("via built-in settings"),
  [sourceLabel("ispdb")]: tk("via Thunderbird database"),
  [sourceLabel("autoconfig")]: tk("via your provider's setup file"),
  [sourceLabel("mx")]: tk("via your domain's mail records"),
  [sourceLabel("srv")]: tk("via your domain's DNS"),
  [sourceLabel("guess")]: tk("via best guess, connection checked"),
};

function detect(email: string): Detection {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  if (KNOWN[domain]) return KNOWN[domain];
  // Pretend the MX lookup found a self-hosted server.
  return {
    provider: "imap",
    name: domain.split(".")[0].replace(/^\w/, (c) => c.toUpperCase()),
    method: "password",
    via: "MX records",
    imap: `imap.${domain}:993 · SSL`,
    smtp: `smtp.${domain}:465 · SSL`,
  };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** `prefill`: the address they signed up with. It's looked up right away, so what's left is the password. */
export function AddAccountView({ tabId, prefill }: { tabId: string; prefill?: string }) {
  const addAccount = useMail((s) => s.addAccount);
  const closeTab = useMail((s) => s.closeTab);
  const accounts = useMail((s) => s.accounts);
  const [email, setEmail] = useState(prefill ?? "");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [phase, setPhase] = useState<"email" | "detecting" | "found" | "connecting">("email");
  const [step, setStep] = useState(0);
  const [found, setFound] = useState<Detection | null>(null);
  const [showServers, setShowServers] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<{ label: string; url: string } | null>(null);
  const [manual, setManual] = useState<ServerFields | null>(null);
  /** The manual fields replace servers we couldn't find (a warning), or ones the user chose to edit. */
  const [serversMissing, setServersMissing] = useState(false);
  const pushToast = useMail((s) => s.pushToast);

  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const askPassword = found?.method === "password" && phase !== "email" && phase !== "detecting";
  const passwordField = useRef<HTMLInputElement>(null);
  // The field is there from the start (for the Keychain), so it takes focus when it unfolds instead of on mount.
  useEffect(() => {
    if (askPassword && !found?.server?.askUsername) passwordField.current?.focus();
  }, [askPassword, found]);

  const run = async () => {
    if (!valid) {
      setError(t("That doesn't look like an email address"));
      return;
    }
    setError(null);
    setHint(null);
    setPhase("detecting");
    if (LIVE) return runLive();
    const result = detect(email);
    const lastStep = Math.max(0, STEPS.indexOf(result.via === "Known provider" ? "Known providers" : result.via));
    for (let i = 0; i <= lastStep; i++) {
      setStep(i);
      await wait(420);
    }
    setFound(result);
    setPhase("found");
  };

  /** Real detection: animate the steps while the server works, but never pretend it's faster than it is. */
  const runLive = async () => {
    let i = 0;
    const ticker = setInterval(() => setStep((i = Math.min(i + 1, STEPS.length - 1))), 450);
    try {
      const [d] = await Promise.all([api.post<ServerDetection>("/api/accounts/detect", { email }), wait(900)]);
      clearInterval(ticker);
      if (!d.supported) {
        setError(d.message ?? t("We can't connect this mailbox yet."));
        setPhase("email");
        return;
      }
      if (d.source === "none" || (d.method === "password" && (!d.imap || !d.smtp))) {
        setManual(guessServers(email.split("@")[1] ?? ""));
        setServersMissing(true);
      }
      setStep(STEPS.length - 1);
      setFound(fromServer(d));
      setPhase("found");
    } catch (err) {
      clearInterval(ticker);
      setError((err as Error).message);
      setPhase("email");
    }
  };

  const prefilled = useRef(false);
  useEffect(() => {
    if (!prefill || prefilled.current) return;
    prefilled.current = true;
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connectLive = async () => {
    if (!found) return;
    if (found.method === "oauth") {
      setPhase("connecting");
      // Full navigation: this hands off to Google's (or Microsoft's) consent screen.
      const via = found.server?.oauth === "microsoft" ? "microsoft" : "google";
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(`/api/accounts/${via}/start?hint=${encodeURIComponent(email)}`);
      return;
    }
    if (!password) return setError(t("Enter your password"));
    setError(null);
    setHint(null);
    setPhase("connecting");
    const servers = manual
      ? {
          imap: serverConfig("imap", manual.imapHost, manual.imapPort, manual.imapSecurity),
          smtp: serverConfig("smtp", manual.smtpHost, manual.smtpPort, manual.smtpSecurity),
        }
      : { imap: found.server?.imap, smtp: found.server?.smtp };
    // Signing in with another address than this one (iCloud custom domains).
    const login = username.trim();
    if (found.server?.askUsername && !login) return (setPhase("found"), setError(t(found.server.askUsername)));
    if (login && servers.imap && servers.smtp) {
      servers.imap = { ...servers.imap, username: login };
      servers.smtp = { ...servers.smtp, username: login };
    }
    try {
      const res = await api.post<{ ok: true; account: Account }>("/api/accounts", { email, password, ...servers });
      useMail.setState((s) => ({ accounts: [...s.accounts.filter((a) => a.id !== res.account.id), res.account] }));
      pushToast({ message: t("{name} connected · importing your mail", { name: res.account.name }) });
      closeTab(tabId);
      void useMail.getState().refresh();
    } catch (err) {
      const e = err as ApiError;
      setError(e.message);
      setPhase("found");
      const serverHint = e.details?.hint as { label: string; url: string } | undefined;
      if (serverHint) setHint(serverHint);
      else if (found.appPasswordHint && e.code === "app_password_required") setHint(found.appPasswordHint);
      if (e.code === "servers_unknown" && !manual) {
        setManual(guessServers(email.split("@")[1] ?? ""));
        setServersMissing(true);
      }
    }
  };

  const connect = async () => {
    if (LIVE) return connectLive();
    if (!found) return;
    if (found.method === "password" && !password) {
      setError(t("Enter your password"));
      return;
    }
    setError(null);
    setPhase("connecting");
    await wait(1100);
    addAccount({
      name: found.name,
      email,
      provider: found.provider,
      hue: randomHue(accounts.map((a) => a.hue)),
      icon: "mail",
      signature: "<p>Daniel</p>",
    });
    closeTab(tabId);
  };

  return (
    <div className="flex h-full items-start justify-center overflow-y-auto px-5 pt-[12vh] pb-16">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={spring} className="w-full max-w-[420px]">
        <h1 className="text-[24px] font-semibold tracking-[-0.02em]">{t("Add a mailbox")}</h1>
        <p className="mt-1 text-[14px] text-ink-3">{t("Just your email address. We'll find the servers for you.")}</p>

        <form
          className="mt-6"
          onSubmit={(e) => {
            e.preventDefault();
            if (phase === "email") run();
            else if (phase === "found") connect();
          }}
        >
          <div className="rounded-2xl bg-solid p-1.5 shadow-[var(--shadow-panel)]">
            {/* username + the password field below (there from the start, folded away): the Keychain offers saved logins right here and fills both. */}
            <input
              autoFocus={!prefill}
              type="email"
              name="email"
              autoComplete="username"
              autoCapitalize="off"
              spellCheck={false}
              value={email}
              disabled={phase !== "email"}
              onChange={(e) => {
                setEmail(e.target.value);
                setError(null);
              }}
              placeholder="you@example.com"
              className="h-11 w-full rounded-xl bg-transparent px-3 text-[16px] outline-none placeholder:text-ink-3 disabled:text-ink-2"
            />
            <motion.div
              initial={false}
              animate={askPassword ? { height: "auto", opacity: 1 } : { height: 0, opacity: 0 }}
              transition={spring}
              aria-hidden={!askPassword}
              className="overflow-hidden"
            >
              {askPassword && found?.server?.askUsername && (
                <>
                  <div className="mx-3 h-px bg-line" />
                  <input
                    autoFocus
                    type="email"
                    value={username}
                    onChange={(e) => {
                      setUsername(e.target.value);
                      setError(null);
                    }}
                    placeholder={t(found.server.askUsername)}
                    className="h-11 w-full rounded-xl bg-transparent px-3 text-[16px] outline-none placeholder:text-ink-3"
                  />
                </>
              )}
              <div className="mx-3 h-px bg-line" />
              <input
                ref={passwordField}
                type="password"
                name="password"
                autoComplete="current-password"
                tabIndex={askPassword ? undefined : -1}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError(null);
                }}
                // Providers that never take the account password in mail apps: say which one it wants.
                placeholder={found?.server?.appPassword?.required === "always" ? t("App password") : t("Password")}
                className="h-11 w-full rounded-xl bg-transparent px-3 text-[16px] outline-none placeholder:text-ink-3"
              />
            </motion.div>
          </div>
          {error && <p className="mt-2 px-1 text-[12.5px] text-danger">{error}</p>}
          {hint && (
            <a href={hint.url} target="_blank" rel="noreferrer" className="mt-1.5 flex items-center gap-2 px-1 text-[12.5px] font-medium text-accent-text hover:underline">
              <KeyRound size={13} /> {t(hint.label)}
            </a>
          )}
          <AnimatePresence initial={false}>
            {manual && found?.method === "password" && phase !== "email" && (
              // -mx/px/pb: room for the fields' shadows, which overflow-hidden would otherwise cut off.
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={spring}
                className="-mx-2 -mb-2 overflow-hidden px-2 pb-2"
              >
                {serversMissing ? (
                  // Not a success: nothing confirmed these servers, so ask for them instead of showing "Found".
                  <div className="mt-5 flex items-start gap-3 rounded-2xl bg-warning/12 px-4 py-3">
                    <CircleAlert size={18} className="mt-px shrink-0 text-warning" />
                    <div className="min-w-0 flex-1 text-[13px]">
                      <div className="font-medium">{t("We couldn't find the mail servers for {domain}", { domain: email.split("@")[1] })}</div>
                      <div className="text-ink-3">{t("We filled in the usual names. Check them with your provider (their help pages list them) and fix them if needed.")}</div>
                    </div>
                  </div>
                ) : (
                  <div className="mt-5 flex items-center justify-between px-1">
                    <span className="text-[13px] font-medium">{t("Server settings")}</span>
                    <button type="button" onClick={() => setManual(null)} className="rounded-lg px-2 py-1 text-[12px] text-ink-3 hover:bg-hover hover:text-ink">
                      {t("Use detected")}
                    </button>
                  </div>
                )}
                <ServerFieldsEditor value={manual} onChange={setManual} />
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence mode="wait" initial={false}>
            {phase === "detecting" && (
              <motion.ul key="steps" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-5 flex flex-col gap-2 px-1">
                {STEPS.map((s, i) => (
                  <li key={s} className={cn("flex items-center gap-2.5 text-[13px] transition-colors", i <= step ? "text-ink" : "text-ink-3/60")}>
                    {i < step ? <Check size={14} className="text-success" /> : i === step ? <Loader size={14} className="animate-spin text-accent-text" /> : <span className="size-3.5" />}
                    {t(STEP_LABELS[i])}
                  </li>
                ))}
              </motion.ul>
            )}

            {found && !(manual && found.method === "password") && (phase === "found" || phase === "connecting") && (
              <motion.div key="found" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={spring} className="mt-5">
                <div className="flex items-center gap-3 rounded-2xl bg-success/10 px-4 py-3">
                  <ShieldCheck size={18} className="shrink-0 text-success" />
                  <div className="min-w-0 flex-1 text-[13px]">
                    <div className="font-medium">{t("Found {name}", { name: found.name })}</div>
                    <div className="text-ink-3">
                      {VIA[found.via] ? t(VIA[found.via]) : `via ${found.via.toLowerCase()}`} · {t("encrypted connection")}
                    </div>
                  </div>
                  {found.imap && (
                    <button type="button" onClick={() => setShowServers((v) => !v)} className="flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] text-ink-2 hover:bg-hover">
                      {t("Servers")} <ChevronDown size={13} className={cn("transition-transform", showServers && "rotate-180")} />
                    </button>
                  )}
                </div>
                <AnimatePresence initial={false}>
                  {showServers && found.imap && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                      <dl className="mt-2 grid grid-cols-[60px_1fr] gap-x-3 gap-y-1 px-4 font-mono text-[12px] text-ink-2">
                        <dt className="text-ink-3">IMAP</dt>
                        <dd>{found.imap}</dd>
                        <dt className="text-ink-3">SMTP</dt>
                        <dd>{found.smtp}</dd>
                      </dl>
                      {found.method === "password" && (
                        <button
                          type="button"
                          onClick={() => {
                            const domain = email.split("@")[1] ?? "";
                            const imap = parseServer(found.imap, "imap", domain);
                            const smtp = parseServer(found.smtp, "smtp", domain);
                            setManual({
                              imapHost: imap.host,
                              imapPort: imap.port,
                              imapSecurity: imap.security,
                              smtpHost: smtp.host,
                              smtpPort: smtp.port,
                              smtpSecurity: smtp.security,
                            });
                            setServersMissing(false);
                            setShowServers(false);
                          }}
                          className="mt-1.5 ml-[88px] text-[12px] font-medium text-accent-text hover:underline"
                        >
                          {t("Edit servers")}
                        </button>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
                {found.server?.message && <p className="mt-3 px-1 text-[12.5px] leading-snug text-ink-2">{found.server.message}</p>}
                {found.appPasswordHint && (
                  <a href={found.appPasswordHint.url} target="_blank" rel="noreferrer" className="mt-3 flex items-center gap-2 px-1 text-[12.5px] text-accent-text hover:underline">
                    <KeyRound size={13} /> {t(found.appPasswordHint.label)}
                  </a>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          <button
            type="submit"
            disabled={phase === "detecting" || phase === "connecting"}
            className="mt-6 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent text-[14px] font-medium text-on-accent shadow-[0_1px_2px_rgb(0_0_0/0.12),inset_0_1px_0_rgb(255_255_255/0.18)] transition-[background-color,opacity] hover:bg-accent-hover disabled:opacity-60"
          >
            {phase === "connecting" ? (
              <>
                <Loader size={16} className="animate-spin" /> {t("Connecting…")}
              </>
            ) : found?.method === "oauth" && phase === "found" ? (
              <>{found.server?.oauth === "microsoft" ? t("Continue with Microsoft") : t("Continue with Google")}</>
            ) : phase === "found" ? (
              <>{t("Connect mailbox")}</>
            ) : (
              <>
                {t("Continue")} <ArrowRight size={16} />
              </>
            )}
          </button>
        </form>

        <div className="mt-8 flex items-center gap-2 text-[12px] text-ink-3">
          <Server size={13} />
          {t("Works with Gmail, Outlook, Seznam, iCloud and any IMAP server.")}
        </div>
      </motion.div>
    </div>
  );
}

/** Host, port and encryption for IMAP and SMTP. Picking a usual port picks its encryption, and back. */
function ServerFieldsEditor({ value, onChange }: { value: ServerFields; onChange: (v: ServerFields) => void }) {
  const field = "rounded-xl bg-solid px-3 pt-1.5 pb-1 shadow-[var(--shadow-panel)]";
  return (
    <div className="mt-3 grid grid-cols-[minmax(0,1fr)_64px_108px] gap-1.5">
      {(["imap", "smtp"] as const).map((kind) => {
        const ports = PORTS[kind];
        const host = `${kind}Host` as const;
        const port = `${kind}Port` as const;
        const security = `${kind}Security` as const;
        return (
          <Fragment key={kind}>
            <label className={field}>
              <span className="block text-[11px] text-ink-3">{kind === "imap" ? t("Incoming (IMAP) server") : t("Outgoing (SMTP) server")}</span>
              <input
                value={value[host]}
                inputMode="url"
                autoCapitalize="off"
                spellCheck={false}
                onChange={(e) => onChange({ ...value, [host]: e.target.value })}
                className="h-7 w-full bg-transparent font-mono text-[14px] outline-none sm:text-[13px]"
              />
            </label>
            <label className={field}>
              <span className="block text-[11px] text-ink-3">Port</span>
              <input
                value={value[port]}
                inputMode="numeric"
                onChange={(e) => {
                  const p = e.target.value.replace(/\D/g, "").slice(0, 5);
                  const known = p === ports.ssl ? "ssl" : p === ports.starttls || (kind === "smtp" && p === "25") ? "starttls" : null;
                  onChange({ ...value, [port]: p, ...(known ? { [security]: known } : {}) });
                }}
                className="h-7 w-full bg-transparent font-mono text-[14px] outline-none sm:text-[13px]"
              />
            </label>
            <label className={cn(field, "relative")}>
              <span className="block text-[11px] text-ink-3">{t("Security")}</span>
              <select
                value={value[security]}
                onChange={(e) => {
                  const next = e.target.value as Security;
                  const other = next === "ssl" ? ports.starttls : ports.ssl;
                  const swapPort = !value[port] || value[port] === other;
                  onChange({ ...value, [security]: next, ...(swapPort ? { [port]: ports[next] } : {}) });
                }}
                className="h-7 w-full cursor-pointer appearance-none bg-transparent pr-4 text-[13px] outline-none"
              >
                <option value="ssl">SSL/TLS</option>
                <option value="starttls">STARTTLS</option>
              </select>
              <ChevronDown size={13} className="pointer-events-none absolute right-2.5 bottom-2.5 text-ink-3" />
            </label>
          </Fragment>
        );
      })}
    </div>
  );
}
