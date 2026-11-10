"use client";

import { Inbox } from "lucide-react";
import { Dialog } from "radix-ui";
import { useState } from "react";
import { t } from "@/lib/i18n";
import { LIVE } from "@/lib/live";
import { useMail } from "@/lib/store";
import { cn } from "@/lib/utils";
import { GoogleMark } from "./auth/google-mark";
import { BrandMark } from "./brand-mark";

const DISMISSED = "kolbaba-welcome-dismissed";

function wasDismissed() {
  try {
    return sessionStorage.getItem(DISMISSED) === "1";
  } catch {
    return false;
  }
}

/** Start connecting Gmail; `hint` makes Google pre-select the account the user signed in with. */
export function connectGmail(hint?: string | null) {
  const query = hint ? `?hint=${encodeURIComponent(hint)}` : "";
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign(`/api/accounts/google/start${query}`);
}

/**
 * The address the user signed up with: the mailbox worth offering first, since people expect the
 * account and that mailbox to be one thing. `google`: they signed in with that Google account.
 * `gmail`: it connects through Google's consent screen rather than Add mailbox.
 */
function useOwnMailbox() {
  const user = useMail((s) => s.user);
  const email = user?.googleEmail ?? user?.email;
  if (!email) return null;
  const google = !!user?.googleEmail;
  return { email, google, gmail: google || /@(gmail|googlemail)\.com$/i.test(email) };
}

/** Gmail goes straight to Google; any other address opens Add mailbox with it filled in and being looked up. */
function connectOwn(own: { email: string; gmail: boolean }) {
  if (own.gmail) connectGmail(own.email);
  else useMail.getState().openAddAccount(own.email);
}

/** What an inbox says before any mailbox is connected (after the welcome was put off). */
export function NoMailbox() {
  const openAddAccount = useMail((s) => s.openAddAccount);
  const own = useOwnMailbox();
  return (
    <div className="flex flex-col items-center gap-3 px-6 text-center">
      <BrandMark size={40} />
      <div>
        <div className="text-[15px] font-semibold">{t("No mailbox yet")}</div>
        <div className="mt-0.5 text-[13px] break-words text-ink-3">
          {own ? t("Connect {email} and your mail shows up here.", { email: own.email }) : t("Connect one and your mail shows up here.")}
        </div>
      </div>
      <div className="mt-1 flex flex-wrap justify-center gap-2">
        {own && (
          <button
            onClick={() => connectOwn(own)}
            className={cn(
              "flex h-9 items-center gap-2 rounded-full bg-accent text-[13px] font-medium text-on-accent transition-colors hover:bg-accent-hover",
              own.gmail ? "pr-4 pl-1.5" : "px-4",
            )}
          >
            {own.gmail && (
              <span className="flex size-6 items-center justify-center rounded-full bg-white">
                <GoogleMark size={13} />
              </span>
            )}
            {own.gmail ? t("Connect Gmail") : t("Connect mailbox")}
          </button>
        )}
        <button
          onClick={() => openAddAccount()}
          className={
            own
              ? "h-9 rounded-full px-4 text-[13px] font-medium text-ink-2 shadow-[inset_0_0_0_0.5px_var(--line)] transition-colors hover:bg-hover"
              : "h-9 rounded-full bg-accent px-4 text-[13px] font-medium text-on-accent transition-colors hover:bg-accent-hover"
          }
        >
          {own ? t("Add a different mailbox") : t("Add mailbox")}
        </button>
      </div>
    </div>
  );
}

/**
 * The first thing a new account sees instead of an empty inbox: the mailbox they signed up with, one
 * tap away. Signed in with Google, that's the same Gmail (Google asks for mail access separately);
 * signed up with a code, Add mailbox opens with the address already looked up.
 */
export function WelcomeHost() {
  const ready = useMail((s) => s.ready);
  const empty = useMail((s) => s.accounts.length === 0);
  const addOpen = useMail((s) => s.tabs.some((tab) => tab.kind === "add-account"));
  const openAddAccount = useMail((s) => s.openAddAccount);
  const own = useOwnMailbox();
  const [dismissed, setDismissed] = useState(wasDismissed);
  const open = LIVE && ready && !!own && empty && !addOpen && !dismissed;

  const dismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem(DISMISSED, "1");
    } catch {
      // Private mode: it just asks again next time.
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && dismiss()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/20 data-[state=open]:animate-[fade-in_140ms_ease-out] dark:bg-black/45" />
        <Dialog.Content className="glass-strong fixed inset-x-3 bottom-[max(12px,var(--safe-bottom))] z-50 mx-auto max-w-[400px] rounded-[26px] p-6 text-center outline-none data-[state=open]:animate-[menu-in_180ms_ease-out] sm:top-1/2 sm:bottom-auto sm:-translate-y-1/2">
          <div className="mx-auto mb-4 flex w-fit">
            <BrandMark size={44} />
          </div>
          <Dialog.Title className="text-[19px] font-semibold tracking-[-0.02em]">{t("Welcome to Kolbaba")}</Dialog.Title>
          {own && (
            <>
              <Dialog.Description className="mt-1.5 text-[14px] leading-relaxed break-words text-ink-2">
                {own.google
                  ? t("Bring in your mail from {email} too? Google will ask once more, this time for access to Gmail.", { email: own.email })
                  : t("Your account is ready. Connect {email} too and your mail shows up here.", { email: own.email })}
              </Dialog.Description>
              <button
                autoFocus
                onClick={() => {
                  if (!own.gmail) dismiss();
                  connectOwn(own);
                }}
                className="mt-5 flex h-11 w-full items-center justify-center gap-2.5 rounded-full bg-accent px-4 text-[14.5px] font-medium text-on-accent press [--press-scale:0.97] hover:bg-accent-hover"
              >
                {own.gmail ? (
                  <span className="flex size-6 items-center justify-center rounded-full bg-white">
                    <GoogleMark size={14} />
                  </span>
                ) : (
                  <Inbox size={17} />
                )}
                {own.gmail ? t("Connect Gmail") : t("Connect mailbox")}
              </button>
              <button
                onClick={() => {
                  dismiss();
                  openAddAccount();
                }}
                className="mt-2 h-10 w-full rounded-full text-[14px] font-medium text-ink-2 transition-colors hover:bg-hover hover:text-ink"
              >
                {t("Add a different mailbox")}
              </button>
            </>
          )}
          <Dialog.Close className="mt-1 h-9 w-full rounded-full text-[13px] text-ink-3 transition-colors hover:text-ink">{t("Not now")}</Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
