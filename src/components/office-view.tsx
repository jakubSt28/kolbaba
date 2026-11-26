"use client";

import { useEffect, useRef, useState } from "react";
import { t } from "@/lib/i18n";
import { columnName, MAX_COLS, MAX_ROWS, type Sheet } from "@/lib/office-preview";
import { cn } from "@/lib/utils";

/** A spreadsheet drawn as a grid, with Excel's column letters and row numbers, and a tab for each sheet. */
export function SheetView({ sheets }: { sheets: Sheet[] }) {
  const [active, setActive] = useState(0);
  const sheet = sheets[active];
  const cols = sheet?.rows[0]?.length ?? 0;

  return (
    <div className="flex size-full flex-col overflow-hidden rounded-lg bg-white text-black">
      <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
        {!sheet || sheet.rows.length === 0 ? (
          <p className="p-6 text-center text-[14px] text-neutral-500">{t("This sheet is empty.")}</p>
        ) : (
          <table className="border-separate border-spacing-0 text-[13px] leading-[1.35]">
            <thead>
              <tr>
                <th className="sticky top-0 left-0 z-20 h-6 min-w-10 border-r border-b border-neutral-300 bg-neutral-100" />
                {Array.from({ length: cols }, (_, c) => (
                  <th
                    key={c}
                    className="sticky top-0 z-10 h-6 border-r border-b border-neutral-300 bg-neutral-100 px-2 text-[11px] font-medium text-neutral-500"
                    style={sheet.widths[c] === 0 ? { display: "none" } : undefined}
                  >
                    {columnName(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sheet.rows.map((row, r) => (
                <tr key={r}>
                  <th className="sticky left-0 z-10 border-r border-b border-neutral-300 bg-neutral-100 px-2 text-right text-[11px] font-medium text-neutral-500 tabular-nums">
                    {r + 1}
                  </th>
                  {row.map((cell, c) =>
                    cell === null ? null : (
                      <td
                        key={c}
                        rowSpan={cell.rowSpan}
                        colSpan={cell.colSpan}
                        title={cell.text.length > 40 ? cell.text : undefined}
                        className={cn(
                          "max-w-[360px] overflow-hidden border-r border-b border-neutral-200 px-2 py-1 align-top text-ellipsis whitespace-nowrap",
                          cell.number && "text-right tabular-nums",
                        )}
                        style={
                          sheet.widths[c] === 0
                            ? { display: "none" }
                            : sheet.widths[c] && !cell.colSpan
                              ? { minWidth: sheet.widths[c], maxWidth: Math.max(sheet.widths[c]!, 360) }
                              : undefined
                        }
                      >
                        {cell.text}
                      </td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {sheet?.cut && (
          <p className="sticky left-0 px-3 py-3 text-[13px] text-neutral-500">
            {t("Kolbaba shows the first {rows} rows and {cols} columns. Download the file to see all of it.", {
              rows: MAX_ROWS.toLocaleString(),
              cols: MAX_COLS,
            })}
          </p>
        )}
      </div>
      {sheets.length > 1 && (
        <div role="tablist" className="flex shrink-0 gap-1 overflow-x-auto border-t border-neutral-200 bg-neutral-50 p-1.5">
          {sheets.map((s, i) => (
            <button
              key={i}
              role="tab"
              aria-selected={i === active}
              onClick={() => setActive(i)}
              className={cn(
                "h-8 shrink-0 rounded-md px-3 text-[13px] whitespace-nowrap transition-colors",
                i === active ? "bg-white font-medium text-black shadow-sm ring-1 ring-neutral-200" : "text-neutral-600 hover:bg-neutral-200/60",
              )}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const DOCUMENT_STYLE = `
  :host { display: block; color: #111; font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; overflow-wrap: anywhere; }
  main { max-width: 760px; margin: 0 auto; padding: 32px 24px 48px; }
  h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.4em 0 0.5em; }
  h1:first-child, h2:first-child, p:first-child { margin-top: 0; }
  p { margin: 0 0 0.8em; }
  img { max-width: 100%; height: auto; }
  table { border-collapse: collapse; margin: 1em 0; max-width: 100%; display: block; overflow-x: auto; }
  td, th { border: 1px solid #d4d4d4; padding: 4px 8px; vertical-align: top; text-align: left; }
  td p, th p { margin: 0; }
  a { color: #2563eb; }
  @media (max-width: 600px) { main { padding: 20px 16px 32px; } }
`;

/**
 * A Word document as a page to read. Its HTML is already cleaned (readDocx); it sits in a shadow root so the
 * app's styles and the document's don't touch. Not a frame: a frame keeps the keys to itself, and Escape
 * wouldn't close the file.
 */
export function DocxView({ html }: { html: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const root = el.shadowRoot ?? el.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = DOCUMENT_STYLE;
    const main = document.createElement("main");
    main.innerHTML = html;
    root.replaceChildren(style, main);
  }, [html]);
  return (
    <div className="size-full overflow-auto overscroll-contain rounded-lg bg-white">
      <div ref={host} />
    </div>
  );
}
