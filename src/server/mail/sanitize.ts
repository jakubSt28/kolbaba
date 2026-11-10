import type { ChildNode, Element } from "domhandler";
import { parseDocument } from "htmlparser2";
import sanitizeHtml from "sanitize-html";

/**
 * Incoming mail HTML → HTML that is safe to show, plus text helpers for snippets and search.
 *
 * Assumption: the client renders the result inside a sandboxed `<iframe srcdoc>` without
 * `allow-scripts` / `allow-same-origin`. That is the real XSS boundary; this sanitizer is defence in
 * depth plus privacy (remote images, tracking pixels). Because of the iframe, `<style>` blocks are kept
 * as-is (newsletters depend on them) and are not scoped; they cannot leak into the app's own UI.
 *
 * `htmlparser2` / `domhandler` are not direct dependencies; they resolve from the hoisted copy that
 * `mailparser` → `html-to-text` brings in (v10 / v5). sanitize-html uses its own nested parser.
 */

export interface SanitizeOptions {
  /** Load remote images. When false, remote URLs are moved to `data-blocked-*` attributes. */
  allowRemoteImages: boolean;
  /** Rewrites `cid:` references to a URL serving the inline attachment; null drops the image. */
  cidUrl: (cid: string) => string | null;
  /** Our own read-tracking pixel prefix (e.g. `${APP_URL}/api/t/`); always stripped. */
  ownPixelPrefix?: string;
  /** Keep `<style>` blocks (default true). Off for quoting a message inside a reply. */
  keepStyleBlocks?: boolean;
}

export interface SanitizeResult {
  html: string;
  /** Remote images (and CSS backgrounds) held back because remote content is off. */
  blockedImages: number;
  /** Names of known tracking services whose pixels were removed. */
  trackers: string[];
  /** Hidden images that report an open (known services and unknown 1×1 pixels alike), all removed. */
  spyPixels: number;
  /** Links whose tracking parameters were taken off (see cleanLink). */
  cleanedLinks: number;
}

/* ------------------------------ Link cleaning ------------------------------ */

/**
 * Query parameters that only exist to tell the sender who clicked (newsletter tools, ad networks).
 * Taken off links before anyone clicks; the page they lead to is the same.
 */
const TRACKING_PARAM =
  /^(utm_[a-z_]+|mc_cid|mc_eid|_hsenc|_hsmi|__hssc|__hstc|__hsfp|hsctatracking|fbclid|gclid|dclid|gbraid|wbraid|msclkid|yclid|mkt_tok|_ke|ck_subscriber_id|vero_id|vero_conv|ml_subscriber|ml_subscriber_hash|oly_anon_id|oly_enc_id|wickedid|igshid|_bta_tid|_bta_c|trk_contact|trk_msg|trk_module|trk_sid)$/i;

/** A signed link breaks if its query changes; those are left alone. */
const SIGNED = /(^|[?&])(x-amz-[a-z-]+|signature|sig|hmac|token|expires)=/i;

/**
 * The link without its tracking parameters, or null when there were none. Works on the raw query
 * string, so every other parameter stays byte for byte as it was.
 */
export function cleanLink(href: string): string | null {
  const q = href.indexOf("?");
  if (q < 0 || !/^https?:/i.test(href)) return null;
  const hash = href.indexOf("#", q);
  const query = href.slice(q + 1, hash < 0 ? undefined : hash);
  if (SIGNED.test(`?${query}`)) return null;
  const parts = query.split("&");
  const kept = parts.filter((part) => {
    let key = part.split("=")[0];
    try {
      key = decodeURIComponent(key);
    } catch {
      // Keep the raw key.
    }
    return !TRACKING_PARAM.test(key);
  });
  if (kept.length === parts.length) return null;
  return href.slice(0, q) + (kept.length ? `?${kept.join("&")}` : "") + (hash < 0 ? "" : href.slice(hash));
}

/* -------------------------------- Trackers -------------------------------- */

/**
 * Well-known open-tracking pixels. Matched against the full URL (scheme stripped, lowercased),
 * so patterns can use host + path. Extend freely; order only matters for the reported name.
 */
