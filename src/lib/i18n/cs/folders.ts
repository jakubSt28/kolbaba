import type { Dictionary } from "..";

/** The user's own folders. */
export const folders: Dictionary = {
  Folder: "Složka",
  "New folder": "Nová složka",
  "New folder…": "Nová složka…",
  "Edit folder": "Upravit složku",
  "In {mailbox}": "Ve schránce {mailbox}",
  "Back in {folder}": "Zpátky ve složce {folder}",
  Newsletters: "Newslettery",
  "Folder name": "Název složky",
  "Colour {n}": "Barva {n}",
  Create: "Vytvořit",
  "Create and move": "Vytvořit a přesunout",
  "Move to folder": "Přesunout do složky",
  "Move to {folder}": "Přesunout do složky {folder}",
  "Move {n} selected to": { one: "Přesunout {n} vybranou do", few: "Přesunout {n} vybrané do", other: "Přesunout {n} vybraných do" },
  "Move mail here from its menu, or with the folder button when several are selected.": "Poštu sem přesuneš z její nabídky, nebo tlačítkem se složkou, když jich vybereš víc.",
  "Edit {name}": "Upravit: {name}",
  "Delete {folder}?": "Smazat složku {folder}?",
  "The folder goes, in every mailbox. Its mail moves to Archive; nothing is deleted.": "Složka zmizí ze všech schránek. Pošta z ní se přesune do Archivu, nic se nesmaže.",
  "Delete folder": "Smazat složku",
  "Deleted {folder}. Its mail is in Archive.": "Složka {folder} je pryč. Její pošta je v Archivu.",
  "Moved {n} conversations to {folder}": {
    one: "{n} konverzace je ve složce {folder}",
    few: "{n} konverzace jsou ve složce {folder}",
    other: "{n} konverzací je ve složce {folder}",
  },
  // Server
  "Give the folder a name": "Pojmenuj složku",
  "You already have a folder with that name": "Složku s tímhle názvem už máš",
  "That folder no longer exists": "Ta složka už neexistuje",
  "This mailbox doesn't support folders": "Tahle schránka složky nepodporuje",
};
