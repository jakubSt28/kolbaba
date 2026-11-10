"use client";

import { useSyncExternalStore } from "react";

const TICK = 30_000;

function subscribe(onChange: () => void) {
  const id = setInterval(onChange, TICK);
  return () => clearInterval(id);
}

// Rounded so consecutive snapshots are equal until the next tick.
const snapshot = () => Math.floor(Date.now() / TICK) * TICK;

/** Current time for rendering relative timestamps; re-renders every 30 s. */
export function useNow() {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
