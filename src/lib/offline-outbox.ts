"use client";

import type { Draft } from "./types";

/**
 * Emails sent without a signal (the subway, a plane): kept on this device and sent the moment the
 * app is back online. iPhone web apps can't send in the background, so "back online" means the app
 * is open again with a signal; until then the list shows what's waiting.
 */

export interface SendOptions {
  scheduleAt?: number;
  followUpDays?: number;
  track?: boolean;
}

export interface QueuedSend {
  draft: Draft;
  opts: SendOptions;
  queuedAt: number;
}

const KEY = "kolbaba:offline-outbox";

export function readQueue(): QueuedSend[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as QueuedSend[]) : [];
    return Array.isArray(list) ? list.filter((q) => q?.draft?.id) : [];
  } catch {
    return [];
  }
}

export function writeQueue(queue: QueuedSend[]) {
  try {
    if (queue.length) localStorage.setItem(KEY, JSON.stringify(queue));
    else localStorage.removeItem(KEY);
  } catch {
    // Private mode or a full disk: the queue still lives in memory while the app is open.
  }
}

/** The browser says there's no connection (a failed request is the other sign). */
export const isOffline = () => typeof navigator !== "undefined" && navigator.onLine === false;
