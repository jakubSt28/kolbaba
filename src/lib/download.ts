"use client";

import { zipParts, type ZipEntry } from "./zip";

export interface DownloadableFile {
  name: string;
  /** /api/attachments/… */
  url: string;
}

function clickLink(href: string, filename: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
}

/** "Re: Screens / 2026" → "Re Screens 2026.zip": what the zip is called in Downloads. */
export function zipName(subject: string) {
  const clean = subject
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return `${clean || "Attachments"}.zip`;
}

/**
 * Every file in one go: fetched a few at a time (each one is a trip to the mail server), zipped here
 * in the browser and handed to Downloads. A single file just downloads as itself.
 */
export async function downloadAll(files: DownloadableFile[], subject: string) {
  if (files.length === 1) return clickLink(`${files[0].url}?download`, files[0].name);
  const entries: ZipEntry[] = new Array(files.length);
  let next = 0;
  const worker = async () => {
    while (next < files.length) {
      const i = next++;
      const res = await fetch(`${files[i].url}?download`);
      if (!res.ok) throw new Error(`Attachment ${i} failed with ${res.status}`);
      entries[i] = { name: files[i].name, data: new Uint8Array(await res.arrayBuffer()) };
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, files.length) }, worker));
  const url = URL.createObjectURL(new Blob(zipParts(entries), { type: "application/zip" }));
  clickLink(url, zipName(subject));
  // Safari reads the blob after click() returns, so let go of it only later.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
