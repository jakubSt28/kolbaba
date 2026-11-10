import { describe, expect, it } from "vitest";
import { mentionsAttachment } from "./attachment-reminder";

describe("forgotten attachment", () => {
  it("hears the promise in Czech, with or without accents, and in English", () => {
    expect(mentionsAttachment("<p>Dobrý den, v příloze posílám fakturu.</p>")).toBe(true);
    expect(mentionsAttachment("<p>Přikládám smlouvu k podpisu.</p>")).toBe(true);
    expect(mentionsAttachment("<p>prikladam fotky</p>")).toBe(true);
    expect(mentionsAttachment("<p>Posílám přiložený dokument.</p>")).toBe(true);
    expect(mentionsAttachment("<p>Please find the report attached.</p>")).toBe(true);
  });

  it("stays quiet otherwise, and about quoted mail", () => {
    expect(mentionsAttachment("<p>Díky, uvidíme se v pondělí.</p>")).toBe(false);
    expect(mentionsAttachment("<p>Posílám to dál.</p><blockquote><p>V příloze je faktura.</p></blockquote>")).toBe(false);
    expect(mentionsAttachment("<p>I'm attaching no strings to this.</p>")).toBe(true);
  });
});
