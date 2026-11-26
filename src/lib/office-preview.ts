import type { CellObject } from "xlsx";

/**
 * Office files (spreadsheets and Word documents) read in the browser, so the attachment viewer can show them
 * without a download. The parsers are big, so they load only when such a file is opened.
 */

export type OfficeKind = "sheet" | "docx";

const SHEET_EXTENSIONS = ["xlsx", "xlsm", "xlsb", "xls", "ods", "numbers", "csv", "tsv"];

/** Whether the viewer can draw the file as a table or a document; by name, as the server sends them all as octet-stream. */
export function officeKind(name: string): OfficeKind | null {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (SHEET_EXTENSIONS.includes(ext)) return "sheet";
  if (ext === "docx") return "docx";
  return null;
}

/** A cell as shown: its text, numbers aligned right, and how far a merged cell reaches. `null` lies under a merged cell. */
export type SheetCell = { text: string; number?: boolean; rowSpan?: number; colSpan?: number } | null;

export interface Sheet {
  name: string;
  rows: SheetCell[][];
  /** Column widths in pixels, where the file sets them. */
  widths: (number | undefined)[];
  /** The sheet goes on past what we show. */
  cut: boolean;
}

/** A table this size stays quick to draw on a phone; the rest is in the downloaded file. */
export const MAX_ROWS = 1000;
export const MAX_COLS = 100;

/**
 * Text as its author wrote it. A CSV or text file from an older Czech program is often windows-1250;
 * UTF-8 first, as a wrong guess there would garble every letter.
 */
export function decodeText(bytes: Uint8Array) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1250").decode(bytes);
  }
}

export async function readSheets(data: ArrayBuffer, name: string): Promise<Sheet[]> {
  const XLSX = await import("xlsx");
  const ext = name.split(".").pop()?.toLowerCase();
  const opts = { sheetRows: MAX_ROWS + 1, dense: true } as const;
  const book =
    ext === "csv" || ext === "tsv"
      ? XLSX.read(decodeText(new Uint8Array(data)).replace(/^\uFEFF/, ""), { ...opts, type: "string" })
      : XLSX.read(data, { ...opts, type: "array" });

  const hidden = new Set((book.Workbook?.Sheets ?? []).filter((s) => s.Hidden).map((s) => s.name));
  return book.SheetNames.filter((n) => !hidden.has(n)).map((sheetName) => {
    const ws = book.Sheets[sheetName];
    const data = (ws["!data"] ?? []) as (CellObject | undefined)[][];
    const text = (cell: CellObject | undefined) => {
      if (!cell || cell.t === "z") return "";
      if (cell.w != null) return cell.w;
      return cell.v == null ? "" : XLSX.utils.format_cell(cell);
    };

    // The used range often reaches past the data (formatting, deleted rows), so it ends at the last filled cell.
    let lastRow = -1;
    let lastCol = -1;
    data.forEach((row, r) =>
      row?.forEach((cell, c) => {
        if (text(cell) === "") return;
        lastRow = Math.max(lastRow, r);
        lastCol = Math.max(lastCol, c);
      }),
    );
    const merges = (ws["!merges"] ?? []).filter((m) => m.s.r <= lastRow && m.s.c <= lastCol);
    for (const m of merges) {
      lastRow = Math.max(lastRow, Math.min(m.e.r, MAX_ROWS - 1));
      lastCol = Math.max(lastCol, Math.min(m.e.c, MAX_COLS - 1));
    }
    const rowCount = Math.min(lastRow + 1, MAX_ROWS);
    const colCount = Math.min(lastCol + 1, MAX_COLS);

    const rows: SheetCell[][] = Array.from({ length: rowCount }, (_, r) =>
      Array.from({ length: colCount }, (_, c) => {
        const cell = data[r]?.[c];
        return { text: text(cell), number: cell?.t === "n" || cell?.t === "d" || undefined };
      }),
    );
    for (const m of merges) {
      if (m.s.r >= rowCount || m.s.c >= colCount) continue;
      const endR = Math.min(m.e.r, rowCount - 1);
      const endC = Math.min(m.e.c, colCount - 1);
      for (let r = m.s.r; r <= endR; r++) for (let c = m.s.c; c <= endC; c++) rows[r][c] = null;
      const cell = data[m.s.r]?.[m.s.c];
      rows[m.s.r][m.s.c] = {
        text: text(cell),
        number: cell?.t === "n" || undefined,
        rowSpan: endR - m.s.r + 1,
        colSpan: endC - m.s.c + 1,
      };
    }

    const widths = Array.from({ length: colCount }, (_, c) => {
      const col = ws["!cols"]?.[c];
      if (col?.hidden) return 0;
      if (col?.wpx) return Math.round(col.wpx);
      if (col?.wch) return Math.round(col.wch * 7 + 10);
      return undefined;
    });

    return { name: sheetName, rows, widths, cut: lastRow >= MAX_ROWS || data.length > MAX_ROWS || lastCol >= MAX_COLS };
  });
}

/** A column's letters, as Excel names it: A … Z, AA … */
export function columnName(index: number) {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

/** What a Word document is made of once mammoth has turned it into HTML. Everything else is dropped. */
const DOCUMENT_TAGS = new Set(
  "p h1 h2 h3 h4 h5 h6 strong b em i u s sup sub br hr a img table thead tbody tr td th ul ol li blockquote pre code span div".split(" "),
);

/**
 * A Word document as HTML that is safe to put on the page: only a document's own tags, no attribute that
 * could run anything, links only to the web or an email address, and only the pictures stored in the file
 * itself, so opening it can't tell the sender anything.
 */
export async function readDocx(data: ArrayBuffer): Promise<string> {
  const mammoth = (await import("mammoth/mammoth.browser.min.js")).default;
  const { value } = await mammoth.convertToHtml({ arrayBuffer: data });
  const page = new DOMParser().parseFromString(value, "text/html");
  for (const el of page.body.querySelectorAll("*")) {
    const tag = el.tagName.toLowerCase();
    if (!DOCUMENT_TAGS.has(tag)) {
      // An unknown wrapper keeps its text; something that isn't text at all (a script, a frame) goes whole.
      if (/^(script|style|iframe|object|embed|svg|math|template|noscript|link|meta|base|form|input|button|select|textarea)$/.test(tag)) el.remove();
      else el.replaceWith(...el.childNodes);
      continue;
    }
    const href = tag === "a" ? (el.getAttribute("href") ?? "").trim() : "";
    const src = tag === "img" ? (el.getAttribute("src") ?? "") : "";
    const spans = tag === "td" || tag === "th" ? [el.getAttribute("colspan"), el.getAttribute("rowspan")] : [];
    const alt = el.getAttribute("alt");
    for (const name of el.getAttributeNames()) el.removeAttribute(name);
    if (tag === "a" && /^(https?:|mailto:)/i.test(href)) {
      el.setAttribute("href", href);
      el.setAttribute("target", "_blank");
      el.setAttribute("rel", "noopener noreferrer");
    }
    if (tag === "img") {
      if (!/^data:image\/(png|jpe?g|gif|webp|bmp);/i.test(src)) el.remove();
      else {
        el.setAttribute("src", src);
        if (alt) el.setAttribute("alt", alt);
      }
    }
    if (spans[0] && /^\d+$/.test(spans[0])) el.setAttribute("colspan", spans[0]);
    if (spans[1] && /^\d+$/.test(spans[1])) el.setAttribute("rowspan", spans[1]);
  }
  return page.body.innerHTML;
}
