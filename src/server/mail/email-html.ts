import type { ChildNode, Element } from "domhandler";
import { parseDocument } from "htmlparser2";
import sanitizeHtml from "sanitize-html";
import { env } from "../env";
import { htmlToText, sanitizeIncoming } from "./sanitize";

/**
 * Composer (TipTap) HTML → email HTML + plain-text alternative.
 *
 * Email clients ignore most CSS: Gmail drops `<style>` in some contexts, old Outlook renders with
 * Word. So every element we emit carries its own inline style, structure stays plain HTML (no
 * table-layout template) and colours are left to the client where possible so dark mode keeps
 * working. The small `<style>` block only improves dark mode where it's supported.
 *
 * The editor HTML is first reduced to an allowlist with sanitize-html (drops scripts, handlers,
 * classes, contenteditable, unknown tags), then re-serialised by hand with email styles. The
 * `data-type` / `data-checked` hints from task lists are used and never emitted.
 */

export interface ToEmailOptions {
  signatureHtml?: string;
  /** Body of the message being replied to; quoted below the reply. */
  quotedHtml?: string;
  /** Attribution line above the quote, e.g. "On 8 Oct 2026, Petr <petr@example.com> wrote:". */
  quoteHeader?: string;
}

const FONT = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono','Courier New',monospace";
const BORDER = "#d0d7de";
/** Outlook (Word) inflates images without an explicit width; cap at a typical reading width. */
const MAX_IMAGE_WIDTH = 600;

const S = {
  p: `margin:0 0 12px;${FONT};font-size:15px;line-height:1.5`,
  h1: `margin:24px 0 12px;${FONT};font-size:24px;line-height:1.25;font-weight:700`,
  h2: `margin:20px 0 10px;${FONT};font-size:20px;line-height:1.3;font-weight:700`,
  h3: `margin:16px 0 8px;${FONT};font-size:17px;line-height:1.35;font-weight:600`,
  list: `margin:0 0 12px;padding:0 0 0 24px;${FONT};font-size:15px;line-height:1.5`,
  nestedList: `margin:4px 0 0;padding:0 0 0 24px`,
  li: `margin:0 0 4px;${FONT};font-size:15px;line-height:1.5`,
  itemP: "margin:4px 0 0",
  tasks: `margin:0 0 12px;${FONT};font-size:15px;line-height:1.5`,
  nestedTasks: "margin:4px 0 0;padding:0 0 0 24px",
  task: `margin:0 0 4px;${FONT};font-size:15px;line-height:1.5`,
  box: "font-family:'Segoe UI Symbol','Apple Symbols','DejaVu Sans',Arial,sans-serif",
  blockquote: `margin:0 0 12px;padding:0 0 0 12px;border-left:3px solid ${BORDER};color:#656d76;${FONT};font-size:15px;line-height:1.5`,
  hr: `border:0;border-top:1px solid ${BORDER};height:0;margin:20px 0`,
  pre: `margin:0 0 12px;padding:12px;background-color:#f6f8fa;color:#1f2328;border-radius:6px;${MONO};font-size:13px;line-height:1.45;white-space:pre-wrap;word-wrap:break-word`,
  code: `${MONO};font-size:0.9em;background-color:#f2f3f5;color:#1f2328;padding:1px 4px;border-radius:4px`,
  a: "color:#2563eb;text-decoration:underline",
  img: "display:block;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;margin:0 0 12px",
  table: `border-collapse:collapse;border:1px solid ${BORDER};margin:0 0 12px`,
  cell: `border:1px solid ${BORDER};padding:6px 10px;${FONT};font-size:14px;line-height:1.45;text-align:left;vertical-align:top`,
  wrapper: `${FONT};font-size:15px;line-height:1.5`,
};

const DARK_CSS =
  ":root{color-scheme:light dark;supported-color-schemes:light dark}" +
  "@media (prefers-color-scheme:dark){" +
  ".pn-code{background-color:#2d2f34!important;color:#e6e6e6!important}" +
  ".pn-muted{color:#a0a6ad!important}" +
  ".pn-link{color:#6ea8fe!important}}";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const escText = (s: string) => esc(s).replace(/ /g, "&nbsp;");

/** Allowlist for what the composer can legitimately produce. */
function cleanEditorHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      "p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "label", "div", "span", "blockquote", "hr",
      "img", "a", "code", "pre", "table", "thead", "tbody", "tfoot", "tr", "th", "td", "strong", "b", "em",
      "i", "s", "strike", "del", "u", "mark", "sub", "sup", "br",
    ],
    allowedAttributes: {
      a: ["href"],
      img: ["src", "alt", "title", "width", "height"],
      ol: ["start", "type"],
      ul: ["data-type"],
      li: ["data-checked", "data-type"],
      th: ["colspan", "rowspan"],
      td: ["colspan", "rowspan"],
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    // blob: previews from the composer must be swapped for cid: by the send pipeline; anything
    // else would show as a broken image, so it's dropped here.
    allowedSchemesByTag: { img: ["http", "https", "cid", "data"] },
    allowProtocolRelative: false,
    disallowedTagsMode: "discard",
  });
}

