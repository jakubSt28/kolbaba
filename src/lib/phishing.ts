import type { Person } from "./types";

const ADDRESS = /[^\s<>"'(),;:]+@[^\s<>"'(),;:]+\.[a-z]{2,}/gi;

/**
 * The sender's name holds an email address that isn't the one it came from: "service@paypal.com" as
 * the name of mail sent by someone else is an old trick, since most apps show only the name.
 */
export function nameHidesAddress(from: Person): boolean {
  return !!addressInName(from);
}

/** The other address the sender's name shows, if it shows one. */
export function addressInName(from: Person): string | null {
  const real = from.email.trim().toLowerCase();
  return (from.name.match(ADDRESS) ?? []).find((a) => a.toLowerCase() !== real) ?? null;
}

/** "jmeno@domena.cz" → ["jmeno@", "domena.cz"]: the reader shows the domain louder, where a fake shows. */
export function splitAddress(email: string): [string, string] {
  const at = email.lastIndexOf("@");
  return at < 0 ? [email, ""] : [email.slice(0, at + 1), email.slice(at + 1)];
}
