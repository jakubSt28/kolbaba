import { describe, expect, it } from "vitest";
import { safeError } from "./log";

describe("safeError", () => {
  it("says where an IMAP connection was lost and what the server said", () => {
    const err = Object.assign(new Error("Connection not available"), { code: "NoConnection", reason: "Too many connections", rejectedFrom: "mailboxLock", path: "INBOX" });
    expect(safeError(err)).toBe('Connection not available (server said "Too many connections"; at mailboxLock "INBOX"; NoConnection)');
  });

  it("adds only what an error carries", () => {
    expect(safeError(new Error("boom"))).toBe("boom");
    expect(safeError(Object.assign(new Error("Connection not available"), { code: "NoConnection", rejectedFrom: "connect" }))).toBe(
      "Connection not available (at connect; NoConnection)",
    );
  });
});
