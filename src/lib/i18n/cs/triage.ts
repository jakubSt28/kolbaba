import type { Dictionary } from "..";

/**
 * Calm and basics (Oct 2026): mute, block, No reply yet, notes, cleaning up after unsubscribing,
 * search operators, signatures, appearance, undo send, keyboard shortcuts, print, privacy line,
 * the reason on AI cards, and the new agent tools.
 */
export const triage: Dictionary = {
  // No reply yet
  "No reply yet": "Bez odpovědi",
  "Nobody owes you a reply": "Nikdo ti nedluží odpověď",
  "Emails you sent that nobody has answered for three working days show up here.": "Tady se objeví tvoje e-maily, na které nikdo neodpověděl tři pracovní dny.",
  "No reply from {name} for {n} days": { one: "{name} neodpovídá {n} den", few: "{name} neodpovídá {n} dny", other: "{name} neodpovídá {n} dní" },
  "Remind me": "Připomenout",
  "Not waiting": "Nečekám",
  "Out of No reply yet": "Pryč z Bez odpovědi",
  "Remind me if no reply": "Připomenout, když neodpoví",
  "Remind me if nobody replies…": "Připomenout, když nikdo neodpoví…",
  "Reminder · {time}": "Připomínka · {time}",
  "No reminder": "Bez připomínky",
  "In 3 days": "Za 3 dny",
  "In a week": "Za týden",
  "I'll remind you {time} if nobody replies.": "Připomenu ti to {time}, když nikdo neodpoví.",
  "Reminder off": "Připomínka zrušena",

  // Mute
  Mute: "Ztlumit",
  Unmute: "Zrušit ztlumení",
  Muted: "Ztlumeno",
  Unmuted: "Ztlumení zrušeno",
  "Muted. New replies won't come to your Inbox.": "Ztlumeno. Nové odpovědi už nepřijdou do Doručených.",
  "Unmuted. New replies come to your Inbox again.": "Ztlumení zrušeno. Nové odpovědi zase chodí do Doručených.",
  "Muted. New replies stay out of your Inbox, without a notification.": "Ztlumeno. Nové odpovědi zůstanou mimo Doručené a bez upozornění.",

  // Block
  Block: "Blokovat",
  "Block {sender}": "Blokovat {sender}",
  "Block everyone at {domain}": "Blokovat všechny z {domain}",
  "Everyone at {domain}": "Všichni z {domain}",
  "What they send goes straight to Trash. You can undo it in Settings.": "Co pošlou, půjde rovnou do Koše. Vrátit to jde v Nastavení.",
  "Blocked {sender}. What they send goes to Trash.": "{sender} je blokovaný. Co pošle, půjde do Koše.",
  "Unblocked {sender}": "Blokování zrušeno: {sender}",
  "Blocked {sender}": "Blokováno: {sender}",
  "Their next emails go to Trash": "Další e-maily od nich půjdou do Koše",
  "{n} conversations moved to Trash": { one: "{n} konverzace přesunuta do Koše", few: "{n} konverzace přesunuty do Koše", other: "{n} konverzací přesunuto do Koše" },
  "{domain} is a free email service: block the address instead": "{domain} je bezplatná e-mailová služba: zablokuj raději jen adresu",
  "Blocked senders": "Blokovaní odesílatelé",
  "Blocked: their mail goes to Trash. Turned away in the screener: to Archive.": "Blokovaní: jejich pošta jde do Koše. Odmítnutí ve Screeneru: do Archivu.",
  "To Trash": "Do Koše",
  "To Archive · screener": "Do Archivu · Screener",
  "Senders you say no to are listed in Mail → Blocked senders.": "Odesílatele, které odmítneš, najdeš v Pošta → Blokovaní odesílatelé.",

  // Unsubscribe and clean up
  "Unsubscribed from {sender}": "Odhlášeno z {sender}",
  "{n} conversations from them are still here. Clean them up too?": {
    one: "Ještě tu od nich je {n} konverzace. Uklidit ji taky?",
    few: "Ještě tu od nich jsou {n} konverzace. Uklidit je taky?",
    other: "Ještě tu od nich je {n} konverzací. Uklidit je taky?",
  },
  "Archive {n} from Inbox": { one: "Archivovat {n} z Doručených", few: "Archivovat {n} z Doručených", other: "Archivovat {n} z Doručených" },
  "Delete all {n}": { one: "Smazat ji", few: "Smazat všechny {n}", other: "Smazat všech {n}" },
  "Keep them": "Nechat je tu",
  "Archived {n} conversations from {sender}": {
    one: "Archivována {n} konverzace od {sender}",
    few: "Archivovány {n} konverzace od {sender}",
    other: "Archivováno {n} konverzací od {sender}",
  },
  "Deleted {n} conversations from {sender}": {
    one: "Smazána {n} konverzace od {sender}",
    few: "Smazány {n} konverzace od {sender}",
    other: "Smazáno {n} konverzací od {sender}",
  },

  // Notes
  "Add a note": "Přidat poznámku",
  "Edit note": "Upravit poznámku",
  "Has a note": "Má poznámku",
  "A note only you see: what was agreed, what to do next…": "Poznámka jen pro tebe: co jste si domluvili, co dál…",
  "Only you see this. Not sent, not in your other email apps.": "Vidíš ji jen ty. Neodesílá se a v jiných e-mailových aplikacích není.",

  // Print
  Print: "Tisk",
  Date: "Datum",
  Attachments: "Přílohy",
  "Couldn't load the whole conversation. Try again.": "Celou konverzaci se nepodařilo načíst. Zkus to znovu.",

  // Privacy line
  "Blocked {n} trackers": { one: "Zablokován {n} sledovací pixel", few: "Zablokovány {n} sledovací pixely", other: "Zablokováno {n} sledovacích pixelů" },
  "cleaned {n} links": { one: "vyčištěn {n} odkaz", few: "vyčištěny {n} odkazy", other: "vyčištěno {n} odkazů" },
  "Trackers are invisible images that tell the sender when, and on what, you opened the email. Kolbaba removes them, so this one never found out.":
    "Sledovací pixely jsou neviditelné obrázky, které odesílateli prozradí, kdy a na čem jsi e-mail otevřel. Kolbaba je odstraní, takže tenhle se to nedozvěděl.",
  "Links carried codes that tell the sender who clicked (utm_… and the like). Kolbaba took them off; the links still go to the same page.":
    "Odkazy nesly kódy, podle kterých odesílatel pozná, kdo klikl (utm_… a podobné). Kolbaba je odstranila; odkazy dál vedou na stejnou stránku.",

  // AI cards
  "Why here: {reason}": "Proč tady: {reason}",

  // Search
  "With attachment": "S přílohou",
  "All folders": "Všechny složky",
  "Search tips": "Tipy k hledání",
  "Narrow it down": "Zúžit hledání",
  "Czech works too: od:, komu:, má:přílohu, je:nepřečtené, před:, po:.": "Funguje i česky: od:, komu:, má:přílohu, je:nepřečtené, před:, po:.",
  "From someone (name or address)": "Od někoho (jméno nebo adresa)",
  "To someone": "Někomu",
  "Words in the subject": "Slova v předmětu",
  "With an attachment": "S přílohou",
  "Unread only": "Jen nepřečtené",
  "Pinned only": "Jen připnuté",
  "From that day on": "Od toho dne",
  "Before that day": "Před tím dnem",
  "In every folder": "Ve všech složkách",

  // Signature
  Signature: "Podpis",
  "Goes under every email you send from {email}.": "Připojí se pod každý e-mail, který pošleš z {email}.",
  "Your name, phone, a link… whatever should end every email": "Jméno, telefon, odkaz… cokoli má být na konci každého e-mailu",
  "There's no signature in Gmail for {email}.": "Pro {email} v Gmailu žádný podpis není.",
  "Signature brought over from Gmail": "Podpis je převzatý z Gmailu",
  "Link address": "Adresa odkazu",
  "Bring over from Gmail": "Převzít z Gmailu",
  "Add a signature for {mailbox}": "Přidat podpis pro {mailbox}",
  "Only Gmail keeps a signature Kolbaba can read": "Podpis, který Kolbaba umí načíst, má jen Gmail",

  // Appearance and undo send
  Appearance: "Vzhled",
  Light: "Světlý",
  Dark: "Tmavý",
  "Switch to dark": "Přepnout na tmavý vzhled",
  "Switch to light": "Přepnout na světlý vzhled",
  "Light and dark like the system": "Světlý a tmavý podle systému",
  "Undo send": "Vrátit odeslání",
  "How long a sent email can still be taken back": "Jak dlouho jde odeslaný e-mail ještě vrátit",
  "{n} s": "{n} s",

  // Keyboard shortcuts
  "Moving around": "Pohyb",
  "Search and commands": "Hledání a příkazy",
  "Previous / next tab": "Předchozí / další karta",
  "Go to Inbox": "Do Doručených",
  "Go to No reply yet": "Do Bez odpovědi",
  "Go to Pinned": "Do Připnutých",
  "Go to Snoozed": "Do Odložených",
  "Go to Drafts": "Do Konceptů",
  "Go to Sent": "Do Odeslaných",
  "Go to Archive": "Do Archivu",
  Conversation: "Konverzace",
  "Read / unread": "Přečtené / nepřečtené",
  Writing: "Psaní",
  "Blocks and snippets, in the text": "Bloky a šablony, v textu",
  "Several at once": "Víc najednou",
  "Add to the selection": "Přidat do výběru",
  "Select a range": "Vybrat rozsah",
  "This list": "Tenhle přehled",
  "Single keys work whenever you're not typing.": "Jednotlivé klávesy fungují, kdykoli zrovna nepíšeš.",
  click: "klik",

  // Agents
  "Remove {app}?": "Odebrat {app}?",
  "It loses access to your mail for good, and its activity here is deleted. To use it again, connect it again.":
    "Natrvalo přijde o přístup k tvé poště a jeho aktivita tady se smaže. Když ho budeš chtít znovu, připoj ho znovu.",
  "Remove {app}": "Odebrat {app}",
  "{app} removed": "{app} odebrán",
  "Things to ask": "Co se dá zeptat",
  "Tap one to copy it. Words in [brackets] are yours to fill in.": "Klepnutím zkopíruješ. Slova v [závorkách] doplň po svém.",
  "Prompt copied. Paste it into your agent.": "Zkopírováno. Vlož to svému agentovi.",
  "Morning triage": "Ranní úklid",
  "Go through today's mail in Kolbaba. Archive newsletters and notifications I don't need, and give me a short list of what needs my answer.":
    "Projdi dnešní poštu v Kolbabě. Archivuj newslettery a upozornění, které nepotřebuju, a dej mi krátký seznam toho, na co mám odpovědět.",
  "Who owes me a reply": "Kdo mi dluží odpověď",
  "Look at No reply yet in Kolbaba and draft a short, friendly follow-up for each one. Don't send anything.":
    "Podívej se v Kolbabě do Bez odpovědi a ke každé konverzaci napiš krátkou, přátelskou urgenci jako koncept. Nic neodesílej.",
  "Find an invoice": "Najít fakturu",
  "Find the latest invoice from [company] in Kolbaba and tell me the amount, the due date and the account to pay to.":
    "Najdi v Kolbabě poslední fakturu od [firma] a řekni mi částku, splatnost a číslo účtu.",
  "Reply in my words": "Odpověď mými slovy",
  "Draft a reply in Kolbaba to [name]'s last email: [what you want to say]. Keep it short and save it as a draft.":
    "Napiš v Kolbabě odpověď na poslední e-mail od [jméno]: [co chceš říct]. Stručně a jen jako koncept.",
  "Notes on a project": "Poznámky k projektu",
  "Read everything in Kolbaba about [topic] and add a note to the newest conversation with what was agreed and what comes next.":
    "Přečti si v Kolbabě všechno o [téma] a k nejnovější konverzaci přidej poznámku, co bylo domluveno a co následuje.",

  // AI activity steps
  "Moved **{subject}** to Trash": "Přesunul **{subject}** do Koše",
  "Unsubscribed from **{subject}**": "Odhlásil odběr **{subject}**",
  "Wrote a note on **{subject}**": "Napsal poznámku ke **{subject}**",
  "Set a reminder on **{subject}** for {when} if nobody replies": "Nastavil připomínku u **{subject}** na {when}, když nikdo neodpoví",
  "Took the reminder off **{subject}**": "Zrušil připomínku u **{subject}**",
  "Let **{who}** into Inbox": "Pustil **{who}** do Doručených",
  "Turned **{who}** away": "Odmítl **{who}**",
  "Opened attachment **{name}**": "Otevřel přílohu **{name}**",
};
