import { describe, expect, it } from "vitest";
import { attachmentResponse } from "./attachment-response";
import { attachmentDto } from "./dto";

const disposition = (mime: string) =>
  attachmentResponse({ name: "file", mime, content: Buffer.from("x") }, { download: false, cacheControl: "no-store" }).headers.get("content-disposition");

describe("opening an attachment", () => {
  const meta = { id: "1", name: "file", size: 1 };

  it.each(["application/pdf", "image/png", "image/heic", "text/plain"])("opens %s in a window, because the server shows it inline", (mime) => {
    expect(attachmentDto("msg", { ...meta, mime }).opensInBrowser).toBe(true);
    expect(disposition(mime)).toMatch(/^inline/);
  });

  // A window opened for one of these stays empty: the server answers with a download.
  it.each(["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/zip", "application/octet-stream", "image/svg+xml", "text/html"])(
    "downloads %s without a window",
    (mime) => {
      expect(attachmentDto("msg", { ...meta, mime }).opensInBrowser).toBe(false);
      expect(disposition(mime)).toMatch(/^attachment/);
    },
  );
});
