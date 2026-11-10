import { describe, expect, it } from "vitest";
import { wordForms } from "./word-forms";

/** Whether a search for `query` finds `word` in the index (no diacritics there). */
const finds = (query: string, word: string) => {
  const plain = word.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  return wordForms(query).some((f) => plain.startsWith(f));
};

describe("word forms", () => {
  it("finds kšiltovek from kšiltovka, like Gmail", () => {
    expect(wordForms("kšiltovka")).toEqual(["ksiltovk", "ksiltovce", "ksiltovci", "ksiltovek"]);
    expect(wordForms("ksiltovka")).toEqual(wordForms("kšiltovka"));
    for (const w of ["kšiltovky", "kšiltovek", "kšiltovce", "kšiltovkou", "kšiltovku"]) expect(finds("kšiltovka", w)).toBe(true);
  });

  it("takes off case endings", () => {
    expect(wordForms("faktura")).toEqual(["faktur"]);
    expect(wordForms("smlouvy")).toEqual(["smlouv"]);
    expect(finds("objednávkou", "objednávka")).toBe(true);
    expect(finds("platba", "plateb")).toBe(true);
  });

  it("softens k and h before e and i, and hardens them back", () => {
    expect(wordForms("Praha")).toEqual(["prah", "praze", "prazi"]);
    expect(finds("Praha", "prázdniny")).toBe(false);
    expect(finds("Praze", "Praha")).toBe(true);
    expect(finds("zákazník", "zákazníci")).toBe(true);
    expect(finds("zákazníci", "zákazník")).toBe(true);
  });

  it("drops the e that goes away in other cases, before a vowel", () => {
    expect(finds("dárek", "dárku")).toBe(true);
    expect(finds("dárek", "dark")).toBe(false);
    expect(finds("účet", "účtu")).toBe(true);
    expect(finds("týden", "týdne")).toBe(true);
  });

  it("leaves short words, numbers and other scripts alone", () => {
    expect(wordForms("auto")).toEqual(["auto"]);
    expect(wordForms("info")).toEqual(["info"]);
    expect(wordForms("81188")).toEqual(["81188"]);
    expect(wordForms("Москва")).toEqual(["москва"]);
    expect(wordForms("status")).toEqual(["status"]);
  });
});
