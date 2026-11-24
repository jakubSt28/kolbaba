"use client";

import { ChevronLeft, ChevronRight, Download, LoaderCircle, MessageSquareText, RotateCw, Share, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useCallback, useEffect, useState } from "react";
import { create } from "zustand";
import { t } from "@/lib/i18n";
import type { Attachment } from "@/lib/types";
import { cn } from "@/lib/utils";
import { FileIcon } from "./file-icon";

/** One file the viewer can show: an attachment of a received email or of a draft. */
export interface ViewerFile {
  name: string;
  size?: string;
  kind: Attachment["kind"];
  url?: string;
  /** Scrolls to the email the file came with (the conversation's list of every file). */
  reveal?: () => void;
}

interface ViewerState {
  files: ViewerFile[];
  index: number;
  open: boolean;
}

const useViewer = create<ViewerState>(() => ({
  files: [],
  index: 0,
  open: false,
}));

/**
 * Opens a file inside Kolbaba instead of a new window. A new window was a dead end in the Home Screen app:
 * it replaced the app with the file and left no way back. `files` are the neighbours you can flip through.
 */
export function openAttachment(files: ViewerFile[], index = 0) {
  if (!files[index]?.url) return;
  useViewer.setState({ files, index, open: true });
}

const close = () => useViewer.setState({ open: false });

const canShareFiles = () =>
  typeof navigator !== "undefined" &&
  typeof navigator.canShare === "function" &&
  navigator.canShare({
    files: [new File([""], "x.txt", { type: "text/plain" })],
  });

type Loaded = { state: "loading" } | { state: "error" } | { state: "ready"; blob: Blob; objectUrl: string; text?: string };

/** What the browser can draw on the page itself; the rest gets a card with Download / Share. */
function previewOf(file: ViewerFile, blob: Blob): "image" | "pdf" | "text" | null {
  const type = blob.type.split(";")[0].toLowerCase();
  if (/^image\/(png|jpe?g|gif|webp|avif|heic|heif)$/.test(type)) return "image";
  if (type === "application/pdf" || file.kind === "pdf") return type === "application/octet-stream" ? null : "pdf";
  if (type === "text/plain") return "text";
  return null;
}

