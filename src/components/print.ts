"use client";

import { intlLocale, t } from "@/lib/i18n";
import { LIVE } from "@/lib/live";
import { useMail } from "@/lib/store";
import { track } from "@/lib/usage";
import type { Message, Person, Thread } from "@/lib/types";

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const who = (p: Person) => (p.name && p.name !== p.email ? `${escape(p.name)} &lt;${escape(p.email)}&gt;` : escape(p.email));

function messageBlock(m: Message) {
  const date = new Date(m.date).toLocaleString(intlLocale(), { weekday: "short", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const rows = [
    [t("From"), who(m.from)],
    [t("To"), m.to.map(who).join(", ")],
    ...(m.cc?.length ? [[t("Cc"), m.cc.map(who).join(", ")]] : []),
    [t("Date"), escape(date)],
  ];
  const files = m.attachments?.length ? `<p class="files"><b>${t("Attachments")}:</b> ${m.attachments.map((a) => `${escape(a.name)} (${escape(a.size)})`).join(", ")}</p>` : "";
  return `<section><table class="head">${rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join("")}</table><div class="body">${m.html}</div>${files}</section>`;
}

/**
 * The page that gets printed: the subject, then each email with who, to whom and when, without the
 * app around it. Bodies are the ones already sanitised for the reader; remote images only where the
 * reader showed them too.
 */
function printDocument(thread: Thread) {
  const remote = thread.messages.some((m) => m.remoteImages);
  const csp = `default-src 'none'; img-src 'self' data: blob:${remote ? " https: http:" : ""}; style-src 'unsafe-inline'${remote ? " https:" : ""}; font-src data:`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><title>${escape(thread.subject)}</title>
<style>
html{color:#111;background:#fff}
body{margin:0;font:12pt/1.5 -apple-system,BlinkMacSystemFont,"Inter","Segoe UI",system-ui,sans-serif;overflow-wrap:anywhere}
h1{font-size:18pt;line-height:1.25;margin:0 0 14pt}
section{padding:12pt 0;border-top:1px solid #ccc;break-inside:auto}
table.head{border-collapse:collapse;margin-bottom:10pt;font-size:10pt}
table.head th{text-align:left;font-weight:600;color:#555;padding:0 10pt 1pt 0;vertical-align:top;white-space:nowrap}
table.head td{padding:0 0 1pt}
.body img{max-width:100%;height:auto}
.body table{max-width:100%}
.files{font-size:10pt;color:#555}
@page{margin:16mm}
</style></head><body><h1>${escape(thread.subject)}</h1>${thread.messages.map(messageBlock).join("")}</body></html>`;
}

/**
 * Print a conversation (or save it as a PDF from the print dialog). It goes through a hidden frame of its
 * own: no scripts, so the email can't do anything there, and the browser prints just that page.
 */
export async function printThread(threadId: string) {
  track("print");
  const { loadThread, pushToast } = useMail.getState();
  if (LIVE) await loadThread(threadId);
  const thread = useMail.getState().threads[threadId];
  if (!thread) return;
  if (thread.messages.some((m) => LIVE && !m.bodyLoaded)) {
    pushToast({ message: t("Couldn't load the whole conversation. Try again.") });
    return;
  }
  const frame = document.createElement("iframe");
  // allow-modals lets the print dialog open; without allow-scripts nothing in the email runs.
  frame.setAttribute("sandbox", "allow-same-origin allow-modals");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  frame.srcdoc = printDocument(thread);
  const done = () => setTimeout(() => frame.remove(), 1000);
  frame.addEventListener(
    "load",
    () => {
      const win = frame.contentWindow;
      if (!win) return done();
      win.addEventListener("afterprint", done, { once: true });
      // Pictures are in the page by now (load waits for them); print what's there.
      win.focus();
      win.print();
      // Some browsers never send afterprint; the frame goes anyway after a while.
      setTimeout(() => frame.isConnected && frame.remove(), 60_000);
    },
    { once: true },
  );
  document.body.appendChild(frame);
}
