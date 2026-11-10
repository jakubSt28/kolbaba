import { describe, expect, it } from "vitest";
import { redactSecrets } from "./redact";

describe("secrets before AI", () => {
  it("blanks a sign-in code in the subject and the text", () => {
    const r = redactSecrets("Your verification code is 731204", "Enter 731 204 to sign in. It expires in 10 minutes.");
    expect(r.subject).toBe("Your verification code is [code]");
    expect(r.text).toBe("Enter [code] to sign in. It expires in 10 minutes.");
  });

  it("blanks passwords, card numbers and CVC, and keeps the rest", () => {
    const r = redactSecrets("Welcome", "Vaše heslo je Xy7!abc9. Card 4111 1111 1111 1111, CVV: 123. Order 4111111111111112 ships today.");
    expect(r.text).toContain("heslo je [password]");
    expect(r.text).toContain("Card [card number]");
    expect(r.text).toContain("CVV: [code]");
    // A parcel or order number that isn't next to a card word stays.
    expect(r.text).toContain("4111111111111112");
  });

  it("leaves ordinary mail alone", () => {
    const text = "Faktura 2026-0042 na 1 290 Kč, splatnost 25. 10. 2026, VS 20260042.";
    expect(redactSecrets("Faktura", text).text).toBe(text);
  });
});
