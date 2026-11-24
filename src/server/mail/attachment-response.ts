import { opensInBrowser } from "@/lib/attachment-inline";
import type { AttachmentContent } from "./types";

const CHUNK = 256 * 1024;

/** An attachment as an HTTP response, for the app's own download route and an agent's download link alike. */
export function attachmentResponse(file: AttachmentContent, { download, cacheControl }: { download: boolean; cacheControl: string }) {
  const filename = encodeURIComponent(file.name || "attachment");
  const inline = opensInBrowser(file.mime);
  const pdf = file.mime.toLowerCase() === "application/pdf";
  const bytes = new Uint8Array(file.content);
  // Streamed, so a big attachment isn't one buffered response body (Vercel caps those at 4.5 MB).
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += CHUNK) controller.enqueue(bytes.subarray(i, i + CHUNK));
      controller.close();
    },
  });
  return new Response(body, {
    headers: {
      "content-type": inline ? file.mime : "application/octet-stream",
      "content-length": String(bytes.length),
      "content-disposition": `${download || !inline ? "attachment" : "inline"}; filename*=UTF-8''${filename}`,
      "cache-control": cacheControl,
      "x-content-type-options": "nosniff",
      // Chrome's PDF viewer won't run under `sandbox` or with plugins off (default-src 'none') and shows a blank
      // page; a PDF can't run script on our origin anyway.
      ...(pdf ? {} : { "content-security-policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox" }),
    },
  });
}
