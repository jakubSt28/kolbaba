import { env } from "../env";

/**
 * The cheap first look at an email: TypeSafe's Jev only sorts (order, trip, invoice… or nothing), says
 * how sure it is and whether it's bulk mail, for about a quarter of what reading it with OpenAI costs.
 * Only what it doesn't rule out goes on to the model that pulls out the details (extract.ts). Jev sees
 * the sender, the subject and the start of the email; it isn't trained on what it gets (TypeSafe's terms).
 *
 * Measured on a sample of 3,000 emails against GPT-6 Luna (13 Oct 2026):
 * skipping what it calls nothing with at least SKIP_IF_NONE certainty sent 39 % of the mail on and lost
 * 0.6 % of the cards; the regex prefilter before it sent 57 % and missed 10 %. Shorter category
 * descriptions saved 13 % of the tokens but lost twice as many cards, so these stay as measured.
 */

export type JevCategory = "order" | "travel" | "invoice" | "subscription" | "security" | "reply" | "none";

/** Below this certainty that an email is nothing, it goes on to the model. */
export const SKIP_IF_NONE = 0.8;

/** Enough of the email to tell what it is: the first 1,000 characters sorted as well as the whole email. */
const CHARS = 1000;

/** The categories as the OpenAI prompt (extract.ts) describes them. */
const CRITERIA: Record<JevCategory, string> = {
  order:
    "Goods bought online, or a food or grocery delivery: order confirmation, payment, shipping, ready for pickup, delivery, cancellation, return, refund. Carrier emails about a parcel. Also sales the reader made on a marketplace (Vinted, Aukro, Bazoš).",
  travel: "Flight, train or bus tickets, hotel or Airbnb stays, car rentals, event tickets.",
  invoice: "A bill or invoice, a tax document, a utility bill, a receipt for a one-off service, or a receipt for something bought and paid in a shop.",
  subscription: "A recurring charge or plan: renewal, receipt for a monthly or yearly payment, trial ending, failed payment, cancellation.",
  security:
    "A service tells the reader about their account's security: a new sign-in or device, a changed or reset password, 2-step verification turned on or off, suspicious activity. Not an email whose point is a one-time sign-in code.",
  reply:
    "A real person (not a company's automated mail, not a newsletter) writes to the reader, asks them something or asks them to do something, and waits for an answer.",
  none: "None of these: newsletters, promotions, discounts, abandoned carts, review requests, sign-in codes, usage reports or statements with nothing to pay, notifications, other personal mail, anything else. Most emails are this.",
};

export interface Triage {
  category: JevCategory;
  /** How sure Jev is that the email is none of the categories (0–1). */
  pNone: number;
  /** How sure it is of `category`. */
  confidence: number;
  /** How likely it's a newsletter, promotion or other bulk email (0–1): offers look like trips and orders. */
  bulk: number;
  inputTokens: number;
}

export const hasJev = () => !!env.typesafeApiKey;

/**
 * Jev can't sort anything right now: an outage or rate limit, or (`account`) the credit ran out or the
 * key stopped working, which needs a person. Anything else is about one email.
 */
export class JevUnavailable extends Error {
  constructor(
    message: string,
    readonly account = false,
  ) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Cut by characters (not UTF-16 units) and drop stray halves of emoji, which Jev refuses as invalid text. */
export function jevState(email: { subject: string; from: { name: string; email: string }; date: Date; text: string }) {
  const start = Array.from(email.text).slice(0, CHARS).join("");
  return `From: ${email.from.name} <${email.from.email}>\nDate: ${email.date.toISOString().slice(0, 10)}\nSubject: ${email.subject}\n\n${start}`.replace(
    /\p{Cs}/gu,
    "",
  );
}

export async function triageWithJev(
  email: { subject: string; from: { name: string; email: string }; date: Date; text: string },
  opts: { replies?: boolean } = {},
): Promise<Triage> {
  const criteria: Partial<Record<JevCategory, string>> = { ...CRITERIA };
  if (!opts.replies) delete criteria.reply;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.typesafeApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: env.jevModel,
        state: jevState(email),
        questions: {
          category: { type: "choice", instructions: "Which kind of email is this? It may be in Czech, Slovak, English or German.", criteria },
          bulk: { type: "noul", instructions: "Is this a newsletter, a promotion, marketing or another bulk email sent to many people?" },
        },
      }),
      signal: AbortSignal.timeout(20_000),
    }).catch((err: Error) => err);
    const retryable = res instanceof Error || res.status === 429 || res.status === 529 || res.status >= 500;
    if (retryable) {
      if (attempt < 3) {
        await sleep(400 * 2 ** attempt + Math.random() * 200);
        continue;
      }
      throw new JevUnavailable(res instanceof Error ? res.message : `jev ${res.status}`);
    }
    // No credit (402) or a key that doesn't work: no use trying again, or deciding without Jev.
    if (res.status === 401 || res.status === 402 || res.status === 403) throw new JevUnavailable(`jev ${res.status}: ${(await res.text()).slice(0, 300)}`, true);
    if (!res.ok) throw new Error(`jev ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const body = (await res.json()) as {
      answers: {
        category?: { choice: JevCategory; probabilities?: Partial<Record<JevCategory, number>>; confidence?: number };
        bulk?: { noul: number };
      };
      usage?: { input_tokens?: number };
    };
    const answer = body.answers.category;
    if (!answer) throw new Error("jev: no answer");
    const pNone = answer.probabilities?.none ?? (answer.choice === "none" ? 1 : 0);
    return {
      category: answer.choice,
      pNone,
      confidence: answer.confidence ?? 0,
      bulk: body.answers.bulk?.noul ?? 0,
      inputTokens: body.usage?.input_tokens ?? 0,
    };
  }
}
