/**
 * No reply yet: emails the user sent that nobody has answered, without setting anything up. A rule,
 * no AI: the user's message is the last one in the conversation, it went to a person (not a no-reply
 * address), it's at least WAIT_WORKING_DAYS working days old and at most LOOK_BACK_DAYS, and it asks
 * something (a question mark in what the user wrote) or starts the conversation. "Thanks!" and the
 * like don't wait for anything.
 */

export const WAIT_WORKING_DAYS = 3;
export const LOOK_BACK_DAYS = 30;

/** The moment `days` working days (Monday to Friday) before `now`. */
export function workingDaysAgo(days: number, now = new Date()): Date {
  const d = new Date(now);
  let left = days;
  while (left > 0) {
    d.setDate(d.getDate() - 1);
    const day = d.getDay();
    if (day !== 0 && day !== 6) left--;
  }
  return d;
}

/** Addresses no person reads: nobody there will reply. */
const NO_REPLY = /^(no-?reply|do-?not-?reply|donotreply|noreply|bounce[s]?|mailer-daemon|postmaster|notifications?|alerts?|automated)([-+._@]|$)/i;

export const isPersonAddress = (email: string) => !!email && email.includes("@") && !NO_REPLY.test(email.trim());

/**
 * Where the quoted conversation starts in a plain-text reply: "On … wrote:", "Dne … napsal(a):",
 * Outlook's "From:" block or the first "> " line. Everything from there on isn't what the user wrote.
 */
const QUOTE_START = [
  /^\s*On .{3,200}wrote:\s*$/im,
  /^\s*Dne .{3,200}napsal(?:\(a\)|a)?:\s*$/im,
  /^\s*-{2,}\s*(Original Message|Původní zpráva|Forwarded message|Přeposlaná zpráva)\s*-{2,}/im,
  /^\s*(From|Od):\s.+$/im,
  /^\s*>/m,
];

export function ownText(text: string): string {
  let end = text.length;
  for (const re of QUOTE_START) {
    const m = re.exec(text);
    if (m && m.index < end) end = m.index;
  }
  return text.slice(0, end);
}

/** The user asked something in what they wrote (a question mark that isn't part of a link). */
export function asksQuestion(text: string): boolean {
  return /\?(?![\w=&%/-])/.test(ownText(text).replace(/https?:\/\/\S+/g, " "));
}
