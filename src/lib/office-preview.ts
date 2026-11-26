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

/** A CSV from Czech Excel is often windows-1250; UTF-8 first, as a wrong guess there would garble every letter. */
function decodeText(bytes: Uint8Array) {
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
      ? XLSX.read(decodeText(new Uint8Array(data)).replace(/^﻿/, ""), { ...opts, type: "string" })
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

/**
 * A Word document as a whole HTML page for a sandboxed frame: no script runs, and only its own pictures load,
 * so opening it can't tell the sender anything.
 */
export async function readDocx(data: ArrayBuffer): Promise<string> {
  const mammoth = (await import("mammoth/mammoth.browser.min.js")).default;
  const { value } = await mammoth.convertToHtml({ arrayBuffer: data });
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<base target="_blank">
<style>
  body { margin: 0; padding: 32px 24px 48px; font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #111; background: #fff; overflow-wrap: anywhere; }
  main { max-width: 760px; margin: 0 auto; }
  h1, h2, h3, h4 { line-height: 1.25; margin: 1.4em 0 0.5em; }
  p { margin: 0 0 0.8em; }
  img { max-width: 100%; height: auto; }
  table { border-collapse: collapse; margin: 1em 0; max-width: 100%; display: block; overflow-x: auto; }
  td, th { border: 1px solid #d4d4d4; padding: 4px 8px; vertical-align: top; }
  td p, th p { margin: 0; }
  a { color: #2563eb; }
  @media (max-width: 600px) { body { padding: 20px 16px 32px; } }
</style></head><body><main>${value}</main></body></html>`;
}
