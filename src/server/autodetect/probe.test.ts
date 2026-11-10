import { describe, expect, it } from "vitest";
import { certificateCovers, certificateNames, isPublicAddress } from "./probe";

describe("isPublicAddress", () => {
  it("accepts public IPv4 and IPv6 addresses", () => {
    // imap.seznam.cz and a Google address: these were wrongly blocked by an IPv4-mapped IPv6 rule
    for (const ip of ["77.75.78.99", "142.250.1.1", "2a02:598:a::78:99", "::ffff:77.75.78.99"]) {
      expect(isPublicAddress(ip), ip).toBe(true);
    }
  });

  it("rejects private, loopback, link-local and mapped private addresses", () => {
    for (const ip of ["10.0.0.1", "127.0.0.1", "169.254.169.254", "192.168.1.10", "172.16.0.5", "100.64.0.1", "::1", "::", "fd00::1", "fe80::1", "::ffff:10.0.0.1", "::ffff:7f00:1"]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
  });

  it("rejects anything that isn't an IP", () => {
    expect(isPublicAddress("imap.seznam.cz")).toBe(false);
  });
});

describe("certificate names", () => {
  it("reads the DNS names, falling back to the common name", () => {
    expect(certificateNames({ subject: { CN: "*.webglobe.com" } as never, subjectaltname: "DNS:*.webglobe.com, DNS:webglobe.com, IP Address:1.2.3.4" })).toEqual([
      "*.webglobe.com",
      "webglobe.com",
    ]);
    expect(certificateNames({ subject: { CN: "Server12.Hosting.cz" } as never, subjectaltname: "" })).toEqual(["server12.hosting.cz"]);
  });

  it("lets a wildcard stand for exactly one label", () => {
    const names = ["*.webglobe.com", "webglobe.com"];
    expect(certificateCovers(names, "mail050.webglobe.com")).toBe(true);
    expect(certificateCovers(names, "WebGlobe.com")).toBe(true);
    expect(certificateCovers(names, "a.b.webglobe.com")).toBe(false);
    expect(certificateCovers(names, "imap.truhlarstvi.example")).toBe(false);
    expect(certificateCovers(names, "evilwebglobe.com")).toBe(false);
  });
});