export const TRACKERS: { name: string; pattern: RegExp }[] = [
  { name: "Mailtrack", pattern: /(^|\.)mailtrack\.io\/|(^|\.)mltrk\.io\// },
  { name: "Mixmax", pattern: /(^|\.)mixmax\.com\/|(^|\.)mixmaxusercontent\.com\// },
  { name: "Superhuman", pattern: /(^|\.)superhuman\.com\// },
  {
    name: "HubSpot",
    pattern:
      /(^|\.)hubspotemail\.net\/|(^|\.)hubspotfree\.net\/|(^|\.)hubspotlinks\.com\/.*\/(e2t|e1t)\/o|track\.hubspot\.com\/|(^|\.)sidekickopen\d*\.com\/|(^|\.)signaux\d*\.com\/|(^|\.)senal\d*\.com\//,
  },
  { name: "SendGrid", pattern: /\/wf\/open\?upn=|(^|\.)sendgrid\.net\/wf\/open/ },
  { name: "Mailchimp", pattern: /list-manage\.com\/track\/open/ },
  { name: "Mandrill", pattern: /mandrillapp\.com\/track\/open/ },
  { name: "Yesware", pattern: /(^|\.)yesware\.com\/(t|trk)\/|t\.yesware\.com\// },
  { name: "Streak", pattern: /mailfoogae\.appspot\.com\/|(^|\.)streak\.com\/.*track/ },
  { name: "Mailgun", pattern: /^email\.[^/]+\/o\/|(^|\.)mailgun\.(org|net)\/.*\/o\// },
  { name: "Postmark", pattern: /(^|\.)pstmrk\.it\/open/ },
  { name: "Amazon SES", pattern: /(^|\.)awstrack\.me\/i0\// },
  { name: "Campaign Monitor", pattern: /(^|\.)(createsend\d*|cmail\d+)\.com\/t\// },
  { name: "Constant Contact", pattern: /(^|\.)rs6\.net\/on\.jsp/ },
  { name: "Salesforce Marketing Cloud", pattern: /(^|\.)exct\.net\/open\.aspx|(^|\.)exacttarget\.com\/.*open/ },
  { name: "Klaviyo", pattern: /(^|\.)klaviyomail\.com\/|(^|\.)klaviyo\.com\/open/ },
  { name: "Brevo", pattern: /(^|\.)sendib[tm]\d*\.com\/|\/tr\/op\// },
  { name: "Mailjet", pattern: /(^|\.)mjt\.lu\/oo?\// },
  { name: "SparkPost", pattern: /(^|\.)spgo\.io\/|\/q\/[^/]+~~\// },
  { name: "Intercom", pattern: /via\.intercom\.io\/o|(^|\.)intercom-mail\.com\/via\/o/ },
  { name: "Customer.io", pattern: /(^|\.)customer\.io\/e\/o\// },
  { name: "Nylas", pattern: /(^|\.)nylas\.com\/open/ },
  { name: "Outreach", pattern: /(^|\.)outrch\.com\/|(^|\.)outreach\.io\/.*open/ },
  { name: "Salesloft", pattern: /(^|\.)salesloft\.com\/.*(open|track)/ },
  { name: "GMass", pattern: /(^|\.)gmass\.co\// },
  { name: "Polymail", pattern: /(^|\.)polymail\.io\// },
  { name: "Boomerang", pattern: /(^|\.)mailstat\.us\/tr/ },
  { name: "Bananatag", pattern: /(^|\.)bl-1\.com\// },
  { name: "ContactMonkey", pattern: /(^|\.)contactmonkey\.com\/.*track/ },
  { name: "Cirrus Insight", pattern: /tracking\.cirrusinsight\.com\// },
  { name: "Litmus", pattern: /(^|\.)emltrk\.com\// },
  { name: "Close", pattern: /(^|\.)close\.(com|io)\/email_opened/ },
  { name: "LinkedIn", pattern: /(^|\.)linkedin\.com\/emimp\// },
  { name: "Facebook", pattern: /(^|\.)facebook\.com\/email_open_log_pic\.php/ },
  { name: "X (Twitter)", pattern: /(^|\.)(twitter|x)\.com\/scribe\/ibis/ },
  { name: "Google Analytics", pattern: /(^|\.)google-analytics\.com\/(r\/)?collect/ },
];

/** Name of the tracking service behind `url`, if it's a known one. */
export function trackerFor(url: string): string | null {
  const bare = url
    .trim()
    .toLowerCase()
    .replace(/^(https?:)?\/\//, "");
  return TRACKERS.find((t) => t.pattern.test(bare))?.name ?? null;
}

/* ------------------------------- Sanitizing -------------------------------- */

const isRemote = (url: string) => /^(https?:)?\/\//i.test(url.trim());
/** Protocol-relative URLs resolve oddly inside srcdoc iframes; pin them to https. */
const absolutize = (url: string) => url.trim().replace(/^\/\//, "https://");
const isDataImage = (url: string) => /^data:image\//i.test(url.trim());

function cidOf(url: string): string | null {
  const m = /^cid:(.+)$/i.exec(url.trim());
  if (!m) return null;
  let cid = m[1].replace(/^<|>$/g, "");
  try {
    cid = decodeURIComponent(cid);
  } catch {
    // Keep the raw value.
  }
  return cid;
}

function px(value: string | undefined): number | null {
  if (value == null) return null;
  const m = /^\s*(\d+(?:\.\d+)?)\s*(px)?\s*$/i.exec(value);
  return m ? Number(m[1]) : null;
}

function styleValue(style: string, prop: string): string | undefined {
  const re = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, "i");
  return re.exec(style)?.[1]?.trim();
}

/** Tiny or hidden images are tracking pixels (or spacers nobody misses). */
function isPixelLike(attribs: Record<string, string>): boolean {
  const style = attribs.style ?? "";
  const w = px(attribs.width) ?? px(styleValue(style, "width"));
  const h = px(attribs.height) ?? px(styleValue(style, "height"));
  if (w === 0 || h === 0) return true;
  if (w != null && h != null && w <= 1 && h <= 1) return true;
  if (/^none\b/i.test(styleValue(style, "display") ?? "")) return true;
  if (/^hidden\b/i.test(styleValue(style, "visibility") ?? "")) return true;
  if (/^0(\.0*)?$/.test(styleValue(style, "opacity") ?? "")) return true;
  return false;
}

/** Decode hex / letter CSS escapes that only serve to obfuscate (`\65 xpression`, `java\script`). */
function deobfuscateCss(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\\([0-9a-f]{1,6})\s?/gi, (all, hex: string) => {
      const ch = String.fromCodePoint(Math.min(parseInt(hex, 16), 0x10ffff));
      return /[a-z0-9:(/.\-]/i.test(ch) ? ch : all;
    })
    .replace(/\\([g-z])/gi, "$1");
}

interface CssContext {
  allowRemote: boolean;
  opts: SanitizeOptions;
  onBlocked: () => void;
  onTracker: (name: string) => void;
}

/**
 * Neutralise dangerous CSS: `@import`, IE `expression()` / `behavior`, `-moz-binding`, script URLs,
 * `position:fixed` overlays. Every `url()` must be data:image, cid: or http(s); remote ones are
 * replaced with `none` when remote content is off, and trackers / our own pixel always are.
 */
function cleanCss(input: string, ctx: CssContext): string {
  let css = deobfuscateCss(input)
    .replace(/@import\b[^;]*;?/gi, "")
    .replace(/expression\s*\(/gi, "invalid(")
    .replace(/(^|[;{\s])(behavior|-moz-binding)\s*:[^;}]*/gi, "$1")
    .replace(/position\s*:\s*fixed/gi, "position:static")
    .replace(/(-webkit-)?image-set\s*\(([^()]|\([^()]*\))*\)/gi, (all) =>
      /(javascript|vbscript):/i.test(all) || (!ctx.allowRemote && /(https?:)?\/\//i.test(all)) ? "none" : all,
    );
  css = css.replace(/url\(\s*(['"]?)([\s\S]*?)\1\s*\)/gi, (_all, _q: string, raw: string) => {
    const url = raw.trim();
    if (isDataImage(url)) return `url("${url.replace(/["\\]/g, "")}")`;
    const cid = cidOf(url);
    if (cid != null) {
      const resolved = ctx.opts.cidUrl(cid);
      return resolved ? `url("${resolved.replace(/["\\]/g, "")}")` : "none";
    }
    if (!isRemote(url)) return "none";
    const abs = absolutize(url);
    if (ctx.opts.ownPixelPrefix && abs.startsWith(ctx.opts.ownPixelPrefix)) return "none";
    const tracker = trackerFor(abs);
    if (tracker) {
      ctx.onTracker(tracker);
      return "none";
    }
    if (!ctx.allowRemote) {
      ctx.onBlocked();
      return "none";
    }
    return `url("${abs.replace(/["\\]/g, "")}")`;
  });
  return css;
}

/** Inside raw-text `<style>`, a literal `<` is the only way to smuggle markup; CSS never needs one. */
const defangStyleText = (css: string) => css.replace(/<!--|-->/g, "").replace(/</g, "\\3c ");

const ALLOWED_TAGS = [
  ...sanitizeHtml.defaults.allowedTags.filter((t) => t !== "style"),
  "img", "font", "center", "big", "strike", "tt", "del", "ins", "style",
];

const COMMON_ATTRS = [
  "style", "class", "id", "align", "valign", "width", "height", "bgcolor", "border", "dir", "lang",
  "title", "role", "colspan", "rowspan", "cellpadding", "cellspacing", "color", "face", "size",
  "data-blocked-style",
];

/** Turn incoming mail HTML into something safe to render (see the module comment for the threat model). */
export function sanitizeIncoming(html: string, opts: SanitizeOptions): SanitizeResult {
  let blockedImages = 0;
  let spyPixels = 0;
  let cleanedLinks = 0;
  const trackers = new Set<string>();
  const keepStyles = opts.keepStyleBlocks ?? true;
  const ctx = (allowRemote: boolean): CssContext => ({
    allowRemote,
    opts,
    onBlocked: () => blockedImages++,
    onTracker: (name) => trackers.add(name),
  });
  // Renaming a void tag trips a sanitize-html bug (stray close tag), so drops are marked by
  // attribs identity and removed in `exclusiveFilter`.
  const dropped = new WeakSet<object>();

  const transform = (tagName: string, input: sanitizeHtml.Attributes): sanitizeHtml.Tag => {
    // Attacker-supplied data-* (e.g. a fake data-blocked-src) must never reach the client.
    const attribs: sanitizeHtml.Attributes = {};
    for (const [k, v] of Object.entries(input)) {
      if (!/^(data-|on)/i.test(k)) attribs[k] = v;
    }

    if (attribs.style != null) {
      const active = cleanCss(attribs.style, ctx(opts.allowRemoteImages));
      if (!opts.allowRemoteImages) {
        const full = cleanCss(attribs.style, { ...ctx(true), onTracker: () => {} });
        if (full !== active) attribs["data-blocked-style"] = full;
      }
      attribs.style = active;
    }

    if (tagName === "img") {
      const src = attribs.src ?? "";
      const cid = cidOf(src);
      if (cid != null) {
        const resolved = opts.cidUrl(cid);
        if (resolved) attribs.src = resolved;
        else delete attribs.src;
      } else if (isRemote(src)) {
        const abs = absolutize(src);
        const tracker = trackerFor(abs);
        if (tracker) trackers.add(tracker);
        const ours = !!opts.ownPixelPrefix && abs.startsWith(opts.ownPixelPrefix);
        if (tracker || isPixelLike(input) || ours) {
          if (!ours) spyPixels++;
          dropped.add(attribs);
          return { tagName, attribs };
        }
        attribs.src = abs;
      } else if (src && !isDataImage(src)) {
        // Relative URLs would hit our own origin from the srcdoc iframe; javascript: etc. are junk.
        delete attribs.src;
      }
      if (!opts.allowRemoteImages) {
        let blocked = false;
        if (attribs.src && isRemote(attribs.src)) {
          attribs["data-blocked-src"] = attribs.src;
          delete attribs.src;
          blocked = true;
        }
        if (attribs.srcset && /(https?:)?\/\//i.test(attribs.srcset)) {
          attribs["data-blocked-srcset"] = attribs.srcset;
          delete attribs.srcset;
          blocked = true;
        }
        if (blocked) blockedImages++;
      }
      return { tagName, attribs };
    }

    if (attribs.background != null) {
      const bg = attribs.background.trim();
      delete attribs.background;
      if (isRemote(bg)) {
        const abs = absolutize(bg);
        const tracker = trackerFor(abs);
        if (tracker) trackers.add(tracker);
        else if (!(opts.ownPixelPrefix && abs.startsWith(opts.ownPixelPrefix))) {
          if (opts.allowRemoteImages) attribs.background = abs;
          else {
            attribs["data-blocked-background"] = abs;
            blockedImages++;
          }
        }
      }
    }

    if (tagName === "a") {
      if (attribs.href) attribs.href = absolutize(attribs.href);
      // Relative links would point into the app (and open outside the sandbox): only real addresses stay.
      if (attribs.href && !/^(https?:|mailto:|tel:)/i.test(attribs.href)) delete attribs.href;
      const clean = attribs.href ? cleanLink(attribs.href) : null;
      if (clean) {
        attribs.href = clean;
        cleanedLinks++;
      }
      attribs.target = "_blank";
      attribs.rel = "noopener noreferrer";
    }

    // Keep the body's colours/background by turning it into a wrapper div.
    if (tagName === "body") return { tagName: "div", attribs };
    return { tagName, attribs };
  };

  const out = sanitizeHtml(html, {
    allowedTags: keepStyles ? ALLOWED_TAGS : ALLOWED_TAGS.filter((t) => t !== "style"),
    allowVulnerableTags: true,
    disallowedTagsMode: "discard",
    nonTextTags: ["script", "style", "textarea", "option", "noscript", "title", "template", "xmp", "iframe", "noembed", "noframes", "object", "select"],
    allowedAttributes: {
      "*": COMMON_ATTRS,
      a: ["href", "name", "target", "rel"],
      img: ["src", "srcset", "alt", "data-blocked-src", "data-blocked-srcset"],
      table: ["background", "data-blocked-background", "summary"],
      td: ["background", "data-blocked-background", "headers", "scope", "nowrap"],
      th: ["background", "data-blocked-background", "headers", "scope", "nowrap"],
      div: ["background", "data-blocked-background"],
      ol: ["start", "type", "reversed"],
      ul: ["type"],
      li: ["value"],
      blockquote: ["cite", "type"],
      col: ["span"],
      colgroup: ["span"],
      style: ["media"],
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    // cid: only survives when `cidUrl` deliberately keeps it (quoting into a reply).
    allowedSchemesByTag: { img: ["http", "https", "data", "cid"] },
    allowProtocolRelative: false,
    transformTags: { "*": transform },
    exclusiveFilter: (frame) => dropped.has(frame.attribs),
  });

  const htmlOut = out.replace(/<style([^>]*)>([\s\S]*?)<\/style>/gi, (_all, attrs: string, css: string) => {
    const cleaned = defangStyleText(cleanCss(css, ctx(opts.allowRemoteImages)));
    return `<style${attrs}>${cleaned}</style>`;
  });

  return { html: htmlOut, blockedImages, trackers: [...trackers], spyPixels, cleanedLinks };
}

/* --------------------------------- To text --------------------------------- */

export interface TextOptions {
  /** Append "(url)" after link text. */
  linkUrls?: boolean;
  /** Render images as "[alt]". */
  imageAlt?: boolean;
  /** Leave out quoted replies (blockquotes, Gmail/Outlook quote containers). */
  skipQuotes?: boolean;
}

type Block = { text: string; gap: number };
type State = { out: Block[]; inline: string };

const SKIP_TAGS = new Set(["script", "style", "head", "title", "template", "noscript", "iframe", "object", "svg", "math", "select", "textarea", "input"]);
const PARAGRAPH_TAGS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "address", "figure", "dl"]);
const CONTAINER_TAGS = new Set([
  "div", "section", "article", "header", "footer", "main", "nav", "aside", "center", "body", "html",
  "form", "fieldset", "li", "dt", "dd", "figcaption", "caption", "tr", "td", "th", "tbody", "thead", "tfoot",
]);
const QUOTE_CLASSES = /\b(gmail_quote|gmail_extra|moz-cite-prefix|yahoo_quoted|protonmail_quote)\b|divRplyFwdMsg/;

const isEl = (n: ChildNode): n is Element => n.type === "tag" || n.type === "script" || n.type === "style";

function joinBlocks(blocks: Block[], maxGap = 2): string {
  let s = "";
  blocks.forEach((b, i) => {
    if (i > 0) s += "\n".repeat(Math.min(maxGap, Math.max(blocks[i - 1].gap, b.gap)));
    s += b.text;
  });
  return s;
}

function flush(st: State, gap = 1) {
  // A line holding only <br> (Gmail's `<div><br></div>`) is a deliberate blank line.
  const blank = /^[ \n]*\n[ \n]*$/.test(st.inline);
  const text = st.inline
    .split("\n")
    .map((l) => l.replace(/ {2,}/g, " ").trim())
    .join("\n")
    .replace(/^\n+|\n+$/g, "");
  if (text || blank) st.out.push({ text, gap });
  st.inline = "";
}

function sub(nodes: ChildNode[], o: TextOptions, maxGap = 2): string {
  const st: State = { out: [], inline: "" };
  for (const n of nodes) walk(n, st, o);
  flush(st);
  return joinBlocks(st.out, maxGap);
}

function textContent(n: ChildNode): string {
  if (n.type === "text") return n.data;
  if (isEl(n)) return n.children.map(textContent).join("");
  return "";
}

function indent(text: string, marker: string): string {
  const pad = " ".repeat(marker.length);
  return text
    .split("\n")
    .map((l, i) => (i === 0 ? marker + l : l ? pad + l : l))
    .join("\n");
}

function walk(n: ChildNode, st: State, o: TextOptions): void {
  if (n.type === "text") {
    st.inline += n.data.replace(/\u00a0/g, " ").replace(/[ \t\r\n\f]+/g, " ");
    return;
  }
  if (!isEl(n)) return;
  const tag = n.name.toLowerCase();
  if (SKIP_TAGS.has(tag)) return;
  if (o.skipQuotes && (tag === "blockquote" || QUOTE_CLASSES.test(n.attribs.class ?? ""))) return;

  const block = (text: string, gap = 2) => {
    flush(st);
    if (text) st.out.push({ text, gap });
  };

  switch (tag) {
    case "br":
      st.inline += "\n";
      return;
    case "img":
      if (o.imageAlt && n.attribs.alt?.trim()) st.inline += `[${n.attribs.alt.trim()}]`;
      return;
    case "a": {
      const text = sub(n.children, o, 1).replace(/\n+/g, " ");
      const href = (n.attribs.href ?? "").trim();
      const shown = href.replace(/^mailto:/i, "");
      st.inline += text;
      if (o.linkUrls && /^(https?|mailto):/i.test(href) && text && shown !== text.trim()) st.inline += ` (${shown})`;
      return;
    }
    case "hr":
      return block("———");
    case "pre":
      return block(textContent(n).replace(/\u00a0/g, " ").replace(/\n+$/, ""));
    case "blockquote": {
      const inner = sub(n.children, o);
      return block(inner && inner.split("\n").map((l) => (l ? `> ${l}` : ">")).join("\n"));
    }
    case "ul":
    case "ol": {
      const task = n.attribs["data-type"] === "taskList";
      let num = Number.parseInt(n.attribs.start ?? "1", 10);
      if (!Number.isFinite(num)) num = 1;
      const items: string[] = [];
      for (const li of n.children) {
        if (!isEl(li)) continue;
        if (li.name !== "li") {
          const t = sub([li], o, 1);
          if (t) items.push(t);
          continue;
        }
        const marker = task ? (li.attribs["data-checked"] === "true" ? "[x] " : "[ ] ") : tag === "ol" ? `${num++}. ` : "- ";
        const body = sub(task ? li.children.filter((c) => !(isEl(c) && c.name === "label")) : li.children, o, 1);
        items.push(indent(body, marker));
      }
      return block(items.join("\n"));
    }
    case "table": {
      const rows: Element[] = [];
      const collectRows = (el: Element) => {
        for (const c of el.children) {
          if (!isEl(c)) continue;
          if (c.name === "tr") rows.push(c);
          else if (["thead", "tbody", "tfoot"].includes(c.name)) collectRows(c);
        }
      };
      collectRows(n);
      const cells = rows.map((r) => r.children.filter((c): c is Element => isEl(c) && (c.name === "td" || c.name === "th")));
      const layout =
        n.attribs.role === "presentation" ||
        cells.every((r) => r.length <= 1) ||
        rows.some((r) => r.children.some((c) => isEl(c) && hasDescendant(c, "table")));
      if (layout) {
        flush(st);
        for (const c of n.children) walk(c, st, o);
        flush(st);
        return;
      }
      const lines = cells
        .map((r) => r.map((c) => sub(c.children, o, 1).replace(/\s*\n\s*/g, " ")).join(" | "))
        .filter((l) => l.replace(/[|\s]/g, ""));
      return block(lines.join("\n"));
    }
  }

  if (PARAGRAPH_TAGS.has(tag)) return block(sub(n.children, o));
  if (CONTAINER_TAGS.has(tag)) {
    flush(st);
    for (const c of n.children) walk(c, st, o);
    flush(st);
    return;
  }
  for (const c of n.children) walk(c, st, o);
}

function hasDescendant(el: Element, name: string): boolean {
  return el.children.some((c) => isEl(c) && (c.name === name || hasDescendant(c, name)));
}

/** Readable plain text of an HTML body (search index, text alternatives, quoting). */
export function htmlToText(html: string, opts: TextOptions = { linkUrls: true }): string {
  const doc = parseDocument(html);
  return sub(doc.children, opts)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** One-line preview for the message list: no quoted reply, no URLs. */
export function snippetFromHtml(html: string, max = 200): string {
  const text = htmlToText(html, { skipQuotes: true }).replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return (space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd() + "…";
}
