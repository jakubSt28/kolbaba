import { opensInBrowser } from "@/lib/attachment-inline";
import type { AttachmentContent } from "./types";

/** An attachment as an HTTP response, for the app's own download route and an agent's download link alike. */
export function attachmentResponse(file: AttachmentContent, { download, cacheControl }: { download: boolean; cacheControl: string }) {
  const filename = encodeURIComponent(file.name || "attachment");
  const inline = opensInBrowser(file.mime);
  return new Response(new Uint8Array(file.content), {
    headers: {
      "content-type": inline ? file.mime : "application/octet-stream",
      "content-disposition": `${download || !inline ? "attachment" : "inline"}; filename*=UTF-8''${filename}`,
      "cache-control": cacheControl,
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
    },
  });
}
