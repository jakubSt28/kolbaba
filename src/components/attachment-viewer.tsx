"use client";

import { ChevronLeft, ChevronRight, Download, LoaderCircle, MessageSquareText, RotateCw, Share, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { t } from "@/lib/i18n";
import type { Attachment } from "@/lib/types";
import { clearFiles, loadFile, thumbnail } from "@/lib/attachment-cache";
import { decodeText, MAX_TEXT_CHARS, type Preview } from "@/lib/attachment-preview";
import { readDocx, readSheets, type Sheet } from "@/lib/office-preview";
import { cn } from "@/lib/utils";
import { ATTACHMENT_ICONS, FileIcon } from "./file-icon";
import { ImageView } from "./image-view";
import { DocxView, SheetView } from "./office-view";
import { PdfView } from "./pdf-view";

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

/** Behind an open file, and the phone's status bar above it (also in globals.css, .top-viewer). Solid: the mail showing through looked like a mistake. */
const VIEWER_BACKGROUND = "#0b0b0c";

const canShareFiles = () =>
  typeof navigator !== "undefined" &&
  typeof navigator.canShare === "function" &&
  navigator.canShare({
    files: [new File([""], "x.txt", { type: "text/plain" })],
  });

/** A file made ready to draw. `null`: Kolbaba has no way to show this kind, and offers the file itself. */
type Shown =
  | { kind: "image" | "video" | "audio"; url: string }
  | { kind: "pdf" }
  | { kind: "text"; text: string; cut: boolean }
  | { kind: "sheet"; sheets: Sheet[] }
  | { kind: "docx"; html: string }
  | null;

type Loaded =
  | { state: "loading" }
  | { state: "error" }
  /** `type` is what the file really is, for the share sheet. `broken`: a kind Kolbaba shows, but this file couldn't be read. */
  | { state: "ready"; blob: Blob; type: string; shown: Shown; broken: boolean };

/** Reads the file into what its kind needs. Throws when the file is damaged; the viewer then offers the file itself. */
async function prepare(name: string, blob: Blob, preview: Preview): Promise<NonNullable<Shown>> {
  switch (preview.kind) {
    case "image":
    case "video":
    case "audio":
      // The server sends most files as "application/octet-stream"; the browser draws and plays by the real type.
      return { kind: preview.kind, url: URL.createObjectURL(new Blob([blob], { type: preview.mime })) };
    case "pdf":
      return { kind: "pdf" };
    case "text": {
      const text = decodeText(new Uint8Array(await blob.arrayBuffer()));
      return { kind: "text", text: text.slice(0, MAX_TEXT_CHARS), cut: text.length > MAX_TEXT_CHARS };
    }
    case "sheet":
      return { kind: "sheet", sheets: await readSheets(await blob.arrayBuffer(), name) };
    case "docx":
      return { kind: "docx", html: await readDocx(await blob.arrayBuffer()) };
  }
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

  // The downloaded files are kept only while the viewer is open.
  useEffect(() => {
    if (!open) clearFiles();
  }, [open]);

  // The browser's bar in the viewer's colour too (Chrome on Android, Safari before iOS 26). The Home Screen
  // app's status bar is #top-edge, which follows .top-viewer below (globals.css).
  useEffect(() => {
    if (!open) return;
    const metas = [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].map((meta) => [meta, meta.content] as const);
    for (const [meta] of metas) meta.content = VIEWER_BACKGROUND;
    return () => {
      for (const [meta, content] of metas) meta.content = content;
    };
  }, [open]);

  const file = files[index];
  return (
    <Dialog.Root open={open && !!file} onOpenChange={(o) => !o && close()}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="top-viewer fixed inset-0 z-[60] data-[state=open]:animate-[fade-in_140ms_ease-out]"
          style={{ background: VIEWER_BACKGROUND }}
        />
        <Dialog.Content
          aria-describedby={undefined}
          data-attachment-viewer=""
          onKeyDown={(e) => {
            // In a video or a recording the arrows seek.
            if ((e.target as HTMLElement).closest?.("video, audio")) return;
            if (e.key === "ArrowLeft" && index > 0) useViewer.setState({ index: index - 1 });
            if (e.key === "ArrowRight" && index < files.length - 1) useViewer.setState({ index: index + 1 });
          }}
          className="fixed inset-0 z-[60] flex flex-col text-white outline-none data-[state=open]:animate-[fade-in_140ms_ease-out]"
        >
          <div className="flex min-h-0 flex-1 flex-col pb-[max(12px,env(safe-area-inset-bottom))]">
            {file && <Viewer key={`${index}-${file.url}`} file={file} index={index} count={files.length} />}
            {files.length > 1 && <Filmstrip files={files} index={index} />}
          </div>
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
  const [touch] = useState(() => matchMedia("(pointer: coarse)").matches);
  const [phone] = useState(() => touch && canShareFiles());

  useEffect(() => {
    if (!file.url) return;
    let objectUrl: string | undefined;
    let cancelled = false;
    (async () => {
      let blob: Blob;
      let preview: Preview | null;
      try {
        ({ blob, preview } = await loadFile(file.name, file.url!));
      } catch {
        if (!cancelled) setLoaded({ state: "error" });
        return;
      }
      let shown: Shown = null;
      try {
        if (preview) shown = await prepare(file.name, blob, preview);
      } catch (err) {
        console.warn("Couldn't read the file for a preview", err);
      }
      if (shown && "url" in shown) objectUrl = shown.url;
      if (cancelled) {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        return;
      }
      const type = preview?.kind === "pdf" ? "application/pdf" : (preview?.mime ?? (blob.type === "application/octet-stream" ? "" : blob.type));
      setLoaded({ state: "ready", blob, type, shown, broken: !!preview && !shown });
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file.url, file.name, attempt]);

  const ready = loaded.state === "ready" ? loaded : null;
  const shown = ready?.shown ?? null;
  /** The file turned out damaged while drawing (a picture this browser can't decode, a PDF with a password). */
  const fail = useCallback(() => setLoaded((l) => (l.state === "ready" ? { ...l, shown: null, broken: true } : l)), []);

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
    void navigator.share({ files: [new File([ready.blob], file.name, { type: ready.type })] }).catch(() => {});
  }, [ready, file.name]);

  const go = (to: number) => useViewer.setState({ index: to });
  const step = useCallback(
    (by: -1 | 1) => {
      const to = index + by;
      if (to < 0 || to >= count) return false;
      useViewer.setState({ index: to });
      return true;
    },
    [index, count],
  );
  // A document fills the window, so arrows over it would cover what you read: the strip and the keys flip those.
  const arrows = count > 1 && !touch && !(shown && ["pdf", "sheet", "docx", "text"].includes(shown.kind));

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
        className="relative flex min-h-0 flex-1 items-center justify-center px-3"
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

        {shown?.kind === "image" && <ImageView url={shown.url} name={file.name} onFail={fail} onClose={close} onStep={step} />}
        {shown?.kind === "pdf" && ready && <PdfView blob={ready.blob} onFail={fail} onBackdrop={close} />}
        {shown?.kind === "video" && <video src={shown.url} controls playsInline onError={fail} className="max-h-full max-w-full rounded-md shadow-2xl" />}
        {shown?.kind === "audio" && (
          <div className="flex w-full max-w-[420px] flex-col items-center gap-4 text-center">
            <FileIcon kind={file.kind} size={64} />
            <p className="text-[15px] font-medium break-all">{file.name}</p>
            <audio src={shown.url} controls onError={fail} className="w-full" />
          </div>
        )}
        {shown?.kind === "text" && (
          <div className="size-full overflow-auto overscroll-contain rounded-lg bg-white p-4 text-black">
            <pre className="text-[13px] leading-relaxed whitespace-pre-wrap">{shown.text}</pre>
            {shown.cut && <p className="mt-4 text-[13px] text-neutral-500">{t("This is the beginning of the file. Download it to see all of it.")}</p>}
          </div>
        )}
        {shown?.kind === "sheet" && <SheetView sheets={shown.sheets} />}
        {shown?.kind === "docx" && <DocxView html={shown.html} />}
        {ready && !shown && (
          <div className="flex max-w-[340px] flex-col items-center gap-3 text-center">
            <FileIcon kind={file.kind} size={64} />
            <p className="text-[15px] font-medium break-all">{file.name}</p>
            <p className="text-[13px] text-white/60">
              {ready.broken
                ? phone
                  ? t("Kolbaba couldn't show this file. Open it in another app or save it.")
                  : t("Kolbaba couldn't show this file. Download it and open it on your computer.")
                : phone
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

        {arrows && (
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

/**
 * Every file of the email in a row under the open one, like Quick Look: pictures as small pictures, the rest
 * as their icon. A click opens the file; the open one is lit and kept in the middle.
 */
function Filmstrip({ files, index }: { files: ViewerFile[]; index: number }) {
  return (
    <div className="no-scrollbar mt-2.5 shrink-0 overflow-x-auto overscroll-contain px-3" role="tablist" aria-label={t("Files")}>
      <div className="mx-auto flex w-max gap-1.5 py-1">
        {files.map((file, i) => (
          <Thumbnail key={`${i}-${file.url}`} file={file} active={i === index} onPick={() => useViewer.setState({ index: i })} />
        ))}
      </div>
    </div>
  );
}

/** The icons' colours on the viewer's dark background. */
const STRIP_TONES: Record<Attachment["kind"], string> = {
  pdf: "text-red-400",
  sheet: "text-emerald-400",
  image: "text-amber-400",
  doc: "text-sky-300",
  zip: "text-white/70",
  calendar: "text-white/70",
};

function Thumbnail({ file, active, onPick }: { file: ViewerFile; active: boolean; onPick: () => void }) {
  const button = useRef<HTMLButtonElement>(null);
  const [picture, setPicture] = useState<string | null>(null);

  // A picture's thumbnail is its whole download, so it starts only when the strip has scrolled it into sight.
  useEffect(() => {
    const el = button.current;
    if (!el || file.kind !== "image" || !file.url) return;
    let gone = false;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      observer.disconnect();
      void thumbnail(file.name, file.url!).then((src) => !gone && setPicture(src));
    });
    observer.observe(el);
    return () => {
      gone = true;
      observer.disconnect();
    };
  }, [file.kind, file.name, file.url]);

  useEffect(() => {
    if (active) button.current?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [active]);

  const Icon = ATTACHMENT_ICONS[file.kind];
  const extension = file.name.includes(".") ? file.name.split(".").pop()!.slice(0, 5) : "";
  return (
    <button
      ref={button}
      role="tab"
      aria-selected={active}
      aria-label={file.name}
      title={file.name}
      onClick={onPick}
      className={cn(
        "relative size-12 shrink-0 overflow-hidden rounded-lg bg-white/10 transition-[opacity,box-shadow,transform] duration-150",
        active ? "opacity-100 ring-2 ring-white" : "opacity-55 hover:opacity-100 active:scale-95",
      )}
    >
      {picture ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={picture} alt="" draggable={false} className="size-full object-cover" />
      ) : (
        <span className="flex size-full flex-col items-center justify-center gap-0.5">
          <Icon size={18} className={STRIP_TONES[file.kind]} />
          {extension && <span className="max-w-full truncate px-0.5 text-[8.5px] leading-none font-semibold tracking-wide text-white/60 uppercase">{extension}</span>}
        </span>
      )}
    </button>
  );
}
