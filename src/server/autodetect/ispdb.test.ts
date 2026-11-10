import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fetchClientConfig, parseClientConfig } from "./ispdb";

const seznamXml = readFileSync(new URL("./fixtures/seznam.cz.xml", import.meta.url), "utf8");

describe("parseClientConfig", () => {
  it("reads the Seznam ISPDB entry: IMAP over SSL, SMTP over SSL, placeholders kept", () => {
    expect(parseClientConfig(seznamXml)).toEqual({
      displayName: "Seznam.cz Email",
      imap: { host: "imap.seznam.cz", port: 993, secure: true, username: "%EMAILADDRESS%" },
      smtp: { host: "smtp.seznam.cz", port: 465, secure: true, username: "%EMAILADDRESS%" },
    });
  });

  it("skips POP3 and plaintext servers, maps STARTTLS, tolerates attribute order, comments and entities", () => {
    const xml = `<?xml version="1.0"?>
      <clientConfig version="1.1">
        <emailProvider id="example.cz">
          <displayName>Example &amp; Sons</displayName>
          <incomingServer type="pop3"><hostname>pop.example.cz</hostname><port>995</port><socketType>SSL</socketType></incomingServer>
          <!-- <incomingServer type="imap"><hostname>commented.example.cz</hostname><port>993</port><socketType>SSL</socketType></incomingServer> -->
          <incomingServer type="imap"><hostname>plain.example.cz</hostname><port>143</port><socketType>plain</socketType></incomingServer>
          <incomingServer foo="bar" type='imap'>
            <hostname> Mail.Example.cz </hostname>
            <port>143</port>
            <socketType>STARTTLS</socketType>
            <username>%EMAILLOCALPART%</username>
          </incomingServer>
          <outgoingServer type="smtp"><hostname>smtp.example.cz</hostname><port>587</port><socketType>STARTTLS</socketType></outgoingServer>
        </emailProvider>
      </clientConfig>`;
    expect(parseClientConfig(xml)).toEqual({
      displayName: "Example & Sons",
      imap: { host: "mail.example.cz", port: 143, secure: false, username: "%EMAILLOCALPART%" },
      smtp: { host: "smtp.example.cz", port: 587, secure: false },
    });
  });

  it("rejects documents without a usable IMAP server", () => {
    expect(parseClientConfig("<html>Not found</html>")).toBeNull();
    expect(
      parseClientConfig(
        `<clientConfig><emailProvider><incomingServer type="pop3"><hostname>p</hostname><port>995</port><socketType>SSL</socketType></incomingServer></emailProvider></clientConfig>`,
      ),
    ).toBeNull();
    expect(
      parseClientConfig(
        `<clientConfig><emailProvider><incomingServer type="imap"><hostname>i.x.cz</hostname><port>99999</port><socketType>SSL</socketType></incomingServer></emailProvider></clientConfig>`,
      ),
    ).toBeNull();
  });
});

describe("fetchClientConfig", () => {
  it("returns the parsed config on 200", async () => {
    const result = await fetchClientConfig(async () => new Response(seznamXml), "https://x", 1000);
    expect(result?.imap?.host).toBe("imap.seznam.cz");
  });

  it("treats 404, network errors and timeouts as no answer", async () => {
    expect(await fetchClientConfig(async () => new Response("nope", { status: 404 }), "https://x", 1000)).toBeNull();
    expect(
      await fetchClientConfig(async () => {
        throw new TypeError("fetch failed");
      }, "https://x", 1000),
    ).toBeNull();
    const hanging = (_url: string, { signal }: { signal: AbortSignal }) =>
      new Promise<Response>((_, reject) => signal.addEventListener("abort", () => reject(signal.reason)));
    const started = Date.now();
    expect(await fetchClientConfig(hanging, "https://x", 50)).toBeNull();
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
