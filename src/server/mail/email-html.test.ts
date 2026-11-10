import { describe, expect, it } from "vitest";
import { toEmail } from "./email-html";

/** Exactly what the TipTap composer emits for each block type. */
const TASKS =
  '<ul data-type="taskList">' +
  '<li data-checked="true" data-type="taskItem"><label><input type="checkbox" checked="checked"><span></span></label><div><p>Done thing</p></div></li>' +
  '<li data-checked="false" data-type="taskItem"><label><input type="checkbox"><span></span></label><div><p>Open thing</p>' +
  '<ul data-type="taskList"><li data-checked="false" data-type="taskItem"><label><input type="checkbox"><span></span></label><div><p>Sub task</p></div></li></ul>' +
  "</div></li></ul>";

const body = (html: string) => toEmail(html).html.replace(/^[\s\S]*<body[^>]*>|<\/body>[\s\S]*$/g, "");

describe("toEmail html", () => {
  it("wraps in a minimal document with dark-mode support", () => {
    const { html } = toEmail("<p>Hi</p>");
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('<meta name="color-scheme" content="light dark">');
    expect(html).toContain("prefers-color-scheme:dark");
    expect(html).toMatch(/<\/body><\/html>$/);
  });

  it("styles paragraphs and headings inline", () => {
    const out = body("<h1>Title</h1><h2>Sub</h2><h3>Small</h3><p>Text</p><p></p>");
    expect(out).toMatch(/<h1 style="[^"]*font-size:24px[^"]*">Title<\/h1>/);
    expect(out).toMatch(/<h2 style="[^"]*font-size:20px/);
    expect(out).toMatch(/<h3 style="[^"]*font-size:17px/);
    expect(out).toMatch(/<p style="[^"]*font-size:15px;line-height:1.5[^"]*">Text<\/p>/);
    expect(out).toMatch(/<p style="[^"]*"><br><\/p>/);
    expect(out).toContain("-apple-system");
  });

  it("renders bullet and ordered lists with the first paragraph unwrapped", () => {
    const out = body('<ul><li><p>One</p><ul><li><p>Nested</p></li></ul></li></ul><ol start="3"><li><p>Three</p></li></ol>');
    expect(out).toMatch(/<ul style="[^"]*padding:0 0 0 24px[^"]*"><li style="[^"]*">One<ul style="margin:4px 0 0/);
    expect(out).toMatch(/<ol start="3" style="[^"]*"><li style="[^"]*">Three<\/li><\/ol>/);
    expect(out).not.toContain("<p style=\"margin:0 0 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5\">One");
  });

  it("turns task lists into ☐ / ☑ without form elements or data attributes", () => {
    const out = body(TASKS);
    expect(out).toContain("☑</span>&nbsp;Done thing");
    expect(out).toContain("☐</span>&nbsp;Open thing");
    expect(out).toContain("☐</span>&nbsp;Sub task");
    expect(out).not.toMatch(/<input|<label|data-|<ul/);
  });

  it("renders blockquote, hr, code and code blocks", () => {
    const out = body(
      '<blockquote><p>Quoted</p></blockquote><hr><p>Use <code>npm i</code></p><pre><code class="language-ts">const a = 1;\nif (a &lt; 2) {}</code></pre>',
    );
    expect(out).toMatch(/<blockquote class="pn-muted" style="[^"]*border-left:3px solid #d0d7de/);
    expect(out).toMatch(/<hr style="border:0;border-top:1px solid #d0d7de/);
    expect(out).toMatch(/<code class="pn-code" style="font-family:ui-monospace[^"]*">npm i<\/code>/);
    expect(out).toMatch(/<pre class="pn-code" style="[^"]*ui-monospace[^"]*white-space:pre-wrap[^"]*">const a = 1;\nif \(a &lt; 2\) \{\}<\/pre>/);
    expect(out).not.toContain("language-ts");
  });

  it("gives images a capped width attribute and max-width:100%", () => {
    const out = body('<img src="https://example.com/a.png" alt="Chart" width="1200" height="800"><img src="cid:logo@kolbaba" alt="">');
    expect(out).toMatch(/<img src="https:\/\/example.com\/a.png" alt="Chart" width="600" height="400" style="[^"]*max-width:100%/);
    expect(out).toContain('src="cid:logo@kolbaba"');
  });

  it("drops blob: previews and javascript: links", () => {
    const out = body('<img src="blob:http://localhost/abc"><p><a href="javascript:alert(1)">x</a> <a href="https://ok.cz" target="_blank" rel="noopener noreferrer nofollow">ok</a></p>');
    expect(out).not.toContain("blob:");
    expect(out).not.toContain("javascript");
    expect(out).toMatch(/<a class="pn-link" href="https:\/\/ok.cz" style="color:#2563eb;text-decoration:underline">ok<\/a>/);
    expect(out).not.toContain("nofollow");
  });

  it("renders tables with explicit border/cellpadding attributes", () => {
    const out = body(
      '<table style="min-width: 50px"><colgroup><col style="min-width:25px"></colgroup><tbody><tr><th colspan="1" rowspan="1"><p>Name</p></th><th colspan="2" rowspan="1"><p>Role</p></th></tr><tr><td colspan="1" rowspan="1"><p>Petr</p></td><td><p>Dev</p></td></tr></tbody></table>',
    );
    expect(out).toMatch(/<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse/);
    expect(out).toMatch(/<th align="left" valign="top" style="[^"]*font-weight:600">Name<\/th>/);
    expect(out).toContain('<th colspan="2" align="left"');
    expect(out).toMatch(/<td align="left" valign="top" style="[^"]*">Petr<\/td>/);
    expect(out).not.toMatch(/colgroup|min-width/);
  });

  it("keeps inline marks", () => {
    const out = body("<p><strong>b</strong><em>i</em><s>s</s><u>u</u><br>next</p>");
    expect(out).toContain('<strong style="font-weight:700">b</strong>');
    expect(out).toContain('<em style="font-style:italic">i</em>');
    expect(out).toContain('<s style="text-decoration:line-through">s</s>');
    expect(out).toContain('<u style="text-decoration:underline">u</u>');
    expect(out).toContain("<br>next");
  });

  it("strips scripts, handlers, classes and contenteditable", () => {
    const out = body(
      '<p class="x" onclick="evil()" contenteditable="true" data-foo="1">Hi<script>alert(1)</script><img src=x onerror="alert(1)"></p><iframe src="https://evil"></iframe><style>p{}</style>',
    );
    expect(out).not.toMatch(/script|onclick|onerror|contenteditable|data-foo|iframe|class="x"|alert|p\{\}/);
    expect(out).toContain(">Hi</p>");
  });

  it("appends signature and quote; strips our pixel from the quote", () => {
    const { html } = toEmail("<p>Reply</p>", {
      signatureHtml: "<p>Daniel</p>",
      quotedHtml: '<html><head><style>p{color:red}</style></head><body><p>Original</p><img src="http://localhost:3000/api/t/abcdefghijklmnopqrstuv.gif" width="1" height="1"><script>x</script></body></html>',
      quoteHeader: "On Mon, Petr wrote:",
    });
    expect(html).toMatch(/Reply<\/p><div class="pn-signature"[^>]*><p[^>]*>Daniel<\/p><\/div>/);
    expect(html).toContain("On Mon, Petr wrote:");
    expect(html).toMatch(/<blockquote type="cite"[^>]*>[\s\S]*Original/);
    expect(html).not.toContain("/api/t/");
    expect(html).not.toContain("color:red");
    expect(html).not.toContain("<script");
  });
});

