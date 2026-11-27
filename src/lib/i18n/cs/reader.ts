import type { Dictionary } from "..";

export const reader: Dictionary = {
  // Summaries
  Summary: "Shrnutí",
  "Waiting for you": "Čeká se na tebe",
  "Written by AI from this conversation, so check anything important.": "Napsala to AI podle téhle konverzace, takže důležité věci si ověř.",
  "Summarizing…": "Shrnuju…",
  Summarize: "Shrnout",

  // Unsubscribe
  Unsubscribe: "Odhlásit odběr",
  Unsubscribed: "Odhlášeno",
  "Unsubscribe from {sender}?": "Odhlásit odběr od {sender}?",
  "Kolbaba asks {sender} to stop sending you this. Mail that's already here stays.":
    "Kolbaba za tebe požádá {sender}, ať ti tohle přestane posílat. Maily, které už přišly, tu zůstanou.",
  "An unsubscribe email goes from {mailbox} to the sender's list. Mail that's already here stays.":
    "Z {mailbox} odejde odesílateli odhlašovací e-mail. Maily, které už přišly, tu zůstanou.",
  "Unsubscribed. Mail that's already here stays.": "Odhlášeno. Maily, které už přišly, tu zůstanou.",
  // Calendar invitations
  Accept: "Přijmout",
  Maybe: "Možná",
  Decline: "Odmítnout",
  "You're going": "Zúčastníš se",
  "You might go": "Možná se zúčastníš",
  "You declined": "Odmítnuto",
  "Add to calendar": "Přidat do kalendáře",
  "Calendar (iPhone, Mac, Outlook)": "Kalendář (iPhone, Mac, Outlook)",
  "Google Calendar": "Google Kalendář",
  "Accepted. {name} gets your answer.": "Přijato. {name} dostane tvoji odpověď.",
  "Sent “maybe” to {name}.": "{name} dostane odpověď „možná“.",
  "Declined. {name} gets your answer.": "Odmítnuto. {name} dostane tvoji odpověď.",
  "all day": "celý den",
  "This event was cancelled": "Událost je zrušená",
  "Invitation from {name}": "Pozvánka od: {name}",
  "Calendar event": "Událost v kalendáři",
  Join: "Připojit se",
  "Join a meeting": "Připojení ke schůzce",
  "Cancelled · {when}": "Zrušeno · {when}",
  // Reader: empty state
  "{n} unread waiting": {
    one: "Čeká tu {n} nepřečtený mail",
    few: "Čekají tu {n} nepřečtené maily",
    other: "Čeká tu {n} nepřečtených mailů",
  },
  "You're all caught up": "Všechno máš přečtené",
  "Your mail is on its way": "Tvoje pošta je na cestě",
  "Pick a conversation, or start something new.": "Vyber si konverzaci, nebo začni něco nového.",
  "Next / previous": "Další / předchozí",
  Archive: "Archivovat",
  Delete: "Smazat",
  Pin: "Připnout",
  Reply: "Odpovědět",
  Snooze: "Odložit",
  "New message": "Nová zpráva",
  "Everything else": "Všechno ostatní",

  // Reader: tabs
  "Add mailbox": "Přidat schránku",
  "AI activity": "Aktivita AI",
  "{title} — preview, double-click to keep it open": "{title} – náhled, dvojklikem panel necháš otevřený",
  Draft: "Koncept",
  "Close tab": "Zavřít panel",

  // Reader: conversation
  "This conversation is gone.": "Tahle konverzace už tu není.",
  "Couldn't load the conversation. Check your connection.": "Konverzaci se nepodařilo načíst. Zkontroluj připojení.",
  "Reply all": "Odpovědět všem",
  Forward: "Přeposlat",
  Pinned: "Připnuté",
  "{n} messages": { one: "{n} zpráva", few: "{n} zprávy", other: "{n} zpráv" },
  "Sends {time}": "Odešle se {time}",
  "Edit message": "Upravit zprávu",
  "Snoozed until {time}": "Odloženo do {time}",
  Unsnooze: "Zrušit odložení",
  "We'll remind you {time} if nobody replies.": "Když nikdo neodpoví, připomeneme ti to {time}.",
  "All orders": "Všechny objednávky",
  "All travel": "Všechny cesty",
  "All invoices": "Všechny faktury",
  "All subscriptions": "Všechna předplatná",
  Track: "Sledovat",
  "Verification code": "Ověřovací kód",
  Copy: "Kopírovat",
  me: "já",
  You: "Ty",
  "to {recipients}": "komu: {recipients}",

  // Reader: read receipts
  "Read receipts": "Sledování přečtení",
  "Nobody has opened this yet. We'll notify you the moment they do.": "Zatím to nikdo neotevřel. Jakmile se to stane, dáme ti vědět.",
  "Apple Mail (preloaded)": "Apple Mail (načteno předem)",
  "Tracked with an invisible image. Apple Mail preloads images and many apps block them, so treat this as a hint, not proof.":
    "Sleduje se neviditelným obrázkem. Apple Mail načítá obrázky předem a spousta aplikací je blokuje, takže to ber jako vodítko, ne jako důkaz.",

  // Reader: attachments
  "{n} attachments": {
    one: "{n} příloha",
    few: "{n} přílohy",
    other: "{n} příloh",
  },
  "in this conversation": "v této konverzaci",
  "Downloading {n} files as a zip": {
    one: "Stahuji {n} soubor jako zip",
    few: "Stahuji {n} soubory jako zip",
    other: "Stahuji {n} souborů jako zip",
  },
  Download: "Stáhnout",
  "Download all": "Stáhnout vše",
  "Couldn't download the attachments. Try again in a moment.": "Přílohy se nepodařilo stáhnout. Zkus to za chvíli znovu.",
  "Couldn't download the file. Try again in a moment.": "Soubor se nepodařilo stáhnout. Zkus to za chvíli znovu.",
  "{name} is ready": "{name} je připravený",
  "{n} files are ready": { one: "{n} soubor je připravený", few: "{n} soubory jsou připravené", other: "{n} souborů je připravených" },
  "Show in conversation": "Zobrazit v konverzaci",
  // Attachment viewer
  "{i} of {n}": "{i} z {n}",
  "Share or save": "Sdílet nebo uložit",
  "Couldn't open {name}": "{name} se nepodařilo otevřít",
  "The mail server didn't send the file. Try again in a moment.": "Poštovní server soubor neposlal. Zkus to za chvíli znovu.",
  "Kolbaba can't show this kind of file. Open it in another app or save it.": "Tenhle typ souboru Kolbaba zobrazit neumí. Otevři ho v jiné aplikaci, nebo ho ulož.",
  "Kolbaba can't show this kind of file. Download it and open it on your computer.": "Tenhle typ souboru Kolbaba zobrazit neumí. Stáhni si ho a otevři v počítači.",
  "Open in another app": "Otevřít v jiné aplikaci",
  "Previous file": "Předchozí soubor",
  "Next file": "Další soubor",
  "Kolbaba couldn't show this file. Open it in another app or save it.": "Tenhle soubor se Kolbabě nepodařilo zobrazit. Otevři ho v jiné aplikaci, nebo ho ulož.",
  "Kolbaba couldn't show this file. Download it and open it on your computer.": "Tenhle soubor se Kolbabě nepodařilo zobrazit. Stáhni si ho a otevři v počítači.",
  "This is the beginning of the file. Download it to see all of it.": "Tohle je začátek souboru. Celý ho uvidíš po stažení.",
  "Page {i} of {n}": "Strana {i} z {n}",
  "This sheet is empty.": "Tenhle list je prázdný.",
  "Kolbaba shows the first {rows} rows and {cols} columns. Download the file to see all of it.":
    "Kolbaba ukazuje prvních {rows} řádků a {cols} sloupců. Celé to uvidíš ve staženém souboru.",
  "Try again": "Zkusit znovu",

  // Reader: action pill
  "Not spam": "Není spam",
  "Restore to Inbox": "Obnovit do Doručených",
  "Delete forever": "Smazat natrvalo",
  "Move to Inbox": "Přesunout do Doručených",
  Unpin: "Odepnout",
  More: "Více",
  "Mark as unread": "Označit jako nepřečtené",
  "Report spam": "Nahlásit spam",

  // Mail body
  Message: "Zpráva",
  "Images hidden to protect your privacy": "Obrázky jsou skryté kvůli soukromí",
  "Loading…": "Načítám…",
  "Show images": "Zobrazit obrázky",
  "Why are images hidden?": "Proč jsou obrázky skryté?",
  // Why images are hidden (images-explainer.tsx, ImagesPreview)
  "Images are hidden on purpose": "Obrázky schováváme schválně",
  "Many emails hide invisible images that tell the sender when and where you read them. Kolbaba blocks them.":
    "Spousta mailů skrývá neviditelné obrázky, které odesílateli prozradí, kdy a odkud je čteš. Kolbaba je proto blokuje.",
  "Got it": "Rozumím",
  "Invisible tracking image": "Neviditelný sledovací obrázek",
  "Report to {sender}: opened {time}, {place}": "Hlášení pro {sender}: otevřeno {time}, {place}",
  "Blocked. {sender} learns nothing": "Zablokováno. {sender} se nic nedozví",

  // Toasts
  Undo: "Vrátit",

  // Confirm dialogs (thread actions)
  Cancel: "Zrušit",
  "Delete forever?": "Smazat natrvalo?",
  "{n} conversations will be gone from your mailbox for good. This can't be undone.": {
    one: "{n} konverzace nadobro zmizí z tvé schránky. Nejde to vrátit.",
    few: "{n} konverzace nadobro zmizí z tvé schránky. Nejde to vrátit.",
    other: "{n} konverzací nadobro zmizí z tvé schránky. Nejde to vrátit.",
  },
  "Empty Trash?": "Vysypat koš?",
  "Empty Spam?": "Vysypat spam?",
  "Everything in Trash will be deleted for good. This can't be undone.": "Všechno v koši se natrvalo smaže. Nejde to vrátit.",
  "Everything in Spam will be deleted for good. This can't be undone.": "Všechno ve spamu se natrvalo smaže. Nejde to vrátit.",
  Empty: "Vysypat",

  // Image cropper
  "This picture can't be opened here. Try a PNG or JPEG.": "Tenhle obrázek tady nejde otevřít. Zkus PNG nebo JPEG.",
  Back: "Zpět",
  "Zoom out": "Oddálit",
  Zoom: "Přiblížení",
  "Zoom in": "Přiblížit",
  "Saving…": "Ukládám…",
  "Use picture": "Použít obrázek",

  // Snooze and schedule menus
  "Snooze until…": "Odložit do…",
  "Tomorrow morning": "Zítra ráno",
  "Tomorrow afternoon": "Zítra odpoledne",
  "Monday morning": "V pondělí ráno",
  Tonight: "Dnes večer",
  "Schedule send": "Naplánovat odeslání",
  Schedule: "Naplánovat",

  // Verification codes
  "Copied {code}": "Zkopírováno: {code}",
  "Code {code}": "Kód {code}",
};
