import { describe, expect, it } from "vitest";
import { parseListUnsubscribe, unsubscribeMethod } from "./unsubscribe";

describe("List-Unsubscribe", () => {
  it("reads both addresses, with the mailto subject", () => {
    expect(parseListUnsubscribe("<mailto:leave-123@lists.example.com?subject=Unsubscribe%20me>, <https://example.com/u?id=1>")).toEqual({
      https: "https://example.com/u?id=1",
      mailto: { to: "leave-123@lists.example.com", subject: "Unsubscribe me", body: "unsubscribe" },
    });
  });

  it("ignores plain http, broken entries and folded whitespace", () => {
    expect(parseListUnsubscribe("<http://example.com/u>, <mailto:not-an-address>")).toEqual({});
    expect(parseListUnsubscribe("<https://example.com/very/\r\n long>")).toEqual({ https: "https://example.com/very/long" });
  });

  it("prefers one click, then email, then the page", () => {
    const both = "<mailto:u@x.cz>, <https://x.cz/u>";
    expect(unsubscribeMethod(both, true)).toBe("one-click");
    expect(unsubscribeMethod(both, false)).toBe("email");
    expect(unsubscribeMethod("<https://x.cz/u>", false)).toBe("page");
    expect(unsubscribeMethod(null, true)).toBeNull();
  });
});
