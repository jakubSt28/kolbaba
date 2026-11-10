import { tk } from "./i18n";
import { ApiError } from "./live";
import type { DraftAttachment } from "./types";

/** Matches the server: a web function takes at most 4.5 MB per request. */
const CHUNK = 3 * 1024 * 1024;
export const MAX_ATTACHMENTS_BYTES = 25 * 1024 * 1024;

async function sendChunk(method: "POST" | "PATCH", url: string, body: Blob) {
  let res: Response;
  try {
    res = await fetch(url, { method, body, credentials: "same-origin", headers: { "content-type": "application/octet-stream" } });
  } catch {
    throw new ApiError(tk("You're offline. We'll try again when you're back."), 0, "offline");
  }
  const data = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
  if (!res.ok) throw new ApiError(data?.error ?? tk("Something went wrong"), res.status, data?.code);
  return data;
}

/**
 * Uploads a file to a draft in 3 MB chunks. The draft must already exist on the server.
 * `onProgress` gets 0…1 after each chunk.
 */
export async function uploadAttachment(
  draftId: string,
  file: Blob,
  opts: { name: string; inline?: boolean; onProgress?: (fraction: number) => void },
): Promise<DraftAttachment> {
  const base = `/api/drafts/${encodeURIComponent(draftId)}/attachments`;
  const q = new URLSearchParams({ name: opts.name, mime: file.type || "application/octet-stream", size: String(file.size), ...(opts.inline ? { inline: "1" } : {}) });
  const first: DraftAttachment = await sendChunk("POST", `${base}?${q}`, file.slice(0, CHUNK));
  opts.onProgress?.(Math.min(1, CHUNK / file.size));
  for (let offset = CHUNK; offset < file.size; offset += CHUNK) {
    await sendChunk("PATCH", `${base}/${first.id}?offset=${offset}`, file.slice(offset, offset + CHUNK));
    opts.onProgress?.(Math.min(1, (offset + CHUNK) / file.size));
  }
  return first;
}

export async function deleteAttachment(draftId: string, attachmentId: string) {
  await fetch(`/api/drafts/${encodeURIComponent(draftId)}/attachments/${encodeURIComponent(attachmentId)}`, { method: "DELETE", credentials: "same-origin" });
}

export const attachmentPreviewUrl = (draftId: string, attachmentId: string) => `/api/drafts/${draftId}/attachments/${attachmentId}`;

/**
 * Photos pasted into an email are scaled to at most 2000 px and re-encoded as JPEG: a phone photo
 * goes from ~4 MB to a few hundred kB. PNG and GIF (screenshots, animations) stay as they are, and so
 * does anything the browser can't decode (HEIC outside Safari).
 */
export async function shrinkPhoto(file: File): Promise<File> {
  if (!/^image\/(jpeg|webp|heic|heif)$/.test(file.type) || file.size < 800_000) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

export function formatSize(bytes: number, locale: string) {
  return bytes > 1e6
    ? `${(bytes / 1e6).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`
    : `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}
