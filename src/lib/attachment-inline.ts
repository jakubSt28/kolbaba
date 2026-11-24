import type { Attachment } from "./types";

/** Types a browser may render inline; everything else downloads, so a hostile HTML/SVG attachment can't run on our origin. */
const INLINE = /^(image\/(png|jpe?g|gif|webp|avif|heic|heif)|application\/pdf|text\/plain)$/i;

/** The server serves anything else as a download, so a link must not open a window for it: that window would stay empty. */
export const opensInBrowser = (mime: string) => INLINE.test(mime);

/** The icon a file gets, from its name and type. */
export function attachmentKind(name: string, mime: string): Attachment["kind"] {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf" || ext === "pdf") return "pdf";
  if (mime === "text/calendar" || ext === "ics") return "calendar";
  if (/zip|compressed|x-tar|x-7z|rar/.test(mime) || ["zip", "rar", "7z", "gz", "tar"].includes(ext)) return "zip";
  if (/sheet|excel|csv/.test(mime) || ["xls", "xlsx", "csv", "numbers", "ods"].includes(ext)) return "sheet";
  return "doc";
}