export function AttachmentViewerHost() {
  const { files, index, open } = useViewer();
  // Back (Android button, iPhone edge swipe) closes the viewer instead of leaving the app.
  useEffect(() => {
    if (!open) return;
    history.pushState({ kolbabaViewer: true }, "");
    let popped = false;
    const onPop = () => {
      popped = true;
      close();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      if (!popped && history.state?.kolbabaViewer) history.back();
    };
  }, [open]);

  const file = files[index];
  return (
    <Dialog.Root open={open && !!file} onOpenChange={(o) => !o && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/95 data-[state=open]:animate-[fade-in_140ms_ease-out]" />
        <Dialog.Content
          aria-describedby={undefined}
          data-attachment-viewer=""
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft" && index > 0) useViewer.setState({ index: index - 1 });
            if (e.key === "ArrowRight" && index < files.length - 1) useViewer.setState({ index: index + 1 });
          }}
          className="fixed inset-0 z-[60] flex flex-col text-white outline-none data-[state=open]:animate-[fade-in_140ms_ease-out]"
        >
          {file && <Viewer key={`${index}-${file.url}`} file={file} index={index} count={files.length} />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const roundButton =
  "flex size-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 disabled:opacity-40";

function Viewer({ file, index, count }: { file: ViewerFile; index: number; count: number }) {
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  // Phones hand the file to another app (Files, Word, Numbers…); computers download it.
  const [phone] = useState(() => matchMedia("(pointer: coarse)").matches && canShareFiles());

  useEffect(() => {
    if (!file.url) return;
    let objectUrl: string | undefined;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(file.url!);
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        const text = blob.type.startsWith("text/plain") ? await blob.text() : undefined;
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setLoaded({ state: "ready", blob, objectUrl, text });
      } catch {
        if (!cancelled) setLoaded({ state: "error" });
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file.url, attempt]);

  const ready = loaded.state === "ready" ? loaded : null;
  const kind = ready ? previewOf(file, ready.blob) : null;

  const download = useCallback(() => {
    const a = document.createElement("a");
    a.href = `${file.url}?download`;
    a.download = file.name;
    document.body.append(a);
    a.click();
    a.remove();
  }, [file]);

  // The file is already here, so the share sheet opens straight from the tap (Safari wants that).
  const shareFile = useCallback(() => {
    if (!ready) return;
    const type = ready.blob.type === "application/octet-stream" ? "" : ready.blob.type;
    void navigator.share({ files: [new File([ready.blob], file.name, { type })] }).catch(() => {});
  }, [ready, file.name]);

  const go = (to: number) => useViewer.setState({ index: to });

  return (
    <>
      <header className="flex shrink-0 items-center gap-2 px-3 pt-[max(12px,env(safe-area-inset-top))] pb-3">
        <Dialog.Close aria-label={t("Close")} className={roundButton}>
          <X size={20} />
        </Dialog.Close>
        <div className="min-w-0 flex-1 px-1 text-center">
          <Dialog.Title className="truncate text-[14px] font-medium">{file.name}</Dialog.Title>
          <div className="truncate text-[12px] text-white/60">
            {[file.size, count > 1 ? t("{i} of {n}", { i: index + 1, n: count }) : ""].filter(Boolean).join(" · ")}
          </div>
        </div>
        {file.reveal && (
          <button
            onClick={() => {
              close();
              file.reveal!();
            }}
            aria-label={t("Show in conversation")}
            className="flex h-10 min-w-10 shrink-0 items-center justify-center gap-2 rounded-full bg-white/10 text-[13px] font-medium transition-colors hover:bg-white/20 sm:px-3.5"
          >
            <MessageSquareText size={18} className="sm:hidden" />
            <span className="hidden sm:inline">{t("Show in conversation")}</span>
          </button>
        )}
        {phone && (
          <button onClick={shareFile} disabled={!ready} aria-label={t("Share or save")} className={roundButton}>
            <Share size={18} />
          </button>
        )}
        <button onClick={download} aria-label={t("Download {name}", { name: file.name })} className={roundButton}>
          <Download size={18} />
        </button>
      </header>

      <div
        className="relative flex min-h-0 flex-1 items-center justify-center px-3 pb-[max(12px,env(safe-area-inset-bottom))]"
        // A tap on the dark area around the file closes it, like a photo viewer.
        onClick={(e) => e.target === e.currentTarget && close()}
      >
        {loaded.state === "loading" && <LoaderCircle size={28} className="animate-spin text-white/70" />}

        {loaded.state === "error" && (
          <div className="flex max-w-[320px] flex-col items-center gap-3 text-center">
            <FileIcon kind={file.kind} size={56} />
            <p className="text-[15px] font-medium">{t("Couldn't open {name}", { name: file.name })}</p>
            <p className="text-[13px] text-white/60">{t("The mail server didn't send the file. Try again in a moment.")}</p>
            <button
              onClick={() => {
                setLoaded({ state: "loading" });
                setAttempt((n) => n + 1);
              }}
              className="mt-1 flex h-10 items-center gap-2 rounded-full bg-white px-4 text-[14px] font-medium text-black"
            >
              <RotateCw size={15} /> {t("Try again")}
            </button>
          </div>
        )}

        {ready && kind === "image" && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={ready.objectUrl} alt={file.name} className="max-h-full max-w-full rounded-md object-contain shadow-2xl" />
        )}
        {ready && kind === "pdf" && <iframe src={ready.objectUrl} title={file.name} className="size-full rounded-lg bg-white" />}
        {ready && kind === "text" && (
          <pre className="size-full overflow-auto rounded-lg bg-white p-4 text-[13px] leading-relaxed whitespace-pre-wrap text-black">{ready.text}</pre>
        )}
        {ready && !kind && (
          <div className="flex max-w-[340px] flex-col items-center gap-3 text-center">
            <FileIcon kind={file.kind} size={64} />
            <p className="text-[15px] font-medium break-all">{file.name}</p>
            <p className="text-[13px] text-white/60">
              {phone
                ? t("Kolbaba can't show this kind of file. Open it in another app or save it.")
                : t("Kolbaba can't show this kind of file. Download it and open it on your computer.")}
            </p>
            <button
              onClick={phone ? shareFile : download}
              className="mt-1 flex h-10 items-center gap-2 rounded-full bg-white px-4 text-[14px] font-medium text-black"
            >
              {phone ? <Share size={15} /> : <Download size={15} />} {phone ? t("Open in another app") : t("Download")}
            </button>
          </div>
        )}

        {count > 1 && (
          <>
            <button
              onClick={() => go(index - 1)}
              disabled={index === 0}
              aria-label={t("Previous file")}
              className={cn(roundButton, "absolute top-1/2 left-3 -translate-y-1/2 bg-black/50 disabled:invisible")}
            >
              <ChevronLeft size={20} />
            </button>
            <button
              onClick={() => go(index + 1)}
              disabled={index === count - 1}
              aria-label={t("Next file")}
              className={cn(roundButton, "absolute top-1/2 right-3 -translate-y-1/2 bg-black/50 disabled:invisible")}
            >
              <ChevronRight size={20} />
            </button>
          </>
        )}
      </div>
    </>
  );
}
