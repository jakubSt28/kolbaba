import { describe, expect, it } from "vitest";
import { signatureHints } from "./signature-hints";

describe("signature hints", () => {
  it("reads a Czech signature above the quoted reply", () => {
    const text = [
      "Dobrý den,",
      "posílám nabídku na příští měsíc.",
      "",
      "S pozdravem",
      "Jana Dvořáková",
      "obchodní ředitelka | Modrá lípa s.r.o.",
      "+420 777 123 456",
      "www.modralipa.example · https://www.linkedin.com/in/jana-example/",
      "",
      "Dne 12. 10. 2026 v 9:00 Daniel <daniel@seznam.cz> napsal(a):",
      "> Zavolejte mi na 603 999 888",
    ].join("\n");
    expect(signatureHints(text, "jana@modralipa.example")).toEqual({
      phones: ["+420 777 123 456"],
      links: ["https://www.modralipa.example", "https://www.linkedin.com/in/jana-example/"],
      company: "Modrá lípa s.r.o.",
    });
  });

  it("leaves out dates, social networks and numbers in quoted mail", () => {
    const text = "Díky!\nPetr\nhttps://instagram.com/petr\n12. 10. 2026\n\nOn Mon, 12 Oct 2026 at 9:00, Daniel wrote:\n> call 777 000 111";
    expect(signatureHints(text)).toEqual({ phones: [], links: [], company: null });
  });
});
