import type { Dictionary } from "..";

/** Tasks (src/components/tasks, src/lib/tasks, src/server/tasks.ts). */
export const tasks: Dictionary = {
  // Mail | Calendar | Tasks
  Tasks: "Úkoly",
  "Mail, calendar or tasks": "Pošta, kalendář nebo úkoly",
  "Mail: {n} unread": { one: "Pošta: {n} nepřečtený", few: "Pošta: {n} nepřečtené", other: "Pošta: {n} nepřečtených" },
  "Calendar: {n} events left today": { one: "Kalendář: dnes ještě {n} událost", few: "Kalendář: dnes ještě {n} události", other: "Kalendář: dnes ještě {n} událostí" },
  "Tasks: {n} for today": { one: "Úkoly: {n} na dnešek", few: "Úkoly: {n} na dnešek", other: "Úkoly: {n} na dnešek" },
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

  // Lists and folders
  "New list": "Nový seznam",
  "New list in this folder": "Nový seznam v této složce",
  "List name": "Název seznamu",
  "Move up": "Posunout nahoru",
  "Move down": "Posunout dolů",
  "Out of the folder": "Ven ze složky",
  "Take apart {name}?": "Rozpustit složku {name}?",
  "Its lists stay, outside the folder.": "Její seznamy zůstanou, jen mimo složku.",
  "Take apart": "Rozpustit",
  "Take the folder apart": "Rozpustit složku",
  "Delete list": "Smazat seznam",
  "Its tasks go to Trash, where you can restore them for 30 days.": "Jeho úkoly půjdou do koše, odkud je 30 dní můžeš obnovit.",
  "Move to list": "Přesunout do seznamu",
  "Add a task to {list}": "Přidej úkol do seznamu {list}",
  "Nothing in this list yet": "V seznamu zatím nic není",
  "Add a task above, or drag one here from another list.": "Přidej úkol nahoře, nebo sem nějaký přetáhni z jiného seznamu.",
  "That's a lot of lists. Delete some first.": "To je hodně seznamů. Nejdřív nějaké smaž.",

  // Repeating
  Repeat: "Opakovat",
  "Done. Next time: {when}": "Hotovo. Příště: {when}",
  Daily: "Každý den",
  "Every {n} days": { one: "Každý {n}. den", few: "Každé {n} dny", other: "Každých {n} dní" },
  "Weekly on {days}": "Každý týden: {days}",
  "Every {n} weeks on {days}": { one: "Každý {n}. týden: {days}", few: "Každé {n} týdny: {days}", other: "Každých {n} týdnů: {days}" },
  "Monthly on day {day}": "Každý měsíc {day}.",
  "Every {n} months on day {day}": { one: "Každý {n}. měsíc {day}.", few: "Každé {n} měsíce {day}.", other: "Každých {n} měsíců {day}." },
  "Yearly on {date}": "Každý rok {date}",
  "Every {n} years on {date}": { one: "Každý {n}. rok {date}", few: "Každé {n} roky {date}", other: "Každých {n} let {date}" },

  // Import from TickTick
  "Import from TickTick": "Importovat z TickTicku",
  "In TickTick on the web, open Settings → Account → Backup and click Generate backup. A CSV file downloads.":
    "V TickTicku na webu otevři Nastavení → Účet → Záloha a klikni na Vygenerovat zálohu. Stáhne se soubor CSV.",
  "Pick that file here. Your lists, folders, tasks done or not, days, priorities, descriptions and repeating tasks come over.":
    "Ten soubor vyber tady. Přenesou se seznamy, složky, hotové i nehotové úkoly, data, priority, popisy i opakované úkoly.",
  "Reminders, tags and kanban columns stay behind. Importing the same backup again adds only what's new.":
    "Připomínky, štítky a sloupce kanbanu se nepřenesou. Když stejnou zálohu naimportuješ znovu, přidá se jen to nové.",
  "Choose the backup file": "Vybrat soubor se zálohou",
  "Importing…": "Importuju…",
  "{n} tasks came over": { one: "Přenesl se {n} úkol", few: "Přenesly se {n} úkoly", other: "Přeneslo se {n} úkolů" },
  "into {n} new lists": { one: "do {n} nového seznamu", few: "do {n} nových seznamů", other: "do {n} nových seznamů" },
  "{n} were here already.": { one: "{n} tu už byl.", few: "{n} tu už byly.", other: "{n} tu už bylo." },
  "That isn't a TickTick backup. In TickTick, open Settings → Account → Backup and generate one.":
    "Tohle není záloha z TickTicku. V TickTicku otevři Nastavení → Účet → Záloha a vygeneruj ji.",
  "The prototype can't import. Sign in to Kolbaba first.": "Prototyp importovat neumí. Nejdřív se přihlas do Kolbaby.",
  "Making a task list": "Vytvoření seznamu úkolů",
  "Making a task repeat": "Nastavení opakování úkolu",
  "Importing from TickTick": "Import z TickTicku",

  // Agents (MCP)
  "See your tasks and lists.": "Vidí tvoje úkoly a seznamy.",
  "See, add, change, tick off and delete your tasks.": "Vidí, přidává, mění, odškrtává a maže tvoje úkoly.",
  "Calendar and tasks": "Kalendář a úkoly",
  "Your tasks": "Tvoje úkoly",
  "Looked up **task lists**": "Prohlédl **seznamy úkolů**",
  "Looked at **tasks**": "Prohlédl **úkoly**",
  "Added the task **{title}**": "Přidal úkol **{title}**",
  "Ticked off the task **{title}**": "Odškrtl úkol **{title}**",
  "Changed the task **{title}**": "Změnil úkol **{title}**",
  "Moved the task **{title}** to Trash": "Přesunul úkol **{title}** do koše",
  "That task is gone": "Ten úkol už neexistuje",

  // The server
  "That title is a little long": "Ten název je trochu dlouhý",
  "A time needs a day": "Čas potřebuje datum",
  "That's a lot of tasks. Tick some off or empty Trash first.": "To je hodně úkolů. Nejdřív nějaké odškrtni nebo vysyp koš.",
};