/** Signatures are shown inside the app as HTML, so they get the composer's allowlist on the way in and out. */
export const cleanSignatureHtml = (html: string) => cleanEditorHtml(html);

const isEl = (n: ChildNode): n is Element => n.type === "tag";
const elements = (nodes: ChildNode[]) => nodes.filter(isEl);

function renderNodes(nodes: ChildNode[]): string {
  return nodes.map(renderNode).join("");
}

/**
 * List items and table cells wrap their text in `<p>`; unwrap the first paragraph so the text sits
 * on the bullet line instead of picking up paragraph margins (Outlook honours them generously).
 */
function renderItemBody(nodes: ChildNode[]): string {
  let first = true;
  return nodes
    .map((n) => {
      if (isEl(n) && n.name === "p") {
        const inner = renderNodes(n.children);
        if (first) {
          first = false;
          return inner;
        }
        return `<p style="${S.itemP}">${inner || "<br>"}</p>`;
      }
      if (isEl(n) && (n.name === "ul" || n.name === "ol")) {
        first = false;
        return renderList(n, true);
      }
      if (n.type === "text" && !n.data.trim()) return "";
      first = false;
      return renderNode(n);
    })
    .join("");
}

function renderList(el: Element, nested: boolean): string {
  if (el.attribs["data-type"] === "taskList") {
    const items = elements(el.children)
      .filter((li) => li.name === "li")
      .map((li) => {
        const checked = li.attribs["data-checked"] === "true";
        const content = elements(li.children).find((c) => c.name === "div");
        const body = renderItemBody(content ? content.children : li.children.filter((c) => !(isEl(c) && c.name === "label")));
        return `<div style="${S.task}"><span style="${S.box}">${checked ? "☑" : "☐"}</span>&nbsp;${body}</div>`;
      });
    return `<div style="${nested ? S.nestedTasks : S.tasks}">${items.join("")}</div>`;
  }
  const tag = el.name === "ol" ? "ol" : "ul";
  let attrs = "";
  if (tag === "ol") {
    const start = Number.parseInt(el.attribs.start ?? "", 10);
    if (Number.isFinite(start) && start !== 1) attrs += ` start="${start}"`;
    if (/^[aAiI]$/.test(el.attribs.type ?? "")) attrs += ` type="${el.attribs.type}"`;
  }
  const items = elements(el.children)
    .filter((li) => li.name === "li")
    .map((li) => `<li style="${S.li}">${renderItemBody(li.children)}</li>`);
  return `<${tag}${attrs} style="${nested ? S.nestedList : S.list}">${items.join("")}</${tag}>`;
}

function renderTable(el: Element): string {
  const rows: string[] = [];
  const visit = (parent: Element) => {
    for (const c of elements(parent.children)) {
      if (c.name === "tr") {
        const cells = elements(c.children)
          .filter((td) => td.name === "td" || td.name === "th")
          .map((td) => {
            let attrs = "";
            for (const a of ["colspan", "rowspan"]) {
              const v = Number.parseInt(td.attribs[a] ?? "", 10);
              if (v > 1) attrs += ` ${a}="${v}"`;
            }
            const weight = td.name === "th" ? ";font-weight:600" : "";
            return `<${td.name}${attrs} align="left" valign="top" style="${S.cell}${weight}">${renderItemBody(td.children) || "&nbsp;"}</${td.name}>`;
          });
        rows.push(`<tr>${cells.join("")}</tr>`);
      } else if (c.name === "thead" || c.name === "tbody" || c.name === "tfoot") {
        visit(c);
      }
    }
  };
  visit(el);
  return `<table border="1" cellpadding="6" cellspacing="0" style="${S.table}"><tbody>${rows.join("")}</tbody></table>`;
}

function renderImage(el: Element): string {
  const src = el.attribs.src;
  // Relative URLs mean nothing in a recipient's inbox.
  if (!src || !/^(https?:|cid:|data:image\/)/i.test(src)) return "";
  let attrs = ` src="${esc(src)}" alt="${esc(el.attribs.alt ?? "")}"`;
  if (el.attribs.title) attrs += ` title="${esc(el.attribs.title)}"`;
  const w = Number.parseInt(el.attribs.width ?? "", 10);
  const h = Number.parseInt(el.attribs.height ?? "", 10);
  if (w > 0) {
    const width = Math.min(w, MAX_IMAGE_WIDTH);
    attrs += ` width="${width}"`;
    if (h > 0) attrs += ` height="${Math.round((h * width) / w)}"`;
  }
  return `<img${attrs} style="${S.img}">`;
}

