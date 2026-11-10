import type { ServerConfig } from "../db/schema";

/**
 * Shared types for mail server autodetection. Kept free of Node imports so the add-account UI can
 * import `sourceLabel` and the types directly.
 */

export type DetectionSource = "known" | "ispdb" | "autoconfig" | "mx" | "srv" | "guess" | "none";

export interface AppPasswordHint {
  /** "always": the provider never accepts the account password in mail apps; "with2fa": only once 2FA is on. */
  required: "always" | "with2fa";
  url: string;
  /** Link text, e.g. "Create an app password". */
  label: string;
  /** Where to click, e.g. "Account → Security → App passwords". */
  steps?: string;
}

export interface Detection {
  provider: "gmail" | "imap";
  providerLabel: string;
  method: "oauth" | "password";
  /** Who to sign in with when `method` is "oauth": Google (Gmail) unless it says Microsoft (Outlook, Microsoft 365). */
  oauth?: "google" | "microsoft";
  imap?: ServerConfig;
  smtp?: ServerConfig;
  source: DetectionSource;
  appPassword?: AppPasswordHint;
  /** False for providers we recognise but can't connect to yet (Outlook, Proton, …). */
  supported: boolean;
  /** Friendly note for the user; always set when `supported` is false or nothing was found. */
  message?: string;
  /** Placeholders in `message` (only until detectMailSettings fills and translates it). */
  messageVars?: Record<string, string>;
  /**
   * The provider signs in with another address than this one (iCloud custom domains: the @icloud.com
   * address): the field's label. The answer is the username for IMAP and SMTP.
   */
  askUsername?: string;
}

const SOURCE_LABELS: Record<DetectionSource, string> = {
  known: "Built-in settings",
  ispdb: "Thunderbird database",
  autoconfig: "Your provider's setup file",
  mx: "Your domain's mail records",
  srv: "Your domain's DNS",
  guess: "Best guess, connection checked",
  none: "Not found",
};

/** Human label for where the settings came from (shown under the detected servers). */
export function sourceLabel(source: DetectionSource) {
  return SOURCE_LABELS[source];
}
