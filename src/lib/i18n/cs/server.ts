import type { Dictionary } from "..";

export const server: Dictionary = {
  // Requests
  "Sign in to continue": "Pro pokračování se přihlas",
  "Invalid request": "Neplatný požadavek",
  "Request blocked": "Požadavek byl zablokován",
  "Not found": "Nenalezeno",
  "Too many attempts. Try again in {minutes} min.": "Příliš mnoho pokusů. Zkus to znovu za {minutes} min.",

  // Sign-in (server)
  "Google sent back something we couldn't read.": "Google poslal zpátky něco, čemu nerozumíme.",
  "Google sign-in couldn't be verified.": "Přihlášení přes Google se nepodařilo ověřit.",
  "Google didn't share an email address.": "Google nám neposlal e-mailovou adresu.",
  "That sign-in link expired. Please try again.": "Platnost odkazu pro přihlášení vypršela. Zkus to prosím znovu.",
  "That took a little too long. Please try again.": "Trvalo to trochu moc dlouho. Zkus to prosím znovu.",
  "We couldn't verify that passkey. Please try again.": "Ten přístupový klíč se nám nepodařilo ověřit. Zkus to prosím znovu.",
  "This passkey is already registered.": "Tenhle přístupový klíč už je zaregistrovaný.",
  "This passkey isn't registered with {app} anymore.": "Tenhle přístupový klíč už v aplikaci {app} není zaregistrovaný.",
  "That name is a little long": "To jméno je trochu moc dlouhé",
  "You already have an account. Sign in instead.": "Účet už máš. Raději se přihlas.",
  "This Google account is already connected to another {app} account.": "Tenhle účet Google už je připojený k jinému účtu v aplikaci {app}.",
  "Confirm your email address first.": "Nejdřív ověř svou e-mailovou adresu.",
  "{code} is your {app} code": "{code} je tvůj kód pro {app}",
  "Your code for creating a {app} account:": "Tvůj kód pro založení účtu v aplikaci {app}:",
  "It works for 15 minutes. If you didn't ask for it, ignore this email.": "Platí 15 minut. Pokud o žádném kódu nevíš, tenhle e-mail ignoruj.",
  "Confirm your email": "Ověř svůj e-mail",
  "That code expired. Ask for a new one.": "Platnost kódu vypršela. Požádej o nový.",
  "That code isn't right. Check the email and try again.": "Tenhle kód nesedí. Zkontroluj e-mail a zkus to znovu.",
  "We couldn't send the email. Please try again later.": "E-mail se nepodařilo odeslat. Zkus to prosím později.",
  "To sign out of this device, use Sign out.": "Pro odhlášení tohoto zařízení použij Odhlásit se.",
  "There's no passkey on this account.": "Tenhle účet nemá žádný přístupový klíč.",
  "Accepted: {summary}": "Přijato: {summary}",
  "Tentative: {summary}": "Možná: {summary}",
  "Declined: {summary}": "Odmítnuto: {summary}",
  "I accept the invitation.": "Pozvánku přijímám.",
  "I might come.": "Možná dorazím.",
  "I decline the invitation.": "Pozvánku bohužel odmítám.",
  "This invitation can't be read.": "Tuhle pozvánku nejde přečíst.",
  "This invitation can't be answered.": "Na tuhle pozvánku nejde odpovědět.",
  "Summaries aren't available right now.": "Shrnutí teď nejsou k dispozici.",
  "That's enough summaries for today. Try again tomorrow.": "Na dnešek už bylo shrnutí dost. Zkus to zítra.",
  "The sender didn't take the request. Try again later.": "Odesílatel žádost nepřijal. Zkus to později.",
  "This sender can't be left from here": "Od tohohle odesílatele se tady odhlásit nedá",
  "That conversation no longer exists": "Ta konverzace už neexistuje",
  "That mailbox is no longer connected": "Ta schránka už není připojená",
  "Couldn't summarize this conversation. Try again in a moment.": "Tuhle konverzaci se nepodařilo shrnout. Zkus to za chvilku.",
  "Type your email address exactly to confirm": "Pro potvrzení napiš přesně svou e-mailovou adresu",

  // Mail
  "Conversation not found": "Konverzace nenalezena",
  "Mailbox not found": "Schránka nenalezena",
  "Draft not found": "Koncept nenalezen",
  "Attachment not found": "Příloha nenalezena",
  "This download link has expired or isn't valid. Ask for the attachment again.": "Platnost odkazu ke stažení vypršela nebo neplatí. Požádej o přílohu znovu.",
  "Couldn't reach {provider}. Try again in a moment.": "Nepodařilo se spojit se službou {provider}. Zkus to za chvilku znovu.",
  "Use a PNG, JPEG or WebP picture": "Použij obrázek ve formátu PNG, JPEG nebo WebP",
  "That picture is too big": "Ten obrázek je moc velký",
  "No picture": "Žádný obrázek",
  "Gmail deletes mail in Trash and Spam for good after 30 days": "Gmail maže maily z koše a spamu natrvalo sám po 30 dnech",
  "Only mail in Trash or Spam can be deleted for good": "Natrvalo jde smazat jen maily v koši nebo ve spamu",
  "Only Trash and Spam can be emptied": "Vysypat jde jen koš a spam",
  "“{address}” isn't a valid email address": "„{address}“ není platná e-mailová adresa",
  "Add at least one recipient": "Přidej aspoň jednoho příjemce",
  "That message has already been sent": "Ta zpráva už je odeslaná",
  "That time is in the past": "Ten čas už minul",
  "Too late — it's already sent": "Pozdě – už je odesláno",

  // AI agents
  "That agent is no longer connected": "Ten agent už není připojený",
  "That step no longer exists": "Ten krok už neexistuje",
  "This step can't be undone": "Tenhle krok nejde vrátit",
  "Already undone": "Už vráceno",
  "That draft is gone (sent or deleted)": "Ten koncept už tu není (je odeslaný nebo smazaný)",
  "Too late, it's already on its way": "Pozdě, už je na cestě",
  "Your session ended. Sign in and try connecting again.": "Tvoje přihlášení vypršelo. Přihlas se a zkus připojení znovu.",
  "This page expired. Go back to the app and connect again.": "Platnost stránky vypršela. Vrať se do aplikace a připoj se znovu.",
  "Confirm that you understand the risks of Full access, or pick a lower level.":
    "Potvrď, že rozumíš rizikům plného přístupu, nebo vyber nižší úroveň.",
  "This app isn't registered with us (unknown client_id). Try connecting again from the app.":
    "Tahle aplikace u nás není zaregistrovaná (neznámé client_id). Zkus se připojit znovu z aplikace.",
  "The app asked to send you back to an address it didn't register. For your safety we stopped here.":
    "Aplikace chtěla, abychom tě vrátili na adresu, kterou nezaregistrovala. Kvůli tvé bezpečnosti jsme to tady zastavili.",

  // Adding a mailbox
  "That doesn't look like an email address.": "Tohle nevypadá jako e-mailová adresa.",
  "That server name doesn't look right": "Ten název serveru nevypadá správně",
  "Enter your password": "Zadej heslo",
  "This mailbox connects with Google sign-in.": "Tahle schránka se připojuje přihlášením přes Google.",
  "We couldn't find the mail servers for this address. Enter them below.": "Pro tuhle adresu jsme nenašli poštovní servery. Zadej je níž.",
  "{provider} accounts connect with “Sign in with {via}”, not a password.": "Účty {provider} se nepřipojují heslem, ale přihlášením přes {via}.",
  "We couldn't find the mail servers for {domain}. Check the address for typos, or enter the servers yourself. Your email provider's help pages list them.":
    "Pro {domain} jsme nenašli poštovní servery. Zkontroluj, jestli v adrese není překlep, nebo servery zadej ručně. Najdeš je v nápovědě svého poskytovatele e-mailu.",
  "Create an app password": "Vytvořit heslo pro aplikace",
  "How to create an app password": "Jak vytvořit heslo pro aplikace",
  "Create an app-specific password": "Vytvořit heslo pro konkrétní aplikaci",
  "Outlook and Hotmail accounts are coming soon. Microsoft requires its own sign-in, which we're still building.":
    "Účty Outlook a Hotmail přidáme brzy. Microsoft vyžaduje vlastní přihlášení, na kterém ještě pracujeme.",
  "Microsoft 365 accounts are coming soon. Microsoft requires its own sign-in, which we're still building.":
    "Účty Microsoft 365 přidáme brzy. Microsoft vyžaduje vlastní přihlášení, na kterém ještě pracujeme.",
  "Proton Mail is end-to-end encrypted, so other apps can only reach it through Proton Mail Bridge running on your own computer. Kolbaba can't connect to Bridge yet.":
    "Proton Mail je šifrovaný end-to-end, takže se k němu jiné aplikace dostanou jen přes Proton Mail Bridge spuštěný na tvém počítači. K Bridge se Kolbaba zatím připojit neumí.",
  "Tuta doesn't let other mail apps connect (it has no IMAP), so Kolbaba can't add this address.":
    "Tuta nedovoluje připojení jiným poštovním aplikacím (nemá IMAP), takže tuhle adresu Kolbaba přidat neumí.",
  "iCloud signs in to a custom domain with your @icloud.com address, not this one.":
    "iCloud se k vlastní doméně přihlašuje tvou adresou @icloud.com, ne touhle.",
  "Your @icloud.com address": "Tvoje adresa @icloud.com",

  // Connection test
  "IMAP access is turned off for this mailbox. Turn it on in {settings}, then try again.":
    "Přístup přes IMAP je u téhle schránky vypnutý. Zapni ho tady: {settings}. Pak to zkus znovu.",
  "IMAP access is turned off for this mailbox. Turn it on in your {name} settings, then try again.":
    "Přístup přes IMAP je u téhle schránky vypnutý. Zapni ho v nastavení služby {name} a zkus to znovu.",
  "IMAP access is turned off for this mailbox. Turn it on in your email settings, then try again.":
    "Přístup přes IMAP je u téhle schránky vypnutý. Zapni ho v nastavení svého e-mailu a zkus to znovu.",
  "Your provider needs an app password here because two-step verification is on. Create one in your account's security settings, then paste it in.":
    "Tvůj poskytovatel tu kvůli zapnutému dvoufázovému ověření vyžaduje heslo pro aplikace. Vytvoř si ho v nastavení zabezpečení svého účtu a vlož ho sem.",
  "{name} needs an app password here because two-step verification is on. Create one in {steps}, then paste it in.":
    "{name} tu kvůli zapnutému dvoufázovému ověření vyžaduje heslo pro aplikace. Vytvoř si ho tady: {steps}. Pak ho vlož sem.",
  "{name} needs an app password here because two-step verification is on. Create one in your account's security settings, then paste it in.":
    "{name} tu kvůli zapnutému dvoufázovému ověření vyžaduje heslo pro aplikace. Vytvoř si ho v nastavení zabezpečení svého účtu a vlož ho sem.",
  "{name} wants you to confirm it's you. Sign in once on its website, then try again here.":
    "{name} chce ověřit, že jsi to ty. Jednou se přihlas přímo na webu a pak to zkus tady znovu.",
  "Your provider wants you to confirm it's you. Sign in once on its website, then try again here.":
    "Tvůj poskytovatel chce ověřit, že jsi to ty. Jednou se přihlas přímo na jeho webu a pak to zkus tady znovu.",
  "{name} is limiting sign-in attempts. Wait a few minutes, then try again.":
    "{name} teď omezuje pokusy o přihlášení. Počkej pár minut a zkus to znovu.",
  "The server is limiting sign-in attempts. Wait a few minutes, then try again.":
    "Server teď omezuje pokusy o přihlášení. Počkej pár minut a zkus to znovu.",
  "Receiving mail works, but {host} didn't accept the password for sending. Check whether your provider uses a separate sending password.":
    "Příjem pošty funguje, ale {host} nepřijal heslo pro odesílání. Zkontroluj, jestli tvůj poskytovatel nepoužívá pro odesílání jiné heslo.",
  "{name} doesn't let mail apps use your regular password. Create an app password in {steps} and paste it here instead.":
    "{name} nedovoluje poštovním aplikacím používat tvoje běžné heslo. Vytvoř si heslo pro aplikace ({steps}) a vlož sem místo běžného.",
  "{name} doesn't let mail apps use your regular password. Create an app password in your {name} account and paste it here instead.":
    "{name} nedovoluje poštovním aplikacím používat tvoje běžné heslo. Vytvoř si v účtu heslo pro aplikace a vlož ho sem místo běžného.",
  "{name} didn't accept that password. If two-step verification is on, {name} needs an app password instead. Create one in {steps}.":
    "{name} tohle heslo nepřijímá. Pokud máš zapnuté dvoufázové ověření, potřebuješ místo něj heslo pro aplikace. Vytvoř si ho tady: {steps}.",
  "{name} didn't accept that password. If two-step verification is on, {name} needs an app password instead. Create one in your {name} account.":
    "{name} tohle heslo nepřijímá. Pokud máš zapnuté dvoufázové ověření, potřebuješ místo něj heslo pro aplikace. Vytvoř si ho v nastavení svého účtu.",
  "{name} didn't accept that email and password. Check them and try again. Passwords are case-sensitive.":
    "{name} tenhle e-mail a heslo nepřijímá. Zkontroluj je a zkus to znovu. U hesla záleží na velikosti písmen.",
  "The server didn't accept that email and password. Check them and try again. Passwords are case-sensitive.":
    "Server tenhle e-mail a heslo nepřijal. Zkontroluj je a zkus to znovu. U hesla záleží na velikosti písmen.",
  "We couldn't find a server called {host}. Check the server name for typos.":
    "Server {host} jsme nenašli. Zkontroluj, jestli v jeho názvu není překlep.",
  "{where} doesn't offer an encrypted connection, so we didn't send your password. Try port {port} with SSL.":
    "{where} nenabízí šifrované spojení, takže jsme heslo neposlali. Zkus port {port} s SSL.",
  "Couldn't start a secure connection to {where}. The port and the SSL/STARTTLS setting probably don't match.":
    "Nepodařilo se navázat zabezpečené spojení s {where}. Port a nastavení SSL/STARTTLS si nejspíš neodpovídají.",
  "{host} has an invalid security certificate, so we stopped before sending your password. Your provider's help pages list the right server name, which often differs from your own domain.":
    "{host} má neplatný bezpečnostní certifikát, takže jsme heslo radši neposlali. Správný název serveru najdeš v nápovědě poskytovatele – často se liší od tvé vlastní domény.",
  "We couldn't connect to {where}. Check the server and port, or try again in a moment.":
    "Nepodařilo se připojit k {where}. Zkontroluj server a port, nebo to zkus za chvilku znovu.",
  "{name} is limiting connections right now. Wait a few minutes, then try again.":
    "{name} teď omezuje počet spojení. Počkej pár minut a zkus to znovu.",
  "The server is limiting connections right now. Wait a few minutes, then try again.":
    "Server teď omezuje počet spojení. Počkej pár minut a zkus to znovu.",
  "{host} answered with an error: “{said}”. Try again, or check the server settings.":
    "{host} odpověděl chybou: „{said}“. Zkus to znovu, nebo zkontroluj nastavení serveru.",
  "{host} answered with an error. Try again, or check the server settings.":
    "{host} odpověděl chybou. Zkus to znovu, nebo zkontroluj nastavení serveru.",

  // Mailbox sign-in problems (shown in "Reconnect" notifications)
  "Google sign-in was cancelled": "Přihlášení přes Google se zrušilo",
  "That took too long. Please try again.": "Trvalo to moc dlouho. Zkus to prosím znovu.",
  "Couldn't connect Gmail. Please try again.": "Gmail se nepodařilo připojit. Zkus to prosím znovu.",
  "Gmail access wasn’t allowed. Try again and keep the Gmail checkbox ticked.":
    "Přístup ke Gmailu nebyl povolen. Zkus to znovu a nech políčko Gmail zaškrtnuté.",
  "Google access was revoked; reconnect the account": "Přístup ke Googlu byl odebrán – připoj účet znovu",
  "Signed in to Google as {actual}, expected {expected}": "Přihlášený účet Google je {actual}, čekali jsme {expected}",
  "Gmail accounts need OAuth credentials": "Účty Gmail potřebují přihlášení přes OAuth",
  "Google rejected the access token": "Google odmítl přístupový token",
  "IMAP accounts sign in with a password": "Účty IMAP se přihlašují heslem",
  "IMAP/SMTP access is disabled for this mailbox": "Přístup přes IMAP/SMTP je u téhle schránky vypnutý",
  "The server requires an app password": "Server vyžaduje heslo pro aplikace",
  "The server rejected the username or password": "Server odmítl uživatelské jméno nebo heslo",

  // Push notifications
  "Reconnect {name}": "Znovu připoj schránku {name}",
  "Verification code": "Ověřovací kód",
  "(no subject)": "(bez předmětu)",
  "Couldn't send your message": "Zprávu se nepodařilo odeslat",
  "“{subject}” — reconnect {name}": "„{subject}“ – znovu připoj schránku {name}",
  "“{subject}” — open it to try again": "„{subject}“ – otevři ji a zkus to znovu",
  Someone: "Někdo",
  "{name} opened “{subject}”": "{name} otevírá „{subject}“",
  "Back in your Inbox": "Zpátky v Doručených",
  They: "Adresát",
  "No reply from {name} yet": "{name} – zatím bez odpovědi",
  "{app} scheduled an email": "Agent {app} naplánoval mail",
  "{app} sent an email": "Agent {app} odeslal mail",
  "“{subject}” to {to} · {when}": "„{subject}“ → {to} · {when}",
  "“{subject}” to {to}": "„{subject}“ → {to}",
  "{who} and {n} more": { one: "{who} a {n} další", few: "{who} a {n} další", other: "{who} a {n} dalších" },
  "Payments aren't available yet.": "Platby zatím nejsou k dispozici.",
  "Payments aren't available right now. Try again in a moment.": "Platby teď nefungují. Zkus to za chvíli.",
  "We couldn't cancel your subscription. Try again in a moment.": "Předplatné se nepodařilo zrušit. Zkus to za chvíli.",
  "This is part of Kolbaba Plus.": "Tohle je součást Kolbaba Plus.",
  "Confirm it's you first.": "Nejdřív potvrď, že jsi to ty.",
  "Your code for signing in to {app}:": "Tvůj kód pro přihlášení do aplikace {app}:",
  "Your code for deleting your {app} account:": "Tvůj kód pro smazání účtu v aplikaci {app}:",
  "Confirm it's you": "Potvrď, že jsi to ty",
};
