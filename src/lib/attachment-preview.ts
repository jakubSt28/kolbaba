import { officeKind } from "./office-preview";

export { decodeText } from "./office-preview";

/** How the attachment viewer draws a file. */
export type PreviewKind = "image" | "pdf" | "text" | "sheet" | "docx" | "video" | "audio";

export interface Preview {
  kind: PreviewKind;
  /** The type the browser needs on the file to draw or play it; the server sends most files as octet-stream. */
  mime?: string;
}

const starts = (head: Uint8Array, bytes: number[], at = 0) => bytes.every((b, i) => head[at + i] === b);
const ascii = (head: Uint8Array, from: number, to: number) => String.fromCharCode(...head.subarray(from, to));

/** A picture's type from its first bytes: mail often labels a photo "application/octet-stream" or gets its name wrong. */
function imageType(head: Uint8Array): string | null {
  if (starts(head, [0x89, 0x50, 0x4e, 0x47])) return "image/png";
  if (starts(head, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (ascii(head, 0, 4) === "GIF8") return "image/gif";
  if (ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 12) === "WEBP") return "image/webp";
  if (ascii(head, 4, 8) === "ftyp") {
    const brand = ascii(head, 8, 12);
    if (brand === "avif" || brand === "avis") return "image/avif";
    if (["heic", "heix", "hevc", "heim", "heis", "mif1", "msf1"].includes(brand)) return "image/heic";
  }
  return null;
}

const IMAGE_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  heic: "image/heic",
  heif: "image/heic",
  bmp: "image/bmp",
  // Drawn through <img>, where an SVG can neither run script nor load anything.
  svg: "image/svg+xml",
};

const VIDEO: Record<string, string> = { mp4: "video/mp4", m4v: "video/mp4", mov: "video/mp4", webm: "video/webm" };
const AUDIO: Record<string, string> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  wav: "audio/wav",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  flac: "audio/flac",
};
const TEXT = ["txt", "md", "markdown", "log", "json", "xml", "yaml", "yml", "ini", "conf", "cfg", "sql", "vcf"];

/**
 * What the viewer can do with a file, from its name, the type the server sent and its first bytes.
 * The bytes win: a PDF sent as "application/octet-stream" is still a PDF. `null` gets the Download / Share card.
 */
export function detectPreview(name: string, mime: string, head: Uint8Array): Preview | null {
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  const type = mime.split(";")[0].trim().toLowerCase();

  // The header may sit a little into the file (a mail gateway's banner before it).
  if (ascii(head, 0, Math.min(head.length, 1024)).includes("%PDF-") || type === "application/pdf" || ext === "pdf") return { kind: "pdf" };

  const sniffed = imageType(head);
  if (sniffed) return { kind: "image", mime: sniffed };

  const office = officeKind(name);
  if (office) return { kind: office };

  if (IMAGE_BY_EXTENSION[ext]) return { kind: "image", mime: IMAGE_BY_EXTENSION[ext] };
  if (/^image\/(png|jpe?g|gif|webp|avif|heic|heif|bmp)$/.test(type)) return { kind: "image", mime: type };
  if (VIDEO[ext]) return { kind: "video", mime: VIDEO[ext] };
  if (AUDIO[ext]) return { kind: "audio", mime: AUDIO[ext] };

  // Text only when nothing in it looks binary: a ".log" full of zero bytes would draw as garbage.
  if ((type === "text/plain" || TEXT.includes(ext)) && !head.includes(0)) return { kind: "text" };
  return null;
}

/** More than this is slow to lay out as one block of text; the rest is in the downloaded file. */
export const MAX_TEXT_CHARS = 500_000;
