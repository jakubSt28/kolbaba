"use client";

import { t } from "./i18n";
import { CODE_FRESH_MS, findCode, formatCode } from "./otp";
import { useMail } from "./store";
import type { Thread } from "./types";
import { htmlToText } from "./utils";

export interface ThreadCode {
  code: string;
  at: number;
  messageId: string;
  sender: string;
}

const cache = new WeakMap<Thread["messages"][number], ThreadCode | null>();

/** The one-time code in a conversation's latest incoming message, if it has one. */
export function threadCode(t: Thread): ThreadCode | null {
  const mine = new Set(useMail.getState().accounts.map((a) => a.email.toLowerCase()));
  const last = [...t.messages].reverse().find((m) => !mine.has(m.from.email.toLowerCase()));
  if (!last) return null;
  // Rows re-render often; a message's text doesn't change, so look once.
  if (cache.has(last)) return cache.get(last)!;
  const found = findCode(t.subject, last.html ? htmlToText(last.html) : (last.snippet ?? ""));
  const result = found ? { code: found.code, at: last.date, messageId: last.id, sender: last.from.name || last.from.email } : null;
  cache.set(last, result);
  return result;
}

export const isFresh = (c: ThreadCode, now = Date.now()) => now - c.at < CODE_FRESH_MS;

export async function copyCode(code: string) {
  const { pushToast } = useMail.getState();
  try {
    await navigator.clipboard.writeText(code);
    pushToast({ message: t("Copied {code}", { code: formatCode(code) }), icon: "key", duration: 2500 });
  } catch {
    pushToast({ message: t("Code {code}", { code: formatCode(code) }), icon: "key" });
  }
}

const announced = new Set<string>();

/**
 * A code that just arrived pops up with a Copy button, wherever you are in the app, once per message.
 * That includes opening the app from the code's push notification.
 */
export function watchForCodes() {
  return useMail.subscribe((s, prev) => {
    if (s.threads === prev.threads) return;
    const now = Date.now();
    for (const thread of Object.values(s.threads)) {
      if (!thread.unread || thread.folder !== "inbox") continue;
      const c = threadCode(thread);
      if (!c || now - c.at > 5 * 60_000 || announced.has(c.messageId)) continue;
      announced.add(c.messageId);
      s.pushToast({
        message: `${formatCode(c.code)} · ${c.sender}`,
        icon: "key",
        duration: 20_000,
        action: { label: t("Copy"), run: () => void copyCode(c.code) },
      });
    }
  });
}
