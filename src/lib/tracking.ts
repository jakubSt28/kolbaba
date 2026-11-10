import { t, tn } from "./i18n";
import type { Message } from "./types";
import { formatListTime } from "./utils";

export type OpenState = "off" | "waiting" | "opened" | "apple";

export interface OpenSummary {
  state: OpenState;
  label: string;
  detail?: string;
}

/**
 * Apple Mail Privacy Protection preloads every image (our pixel included) as soon as the
 * message lands on the device, so an Apple-proxy hit only proves delivery, not reading.
 */
export function openSummary(m: Message): OpenSummary {
  if (!m.tracked) return { state: "off", label: t("Not tracked") };
  const opens = m.opens ?? [];
  const real = opens.filter((o) => !o.viaApple);
  if (real.length) {
    const last = real[real.length - 1];
    return {
      state: "opened",
      label: real.length > 1 ? tn(real.length, "Opened {n}×", "Opened {n}×") : t("Opened"),
      detail: t("last {time} · {client}", {
        time: formatListTime(last.at).toLowerCase(),
        client: last.client,
      }),
    };
  }
  if (opens.length) {
    return {
      state: "apple",
      label: t("Delivered to Apple Mail"),
      detail: t("Apple preloads images, so we can't tell if it was read"),
    };
  }
  return { state: "waiting", label: t("Not opened yet") };
}

export function openTooltip(m: Message) {
  const s = openSummary(m);
  return s.detail ? `${s.label} · ${s.detail}` : s.label;
}


const CLIENTS = ["iPhone · Gmail", "Gmail on the web", "Mac · Outlook", "Android · Gmail"];
export const randomClient = () => CLIENTS[Math.floor(Math.random() * CLIENTS.length)];
