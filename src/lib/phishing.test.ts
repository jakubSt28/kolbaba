import { describe, expect, it } from "vitest";
import { addressInName, nameHidesAddress, splitAddress } from "./phishing";

describe("sender safety", () => {
  it("spots a name that carries another address", () => {
    expect(nameHidesAddress({ name: "service@paypal.com", email: "x@evil.example" })).toBe(true);
    expect(addressInName({ name: "PayPal <service@paypal.com>", email: "x@evil.example" })).toBe("service@paypal.com");
    expect(nameHidesAddress({ name: "petr@firma.cz", email: "Petr@Firma.cz" })).toBe(false);
    expect(nameHidesAddress({ name: "Petr Novák", email: "petr@firma.cz" })).toBe(false);
  });

  it("splits an address so the domain can stand out", () => {
    expect(splitAddress("overeni@neco-jineho.ru")).toEqual(["overeni@", "neco-jineho.ru"]);
    expect(splitAddress("nodomain")).toEqual(["nodomain", ""]);
  });
});
