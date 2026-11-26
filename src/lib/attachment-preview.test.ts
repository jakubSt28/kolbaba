import { describe, expect, it } from "vitest";
import { detectPreview } from "./attachment-preview";

const bytes = (...values: (number | string)[]) =>
  new Uint8Array(values.flatMap((v) => (typeof v === "number" ? [v] : [...v].map((c) => c.charCodeAt(0)))));
const OCTET = "application/octet-stream";

describe("detectPreview", () => {
  it("knows a PDF by its first bytes, whatever the mail called it", () => {
    expect(detectPreview("ticket.pdf", "application/pdf", bytes("%PDF-1.7"))).toEqual({ kind: "pdf" });
    expect(detectPreview("ticket", OCTET, bytes("%PDF-1.4"))).toEqual({ kind: "pdf" });
    expect(detectPreview("scan.bin", OCTET, bytes("\r\n\r\n%PDF-1.4"))).toEqual({ kind: "pdf" });
    // Named a PDF with no header in sight: pdf.js gets to try, and the viewer offers the file if it can't.
    expect(detectPreview("odd.pdf", OCTET, bytes("hello"))).toEqual({ kind: "pdf" });
  });

  it("knows pictures by their first bytes and gives them their real type", () => {
    expect(detectPreview("photo", OCTET, bytes(0xff, 0xd8, 0xff, 0xe0))).toEqual({ kind: "image", mime: "image/jpeg" });
    expect(detectPreview("wrong-name.jpg", OCTET, bytes(0x89, "PNG\r\n"))).toEqual({ kind: "image", mime: "image/png" });
    expect(detectPreview("a.gif", OCTET, bytes("GIF89a"))).toEqual({ kind: "image", mime: "image/gif" });
    expect(detectPreview("a", OCTET, bytes("RIFF", 0, 0, 0, 0, "WEBP"))).toEqual({ kind: "image", mime: "image/webp" });
    expect(detectPreview("IMG_0001.HEIC", OCTET, bytes(0, 0, 0, 0x18, "ftypheic"))).toEqual({ kind: "image", mime: "image/heic" });
    expect(detectPreview("logo.svg", OCTET, bytes("<svg xmlns"))).toEqual({ kind: "image", mime: "image/svg+xml" });
  });

  it("opens spreadsheets and Word documents by name", () => {
    expect(detectPreview("Rozpočet.xlsx", OCTET, bytes("PK", 3, 4))).toEqual({ kind: "sheet" });
    expect(detectPreview("export.csv", "text/plain", bytes("a;b"))).toEqual({ kind: "sheet" });
    expect(detectPreview("smlouva.docx", OCTET, bytes("PK", 3, 4))).toEqual({ kind: "docx" });
  });

  it("plays video and sound", () => {
    expect(detectPreview("clip.MOV", OCTET, bytes(0, 0, 0, 0x14, "ftypqt  "))).toEqual({ kind: "video", mime: "video/mp4" });
    expect(detectPreview("memo.m4a", OCTET, bytes(0, 0, 0, 0x1c, "ftypM4A "))).toEqual({ kind: "audio", mime: "audio/mp4" });
  });

  it("shows text, unless it's binary", () => {
    expect(detectPreview("notes", "text/plain; charset=utf-8", bytes("hello"))).toEqual({ kind: "text" });
    expect(detectPreview("app.log", OCTET, bytes("12:00 started"))).toEqual({ kind: "text" });
    expect(detectPreview("app.log", OCTET, bytes("ab", 0, 0, "cd"))).toBeNull();
  });

  it("leaves the rest to a download", () => {
    expect(detectPreview("archive.zip", OCTET, bytes("PK", 3, 4))).toBeNull();
    expect(detectPreview("page.html", OCTET, bytes("<html>"))).toBeNull();
    expect(detectPreview("old.doc", OCTET, bytes(0xd0, 0xcf, 0x11, 0xe0))).toBeNull();
  });
});
