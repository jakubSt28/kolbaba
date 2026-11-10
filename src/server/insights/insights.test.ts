import { describe, expect, it } from "vitest";
import { toExtracted, type ModelOutput } from "./extract";
import { looksLikeAsk, looksLikeInsight, looksLikeSecurity } from "./prefilter";
import { fromSchemaOrg } from "./schema-org";
import { emailText } from "./text";

const none: ModelOutput = {
  category: "none",
  why: null,
  merchant: null,
  amount: null,
  currency: null,
  ref: null,
  order: null,
  travel: null,
  invoice: null,
  subscription: null,
  security: null,
  reply: null,
};

describe("looksLikeInsight", () => {
  const mail = (subject: string, text = "", email = "someone@example.com") => looksLikeInsight({ subject, text, from: { email } });

  it("lets order, travel, invoice and subscription mail through", () => {
    expect(mail("Vaše objednávka č. 123 byla odeslána")).toBe(true);
    expect(mail("Faktura za elektřinu")).toBe(true);
    expect(mail("Your booking confirmation")).toBe(true);
    expect(mail("Your Netflix receipt")).toBe(true);
    expect(mail("Hi", "", "info@alza.cz")).toBe(true);
    expect(mail("Novinky", "", "news@mail.rohlik.cz")).toBe(true);
  });

  it("keeps everyday mail on the server", () => {
    expect(mail("Víkend v Jizerkách?", "Vyrazili bychom ráno vlakem z Holešovic.")).toBe(false);
    expect(mail("Re: Sync engine — IMAP IDLE notes", "Gmail bych řešil přes Pub/Sub.")).toBe(false);
  });
});

describe("fromSchemaOrg", () => {
  const html = (data: unknown) => `<html><head><script type="application/ld+json">${JSON.stringify(data)}</script></head><body>…</body></html>`;

  it("reads a parcel delivery", () => {
    const found = fromSchemaOrg(
      html({
        "@context": "http://schema.org",
        "@type": "ParcelDelivery",
        carrier: { "@type": "Organization", name: "PPL" },
        trackingNumber: "40712345678",
        trackingUrl: "https://ppl.cz/t/40712345678",
        expectedArrivalUntil: "2026-10-12T18:00:00+02:00",
        partOfOrder: {
          "@type": "Order",
          orderNumber: "1029384756",
          merchant: { "@type": "Organization", name: "Alza.cz" },
          orderStatus: "http://schema.org/OrderInTransit",
        },
      }),
    );
    expect(found).toMatchObject({
      category: "order",
      merchant: "Alza.cz",
      ref: "1029384756",
      order: { status: "shipped", carrier: "PPL", trackingNumber: "40712345678", expectedAt: "2026-10-12T18:00" },
    });
  });

  it("reads a flight and a hotel", () => {
    const flight = fromSchemaOrg(
      html({
        "@type": "FlightReservation",
        reservationNumber: "K7X2QP",
        reservationFor: {
          "@type": "Flight",
          airline: { name: "Ryanair" },
          departureAirport: { iataCode: "PRG" },
          arrivalAirport: { iataCode: "BCN" },
          departureTime: "2026-11-14T06:25:00+01:00",
        },
      }),
    );
    expect(flight).toMatchObject({ category: "travel", merchant: "Ryanair", travel: { kind: "flight", from: "PRG", to: "BCN", startsAt: "2026-11-14T06:25", bookingCode: "K7X2QP" } });
    const hotel = fromSchemaOrg(
      html([{ "@type": "LodgingReservation", reservationNumber: "123", reservationFor: { name: "Hotel Sacher" }, checkinTime: "2026-12-01T15:00" }]),
    );
    expect(hotel).toMatchObject({ travel: { kind: "hotel", to: "Hotel Sacher", startsAt: "2026-12-01T15:00" } });
  });

  it("ignores broken or unrelated markup", () => {
    expect(fromSchemaOrg(`<script type="application/ld+json">{ not json</script>`)).toBe(null);
    expect(fromSchemaOrg(html({ "@type": "Organization", name: "Shop" }))).toBe(null);
    expect(fromSchemaOrg(null)).toBe(null);
  });
});

describe("emailText", () => {
  it("keeps table structure and tracking links, drops the rest", () => {
    const text = emailText(
      `<style>p{color:red}</style><table><tr><td>Sluchátka</td><td>8&nbsp;990 Kč</td></tr></table><p>Sledujte <a href="https://ppl.cz/track/1">zásilku</a> nebo <a href="https://shop.cz/promo">akce</a>.</p>`,
      null,
    );
    expect(text).toContain("Sluchátka 8 990 Kč");
    expect(text).toContain("zásilku (https://ppl.cz/track/1)");
    expect(text).not.toContain("shop.cz/promo");
    expect(text).not.toContain("color");
  });
});

