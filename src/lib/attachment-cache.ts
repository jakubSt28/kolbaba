import { detectPreview, type Preview } from "./attachment-preview";

/**
 * The files of the open attachment viewer, kept while it's open: going back to a file is instant, and the
 * strip of thumbnails and the big picture share one download. Everything is dropped when the viewer closes.
 */

export interface LoadedFile {
  blob: Blob;
  /** How the viewer draws it; `null` when it can't. */
  preview: Preview | null;
}

const files = new Map<string, Promise<LoadedFile>>();
const thumbnails = new Map<string, Promise<string | null>>();
/** Goes up when the viewer closes, so work queued for the old one stops. */
let session = 0;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function download(url: string): Promise<Blob> {
  // The mail server hands the file over on request and now and then drops the first try; one more usually gets it.
  let failure: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await wait(700);
    try {
      const res = await fetch(url);
      if (res.ok) return await res.blob();
      failure = new Error(String(res.status));
      // Not found or signed out: asking again won't change it.
      if (res.status < 500) break;
    } catch (err) {
      failure = err;
    }
  }
  throw failure;
}

export function loadFile(name: string, url: string): Promise<LoadedFile> {
  let file = files.get(url);
  if (!file) {
    file = download(url).then(async (blob) => ({
      blob,
      preview: detectPreview(name, blob.type, new Uint8Array(await blob.slice(0, 1024).arrayBuffer())),
    }));
    files.set(url, file);
    // A failure isn't kept: "Try again" downloads anew.
    file.catch(() => files.get(url) === file && files.delete(url));
  }
  return file;
}

export function clearFiles() {
  session++;
  files.clear();
  thumbnails.clear();
  queue.length = 0;
}

const THUMBNAIL_SIZE = 144;

/** A small square cut from the middle of the picture, as a data URL. `null` when the browser can't draw the picture. */
async function shrink(blob: Blob): Promise<string | null> {
  let source: ImageBitmap | HTMLImageElement;
  let objectUrl: string | undefined;
  try {
    // Decodes straight to a small picture where the browser can; a 12-megapixel photo never sits in memory whole.
    source = await createImageBitmap(blob, { resizeHeight: THUMBNAIL_SIZE * 2, resizeQuality: "medium" });
  } catch {
    try {
      objectUrl = URL.createObjectURL(blob);
      const img = new Image();
      img.src = objectUrl;
      await img.decode();
      source = img;
    } catch {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      return null;
    }
  }
  try {
    const width = "naturalWidth" in source ? source.naturalWidth : source.width;
    const height = "naturalHeight" in source ? source.naturalHeight : source.height;
    const side = Math.min(width, height);
    if (!side) return null;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = THUMBNAIL_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    // White under a see-through picture, like the big view.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, THUMBNAIL_SIZE, THUMBNAIL_SIZE);
    ctx.drawImage(source, (width - side) / 2, (height - side) / 2, side, side, 0, 0, THUMBNAIL_SIZE, THUMBNAIL_SIZE);
    return canvas.toDataURL("image/jpeg", 0.82);
  } catch {
    return null;
  } finally {
    if ("close" in source) source.close();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

// Thumbnails download two at a time: each one is a request to the mail server, and the file being opened goes first.
const queue: (() => Promise<void>)[] = [];
let running = 0;
function pump() {
  while (running < 2 && queue.length) {
    running++;
    void queue.shift()!().finally(() => {
      running--;
      pump();
    });
  }
}

/** A picture's thumbnail for the strip under the viewer. */
export function thumbnail(name: string, url: string): Promise<string | null> {
  let thumb = thumbnails.get(url);
  if (!thumb) {
    const started = session;
    thumb = new Promise<string | null>((resolve) => {
      queue.push(async () => {
        if (started !== session) return resolve(null);
        try {
          const { blob, preview } = await loadFile(name, url);
          resolve(preview?.kind === "image" ? await shrink(new Blob([blob], { type: preview.mime })) : null);
        } catch {
          resolve(null);
        }
      });
      pump();
    });
    thumbnails.set(url, thumb);
  }
  return thumb;
}
