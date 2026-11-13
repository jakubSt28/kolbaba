import type { Dictionary } from "..";

/** Tasks (src/components/tasks, src/lib/tasks, src/server/tasks.ts). */
export const tasks: Dictionary = {
  // Mail | Calendar | Tasks
  Tasks: "Úkoly",
  "Mail, calendar or tasks": "Pošta, kalendář nebo úkoly",
  Lists: "Seznamy",

  // Views and sections
  "Next 7 days": "Příštích 7 dní",
  "Inbox@@tasks": "Příchozí",
  Completed: "Dokončeno",
  Overdue: "Po termínu",
  Later: "Později",
  "No date": "Bez data",

  // A task
  "New task": "Nový úkol",
  "Add a task to the Inbox": "Přidej úkol do Příchozích",
  "Add a task for today": "Přidej úkol na dnešek",
  "Mark as done": "Označit jako hotové",
  "Mark as not done": "Označit jako nehotové",
  "Task completed": "Úkol je hotový",
  "Has a description": "Má popis",
  "What needs doing?": "Co je potřeba udělat?",
  "Add a description, or press / for blocks…": "Přidej popis, nebo stiskni / pro bloky…",
  "Click a task to see its details and write a description.": "Klikni na úkol a uvidíš jeho detail a můžeš mu napsat popis.",
  "Created on {date}": "Vytvořeno {date}",
  "Completed on {date}": "Dokončeno {date}",
  "In Trash. It's deleted for good on {date}.": "V koši. Natrvalo se smaže {date}.",

  // Priority
  Priority: "Priorita",
  "High priority": "Vysoká priorita",
  "Medium priority": "Střední priorita",
  "Low priority": "Nízká priorita",
  "No priority": "Žádná priorita",

  // Date
  "Next month@@due": "Příští měsíc",
  "This month": "Tento měsíc",
  Time: "Čas",
  "No time": "Bez času",
  OK: "OK",

  // Sorting and the menus
  Sort: "Řazení",
  "By date": "Podle data",
  "By priority": "Podle priority",
  "By title": "Podle názvu",
  "Custom order": "Vlastní pořadí",
  "Drag tasks to put them in order.": "Úkoly seřadíš přetažením.",
  "Show completed": "Zobrazit dokončené",
  "Hide completed": "Skrýt dokončené",
  "The tasks in Trash are deleted for good.": "Úkoly v koši se natrvalo smažou.",
  "Tasks in Trash are deleted for good after {days} days.": "Úkoly v koši se po {days} dnech natrvalo smažou.",

  // Nothing here
  "Nothing left for today": "Na dnešek nic nezbývá",
  "Add a task above, or enjoy the day.": "Přidej úkol nahoře, nebo si užij den.",
  "Nothing in the next 7 days": "Příštích 7 dní nic",
  "Tasks with a day this week show up here.": "Tady se ukážou úkoly s datem v příštích sedmi dnech.",
  "No tasks yet": "Zatím žádné úkoly",
  "Type one above and press Enter. Words like “tomorrow” or “!high” at its end set its day and priority.":
    "Napiš ho nahoru a stiskni Enter. Slova jako „zítra“ nebo „!vysoká“ na konci mu nastaví datum a prioritu.",
  "Nothing completed yet": "Zatím nic hotového",
  "Tasks you tick off wait here.": "Tady čekají úkoly, které odškrtneš.",
  "Trash is empty": "Koš je prázdný",
  "Deleted tasks wait here for {days} days.": "Smazané úkoly tu {days} dní počkají.",

  // Shortcuts
  "Next / previous task": "Další / předchozí úkol",
  "Tick off or back": "Odškrtnout nebo vrátit",
  "Move to Trash": "Přesunout do koše",
  "Close the task": "Zavřít úkol",

  // Admin: what's used
  "Opening the tasks": "Otevření úkolů",
  "A day or priority typed with the task": "Datum nebo priorita napsaná k úkolu",
  "Ticking a task off": "Odškrtnutí úkolu",
  "Giving a task a day": "Nastavení data úkolu",
  "Giving a task a priority": "Nastavení priority úkolu",
  "Writing a task's description": "Psaní popisu úkolu",
  "Moving a task by dragging": "Přesunutí úkolu tažením",

  // The server
  "That title is a little long": "Ten název je trochu dlouhý",
  "A time needs a day": "Čas potřebuje datum",
  "That's a lot of tasks. Tick some off or empty Trash first.": "To je hodně úkolů. Nejdřív nějaké odškrtni nebo vysyp koš.",
};
