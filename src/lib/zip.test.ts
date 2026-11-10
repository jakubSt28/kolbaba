import { describe, expect, it } from "vitest";
import { crc32, uniqueNames, zipParts } from "./zip";
import { zipName } from "./download";

const bytes = (s: string) => new TextEncoder().encode(s);

function joined(parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) out.set(p, (at += p.length) - p.length);
  return out;
}

describe("zip", () => {
  it("computes the standard CRC-32", () => {
    expect(crc32(bytes("The quick brown fox jumps over the lazy dog"))).toBe(0x414fa339);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it("keeps every file when names repeat, and never makes folders", () => {
    expect(uniqueNames(["a.jpg", "A.jpg", "a.jpg", "notes", "notes", "x/y.pdf", ""])).toEqual([
      "a.jpg",
      "A (2).jpg",
      "a (3).jpg",
      "notes",
      "notes (2)",
      "x_y.pdf",
      "attachment",
    ]);
  });

  it("writes headers a zip reader can walk: entries, sizes, offsets, UTF-8 names", () => {
    const zip = joined(zipParts([
      { name: "Žďárský.txt", data: bytes("ahoj") },
      { name: "b.bin", data: new Uint8Array([1, 2, 3]) },
    ]));
    const view = new DataView(zip.buffer);
    const end = zip.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(2);
    const centralSize = view.getUint32(end + 12, true);
    const centralAt = view.getUint32(end + 16, true);
    expect(centralAt + centralSize).toBe(end);

    let at = centralAt;
    const seen: { name: string; data: string; flags: number }[] = [];
    for (let i = 0; i < 2; i++) {
      expect(view.getUint32(at, true)).toBe(0x02014b50);
      const size = view.getUint32(at + 20, true);
      const nameLength = view.getUint16(at + 28, true);
      const local = view.getUint32(at + 42, true);
      expect(view.getUint32(local, true)).toBe(0x04034b50);
      const dataAt = local + 30 + view.getUint16(local + 26, true);
      const data = zip.slice(dataAt, dataAt + size);
      expect(crc32(data)).toBe(view.getUint32(at + 16, true));
      seen.push({
        name: new TextDecoder().decode(zip.slice(at + 46, at + 46 + nameLength)),
        data: Array.from(data).join(","),
        flags: view.getUint16(at + 8, true),
      });
      at += 46 + nameLength;
    }
    expect(seen).toEqual([
      { name: "Žďárský.txt", data: Array.from(bytes("ahoj")).join(","), flags: 0x0800 },
      { name: "b.bin", data: "1,2,3", flags: 0x0800 },
    ]);
  });

  it("names the zip after the conversation", () => {
    expect(zipName("Re: Screens / 2026")).toBe("Re Screens 2026.zip");
    expect(zipName("   ")).toBe("Attachments.zip");
  });
});
