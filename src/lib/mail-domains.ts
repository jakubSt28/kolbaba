/** Free-mail domains: never a company (no useful logo), and far too many people to block at once. */
export const FREE_MAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "seznam.cz",
  "email.cz",
  "post.cz",
  "centrum.cz",
  "atlas.cz",
  "volny.cz",
  "tiscali.cz",
  "azet.sk",
  "icloud.com",
  "me.com",
  "mac.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "gmx.net",
  "aol.com",
]);

/** "petr@firma.cz" → "firma.cz". */
export const domainOf = (email: string) => email.slice(email.lastIndexOf("@") + 1).toLowerCase();

export const isFreeMail = (email: string) => FREE_MAIL_DOMAINS.has(domainOf(email));
