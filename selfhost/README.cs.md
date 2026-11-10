# Kolbaba na vlastním serveru

[English](README.md)

Celá Kolbaba běží u tebe: aplikace, databáze i šifrovací klíče. Nic z tvé pošty nechodí k těm, kdo Kolbabu
dělají. Je zdarma a má otevřený zdrojový kód.

Co k tomu potřebuješ:

- **Server s Dockerem.** Stačí nejmenší VPS (1–2 GB RAM, např. Hetzner) nebo počítač doma, který běží pořád.
- **Doménu**, třeba `mail.mojedomena.cz`, nasměrovanou záznamem A na adresu serveru. Bez HTTPS by nefungovaly
  notifikace ani instalace na iPhone.

## Instalace

Na serveru nainstaluj Docker, pokud tam ještě není:

```bash
curl -fsSL https://get.docker.com | sh
```

A nainstaluj Kolbabu:

```bash
mkdir kolbaba && cd kolbaba && docker run --rm ghcr.io/jakubst28/kolbaba:1 tar -c -C /app/selfhost . | tar x && sh install.sh
```

Skript se zeptá na doménu, vše spustí a vypíše odkaz. Otevři ho, založ si účet a ulož si přístupový klíč.
A je hotovo.

Přidání schránky je stejné jako jinde. **Gmail** se připojuje heslem pro aplikace
([vytvoříš ho tady](https://myaccount.google.com/apppasswords), musíš mít zapnuté dvoufázové ověření).
**Outlook** potřebuje vlastní aplikaci u Microsoftu, viz [níž](#volitelně).

Na iPhonu otevři adresu v Safari a přidej ji na plochu (Sdílet → Přidat na plochu). Notifikace pak zapneš
v Nastavení.

## Aktualizace

Nové verze se instalují samy ve 3 ráno (UTC). Výpadek trvá pár vteřin a aplikace se na zařízeních obnoví sama.
Sledují se verze `1.x`. Větší změna, která by vyžadovala tvůj zásah, by vyšla jako `2.x` a sama se nenainstaluje.

Docker Desktop na Macu a Windows ukládá nastavení Dockeru do systémové klíčenky, ke které se automatické
aktualizace nemusí dostat. Když tam nové verze nechodí, aktualizuj ručně.

Chceš aktualizovat ručně? V `.env` odeber z `COMPOSE_PROFILES` slovo `autoupdate`, spusť
`docker compose up -d --remove-orphans` a nové verze instaluj takto:

```bash
docker compose pull && docker compose up -d
```

Automatické aktualizace znamenají, že věříš tomu, kdo je vydává. Kdo chce mít každou změnu pod kontrolou, ať si
v `.env` nastaví konkrétní verzi (`KOLBABA_VERSION=1.4.2`) a mění ji sám.

## Přihlášení

Přihlašuješ se přístupovým klíčem (Face ID, Touch ID, zámek obrazovky). Nemáš ho po ruce, nebo jsi na novém
zařízení? Přihlašovací odkaz na jedno použití dá server:

```bash
docker compose exec kolbaba kolbaba-link
```

Účet pro další osobu na stejném serveru: `kolbaba-link --new`. Přihlášení k jednomu z více účtů:
`kolbaba-link adresa@example.com`.

Chceš i přihlašovací kódy e-mailem? V `.env` vyplň `SMTP_URL` a `MAIL_FROM`.

## Zálohy

Každý den se do složky `backups/` uloží kopie databáze (drží se 14 dní) a soubor `secrets.json`.

**Záloha leží na stejném disku.** Pomůže při chybě, ale ne když o server přijdeš. Kopíruj proto složku `backups/`
a soubor `.env` i jinam. Kdo má `secrets.json` a databázi, má přístup ke všemu včetně hesel ke schránkám, takže
s nimi tak zacházej. Bez `secrets.json` se uložená hesla ke schránkám nedají přečíst.

Obnova databáze (i při přesunu na nový server, po instalaci):

```bash
docker compose stop kolbaba
```

```bash
docker compose run --rm -T --no-deps -u root -v "$PWD/backups:/b" kolbaba sh -c "cp /b/secrets.json /data/secrets.json && chown node:node /data/secrets.json && chmod 600 /data/secrets.json"
```

```bash
docker compose exec -T postgres pg_restore -U kolbaba -d kolbaba --clean --if-exists < backups/kolbaba-DATUM.dump
```

```bash
docker compose start kolbaba
```

## Volitelně

Všechno se nastavuje v souboru `.env` (popis je v něm) a platí po `docker compose up -d`.

- **Chytré funkce** (kategorie, souhrny): vyplň `OPENAI_API_KEY`. E-maily pak chodí do OpenAI pod tvým účtem.
  Bez klíče jsou funkce vypnuté a nic nikam nechodí.
- **Gmail přes přihlášení Googlem:** založ si [OAuth klienta](https://console.cloud.google.com/apis/credentials)
  typu Web application s přesměrováním `https://TVOJE-DOMENA/api/auth/google/callback`
  a `https://TVOJE-DOMENA/api/accounts/google/callback`, zapni Gmail API, přepni aplikaci do stavu
  „In production“ a vyplň `GOOGLE_CLIENT_ID` a `GOOGLE_CLIENT_SECRET`.
- **Outlook a Microsoft 365:** registrace aplikace v [Microsoft Entra](https://entra.microsoft.com) pro
  „Any Entra ID tenant + personal Microsoft accounts“, přesměrování (Web)
  `https://TVOJE-DOMENA/api/accounts/microsoft/callback`. Delegovaná oprávnění: Graph `openid`, `email`, `profile`,
  `offline_access`, `Mail.Send` a Office 365 Exchange Online `IMAP.AccessAsUser.All`, `SMTP.Send`. Vyplň
  `MICROSOFT_CLIENT_ID` a `MICROSOFT_CLIENT_SECRET`.
- **Doma přes Tailscale, bez domény a otevřených portů:** v `.env` nastav `COMPOSE_PROFILES=autoupdate`
  a `APP_URL=https://pocitac.tvuj-tailnet.ts.net`, spusť `docker compose up -d --remove-orphans` a pak
  `tailscale serve --bg 3000`. Telefon musí mít Tailscale zapnutý. Cloudflare Tunnel nepoužívej: Cloudflare by
  viděl celý provoz.

## Kam server sám volá

- k tvým poskytovatelům pošty,
- k `autoconfig.thunderbird.net` a na DNS, když hledá nastavení neznámé schránky,
- k push službám Applu, Googlu a Mozilly, když posílá notifikace (obsah je šifrovaný),
- na `ghcr.io` pro nové verze (vypneš přes `UPDATE_CHECK=off` a `autoupdate`),
- do OpenAI, jen pokud vyplníš klíč.

Nic z toho nechodí na servery Kolbaby.

## Když něco nejde

```bash
docker compose ps
```

```bash
docker compose logs --tail 50 kolbaba
```

Našel jsi chybu? [Založ issue](https://github.com/jakubSt28/kolbaba/issues) (anglicky).

## Chceš pomoct?

Když chceš, aby ti Kolbabu někdo nastavil, na tvém serveru nebo ve firmě, je to placená služba. Napiš na
[hello@kolbaba.app](mailto:hello@kolbaba.app) nebo použij formulář na
[kolbaba.app/cs/self-hosted](https://kolbaba.app/cs/self-hosted).

## Licence

Kolbaba je svobodný software pod licencí [GNU AGPL v3.0 nebo novější](../LICENSE): smíš ji provozovat, upravovat
i šířit. Když upravenou verzi nabízíš dalším lidem přes síť, musíš jim dát i její zdrojový kód. Jméno a logo mají
vlastní pravidla, viz [TRADEMARKS.md](../TRADEMARKS.md).
