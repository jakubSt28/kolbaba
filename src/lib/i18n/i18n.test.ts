import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectLocale, translate, translateCount } from ".";
import { CS } from "./cs";

/** Every text the code marks for translation, found by reading the source. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" || name === "i18n" ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const STR = String.raw`"((?:[^"\\]|\\.)*)"`;
const unescape = (s: string) => JSON.parse(`"${s}"`) as string;

function usedTexts() {
  const single = new Map<string, string>();
  const counted = new Map<string, string>();
  for (const file of [...sourceFiles("src"), ...sourceFiles("worker")]) {
    const code = readFileSync(file, "utf8");
    for (const m of code.matchAll(new RegExp(String.raw`(?<![\w.])(?:t|tk)\(\s*${STR}`, "g"))) single.set(unescape(m[1]), file);
    for (const m of code.matchAll(new RegExp(String.raw`(?<![\w.])translate\(\s*[\w.()]+,\s*${STR}`, "g"))) single.set(unescape(m[1]), file);
    for (const m of code.matchAll(new RegExp(String.raw`new HttpError\(\s*\d+,\s*${STR}`, "g"))) single.set(unescape(m[1]), file);
    for (const m of code.matchAll(new RegExp(String.raw`(?<![\w.])(?:tn\(|translateCount\(\s*[\w.()]+,)\s*[^,]+,\s*${STR},\s*${STR}`, "g")))
      counted.set(unescape(m[2]), file);
  }
  return { single, counted };
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("Czech translations", () => {
  const { single, counted } = usedTexts();

  it("cover every text the app shows", () => {
    const missing = [...single].filter(([text]) => typeof CS[text] !== "string").map(([text, file]) => `${file}: ${text}`);
    const missingCounts = [...counted].filter(([text]) => typeof CS[text] !== "object").map(([text, file]) => `${file}: ${text}`);
    expect([...missing, ...missingCounts]).toEqual([]);
  });

  it("keep the placeholders of the English text", () => {
    const wrong = Object.entries(CS).flatMap(([en, cs]) => {
      const want = placeholders(en).filter((p) => p !== "n");
      const forms = typeof cs === "string" ? [cs] : [cs.one, cs.few, cs.other];
      return forms
        .filter(
          (f) =>
            placeholders(f)
              .filter((p) => p !== "n")
              .join() !== [...new Set(want)].join(),
        )
        .map((f) => `${en} → ${f}`);
    });
    expect(wrong).toEqual([]);
  });

  it("have no leftovers the code no longer uses", () => {
    const unused = Object.keys(CS).filter((text) => !single.has(text) && !counted.has(text));
    expect(unused).toEqual([]);
  });
});

describe("i18n", () => {
  it("picks Czech for Czech and Slovak browsers, English otherwise", () => {
    expect(detectLocale(["cs-CZ", "en"])).toBe("cs");
    expect(detectLocale(["sk"])).toBe("cs");
    expect(detectLocale(["de-DE", "en-US"])).toBe("en");
    expect(detectLocale(["fr"])).toBe("en");
  });

  it("fills placeholders and falls back to English", () => {
    expect(translate("en", "Copied {value}", { value: "123" })).toBe("Copied 123");
    expect(translate("cs", "Some text nobody translated")).toBe("Some text nobody translated");
  });

  it("uses the three Czech plural forms", () => {
    const forms = (n: number) => translateCount("cs", n, "{n} order on the way", "{n} orders on the way");
    if (typeof CS["{n} orders on the way"] !== "object") return;
    expect(new Set([forms(1), forms(3), forms(5)]).size).toBe(3);
    expect(translateCount("en", 1, "{n} order on the way", "{n} orders on the way")).toBe("1 order on the way");
    expect(translateCount("en", 2, "{n} order on the way", "{n} orders on the way")).toBe("2 orders on the way");
  });
});

describe("context", () => {
  it("never shows the context in English", () => {
    expect(translate("en", "Archive@@folder")).toBe("Archive");
  });
});
