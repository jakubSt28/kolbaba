import { describe, expect, it } from "vitest";
import { hashToken, parseKeyRing, rewrap, seal, unseal } from "./crypto";

const key = (n: number) => Buffer.alloc(32, n).toString("base64");

describe("envelope encryption", () => {
  it("round-trips a secret bound to its row", () => {
    const sealed = seal({ kind: "password", password: "hunter2" }, "acc_1");
    expect(JSON.stringify(sealed)).not.toContain("hunter2");
    expect(unseal(sealed, "acc_1")).toEqual({ kind: "password", password: "hunter2" });
  });

  it("refuses a blob copied onto another row", () => {
    const sealed = seal("secret", "acc_1");
    expect(() => unseal(sealed, "acc_2")).toThrow();
  });

  it("keeps old rows readable after KEK rotation and re-wraps them", () => {
    const oldRing = parseKeyRing(`v1:${key(1)}`);
    const newRing = parseKeyRing(`v1:${key(1)},v2:${key(2)}`);
    const sealed = seal("token", "acc_1", oldRing);
    expect(unseal(sealed, "acc_1", newRing)).toBe("token");
    const rewrapped = rewrap(sealed, "acc_1", newRing);
    expect(rewrapped.kid).toBe("v2");
    expect(rewrapped.data).toBe(sealed.data);
    expect(unseal(rewrapped, "acc_1", parseKeyRing(`v2:${key(2)}`))).toBe("token");
  });

  it("hashes tokens deterministically", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"));
    expect(hashToken("abc")).not.toBe("abc");
  });
});
