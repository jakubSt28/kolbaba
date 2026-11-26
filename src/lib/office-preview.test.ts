import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { columnName, MAX_ROWS, officeKind, readSheets } from "./office-preview";

function workbook(build: (book: XLSX.WorkBook) => void, bookType: XLSX.BookType = "xlsx") {
  const book = XLSX.utils.book_new();
  build(book);
  return XLSX.write(book, { type: "array", bookType }) as ArrayBuffer;
}

const texts = (rows: { text: string }[][]) => rows.map((row) => row.map((cell) => cell?.text ?? null));

describe("officeKind", () => {
  it("knows spreadsheets and Word documents by name", () => {
    expect(officeKind("Rozpočet 2027.XLSX")).toBe("sheet");
    expect(officeKind("export.csv")).toBe("sheet");
    expect(officeKind("stary.xls")).toBe("sheet");
    expect(officeKind("smlouva.docx")).toBe("docx");
    expect(officeKind("smlouva.doc")).toBeNull();
    expect(officeKind("foto.jpg")).toBeNull();
  });
});

describe("columnName", () => {
  it("names columns like Excel", () => {
    expect([0, 25, 26, 27, 51, 52, 701, 702].map(columnName)).toEqual(["A", "Z", "AA", "AB", "AZ", "BA", "ZZ", "AAA"]);
  });
});

describe("readSheets", () => {
  it("reads each visible sheet, with numbers formatted and merged cells", async () => {
    const data = workbook((book) => {
      const ws = XLSX.utils.aoa_to_sheet([
        ["Invoice", null, null],
        ["Item", "Pieces", "Price"],
        ["Chairs", 4, 1250.5],
      ]);
      ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } }];
      ws.C3.z = "#,##0.00";
      XLSX.utils.book_append_sheet(book, ws, "Summary");
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["secret"]]), "Hidden");
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([]), "Empty");
      book.Workbook = { Sheets: [{ name: "Summary" }, { name: "Hidden", Hidden: 1 }, { name: "Empty" }] };
    });

    const sheets = await readSheets(data, "invoice.xlsx");
    expect(sheets.map((s) => s.name)).toEqual(["Summary", "Empty"]);
    const [summary, empty] = sheets;
    expect(summary.rows[0][0]).toMatchObject({ text: "Invoice", colSpan: 3, rowSpan: 1 });
    expect(summary.rows[0].slice(1)).toEqual([null, null]);
    expect(texts(summary.rows.slice(1) as { text: string }[][])).toEqual([
      ["Item", "Pieces", "Price"],
      ["Chairs", "4", "1,250.50"],
    ]);
    expect(summary.rows[2][2]).toMatchObject({ number: true });
    expect(summary.cut).toBe(false);
    expect(empty.rows).toEqual([]);
  });

  it("stops at the last filled cell and cuts a long sheet", async () => {
    const rows = Array.from({ length: MAX_ROWS + 50 }, (_, i) => [i]);
    const data = workbook((book) => {
      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws["!ref"] = "A1:Z5000";
      XLSX.utils.book_append_sheet(book, ws, "Long");
    });
    const [sheet] = await readSheets(data, "long.xlsx");
    expect(sheet.rows).toHaveLength(MAX_ROWS);
    expect(sheet.rows[0]).toHaveLength(1);
    expect(sheet.cut).toBe(true);
  });

  it("reads an old .xls and an OpenDocument sheet", async () => {
    for (const [bookType, name] of [["biff8", "old.xls"], ["ods", "sheet.ods"]] as const) {
      const data = workbook((book) => XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Žluťoučký kůň", 7]]), "List1"), bookType);
      const [sheet] = await readSheets(data, name);
      expect(texts(sheet.rows as { text: string }[][])).toEqual([["Žluťoučký kůň", "7"]]);
    }
  });

  it("reads a CSV from Czech Excel: windows-1250 with semicolons", async () => {
    // "Název;Cena\nŽidle;120\n" in windows-1250.
    const bytes = new Uint8Array([
      0x4e, 0xe1, 0x7a, 0x65, 0x76, 0x3b, 0x43, 0x65, 0x6e, 0x61, 0x0a, 0x8e, 0x69, 0x64, 0x6c, 0x65, 0x3b, 0x31, 0x32, 0x30, 0x0a,
    ]);
    const [sheet] = await readSheets(bytes.buffer, "export.csv");
    expect(texts(sheet.rows as { text: string }[][])).toEqual([
      ["Název", "Cena"],
      ["Židle", "120"],
    ]);
  });

  it("reads a UTF-8 CSV with a byte order mark", async () => {
    const bytes = new TextEncoder().encode("\uFEFFJméno,Město\nAnna,Brno\n");
    const [sheet] = await readSheets(bytes.buffer as ArrayBuffer, "people.csv");
    expect(texts(sheet.rows as { text: string }[][])).toEqual([
      ["Jméno", "Město"],
      ["Anna", "Brno"],
    ]);
  });
});