function renderNode(n: ChildNode): string {
  if (n.type === "text") return escText(n.data);
  if (!isEl(n)) return "";
  const inner = () => renderNodes(n.children);
  switch (n.name) {
    case "p":
      return `<p style="${S.p}">${inner() || "<br>"}</p>`;
    case "h1":
    case "h2":
    case "h3":
      return `<${n.name} style="${S[n.name]}">${inner()}</${n.name}>`;
    case "h4":
    case "h5":
    case "h6":
      return `<h3 style="${S.h3}">${inner()}</h3>`;
    case "ul":
    case "ol":
      return renderList(n, false);
    case "li":
      return `<div style="${S.li}">${renderItemBody(n.children)}</div>`;
    case "blockquote":
      return `<blockquote class="pn-muted" style="${S.blockquote}">${inner()}</blockquote>`;
    case "hr":
      return `<hr style="${S.hr}">`;
    case "pre": {
      // Ignore inner <code> and any marks: a code block is just its text.
      const text = n.children.map(textOf).join("").replace(/\n$/, "");
      return `<pre class="pn-code" style="${S.pre}">${escText(text)}</pre>`;
    }
    case "code":
      return `<code class="pn-code" style="${S.code}">${inner()}</code>`;
    case "a": {
      const href = n.attribs.href;
      return href ? `<a class="pn-link" href="${esc(href)}" style="${S.a}">${inner()}</a>` : inner();
    }
    case "img":
      return renderImage(n);
    case "table":
      return renderTable(n);
    case "br":
      return "<br>";
    case "strong":
    case "b":
      return `<strong style="font-weight:700">${inner()}</strong>`;
    case "em":
    case "i":
      return `<em style="font-style:italic">${inner()}</em>`;
    case "u":
      return `<u style="text-decoration:underline">${inner()}</u>`;
    case "s":
    case "strike":
    case "del":
      return `<s style="text-decoration:line-through">${inner()}</s>`;
    case "mark":
    case "sub":
    case "sup":
      return `<${n.name}>${inner()}</${n.name}>`;
    case "label":
      return "";
    default:
      // div, span and anything else the allowlist let through: keep the content only.
      return inner();
  }
}

function textOf(n: ChildNode): string {
  if (n.type === "text") return n.data;
  if (isEl(n)) return n.name === "br" ? "\n" : n.children.map(textOf).join("");
  return "";
}

function renderEditorHtml(html: string): { html: string; clean: string } {
  const clean = cleanEditorHtml(html);
  return { html: renderNodes(parseDocument(clean).children), clean };
}

/** Build the email bodies for a composed message (reply quote and signature included). */
export function toEmail(editorHtml: string, opts: ToEmailOptions = {}): { html: string; text: string } {
  const body = renderEditorHtml(editorHtml);
  let html = body.html;
  let text = htmlToText(body.clean, { linkUrls: true, imageAlt: true });

  if (opts.signatureHtml?.trim()) {
    const sig = renderEditorHtml(opts.signatureHtml);
    html += `<div class="pn-signature" style="margin:20px 0 0">${sig.html}</div>`;
    text += `\n\n-- \n${htmlToText(sig.clean, { linkUrls: true })}`;
  }

  if (opts.quotedHtml?.trim()) {
    // The original may be any mail: sanitise it like incoming mail, minus its <style> blocks (they
    // would restyle our reply) and minus any read-tracking pixel, ours included.
    const quoted = sanitizeIncoming(opts.quotedHtml, {
      allowRemoteImages: true,
      cidUrl: () => null,
      ownPixelPrefix: `${env.appUrl}/api/t/`,
      keepStyleBlocks: false,
    }).html;
    if (opts.quoteHeader) html += `<div class="pn-muted" style="margin:20px 0 8px;${S.wrapper};color:#656d76">${escText(opts.quoteHeader)}</div>`;
    html += `<blockquote type="cite" style="margin:${opts.quoteHeader ? "0" : "20px 0 0"};padding:0 0 0 12px;border-left:2px solid ${BORDER}">${quoted}</blockquote>`;
    const quotedText = htmlToText(opts.quotedHtml, { linkUrls: true })
      .split("\n")
      .map((l) => (l ? `> ${l}` : ">"))
      .join("\n");
    text += `\n\n${opts.quoteHeader ? `${opts.quoteHeader}\n` : ""}${quotedText}`;
  }

  const doc =
    "<!DOCTYPE html>" +
    '<html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="color-scheme" content="light dark">' +
    '<meta name="supported-color-schemes" content="light dark">' +
    `<style>${DARK_CSS}</style>` +
    `</head><body style="margin:0;padding:0"><div style="${S.wrapper}">${html}</div></body></html>`;

  return { html: doc, text: text.trim() + "\n" };
}
