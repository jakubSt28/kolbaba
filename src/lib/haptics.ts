"use client";

/**
 * A short tap from the phone's vibration motor, for the moments a finger should feel: a swipe
 * crossing its threshold, a long-press, a send. Never sound.
 *
 * Android has the Vibration API. iPhone has none, but Safari (17.4+) taps when a switch checkbox
 * flips, so a hidden one is flipped through its label. Apple may close that door in any update
 * (reportedly in iOS 26.5); then this simply does nothing. Mice and trackpads get nothing either.
 */
export type Haptic = "tick" | "soft" | "success" | "warning";

const PATTERNS: Record<Haptic, number | number[]> = {
  tick: 6,
  soft: 4,
  success: [8, 60, 12],
  warning: [14, 50, 14],
};

let label: HTMLLabelElement | null = null;

function iosTap() {
  if (!label) {
    label = document.createElement("label");
    label.ariaHidden = "true";
    label.style.display = "none";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.setAttribute("switch", "");
    input.tabIndex = -1;
    label.appendChild(input);
    document.head.appendChild(label);
  }
  label.click();
}

const touchDevice = () => typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;

export function haptic(kind: Haptic = "tick") {
  try {
    if (!touchDevice()) return;
    if (typeof navigator.vibrate === "function") {
      navigator.vibrate(PATTERNS[kind]);
      return;
    }
    iosTap();
    // iOS has one strength; two taps read as "done" rather than "touched".
    if (kind === "success" || kind === "warning") setTimeout(iosTap, 90);
  } catch {
    // Haptics are a nicety; nothing may break because of them.
  }
}
