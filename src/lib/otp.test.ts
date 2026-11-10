import { describe, expect, it } from "vitest";
import { findCode, formatCode } from "./otp";

const code = (subject: string, text = "") => findCode(subject, text)?.code ?? null;

describe("findCode", () => {
  it("finds codes in the usual places", () => {
    expect(code("G-482913 is your Google verification code")).toBe("482913");
    expect(code("Your verification code", "Enter 731 204 to continue. It expires in 10 minutes.")).toBe("731204");
    expect(code("Sign in to GitHub", "Your one-time code is 593-021. If you didn't try to sign in, ignore this.")).toBe("593021");
    expect(code("Ověřovací kód", "Váš ověřovací kód pro přihlášení je 4821. Platí 5 minut.")).toBe("4821");
    expect(code("Seznam.cz: kód pro přihlášení", "Kód: 905 112")).toBe("905112");
    expect(code("Slack confirmation code: K7X-2QP"), "letters need to stand alone").toBe(null);
    expect(code("Your Slack code", "Your confirmation code is K7X2QP")).toBe("K7X2QP");
    expect(code("Dein Bestätigungscode", "Bestätigungscode: 662918")).toBe("662918");
  });

  it("takes the number nearest to the code word", () => {
    expect(code("Verify your email", "Hi! Order 2026 is on its way. Your verification code: 118274. Thanks, Team 42")).toBe("118274");
  });

  it("ignores mail that isn't about a code", () => {
    expect(code("Faktura 202611 k úhradě", "Částka 12 450 Kč, splatnost 24. 10. 2026")).toBe(null);
    expect(code("Lunch at 12:30?", "See you at Café 1890, table 4")).toBe(null);
    expect(code("Your order has shipped", "Order #1048213, tracking 00341234567")).toBe(null);
  });

  it("ignores amounts, years, phone and order numbers even next to code words", () => {
    expect(code("Login alert", "New sign in from Prague on 10.10.2026 at 09:41. Not you? Call 800 123 456.")).toBe(null);
    expect(code("Your PIN was changed", "Your new card limit is 5000 Kč.")).toBe(null);
    expect(code("Verification code for order", "Objednávka č. 552301 · your code is in the app")).toBe(null);
  });

  it("skips promo codes", () => {
    expect(code("20 % off everything", "Use code SAVE2026 at checkout")).toBe(null);
    expect(code("Sleva pro vás", "Slevový kód ABC123 platí do neděle")).toBe(null);
  });
});

describe("formatCode", () => {
  it("splits six digits for reading", () => {
    expect(formatCode("482913")).toBe("482 913");
    expect(formatCode("4821")).toBe("4821");
    expect(formatCode("K7X2QP")).toBe("K7X2QP");
  });
});
