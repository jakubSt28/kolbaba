import type { ForwardedFiles } from "./types";

/**
 * Forwarding copies the forwarded email's files into the new draft on the server; that takes a moment
 * (they come from the mail server). The composer shows them as uploading meanwhile and holds Send.
 */
export interface ForwardCopy {
  /** What's being copied, for the chips while it runs. */
  files: { name: string }[];
  done: Promise<ForwardedFiles>;
}

const running = new Map<string, ForwardCopy>();

export function trackForwardCopy(draftId: string, copy: ForwardCopy) {
  running.set(draftId, copy);
  copy.done.then(
    () => running.delete(draftId),
    () => running.delete(draftId),
  );
}

export const forwardCopy = (draftId: string) => running.get(draftId);

/** The draft's text with the forwarded pictures pointing at the draft's own copies. */
export function withForwardedImages(html: string, images: ForwardedFiles["images"]) {
  let out = html;
  for (const [from, to] of Object.entries(images)) out = out.split(from).join(to);
  return out;
}
