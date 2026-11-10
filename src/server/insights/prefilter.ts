/**
 * Cheap first pass before any AI: does this email look like an order, a trip, an invoice or a
 * subscription at all? Generous on purpose (the model sorts out the rest), but most mail — people,
 * newsletters, notifications — never leaves the server.
 */

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const WORDS = new RegExp(
  "\\b(" +
    [
      // Orders and deliveries
      "order\\w*",
      "objednav\\w*",
      "objednan\\w*",
      "zasilk\\w*",
      "balik\\w*",
      "doruc\\w*",
      "delivered",
      "delivery",
      "shipped",
      "shipping",
      "dispatched",
      "odeslan\\w*",
      "expedov\\w*",
      "tracking",
      "sledovani",
      "vydejn\\w*",
      "pickup",
      "refund\\w*",
      "vraceni",
      "reklamac\\w*",
      // Invoices and payments
      "faktur\\w*",
      "invoice\\w*",
      "receipt",
      "uctenk\\w*",
      "danovy doklad",
      "payment",
      "platb\\w*",
      "zaplacen\\w*",
      "uhrad\\w*",
      "splatnost\\w*",
      "vyuctovani",
      "billing",
      "statement",
      // Subscriptions
      "subscription\\w*",
      "predplatn\\w*",
      "renew\\w*",
      "obnov\\w*",
      "trial",
      "membership",
      "clenstvi",
      "your plan",
      // Travel
      "booking",
      "rezervac\\w*",
      "reservation",
      "itinerary",
      "flight",
      "boarding",
      "check-in",
      "letenk\\w*",
      "jizdenk\\w*",
      "ticket\\w*",
      "vstupenk\\w*",
      "hotel",
      "ubytovani",
      "pobyt",
    ].join("|") +
    ")\\b",
);

/** Senders whose mail is almost always one of the four (shops, carriers, travel, billing). */
const DOMAINS = [
  "alza.cz",
  "mall.cz",
  "rohlik.cz",
  "kosik.cz",
  "notino.cz",
  "zalando.cz",
  "aboutyou.cz",
  "datart.cz",
  "czc.cz",
  "ikea.com",
  "amazon.",
  "temu.com",
  "aliexpress.",
  "zasilkovna.cz",
  "packeta.",
  "ppl.cz",
  "dpd.",
  "gls-",
  "postaonline.cz",
  "cpost.cz",
  "balikovna.cz",
  "wolt.com",
  "bolt.eu",
  "foodora.cz",
  "booking.com",
  "airbnb.",
  "regiojet.",
  "cd.cz",
  "leoexpress.",
  "flixbus.",
  "ryanair.com",
  "wizzair.com",
  "smartwings.com",
  "csa.cz",
  "lufthansa.com",
  "easyjet.com",
  "goout.net",
  "ticketportal.cz",
  "ticketmaster.",
  "netflix.com",
  "spotify.com",
  "apple.com",
  "google.com",
  "paypal.",
  "stripe.com",
  "paddle.com",
  "fakturoid.cz",
  "idoklad.cz",
];

/** Account security notices (new sign-in, password, 2-step verification). Sign-in codes match too; the model drops them. */
const SECURITY = new RegExp(
  "(" +
    [
      "new sign[- ]?in",
      "new login",
      "signed in",
      "sign-in attempt",
      "security alert",
      "security notification",
      "password (was |has been )?(changed|reset)",
      "reset your password",
      "2-step",
      "two-factor",
      "2fa",
      "suspicious",
      "unusual (sign|activity)",
      "new device",
      "nove prihlaseni",
      "prihlaseni (do|k) (vaseho|tveho|uctu)",
      "zmena hesla",
      "heslo (bylo )?zmeneno",
      "obnov\\w* hesl\\w*",
      "dvoufazov\\w*",
      "dvoufaktor\\w*",
      "podezrel\\w*",
      "bezpecnostni upozorneni",
      "nove zarizeni",
    ].join("|") +
    ")",
);

/** Automated senders never wait for an answer. */
const NO_REPLY = /^(no-?reply|do-?not-?reply|notifications?|alerts?|mailer-daemon|postmaster|bounce|news(letter)?|info|support|hello|team|marketing)[@+.-]/i;

/** A question or a request in what the person wrote (not in the quote below it). */
const ASKS = new RegExp(
  "(\\?|" +
    [
      "prosim",
      "potrebuj\\w*",
      "muzes",
      "muzete",
      "mohl\\w* bys",
      "mohl\\w* byste",
      "dej(te)? (mi )?vedet",
      "ozvi se",
      "ozvete se",
      "potvrd\\w*",
      "posli\\w*",
      "zasli\\w*",
      "could you",
      "can you",
      "would you",
      "please",
      "let me know",
      "get back to me",
      "confirm",
      "send me",
    ].join("|") +
    ")",
);

/** An email from a person to the reader that seems to ask for something (only with "Awaiting my reply" on). */
export function looksLikeAsk(m: { from: { email: string }; text: string; toMe: boolean; personal: boolean }): boolean {
  if (!m.toMe || !m.personal || NO_REPLY.test(m.from.email)) return false;
  // Only what they wrote above the quoted thread.
  const own = m.text.split(/\n(?:>|On .{5,120}wrote:|Dne .{5,120}napsal)/)[0].slice(0, 2000);
  return ASKS.test(fold(own));
}

export function looksLikeSecurity(m: { subject: string; text: string }): boolean {
  return SECURITY.test(fold(m.subject)) || SECURITY.test(fold(m.text.slice(0, 1500)));
}

export function looksLikeInsight(m: { subject: string; from: { email: string }; text: string }): boolean {
  const domain = m.from.email.toLowerCase().split("@")[1] ?? "";
  if (DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`) || (d.endsWith(".") || d.endsWith("-") ? domain.includes(d) : false))) {
    return true;
  }
  return WORDS.test(fold(m.subject)) || WORDS.test(fold(m.text.slice(0, 2500)));
}
