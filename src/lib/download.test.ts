import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadAll, saveFile } from "./download";
import { useMail } from "./store";

describe("saveFile on a Home Screen iPhone", () => {
  const share = vi.fn<(data: { files: File[] }) => Promise<void>>();

  beforeEach(() => {
    share.mockReset().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { standalone: true, canShare: () => true, share });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Blob(["%PDF-1.7"], { type: "application/pdf" }))),
    );
    useMail.setState({ toasts: [] });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("hands the file to the share sheet instead of a link that would only show it", async () => {
    await saveFile("invoice.pdf", "/api/attachments/a1?download");
    expect(share).toHaveBeenCalledOnce();
    const [file] = share.mock.calls[0][0].files;
    expect(file.name).toBe("invoice.pdf");
    expect(file.type).toBe("application/pdf");
    expect(await file.text()).toBe("%PDF-1.7");
  });

  it("uses the file already here without fetching it again", async () => {
    await saveFile("notes.txt", "/api/attachments/a2?download", new Blob(["hi"], { type: "text/plain" }));
    expect(fetch).not.toHaveBeenCalled();
    expect(share.mock.calls[0][0].files[0].type).toBe("text/plain");
  });

  it("offers a fresh tap when the fetch outlasted the first one", async () => {
    share.mockRejectedValueOnce(Object.assign(new Error("no gesture"), { name: "NotAllowedError" }));
    await saveFile("invoice.pdf", "/api/attachments/a1?download");
    const toast = useMail.getState().toasts.at(-1);
    expect(toast?.action).toBeDefined();
    toast!.action!.run();
    expect(share).toHaveBeenCalledTimes(2);
  });

  it("stays quiet when the sheet is dismissed", async () => {
    share.mockRejectedValueOnce(Object.assign(new Error("cancelled"), { name: "AbortError" }));
    await saveFile("invoice.pdf", "/api/attachments/a1?download");
    expect(useMail.getState().toasts).toHaveLength(0);
  });

  it("throws when the file can't be fetched", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 502 })));
    await expect(saveFile("invoice.pdf", "/api/attachments/a1?download")).rejects.toThrow();
    expect(share).not.toHaveBeenCalled();
  });
});

describe("downloadAll on a Home Screen iPhone", () => {
  const share = vi.fn<(data: { files: File[] }) => Promise<void>>();
  const canShare = vi.fn<(data: { files: File[] }) => boolean>(() => true);

  beforeEach(() => {
    share.mockReset().mockResolvedValue(undefined);
    canShare.mockReset().mockReturnValue(true);
    vi.stubGlobal("navigator", { standalone: true, canShare, share });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("photo") ? new Response(new Blob(["jpeg"], { type: "image/jpeg" })) : new Response(new Blob(["%PDF-1.7"], { type: "application/pdf" })),
      ),
    );
    useMail.setState({ toasts: [] });
  });
  afterEach(() => vi.unstubAllGlobals());

  const files = [
    { name: "photo.jpg", url: "/api/attachments/photo" },
    { name: "invoice.pdf", url: "/api/attachments/a1" },
    { name: "invoice.pdf", url: "/api/attachments/a2" },
  ];

  it("hands over the files themselves, not a zip, so photos can go to Photos", async () => {
    await downloadAll(files, "Trip");
    expect(share).toHaveBeenCalledOnce();
    const shared = share.mock.calls[0][0].files;
    expect(shared.map((f) => f.name)).toEqual(["photo.jpg", "invoice.pdf", "invoice (2).pdf"]);
    expect(shared[0].type).toBe("image/jpeg");
  });

  it("offers a fresh tap for all of them when the fetch outlasted the first one", async () => {
    share.mockRejectedValueOnce(Object.assign(new Error("no gesture"), { name: "NotAllowedError" }));
    await downloadAll(files, "Trip");
    const toast = useMail.getState().toasts.at(-1);
    toast!.action!.run();
    expect(share.mock.calls[1][0].files).toHaveLength(3);
  });

  it("falls back to the zip when the files can't be shared", async () => {
    canShare.mockImplementation(({ files }) => files.length === 1 && files[0].name.endsWith(".zip"));
    await downloadAll(files, "Trip");
    expect(share).toHaveBeenCalledOnce();
    expect(share.mock.calls[0][0].files[0].name).toBe("Trip.zip");
  });
});
