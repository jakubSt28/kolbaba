import { describe, expect, it } from "vitest";
import { formatClientError, type ClientError } from "./client-errors";

const report: ClientError = {
  where: "page",
  name: "TypeError",
  message: "undefined is not an object (evaluating 'a.messages')",
  stack: "render@https://app.kolbaba.app/_next/static/chunks/abc.js:1:2345\nmap@[native code]",
  path: "/",
  build: "dpl_123",
  app: true,
  viewport: "1000x553",
};

describe("formatClientError", () => {
  it("says where, which build, who and which window, then the error and its code", () => {
    expect(formatClientError(report, { userId: "usr_1", userAgent: "Safari" })).toBe(
      [
        "[client-error] page · build dpl_123 · user usr_1 · app 1000x553 · /",
        "TypeError: undefined is not an object (evaluating 'a.messages')",
        "render@https://app.kolbaba.app/_next/static/chunks/abc.js:1:2345",
        "map@[native code]",
        "UA Safari",
      ].join("\n"),
    );
  });

  it("adds the components it happened in", () => {
    const withComponents = { ...report, stack: undefined, componentStack: "\n    at Sidebar (https://app.kolbaba.app/_next/static/chunks/abc.js:1:99)\n    at aside\n" };
    expect(formatClientError(withComponents, { userId: "usr_1", userAgent: "Safari" }).split("\n").slice(2)).toEqual([
      "components:",
      "at Sidebar (https://app.kolbaba.app/_next/static/chunks/abc.js:1:99)",
      "at aside",
      "UA Safari",
    ]);
  });

  it("doesn't repeat Chrome's first stack line and keeps email addresses out", () => {
    const chrome = { ...report, message: "Bad sender jan.novak@seznam.cz", stack: "TypeError: Bad sender jan.novak@seznam.cz\n    at render (abc.js:1:2)" };
    expect(formatClientError(chrome, { userId: null, userAgent: null }).split("\n")).toEqual([
      "[client-error] page · build dpl_123 · signed out · app 1000x553 · /",
      "TypeError: Bad sender [email]",
      "at render (abc.js:1:2)",
      "UA unknown",
    ]);
  });
});
