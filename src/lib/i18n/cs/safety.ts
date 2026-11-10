import type { Dictionary } from "..";

/** Security fixes (26 Oct 2026) and the short onboarding. */
export const safety: Dictionary = {
  /* Sign-in codes in notifications */
  "Show sign-in codes in notifications": "Ověřovací kódy v upozornění",
  "Readable even on a locked screen": "Jsou vidět i na zamčeném displeji",
  "Off: the notification only says a code came, and you open Kolbaba to see it. Safer on a phone that others can pick up.":
    "Vypnuté: upozornění jen řekne, že kód přišel, a uvidíš ho až v Kolbabě. Bezpečnější, když ti telefon může vzít do ruky někdo jiný.",

  /* Drafts */
  "This draft can't be saved. Copy the text into a new email.": "Tenhle koncept nejde uložit. Zkopíruj text do nového e-mailu.",

  /* Onboarding: notifications */
  "Wanna know when mail comes?": "Chceš vědět, když přijde pošta?",
  "You choose later who may interrupt you.": "Kdo smí rušit, nastavíš později.",
  "Notifications are on. Who may notify you is in Settings → Notifications.": "Upozornění jsou zapnutá. Kdo smí rušit, nastavíš v Nastavení → Notifikace.",

  /* Allowing notifications that were refused (src/components/install-guide.tsx) */
  "Your Mac is asking at the top right of the screen. Choose Allow, it may be under Options.": "Mac se ptá vpravo nahoře na obrazovce. Vyber Povolit, může být schované pod Volbami.",
  "Blocked on this device. Turn on to see how to allow them.": "Na tomhle zařízení zablokované. Zapni a uvidíš, jak je povolit.",
  "Allow notifications": "Povolit upozornění",
  "Kolbaba may ask only once, and that time the answer was no. To allow them now:": "Kolbaba se smí zeptat jen jednou a tehdy padlo ne. Povolíš je takhle:",
  "Open System Settings → Notifications.": "Otevři Nastavení systému → Oznámení.",
  "Click Kolbaba and turn on Allow notifications.": "Klikni na Kolbabu a zapni Povolit oznámení.",
  "In the menu bar, choose Safari → Settings → Websites.": "V řádku nabídek vyber Safari → Nastavení → Webové stránky.",
  "Under Notifications, set {address} to Allow.": "V části Oznámení nastav u {address} Povolit.",
  "Open Settings → Notifications.": "Otevři Nastavení → Oznámení.",
  "Tap Kolbaba and turn on Allow Notifications.": "Klepni na Kolbabu a zapni Povolit oznámení.",
  "Hold the Kolbaba icon and tap App info. In the browser, tap the icon left of the address.":
    "Podrž ikonu Kolbaby a klepni na Informace o aplikaci. V prohlížeči klepni na ikonu vlevo od adresy.",
  "Allow notifications.": "Povol oznámení.",
  "Click the icon left of the address. In Kolbaba's own window, open the ⋮ or ⋯ menu and choose App info.":
    "Klikni na ikonu vlevo od adresy. Ve vlastním okně Kolbaby otevři nabídku ⋮ nebo ⋯ a vyber Informace o aplikaci.",
  "Set Notifications to Allow.": "U Oznámení nastav Povolit.",
  "Click the icon left of the address.": "Klikni na ikonu vlevo od adresy.",
  "Next to Send notifications, remove Blocked.": "U Odesílat oznámení zruš Blokováno.",
  "Still blocked? Quit Kolbaba with ⌘Q, open it again and turn them on.": "Pořád zablokované? Ukonči Kolbabu přes ⌘Q, znovu ji otevři a zapni je.",
  "Still blocked? Load Kolbaba again and turn them on.": "Pořád zablokované? Načti Kolbabu znovu a zapni je.",
};