describe("toEmail text", () => {
  it("renders every block type as readable plain text", () => {
    const { text } = toEmail(
      "<h1>Title</h1><p>Hello <strong>there</strong>, see <a href=\"https://kolbaba.app/x\">the docs</a> or <a href=\"https://kolbaba.app\">https://kolbaba.app</a>.</p>" +
        '<ul><li><p>One</p><ul><li><p>Nested</p></li></ul></li><li><p>Two</p></li></ul><ol><li><p>First</p></li><li><p>Second</p></li></ol>' +
        TASKS +
        "<blockquote><p>Line one</p><p>Line two</p></blockquote><hr><pre><code>a  =  1\n  b</code></pre>" +
        "<table><tbody><tr><th><p>Name</p></th><th><p>Role</p></th></tr><tr><td><p>Petr</p></td><td><p>Dev</p></td></tr></tbody></table>",
    );
    expect(text).toBe(
      [
        "Title",
        "",
        "Hello there, see the docs (https://kolbaba.app/x) or https://kolbaba.app.",
        "",
        "- One",
        "  - Nested",
        "- Two",
        "",
        "1. First",
        "2. Second",
        "",
        "[x] Done thing",
        "[ ] Open thing",
        "    [ ] Sub task",
        "",
        "> Line one",
        ">",
        "> Line two",
        "",
        "———",
        "",
        "a  =  1",
        "  b",
        "",
        "Name | Role",
        "Petr | Dev",
        "",
      ].join("\n"),
    );
  });

  it("separates the signature with '-- ' and prefixes the quote", () => {
    const { text } = toEmail("<p>Thanks</p>", {
      signatureHtml: "<p>Daniel<br>Kolbaba</p>",
      quotedHtml: "<div>Original</div><div>second</div>",
      quoteHeader: "On Mon, Petr wrote:",
    });
    expect(text).toBe("Thanks\n\n-- \nDaniel\nKolbaba\n\nOn Mon, Petr wrote:\n> Original\n> second\n");
  });
});
