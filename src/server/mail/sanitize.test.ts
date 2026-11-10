import { describe, expect, it } from "vitest";
import { cleanLink, htmlToText, sanitizeIncoming, snippetFromHtml, trackerFor, type SanitizeOptions } from "./sanitize";

const OWN = "https://mail.example.com/api/t/";
const opts = (o: Partial<SanitizeOptions> = {}): SanitizeOptions => ({
  allowRemoteImages: true,
  cidUrl: (cid) => (cid === "logo@x" ? `/api/attachments/msg_1/att_1` : null),
  ownPixelPrefix: OWN,
  ...o,
});
const clean = (html: string, o?: Partial<SanitizeOptions>) => sanitizeIncoming(html, opts(o)).html;

describe("sanitizeIncoming: XSS vectors", () => {
  const vectors: [string, RegExp][] = [
    ["<img src=x onerror=alert(1)>", /onerror|alert/],
    ['<a href="javascript:alert(1)">x</a>', /javascript/i],
    ['<a href="JaVaScRiPt:alert(1)">x</a>', /javascript/i],
    ['<a href="java&#x09;script:alert(1)">x</a>', /script:|alert/i],
    ['<a href="&#106;&#97;&#118;&#97;&#115;&#99;&#114;&#105;&#112;&#116;&#58;alert(1)">x</a>', /script:|alert/i],
    ['<a href="vbscript:msgbox(1)">x</a>', /vbscript/i],
    ['<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">x</a>', /data:/],
    ["<svg onload=alert(1)><circle r=1></circle></svg>", /svg|onload|alert/],
    ['<svg><a xlink:href="javascript:alert(1)"><text>x</text></a></svg>', /javascript|xlink/],
    ['<math><mtext><table><mglyph><style><img src=x onerror=alert(1)></style></mglyph></table></mtext></math>', /<img|<math|<mglyph/],
    ['<math href="javascript:alert(1)">x</math>', /javascript|<math/],
    ["<script>alert(1)</script>", /script|alert/],
    ['<iframe src="https://evil.example"></iframe>', /iframe|evil/],
    ['<object data="evil.swf"></object><embed src="evil.swf">', /object|embed|swf/],
    ['<form action="https://evil.example"><input name=pw><button formaction="javascript:alert(1)">Go</button></form>', /<form|<input|<button|formaction|javascript/],
    ['<meta http-equiv="refresh" content="0;url=https://evil.example">', /meta|refresh|evil/],
    ['<base href="https://evil.example/">', /base|evil/],
    ['<link rel="stylesheet" href="https://evil.example/x.css">', /link|evil/],
    ['<div style="background:url(javascript:alert(1))">x</div>', /javascript/],
    ['<div style="width: expression(alert(1))">x</div>', /expression/],
    ['<div style="behavior: url(x.htc); -moz-binding: url(x.xml#x)">x</div>', /behavior|binding/],
    ['<div style="position:fixed;top:0;left:0">overlay</div>', /fixed/],
    ["<style>@import url(https://evil.example/x.css); p{color:red}</style>", /@import|evil/],
    ['<style>p{background:url("javascript:alert(1)")}</style>', /javascript/],
    ["<style>p{width:e\\78 pression(alert(1))}</style>", /pression\(alert/],
    ["<style></style><img src=x onerror=alert(1)></style>", /onerror/],
    ['<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>', /onerror/],
    ['<p data-blocked-src="javascript:alert(1)">x</p>', /javascript/],
    ['<img src="data:text/html,<script>alert(1)</script>">', /data:text|script/],
  ];
  for (const [input, bad] of vectors) {
    it(`neutralises ${input.slice(0, 60)}`, () => {
      expect(clean(input)).not.toMatch(bad);
      expect(clean(input, { allowRemoteImages: false })).not.toMatch(bad);
    });
  }

  it("keeps style blocks (minus dangerous bits) and a CSS color", () => {
    const out = clean("<style>@import 'x.css'; .a{color:red}</style><p class=\"a\">x</p>");
    expect(out).toContain("<style>");
    expect(out).toContain(".a{color:red}");
    expect(out).toContain('class="a"');
  });

  it("can drop style blocks entirely", () => {
    expect(clean("<style>.a{color:red}</style><p>x</p>", { keepStyleBlocks: false })).toBe("<p>x</p>");
  });

  it("drops head/title text and keeps body attributes on a div", () => {
    const out = clean('<html><head><title>Secret title</title></head><body bgcolor="#eee" style="margin:0"><p>Hi</p></body></html>');
    expect(out).not.toContain("Secret title");
    expect(out).toMatch(/<div bgcolor="#eee" style="margin:0"><p>Hi<\/p><\/div>/);
  });

  it("forces links to open in a new tab without referrer", () => {
    const out = clean('<a href="https://example.com" target="_self" rel="opener" onclick="x()">x</a>');
    expect(out).toBe('<a href="https://example.com" target="_blank" rel="noopener noreferrer">x</a>');
  });

  it("keeps only real web, mail and phone links (no paths into the app)", () => {
    expect(clean('<a href="/api/auth/me">x</a>')).toBe('<a target="_blank" rel="noopener noreferrer">x</a>');
    expect(clean('<a href="settings">x</a>')).not.toContain("href");
    expect(clean('<a href="mailto:a@b.cz">x</a>')).toContain('href="mailto:a@b.cz"');
  });

  it("allows data:image in img", () => {
    expect(clean('<img src="data:image/png;base64,iVBORw0KGgo=">')).toContain('src="data:image/png;base64,iVBORw0KGgo="');
  });
});

describe("sanitizeIncoming: images", () => {
  it("rewrites cid: images and drops unknown cids", () => {
    const out = clean('<img src="cid:logo@x" alt="Logo"><img src="cid:missing" alt="M">');
    expect(out).toContain('<img src="/api/attachments/msg_1/att_1" alt="Logo" />');
    expect(out).toContain('<img alt="M" />');
  });

  it("blocks remote images and counts them", () => {
    const r = sanitizeIncoming(
      '<img src="https://cdn.example.com/a.png" srcset="https://cdn.example.com/a@2x.png 2x" width="300" alt="A">' +
        '<img src="//cdn.example.com/b.png" width="300">' +
        '<table background="https://cdn.example.com/bg.png"><tr><td style="background-image:url(https://cdn.example.com/c.png);color:red">x</td></tr></table>' +
        "<style>.hero{background:url('https://cdn.example.com/d.png')}</style>",
      opts({ allowRemoteImages: false }),
    );
    expect(r.blockedImages).toBe(5);
    expect(r.html).not.toMatch(/\ssrc="https?:|\ssrcset=|\sbackground="|url\("?https/);
    expect(r.html).toContain('data-blocked-src="https://cdn.example.com/a.png"');
    expect(r.html).toContain('data-blocked-srcset="https://cdn.example.com/a@2x.png 2x"');
    expect(r.html).toContain('data-blocked-src="https://cdn.example.com/b.png"');
    expect(r.html).toContain('data-blocked-background="https://cdn.example.com/bg.png"');
    expect(r.html).toMatch(/style="background-image:none;color:red"/);
    expect(r.html).toContain('data-blocked-style="background-image:url(&quot;https://cdn.example.com/c.png&quot;);color:red"');
    expect(r.html).toContain(".hero{background:none}");
  });

  it("loads remote images when allowed", () => {
    const r = sanitizeIncoming('<img src="https://cdn.example.com/a.png" width="300">', opts());
    expect(r.blockedImages).toBe(0);
    expect(r.html).toContain('src="https://cdn.example.com/a.png"');
  });

  it("always strips known trackers and reports them", () => {
    const r = sanitizeIncoming(
      '<p>Hi</p><img src="https://mailtrack.io/trace/mail/abc.png?u=1" width="0" height="0">' +
        '<img src="https://u123.ct.sendgrid.net/wf/open?upn=xyz">' +
        '<img src="https://example.us1.list-manage.com/track/open.php?u=1&id=2" width="1" height="1">' +
        '<img src="https://t.hubspotemail.net/e2t/to/abc">' +
        '<img src="https://eu-west-1.awstrack.me/I0/0102/abc">',
      opts(),
    );
    expect(r.html).toBe("<p>Hi</p>");
    expect(r.trackers.sort()).toEqual(["Amazon SES", "HubSpot", "Mailchimp", "Mailtrack", "SendGrid"]);
    expect(r.spyPixels).toBe(5);
  });

  it("strips generic 1×1 / hidden pixels but keeps spacers and real images", () => {
    const r = sanitizeIncoming(
      '<img src="https://x.example/p.gif" width="1" height="1">' +
        '<img src="https://x.example/q.gif" style="display:none">' +
        '<img src="https://x.example/r.gif" width="0">' +
        '<img src="https://x.example/spacer.gif" width="20" height="1">' +
        '<img src="https://x.example/photo.jpg" width="600">',
      opts({ allowRemoteImages: true }),
    );
    const out = r.html;
    // Unknown services' pixels count as spy pixels too (the postcard's counter).
    expect(r.spyPixels).toBe(3);
    expect(out).not.toMatch(/\/[pqr]\.gif/);
    expect(out).toContain("spacer.gif");
    expect(out).toContain("photo.jpg");
  });

  it("strips our own pixel so viewing sent mail doesn't count as an open", () => {
    const r = sanitizeIncoming(`<p>Sent</p><img width="1" height="1" alt="" style="display:block" src="${OWN}abcdefghijklmnopqrstuvwx.gif">`, opts());
    expect(r.html).toBe("<p>Sent</p>");
    expect(r.trackers).toEqual([]);
    expect(r.spyPixels).toBe(0);
  });

  it("identifies trackers by URL", () => {
    expect(trackerFor("https://r.superhuman.com/abc.gif")).toBe("Superhuman");
    expect(trackerFor("https://t.yesware.com/t/abc")).toBe("Yesware");
    expect(trackerFor("https://mailfoogae.appspot.com/t?sender=x")).toBe("Streak");
    expect(trackerFor("https://cdn.example.com/logo.png")).toBeNull();
  });
});

describe("htmlToText / snippetFromHtml", () => {
  it("converts typical incoming HTML", () => {
    const text = htmlToText(
      "<html><head><style>p{}</style><title>T</title></head><body>" +
        "<div>Hi Daniel,</div><div><br></div><div>see <a href=\"https://kolbaba.app\">this</a>&nbsp;now.</div>" +
        "<p>Para</p><ul><li>a</li><li>b</li></ul><script>x()</script></body></html>",
    );
    expect(text).toBe("Hi Daniel,\n\nsee this (https://kolbaba.app) now.\n\nPara\n\n- a\n- b");
  });

  it("flattens layout tables instead of piping them", () => {
    const text = htmlToText(
      '<table role="presentation"><tr><td><table><tr><td>Logo</td></tr></table></td></tr><tr><td><p>Big news</p></td></tr></table>',
    );
    expect(text).toBe("Logo\n\nBig news");
  });

  it("builds a one-line snippet without quotes or URLs", () => {
    const snippet = snippetFromHtml(
      '<div>Sounds good, <a href="https://x.example">link</a>.</div><div class="gmail_quote">On Mon wrote:<blockquote>old text</blockquote></div>',
    );
    expect(snippet).toBe("Sounds good, link.");
    const long = snippetFromHtml(`<p>${"word ".repeat(100)}</p>`, 50);
    expect(long.length).toBeLessThanOrEqual(50);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("link cleaning", () => {
  it("takes tracking parameters off links and keeps the rest as it was", () => {
    expect(cleanLink("https://shop.cz/boty?utm_source=nl&utm_campaign=rijen&id=42&mc_eid=8f3a#top")).toBe("https://shop.cz/boty?id=42#top");
    expect(cleanLink("https://shop.cz/?utm_medium=email")).toBe("https://shop.cz/");
    expect(cleanLink("https://shop.cz/?q=a%2Fb&fbclid=xyz")).toBe("https://shop.cz/?q=a%2Fb");
  });

  it("leaves links without tracking, and signed links, alone", () => {
    expect(cleanLink("https://shop.cz/boty?id=42")).toBeNull();
    expect(cleanLink("https://bucket.s3.amazonaws.com/f.pdf?X-Amz-Signature=abc&utm_source=x")).toBeNull();
    expect(cleanLink("mailto:a@b.cz?subject=utm_source")).toBeNull();
  });

  it("counts what it cleaned in an email", () => {
    const out = sanitizeIncoming('<a href="https://a.cz/?utm_source=x">A</a> <a href="https://b.cz/">B</a>', { allowRemoteImages: false, cidUrl: () => null });
    expect(out.cleanedLinks).toBe(1);
    expect(out.html).toContain('href="https://a.cz/"');
  });
});

