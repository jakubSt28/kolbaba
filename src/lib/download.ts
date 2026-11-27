"use client";

import { t, tn } from "./i18n";
import { useMail } from "./store";
import { uniqueNames, zipParts, type ZipEntry } from "./zip";

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

/**
 * A Home Screen app on iPhone and iPad ignores `download`: it shows the file instead, in a preview with no way
 * back to the app. There the file goes to the share sheet, whose "Save to Files" is the phone's download.
 */
export const downloadsOpenInstead = () => typeof navigator !== "undefined" && (navigator as { standalone?: boolean }).standalone === true;

async function share(files: File[]) {
  try {
    await navigator.share({ files });
  } catch (err) {
    // Fetching the files outlasted the tap, and Safari opens the sheet only from one: a toast offers a fresh tap.
    if ((err as DOMException).name !== "NotAllowedError") return;
    useMail.getState().pushToast({
      message: files.length === 1 ? t("{name} is ready", { name: files[0].name }) : tn(files.length, "{n} file is ready", "{n} files are ready"),
      duration: 0,
      action: { label: t("Save"), run: () => void navigator.share({ files }).catch(() => {}) },
    });
  }
}

const sharable = (files: File[]) => typeof navigator.canShare === "function" && navigator.canShare({ files });

/**
 * One file into the phone or the computer's Downloads. `href` is its address (an attachment with `?download`,
 * or a blob URL); `blob`, when the file is already here, saves fetching it again. Throws when it can't be fetched.
 */
export async function saveFile(name: string, href: string, blob?: Blob) {
  if (!downloadsOpenInstead()) return clickLink(href, name);
  if (!blob) {
    const res = await fetch(href);
    if (!res.ok) throw new Error(`Download failed with ${res.status}`);
    blob = await res.blob();
  }
  const file = new File([blob], name, { type: blob.type || "application/octet-stream" });
  if (!sharable([file])) return clickLink(href, name);
  await share([file]);
}

const failed = () => useMail.getState().pushToast({ message: t("Couldn't download the file. Try again in a moment.") });

/** A download button's own save, with a toast when it fails. */
export function saveWithToast(name: string, href: string, blob?: Blob) {
  saveFile(name, href, blob).catch(failed);
}

/** For a link with `download`: where it would show the file instead, saves it the phone's way. */
export function saveOnPhone(e: { preventDefault(): void }, name: string, href: string) {
  if (!downloadsOpenInstead()) return;
  e.preventDefault();
  saveWithToast(name, href);
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
 *
 * A Home Screen iPhone gets the files themselves in the share sheet instead (Save to Files, Save images):
 * a zip there is a file Photos can't take and Files only shows as an archive.
 */
export async function downloadAll(files: DownloadableFile[], subject: string) {
  if (files.length === 1) return saveFile(files[0].name, `${files[0].url}?download`);
  const blobs: Blob[] = new Array(files.length);
  let next = 0;
  const worker = async () => {
    while (next < files.length) {
      const i = next++;
      const res = await fetch(`${files[i].url}?download`);
      if (!res.ok) throw new Error(`Attachment ${i} failed with ${res.status}`);
      blobs[i] = await res.blob();
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, files.length) }, worker));
  if (downloadsOpenInstead()) {
    const names = uniqueNames(files.map((f) => f.name));
    const list = blobs.map((b, i) => new File([b], names[i], { type: b.type || "application/octet-stream" }));
    if (sharable(list)) return share(list);
  }
  const entries: ZipEntry[] = await Promise.all(blobs.map(async (b, i) => ({ name: files[i].name, data: new Uint8Array(await b.arrayBuffer()) })));
  const zip = new Blob(zipParts(entries), { type: "application/zip" });
  const url = URL.createObjectURL(zip);
  await saveFile(zipName(subject), url, zip);
  // Safari reads the blob after click() returns, so let go of it only later.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