describe("toExtracted", () => {
  const date = new Date("2026-10-10T12:00:00Z");

  it("maps an order and adds the 14-day return deadline to returnable deliveries", () => {
    const out = toExtracted(
      {
        ...none,
        category: "order",
        merchant: "Zalando",
        amount: 2499,
        currency: "czk",
        ref: "10304050",
        order: {
          role: "buyer",
          item: "Mikina",
          status: "delivered",
          carrier: null,
          trackingNumber: null,
          trackingUrl: "not a url",
          expectedAt: null,
          pickupBy: null,
          returnBy: null,
          returnable: true,
        },
      },
      date,
    );
    expect(out).toMatchObject({
      category: "order",
      currency: "CZK",
      order: {
        number: "10304050",
        item: "Mikina",
        role: "buyer",
        status: "delivered",
        trackingUrl: null,
        returnBy: "2026-10-24",
      },
    });
  });

  it("gives no return deadline for something the reader sold", () => {
    const sold = toExtracted(
      {
        ...none,
        category: "order",
        merchant: "Vinted",
        order: {
          role: "seller",
          item: "Šedá mikina s kapucí",
          status: "delivered",
          carrier: "Zásilkovna",
          trackingNumber: null,
          trackingUrl: null,
          expectedAt: null,
          pickupBy: null,
          returnBy: null,
          returnable: true,
        },
      },
      date,
    );
    expect(sold?.order).toMatchObject({ role: "seller", returnBy: null });
  });

  it("keeps whether a bill is the reader's to pay", () => {
    const bill = (toPay: boolean) =>
      toExtracted(
        {
          ...none,
          category: "invoice",
          merchant: "PRE",
          amount: 1250.5,
          currency: "CZK",
          invoice: {
            toPay,
            dueAt: "2026-10-23",
            status: "due",
            variableSymbol: "1234567890",
          },
        },
        date,
      );
    expect(bill(true)?.invoice?.toPay).toBe(true);
    expect(bill(false)?.invoice?.toPay).toBe(false);
  });

  it("keeps a stated deadline and none for groceries", () => {
    const base = { ...none, category: "order" as const, merchant: "Rohlík" };
    const order = {
      role: "buyer" as const,
      item: null,
      status: "delivered" as const,
      carrier: null,
      trackingNumber: null,
      trackingUrl: null,
      expectedAt: null,
      pickupBy: null,
    };
    expect(
      toExtracted(
        {
          ...base,
          order: { ...order, returnBy: "2026-11-01", returnable: true },
        },
        date,
      )?.order?.returnBy,
    ).toBe("2026-11-01");
    expect(toExtracted({ ...base, order: { ...order, returnBy: null, returnable: false } }, date)?.order?.returnBy).toBe(null);
  });

  it("returns nothing for mail that isn't one of the four", () => {
    expect(toExtracted(none, date)).toBe(null);
  });
});

describe("security and reply candidates", () => {
  it("spots account security notices in Czech and English", () => {
    expect(looksLikeSecurity({ subject: "Nové přihlášení k vašemu účtu", text: "" })).toBe(true);
    expect(looksLikeSecurity({ subject: "Security alert", text: "A new sign-in on Windows" })).toBe(true);
    expect(looksLikeSecurity({ subject: "Your password was changed", text: "" })).toBe(true);
    expect(looksLikeSecurity({ subject: "Týdenní newsletter", text: "Novinky z obchodu" })).toBe(false);
  });

  it("takes only what a person asks the reader, not quotes or automated mail", () => {
    const base = { from: { email: "petr@firma.cz" }, toMe: true, personal: true };
    expect(looksLikeAsk({ ...base, text: "Ahoj, můžeš mi poslat tu smlouvu?" })).toBe(true);
    expect(looksLikeAsk({ ...base, text: "Díky, mám to.\n> Můžeš mi poslat tu smlouvu?" })).toBe(false);
    expect(looksLikeAsk({ ...base, toMe: false, text: "Můžeš to poslat?" })).toBe(false);
    expect(looksLikeAsk({ ...base, from: { email: "noreply@shop.cz" }, text: "Can you rate us?" })).toBe(false);
  });

  it("maps the model's answer, and a reply without an ask is nothing", () => {
    const sec = toExtracted(
      { ...none, category: "security", merchant: "Google", security: { kind: "sign_in", device: "Windows", location: "Brno", actionUrl: "javascript:alert(1)" } },
      new Date(),
    );
    expect(sec).toMatchObject({ category: "security", merchant: "Google", security: { kind: "sign_in", actionUrl: null } });
    expect(toExtracted({ ...none, category: "reply", merchant: "Petr", reply: { ask: "poslat smlouvu", dueAt: "2026-10-20" } }, new Date())).toMatchObject({
      category: "reply",
      reply: { ask: "poslat smlouvu", dueAt: "2026-10-20" },
    });
    expect(toExtracted({ ...none, category: "reply", reply: { ask: "", dueAt: null } }, new Date())).toBeNull();
  });
});
