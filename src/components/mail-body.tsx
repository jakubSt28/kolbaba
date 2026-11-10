"use client";

import { ImageOff } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { t } from "@/lib/i18n";
import { LIVE } from "@/lib/live";
import { keepTextReadable, pinColorScheme } from "@/lib/mail-contrast";
import { useMail } from "@/lib/store";
import { useDarkTheme } from "@/lib/theme";
import type { Message } from "@/lib/types";
import { spring } from "./ui";

/** Newsletters bring their own colours and layout; plain mail should look like the rest of the app. */
const RICH = /<table|bgcolor=|background(-color)?\s*:/i;

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * Real-world HTML mail is rendered in a sandboxed iframe: no scripts, no access to the app, its
 * CSS can't leak into ours. `allow-same-origin` is only there so we can measure and fit it — with
 * scripts disabled the document can't use it. Bodies are already sanitised on the server.
 */
function srcDoc(html: string, rich: boolean, dark: boolean, allowRemote: boolean) {
  // `anywhere` lets a table squeeze a column down to one letter a line (Alza's footer); newsletters expect words to stay whole.
  // Rich mail's own `:root{color-scheme:light dark}` would outrank a plain `html` rule.
  const theme = rich
    ? `html{background:#fff;color:#111;color-scheme:light!important}body{padding:20px;overflow-wrap:break-word}`
    : `html{background:transparent;color:${cssVar("--ink")}!important;color-scheme:light dark}
       a{color:${cssVar("--accent-text")}}
       blockquote{border-left:2px solid ${cssVar("--line")};margin:0 0 .85em;padding-left:12px;color:${cssVar("--ink-2")}}`;
  const csp = `default-src 'none'; img-src 'self' data: blob:${allowRemote ? " https: http:" : ""}; style-src 'unsafe-inline'${allowRemote ? " https:" : ""}; font-src data:${allowRemote ? " https:" : ""}`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><base target="_blank">
<style>
html,body{margin:0}
body{display:flow-root}
body{font:15px/1.6 -apple-system,BlinkMacSystemFont,"Inter","Segoe UI",system-ui,sans-serif;overflow-wrap:anywhere;-webkit-text-size-adjust:100%}
img{max-width:100%;height:auto}
table{max-width:100%}
pre{white-space:pre-wrap}
p{margin:0 0 .85em}
mail-fit{display:block}
${theme}
</style></head><body><mail-fit>${pinColorScheme(html, !rich && dark ? "dark" : "light")}</mail-fit></body></html>`;
}

/**
 * Mail built for a fixed width (Alza's `min-width:600px` table) can't narrow to a phone, so it's
 * shrunk to fit, as Apple Mail does. Its own mobile CSS goes first: media queries still see the
 * frame's real width, and only what overflows after them is scaled. The zoom is on a wrapper so the
 * body, which is measured, keeps plain CSS pixels.
 */
function fitWidth(d: Document) {
  const box = d.querySelector<HTMLElement>("mail-fit");
  if (!box) return;
  box.style.zoom = "";
  const room = box.clientWidth;
  const need = box.scrollWidth;
  if (room > 0 && need > room + 1) box.style.zoom = String(room / need);
}

function SandboxedBody({ html, allowRemote }: { html: string; allowRemote: boolean }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(0);
  const dark = useDarkTheme();
  const rich = RICH.test(html);
  // Theme colours are baked into the document, so rebuild it when the app turns light or dark.
  const doc = useMemo(() => srcDoc(html, rich, dark, allowRemote), [html, rich, dark, allowRemote]);

  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    let observer: ResizeObserver | undefined;
    let raf = 0;
    const measure = () => {
      const d = frame.contentDocument;
      if (!d?.body) return;
      fitWidth(d);
      // Measure the body, not the document: documentElement never reports less than the frame itself.
      setHeight(Math.ceil(d.body.getBoundingClientRect().height));
    };
    const onLoad = () => {
      const body = frame.contentDocument?.body;
      if (body && !rich) keepTextReadable(body, cssVar("--solid"));
      measure();
      if (body) {
        // A new zoom resizes the body; done inside the observer's callback, that would be a resize loop.
        observer = new ResizeObserver(() => {
          cancelAnimationFrame(raf);
          raf = requestAnimationFrame(measure);
        });
        observer.observe(body);
      }
    };
    frame.addEventListener("load", onLoad);
    return () => {
      frame.removeEventListener("load", onLoad);
      observer?.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [doc, rich]);

  return (
    <iframe
      ref={ref}
      title={t("Message")}
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      srcDoc={doc}
      className={rich ? "w-full rounded-xl" : "w-full"}
      style={{ height: height || 80, border: 0, colorScheme: rich ? "light" : "light dark" }}
    />
  );
}

function BodySkeleton({ snippet }: { snippet?: string }) {
  return (
    <div aria-busy className="space-y-2.5">
      {snippet && <p className="text-[15px] leading-relaxed text-ink-3">{snippet}</p>}
      {[92, 100, 76].map((w, i) => (
        <div key={i} className="h-3 animate-pulse rounded-full bg-hover" style={{ width: `${w}%`, animationDelay: `${i * 120}ms` }} />
      ))}
    </div>
  );
}

export function MailBody({ message, threadId }: { message: Message; threadId: string }) {
  const loadThread = useMail((s) => s.loadThread);
  const explainImages = useMail((s) => s.explainImages);
  const [allowing, setAllowing] = useState(false);
  const blocked = (LIVE && message.bodyLoaded && message.blockedImages) || 0;
  // The first email with hidden images on screen says why, once; after that the notice above it does.
  const explain = useMail(
    (s) =>
      blocked > 0 &&
      !s.imagesExplained &&
      !s.loadRemoteImages &&
      !!s.user &&
      s.tabs.some((tab) => tab.id === s.activeTabId && tab.kind === "thread" && tab.threadId === threadId),
  );
  useEffect(() => {
    // Several emails of one conversation can ask at once: the first one opens it.
    if (explain && !useMail.getState().imagesExplained) explainImages();
  }, [explain, explainImages]);

  if (!LIVE) return <div className="mail-body" dangerouslySetInnerHTML={{ __html: message.html }} />;
  if (!message.bodyLoaded) return <BodySkeleton snippet={message.snippet} />;

  return (
    <div>
      {blocked > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={spring}
          className="mb-3 flex items-center gap-2.5 rounded-xl bg-hover px-3 py-2 text-[12.5px] text-ink-2"
        >
          <ImageOff size={14} className="shrink-0 text-ink-3" />
          <button
            title={t("Why are images hidden?")}
            onClick={explainImages}
            className="min-w-0 flex-1 text-left transition-colors hover:text-ink"
          >
            {t("Images hidden to protect your privacy")}
          </button>
          <button
            disabled={allowing}
            onClick={async () => {
              setAllowing(true);
              await loadThread(threadId, { images: true });
              setAllowing(false);
            }}
            className="shrink-0 rounded-lg px-2 py-1 font-medium text-accent-text transition-colors hover:bg-accent-soft disabled:opacity-60"
          >
            {allowing ? t("Loading…") : t("Show images")}
          </button>
        </motion.div>
      )}
      {/* The frame's own CSP follows the server's decision, not the count of images it caught: CSS can hide more. */}
      <SandboxedBody html={message.html} allowRemote={message.remoteImages === true} />
    </div>
  );
}
