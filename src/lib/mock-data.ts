import type { Account, Agent, AgentEvent, AgentSession, Draft, Person, Thread } from "./types";
import { DAY, HOUR, MINUTE, at, nextWeekday } from "./utils";

export const ME_NAME = "Daniel Svoboda";

export const initialAccounts: Account[] = [
  {
    id: "acc_personal",
    name: "Personal",
    email: "daniel.svoboda@example.com",
    provider: "gmail",
    hue: 28,
    icon: "user",
    signature: "<p>Daniel</p>",
  },
  {
    id: "acc_seznam",
    name: "Seznam",
    email: "daniel.svoboda@example.cz",
    provider: "seznam",
    hue: 152,
    icon: "home",
    signature: "<p>Daniel Svoboda</p>",
  },
  {
    id: "acc_studio",
    name: "Studio",
    email: "daniel@studio.example",
    provider: "imap",
    hue: 282,
    icon: "briefcase",
    signature: "<p><strong>Daniel Svoboda</strong><br>Design &amp; development</p>",
  },
];

const p = (name: string, email: string): Person => ({ name, email });

const me = {
  personal: p(ME_NAME, "daniel.svoboda@example.com"),
  seznam: p(ME_NAME, "daniel.svoboda@example.cz"),
  studio: p(ME_NAME, "daniel@studio.example"),
};

/** "2026-10-24" (or with a time) this many days from `now`, as smart categories store dates. */
function isoIn(days: number, now: number, time?: string) {
  const d = new Date(now + days * DAY);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}${time ? `T${time}` : ""}`;
}

/** The next Thursday at this hour, as an ISO time: when the sample invitation's review is. */
function nextThursday(now: number, hour: number) {
  const d = new Date(now);
  d.setDate(d.getDate() + ((4 - d.getDay() + 7) % 7 || 7));
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

/** Smart category samples: orders, trips, invoices and subscriptions, with what the AI would pull out. */
function insightThreads(now: number): Thread[] {
  const ago = (ms: number) => now - ms;
  const mail = (
    id: string,
    accountId: string,
    folder: Thread["folder"],
    from: Person,
    to: Person,
    subject: string,
    when: number,
    html: string,
    insight: Omit<Thread["insight"] & object, "at">,
    extra: Partial<Thread> = {},
  ): Thread => ({
    id,
    accountId,
    subject,
    unread: false,
    pinned: false,
    folder,
    kind: "notification",
    messages: [{ id: `m_${id}`, from, to: [to], date: when, html }],
    insight: { ...insight, at: when },
    ...extra,
  });
  return [
    mail(
      "t_zalando",
      "acc_personal",
      "inbox",
      p("Zalando", "info@service-mail.zalando.cz"),
      me.personal,
      "Vaše zásilka byla doručena",
      ago(5 * DAY),
      `<p>Ahoj Danieli, tvoje objednávka 10304050 byla doručena. Nesedí? Vrátit ji můžeš zdarma do 14 dnů.</p>`,
      {
        category: "order",
        key: "order:zalando:10304050",
        merchant: "Zalando",
        amount: 2499,
        currency: "CZK",
        order: { number: "10304050", item: "Džíny Levi's 501", status: "delivered", carrier: "Zásilkovna", trackingNumber: null, trackingUrl: null, expectedAt: null, returnBy: isoIn(9, now) },
      },
      { logo: "zalando.cz" },
    ),
    mail(
      "t_drmax",
      "acc_personal",
      "inbox",
      p("Dr.Max", "eshop@drmax.cz"),
      me.personal,
      "Objednávka 4400123456 je připravena k vyzvednutí",
      ago(1 * DAY),
      `<p>Dobrý den, vaše objednávka 4400123456 čeká na lékárně Praha – Centrum. Vyzvedněte si ji prosím do 3 dnů.</p>`,
      {
        category: "order",
        key: "order:dr.max:4400123456",
        merchant: "Dr.Max",
        amount: 655,
        currency: "CZK",
        order: {
          number: "4400123456",
          item: "Vitamín D3 + 2 další",
          status: "ready_for_pickup",
          carrier: null,
          trackingNumber: null,
          trackingUrl: null,
          expectedAt: null,
          pickupBy: isoIn(3, now),
          returnBy: null,
        },
      },
      { logo: "drmax.cz" },
    ),
    mail(
      "t_vinted_sold",
      "acc_personal",
      "archive",
      p("Vinted", "no-reply@vinted.cz"),
      me.personal,
      "Zásilka čeká na kupujícího",
      ago(2 * DAY),
      `<p>Tvoje zásilka s položkou Šedá mikina s kapucí dorazila na výdejní místo. Jakmile si ji kupující vyzvedne, pošleme ti peníze.</p>`,
      {
        category: "order",
        key: "order:vinted:item:tomtailormikina",
        merchant: "Vinted",
        amount: 350,
        currency: "CZK",
        order: { number: null, item: "Šedá mikina s kapucí", role: "seller", status: "ready_for_pickup", carrier: "Zásilkovna", trackingNumber: null, trackingUrl: null, expectedAt: null, returnBy: null },
      },
      { logo: "vinted.cz" },
    ),
    mail(
      "t_vinted_ship",
      "acc_personal",
      "inbox",
      p("Vinted", "no-reply@vinted.cz"),
      me.personal,
      "Prodáno! Odešli položku do 5 dnů",
      ago(3 * HOUR),
      `<p>Gratulujeme, položku Vlněný svetr někdo koupil. Zabal ji a odešli do 5 dnů.</p>`,
      {
        category: "order",
        key: "order:vinted:item:housefunnelnecksvetr",
        merchant: "Vinted",
        amount: 420,
        currency: "CZK",
        order: { number: null, item: "Vlněný svetr", role: "seller", status: "placed", carrier: null, trackingNumber: null, trackingUrl: null, expectedAt: null, returnBy: null },
      },
      { logo: "vinted.cz" },
    ),
    mail(
      "t_ikea",
      "acc_personal",
      "archive",
      p("IKEA", "no.reply@ikea.com"),
      me.personal,
      "Účtenka z IKEA",
      ago(1 * DAY),
      `<p>Děkujeme, že nakupujete v IKEA! V příloze naleznete svou účtenku.</p>`,
      {
        category: "invoice",
        key: "invoice:t_ikea",
        merchant: "IKEA",
        amount: 2387,
        currency: "CZK",
        invoice: { number: null, toPay: false, dueAt: null, status: "paid", variableSymbol: null },
      },
      { logo: "ikea.com" },
    ),
    mail(
      "t_regiojet",
      "acc_seznam",
      "archive",
      p("RegioJet", "jizdenky@regiojet.cz"),
      me.seznam,
      "Jízdenka Praha → Brno",
      ago(3 * DAY),
      `<p>Děkujeme za nákup. Praha hl.n. 07:05 → Brno hl.n. 09:41, vůz 6, místo 42. Kód jízdenky: RJ-58K2Q.</p>`,
      {
        category: "travel",
        key: "travel:regiojet:rj58k2q",
        merchant: "RegioJet",
        amount: 249,
        currency: "CZK",
        travel: { kind: "train", from: "Praha", to: "Brno", startsAt: isoIn(4, now, "07:05"), endsAt: isoIn(4, now, "09:41"), bookingCode: "RJ-58K2Q" },
      },
      { logo: "regiojet.cz" },
    ),
    mail(
      "t_ryanair",
      "acc_personal",
      "archive",
      p("Ryanair", "itinerary@ryanair.com"),
      me.personal,
      "Your booking confirmation: K7X2QP",
      ago(9 * DAY),
      `<p>Prague (PRG) → Barcelona (BCN), FR 3204, departs 06:25. Booking reference K7X2QP.</p>`,
      {
        category: "travel",
        key: "travel:ryanair:k7x2qp",
        merchant: "Ryanair",
        amount: 3180,
        currency: "CZK",
        travel: { kind: "flight", from: "PRG", to: "BCN", startsAt: isoIn(21, now, "06:25"), endsAt: isoIn(21, now, "08:40"), bookingCode: "K7X2QP" },
      },
      { logo: "ryanair.com" },
    ),
    mail(
      "t_cez",
      "acc_seznam",
      "inbox",
      p("ČEZ Prodej", "vyuctovani@cez.cz"),
      me.seznam,
      "Faktura za elektřinu – říjen",
      ago(2 * DAY),
      `<p>Zasíláme fakturu č. 7001234567 na 1 380 Kč se splatností za 3 dny. Variabilní symbol 7001234567.</p>`,
      {
        category: "invoice",
        key: "invoice:čez prodej:7001234567",
        merchant: "ČEZ Prodej",
        amount: 1380,
        currency: "CZK",
        invoice: { number: "7001234567", toPay: true, dueAt: isoIn(3, now), status: "due", variableSymbol: "7001234567" },
      },
      { logo: "cez.cz" },
    ),
    mail(
      "t_hosting",
      "acc_studio",
      "archive",
      p("Wedos", "fakturace@wedos.com"),
      me.studio,
      "Daňový doklad 2026100012 – zaplaceno",
      ago(12 * DAY),
      `<p>Děkujeme za platbu 1 089 Kč za hosting webu na další rok.</p>`,
      {
        category: "invoice",
        key: "invoice:wedos:2026100012",
        merchant: "Wedos",
        amount: 1089,
        currency: "CZK",
        invoice: { number: "2026100012", toPay: false, dueAt: null, status: "paid", variableSymbol: null },
      },
      { logo: "wedos.com" },
    ),
    mail(
      "t_netflix",
      "acc_personal",
      "archive",
      p("Netflix", "info@account.netflix.com"),
      me.personal,
      "Your Netflix receipt",
      ago(6 * DAY),
      `<p>We charged 299 Kč for your Standard plan. Next billing date in 24 days.</p>`,
      {
        category: "subscription",
        key: "subscription:netflix",
        merchant: "Netflix",
        amount: 299,
        currency: "CZK",
        subscription: { period: "monthly", renewsAt: isoIn(24, now), trialEndsAt: null, status: "active" },
      },
      { logo: "netflix.com" },
    ),
    mail(
      "t_figma_billing",
      "acc_studio",
      "archive",
      p("Figma", "billing@figma.com"),
      me.studio,
      "Your Figma Professional plan renewed",
      ago(40 * DAY),
      `<p>Your annual Professional plan renewed for $192.00.</p>`,
      {
        category: "subscription",
        key: "subscription:figma",
        merchant: "Figma",
        amount: 192,
        currency: "USD",
        subscription: { period: "yearly", renewsAt: isoIn(325, now), trialEndsAt: null, status: "active" },
      },
      { logo: "figma.com" },
    ),
    mail(
      "t_spotify",
      "acc_personal",
      "inbox",
      p("Spotify", "no-reply@spotify.com"),
      me.personal,
      "Your free trial ends soon",
      ago(1 * DAY),
      `<p>Your Premium trial ends in 2 days. After that it's 189 Kč a month.</p>`,
      {
        category: "subscription",
        key: "subscription:spotify",
        merchant: "Spotify",
        amount: 189,
        currency: "CZK",
        subscription: { period: "monthly", renewsAt: null, trialEndsAt: isoIn(2, now), status: "trial" },
      },
      { logo: "spotify.com" },
    ),
  ];
}

/** What smart categories would say about order emails that are already in the sample mailbox. */
function existingInsights(now: number): Record<string, Omit<NonNullable<Thread["insight"]>, "at">> {
  return {
    t_alza: {
      category: "order",
      key: "order:alza.cz:412889301",
      merchant: "Alza.cz",
      amount: 12490,
      currency: "CZK",
      order: {
        number: "412889301",
        status: "shipped",
        carrier: "PPL",
        trackingNumber: "40712345678",
        trackingUrl: "https://www.ppl.cz/vyhledat-zasilku?shipmentId=40712345678",
        expectedAt: isoIn(0, now),
        returnBy: null,
      },
    },
    t_rohlik: {
      category: "order",
      key: "order:rohlik.cz:t_rohlik",
      merchant: "Rohlík.cz",
      amount: 1846,
      currency: "CZK",
      order: { number: null, status: "delivered", carrier: null, trackingNumber: null, trackingUrl: null, expectedAt: null, returnBy: null },
    },
  };
}

export function buildThreads(now = Date.now()): Thread[] {
  const extra = existingInsights(now);
  const threads = [...insightThreads(now), ...sampleThreads(now)].map((t) =>
    extra[t.id] ? { ...t, insight: { ...extra[t.id], at: t.messages[t.messages.length - 1].date } } : t,
  );
  // Warm letters, as the server marks them: from someone we've written to.
  const mine = new Set(Object.values(me).map((x) => x.email));
  const written = new Set(threads.flatMap((t) => t.messages.filter((m) => mine.has(m.from.email)).flatMap((m) => [...m.to, ...(m.cc ?? [])].map((x) => x.email))));
  return threads.map((t) => (t.messages.some((m) => written.has(m.from.email)) ? { ...t, warm: true } : t));
}

function sampleThreads(now: number): Thread[] {
  const ago = (ms: number) => now - ms;

  return [
    {
      id: "t_petra",
      accountId: "acc_personal",
      subject: "Víkend v Jizerkách?",
      unread: true,
      pinned: false,
      folder: "inbox",
      kind: "person",
      messages: [
        {
          id: "m_petra_1",
          from: p("Petra Nováková", "petra.novakova@example.com"),
          to: [me.personal],
          date: ago(18 * MINUTE),
          html: `<p>Ahoj Danieli,</p>
<p>co bys říkal na sobotu v Jizerkách? Vyrazili bychom ráno vlakem z Holešovic, prošli to kolem Smědavy a večer zpátky. Předpověď vypadá zatím dobře.</p>
<p>Dej vědět do čtvrtka, ať stihnu koupit lístky. Kdyby se přidala i Klára, budeme čtyři.</p>
<p>Petra</p>`,
        },
      ],
    },
    {
      id: "t_tomas",
      accountId: "acc_studio",
      subject: "Feedback k návrhu webu",
      unread: true,
      pinned: false,
      folder: "inbox",
      kind: "person",
      messages: [
        {
          id: "m_tomas_1",
          from: p("Tomáš Malý", "tomas@kavarna-ruze.example"),
          to: [me.studio],
          date: ago(2 * DAY + 3 * HOUR),
          html: `<p>Dobrý den, Danieli,</p>
<p>posílám první dojmy z návrhu. Celkově se nám moc líbí, hlavně fotky a to, jak je menu přehledné. Pár poznámek posílám v PDF.</p>
<p>Tomáš</p>`,
          attachments: [{ name: "feedback-web-v1.pdf", size: "1.2 MB", kind: "pdf" }],
        },
        {
          id: "m_tomas_2",
          from: me.studio,
          to: [p("Tomáš Malý", "tomas@kavarna-ruze.example")],
          date: ago(1 * DAY + 5 * HOUR),
          tracked: true,
          opens: [
            { at: ago(1 * DAY + 4 * HOUR), client: "iPhone · Gmail" },
            { at: ago(52 * MINUTE), client: "Mac · Outlook" },
          ],
          html: `<p>Díky, Tomáši! Poznámky jsem prošel, většinu zapracuju do čtvrtka. K té rezervaci stolů — chcete napojit váš stávající systém, nebo stačí formulář?</p>
<p>Daniel</p>`,
        },
        {
          id: "m_tomas_3",
          from: p("Tomáš Malý", "tomas@kavarna-ruze.example"),
          to: [me.studio],
          cc: [p("Lucie Malá", "lucie@kavarna-ruze.example")],
          date: ago(46 * MINUTE),
          html: `<p>Formulář zatím stačí, systém řešíme až na jaře.</p>
<p>Ještě jedna věc: dalo by se na úvodní stránku přidat sezónní nabídku, kterou bychom si měnili sami? Lucie by to ráda spravovala bez vás, ať vás neotravujeme s každou dýní.</p>
<p>Díky moc,<br>Tomáš</p>`,
        },
      ],
    },
    {
      id: "t_ucetni",
      accountId: "acc_seznam",
      subject: "Podklady za září",
      unread: true,
      pinned: true,
      folder: "inbox",
      kind: "person",
      messages: [
        {
          id: "m_ucetni_1",
          from: p("Martina Dvořáková", "dvorakova@ucetni.example"),
          to: [me.seznam],
          date: ago(2 * HOUR + 10 * MINUTE),
          html: `<p>Dobrý den,</p>
<p>prosím o zaslání podkladů za září do <strong>15. 10.</strong> — vydané a přijaté faktury, výpis z účtu a případné doklady za cestovné.</p>
<p>Děkuji a přeji hezký den,<br>Martina Dvořáková</p>`,
        },
      ],
    },
    {
      id: "t_github",
      accountId: "acc_studio",
      subject: "[email-client] Review requested: Sklo layout (#12)",
      unread: true,
      pinned: false,
      folder: "inbox",
      kind: "notification",
      logo: "github.com",
      messages: [
        {
          id: "m_github_1",
          from: p("GitHub", "notifications@github.com"),
          to: [me.studio],
          date: ago(3 * HOUR + 20 * MINUTE),
          html: `<p><strong>okriz</strong> requested your review on <a href="#">#12 Sklo layout: three-column shell with tabs</a>.</p>
<p>+842 −117 across 14 files. 2 checks passed.</p>`,
        },
      ],
    },
    {
      id: "t_vercel",
      accountId: "acc_studio",
      subject: "Deployment ready: email-client",
      unread: false,
      pinned: false,
      folder: "inbox",
      kind: "notification",
      logo: "vercel.com",
      messages: [
        {
          id: "m_vercel_1",
          from: p("Vercel", "notifications@vercel.com"),
          to: [me.studio],
          date: ago(4 * HOUR + 5 * MINUTE),
          html: `<p>Your deployment of <strong>email-client</strong> is ready.</p>
<p>Branch <code>feat/sklo-tabs</code> · built in 38s</p>
<p><a class="cta" href="#">Visit preview</a></p>`,
        },
      ],
    },
    {
      id: "t_lenny",
      accountId: "acc_personal",
      subject: "How the best product teams say no",
      unread: true,
      pinned: false,
      folder: "inbox",
      kind: "newsletter",
      messages: [
        {
          id: "m_lenny_1",
          from: p("Lenny's Newsletter", "lenny@substack.com"),
          to: [me.personal],
          date: ago(6 * HOUR + 40 * MINUTE),
          html: `<h2>How the best product teams say no</h2>
<p>Every great product is defined as much by what it leaves out as by what it includes. This week, I talked to twelve product leaders about how they protect focus.</p>
<ul><li>Keep a visible "not now" list, so ideas never feel lost</li><li>Tie every yes to a single outcome</li><li>Make saying no cheap and reversible</li></ul>
<p><a class="cta" href="#">Read the full post</a></p>`,
        },
      ],
    },
    {
      id: "t_klara",
      accountId: "acc_studio",
      subject: "Moodboard pro rebranding",
      unread: false,
      pinned: true,
      folder: "inbox",
      kind: "person",
      messages: [
        {
          id: "m_klara_0a",
          from: p("Klára Horáková", "klara@horakova.example"),
          to: [me.studio],
          date: ago(6 * DAY + 2 * HOUR),
          html: `<p>Ahoj Danieli,</p><p>posílám první směr moodboardu, ať máme od čeho se odrazit. Je to zatím dost široké.</p><p>K.</p>`,
          attachments: [{ name: "moodboard-v1.pdf", size: "6.1 MB", kind: "pdf" }],
        },
        {
          id: "m_klara_0b",
          from: me.studio,
          to: [p("Klára Horáková", "klara@horakova.example")],
          date: ago(5 * DAY + 4 * HOUR),
          html: `<p>Díky! Líbí se mi hlavně ta skleněná část. Přikládám pár skic loga, ať vidíš, kam to táhnu.</p>`,
          attachments: [
            { name: "logo-skici.png", size: "2.4 MB", kind: "image" },
            { name: "logo-skici-2.png", size: "1.9 MB", kind: "image" },
          ],
        },
        {
          id: "m_klara_0c",
          from: p("Klára Horáková", "klara@horakova.example"),
          to: [me.studio],
          date: ago(4 * DAY + 1 * HOUR),
          html: `<p>Super. Ještě otázka k barvám — chceš zůstat u studené modrozelené, nebo zkusíme i teplejší variantu?</p>`,
        },
        {
          id: "m_klara_0d",
          from: me.studio,
          to: [p("Klára Horáková", "klara@horakova.example")],
          date: ago(3 * DAY + 6 * HOUR),
          html: `<p>Zkusme obě. Do tabulky jsem dal pár variant i s kontrastem textu.</p>`,
          attachments: [{ name: "varianty-barev.xlsx", size: "48 KB", kind: "sheet" }],
        },
        {
          id: "m_klara_1",
          from: p("Klára Horáková", "klara@horakova.example"),
          to: [me.studio],
          date: at(-1, 16, 20, now),
          html: `<p>Ahoj,</p>
<p>posílám druhou verzi moodboardu. Šla jsem víc do měkkých materiálů — matné sklo, papír, přirozené světlo. Myslím, že to sedí k tomu, co jsi popisoval.</p>
<p>Reference jsou v zipu, kdybys chtěl něco vyhodit, klidně piš rovnou do PDF.</p>
<p>K.</p>`,
          attachments: [
            { name: "moodboard-v2.pdf", size: "8.4 MB", kind: "pdf" },
            { name: "reference.zip", size: "24 MB", kind: "zip" },
          ],
        },
      ],
    },
    {
      id: "t_airbnb",
      accountId: "acc_personal",
      subject: "Your reservation in Lisbon is confirmed",
      unread: false,
      pinned: false,
      folder: "inbox",
      kind: "notification",
      logo: "airbnb.com",
      messages: [
        {
          id: "m_airbnb_1",
          from: p("Airbnb", "automated@airbnb.com"),
          to: [me.personal],
          date: at(-1, 11, 2, now),
          html: `<h2>Pack your bags — you're going to Lisbon!</h2>
<p>Bright loft in Alfama · 14–19 Nov · 2 guests</p>
<p>Check-in after 15:00. Your host Inês will send directions a few days before arrival.</p>
<p><a class="cta" href="#">View itinerary</a></p>`,
        },
      ],
    },
    {
      id: "t_alza",
      accountId: "acc_seznam",
      subject: "Vaše objednávka byla odeslána",
      unread: false,
      pinned: false,
      folder: "inbox",
      kind: "notification",
      logo: "alza.cz",
      messages: [
        {
          id: "m_alza_1",
          from: p("Alza.cz", "objednavky@alza.cz"),
          to: [me.seznam],
          date: at(-1, 9, 45, now),
          html: `<p>Dobrý den,</p><p>objednávka <strong>č. 412 889 301</strong> byla předána dopravci. Doručení očekávejte zítra mezi 10:00 a 14:00.</p><p><a class="cta" href="#">Sledovat zásilku</a></p>`,
        },
      ],
    },
    {
      id: "t_mama",
      accountId: "acc_personal",
      subject: "Nedělní oběd",
      unread: false,
      pinned: false,
      folder: "inbox",
      kind: "person",
      messages: [
        {
          id: "m_mama_1",
          from: p("Máma", "jana.svobodova@example.cz"),
          to: [me.personal],
          date: ago(2 * DAY + 2 * HOUR),
          html: `<p>Ahoj Dane, přijedeš v neděli na oběd? Bude svíčková. Vezmi s sebou tu krabici od jablek, ať ji máme na podzim. Pa, máma</p>`,
        },
        {
          id: "m_mama_2",
          from: me.personal,
          to: [p("Máma", "jana.svobodova@example.cz")],
          date: ago(2 * DAY + 1 * HOUR),
          html: `<p>Jasně, přijedu kolem dvanácté a krabici vezmu. Dan</p>`,
        },
      ],
    },
    {
      id: "t_figma",
      accountId: "acc_studio",
      subject: "Ondřej commented on “Mail client — Sklo”",
      unread: false,
      pinned: false,
      folder: "inbox",
      kind: "notification",
      logo: "figma.com",
      messages: [
        {
          id: "m_figma_1",
          from: p("Figma", "comments@figma.com"),
          to: [me.studio],
          date: ago(2 * DAY + 6 * HOUR),
          html: `<p><strong>Ondřej Kříž</strong> commented on <strong>Mail client — Sklo</strong>:</p><blockquote>The floating toolbar feels great. Can we try it 4px smaller on mobile?</blockquote><p><a class="cta" href="#">Reply in Figma</a></p>`,
        },
      ],
    },
    {
      id: "t_fio",
      accountId: "acc_seznam",
      subject: "Výpis z účtu za září",
      unread: false,
      pinned: false,
      folder: "inbox",
      kind: "notification",
      logo: "fio.cz",
      messages: [
        {
          id: "m_fio_1",
          from: p("Fio banka", "vypisy@fio.cz"),
          to: [me.seznam],
          date: ago(3 * DAY + 1 * HOUR),
          html: `<p>Dobrý den, v příloze zasíláme výpis z účtu za období 1. 9. – 30. 9. 2026.</p>`,
          attachments: [{ name: "vypis-2026-09.pdf", size: "212 KB", kind: "pdf" }],
        },
      ],
    },
    {
      id: "t_calendar",
      accountId: "acc_studio",
      subject: "Invitation: Design review @ Thu 10:00",
      unread: false,
      pinned: false,
      folder: "inbox",
      kind: "notification",
      logo: "calendar.google.com",
      messages: [
        {
          id: "m_cal_1",
          from: p("Ondřej Kříž", "ondrej@kriz.example"),
          to: [me.studio],
          date: ago(3 * DAY + 4 * HOUR),
          html: `<p><strong>Design review — mail client</strong></p><p>Thursday · 10:00 – 11:00 · Google Meet</p><p>Let's go through the prototype together and decide on the branding.</p>`,
          attachments: [{ name: "invite.ics", size: "2 KB", kind: "calendar" }],
          invite: {
            method: "REQUEST",
            summary: "Design review — mail client",
            location: "",
            start: nextThursday(now, 10),
            end: nextThursday(now, 11),
            allDay: false,
            organizer: p("Ondřej Kříž", "ondrej@kriz.example"),
            joinUrl: "https://meet.google.com/abc-defg-hij",
          },
        },
      ],
    },
    {
      id: "t_stripe",
      accountId: "acc_personal",
      subject: "Your payout of €1,240.00 is on the way",
      unread: false,
      pinned: false,
      folder: "inbox",
      kind: "notification",
      logo: "stripe.com",
      messages: [
        {
          id: "m_stripe_1",
          from: p("Stripe", "notifications@stripe.com"),
          to: [me.personal],
          date: ago(4 * DAY + 2 * HOUR),
          html: `<p>A payout of <strong>€1,240.00</strong> is expected to arrive in your bank account on Friday.</p>`,
        },
      ],
    },
    {
      id: "t_ondrej",
      accountId: "acc_studio",
      subject: "Re: Sync engine — IMAP IDLE notes",
      unread: false,
      pinned: false,
      folder: "inbox",
      kind: "person",
      messages: [
        {
          id: "m_ondrej_1",
          from: me.studio,
          to: [p("Ondřej Kříž", "ondrej@kriz.example")],
          date: ago(5 * DAY + 3 * HOUR),
          html: `<p>Hele, máš zkušenost s IMAP IDLE ve větším měřítku? Přemýšlím, kolik spojení udrží jeden malý worker.</p>`,
        },
        {
          id: "m_ondrej_2",
          from: p("Ondřej Kříž", "ondrej@kriz.example"),
          to: [me.studio],
          date: ago(5 * DAY),
          html: `<p>Jo, s ImapFlow v pohodě stovky spojení na malém stroji. Hlavní je hlídat reconnecty a mít backoff, Seznam občas spojení po 30 minutách zavře.</p><p>Gmail bych řešil přes Pub/Sub, ne přes IDLE.</p>`,
        },
      ],
    },
    {
      id: "t_rohlik",
      accountId: "acc_personal",
      subject: "Zítra doručíme mezi 8:00 a 9:00",
      unread: false,
      pinned: false,
      folder: "inbox",
      kind: "notification",
      logo: "rohlik.cz",
      messages: [
        {
          id: "m_rohlik_1",
          from: p("Rohlik.cz", "info@rohlik.cz"),
          to: [me.personal],
          date: ago(6 * DAY),
          html: `<p>Vaše objednávka je připravená. Kurýr dorazí zítra mezi 8:00 a 9:00.</p>`,
        },
      ],
    },
    {
      id: "t_linear",
      accountId: "acc_studio",
      subject: "Weekly digest: 12 issues closed",
      unread: false,
      pinned: false,
      folder: "inbox",
      kind: "newsletter",
      logo: "linear.app",
      messages: [
        {
          id: "m_linear_1",
          from: p("Linear", "notifications@linear.app"),
          to: [me.studio],
          date: ago(9 * DAY),
          html: `<p>Your team closed <strong>12 issues</strong> last week. Top project: <strong>Mail client prototype</strong>.</p>`,
        },
      ],
    },
    {
      id: "t_insurance",
      accountId: "acc_personal",
      subject: "Pojištění auta — prodloužení smlouvy",
      unread: false,
      pinned: false,
      folder: "inbox",
      kind: "notification",
      snoozedUntil: at(1, 8, 0, now),
      messages: [
        {
          id: "m_ins_1",
          from: p("Moje pojišťovna", "info@mojepojistovna.cz"),
          to: [me.personal],
          date: ago(1 * DAY + 2 * HOUR),
          html: `<p>Dobrý den, vaše pojistná smlouva končí 31. 10. Prodloužení vyřídíte online během dvou minut.</p>`,
        },
      ],
    },
    {
      id: "t_booking",
      accountId: "acc_personal",
      subject: "Thanks for staying with us",
      unread: false,
      pinned: false,
      folder: "archive",
      kind: "notification",
      logo: "booking.com",
      messages: [
        {
          id: "m_booking_1",
          from: p("Booking.com", "noreply@booking.com"),
          to: [me.personal],
          date: ago(20 * DAY),
          html: `<p>How was your stay in Vienna? Leave a review and help other travellers.</p>`,
        },
      ],
    },
    {
      id: "t_code_vercel",
      accountId: "acc_studio",
      subject: "Your Vercel sign-in code",
      unread: true,
      pinned: false,
      folder: "inbox",
      kind: "notification",
      logo: "vercel.com",
      messages: [
        {
          id: "m_code_vercel_1",
          from: p("Vercel", "notifications@vercel.com"),
          to: [me.studio],
          date: ago(8 * MINUTE),
          html: `<p>Hi Daniel,</p><p>Your one-time sign-in code is <strong>482913</strong>. It expires in 10 minutes.</p><p>If you didn't request it, you can ignore this email.</p>`,
        },
      ],
    },
    {
      id: "t_trash_promo",
      accountId: "acc_seznam",
      subject: "Podzimní výprodej: až −60 %",
      unread: false,
      pinned: false,
      folder: "trash",
      kind: "newsletter",
      logo: "zoot.cz",
      messages: [
        {
          id: "m_trash_promo_1",
          from: p("ZOOT", "newsletter@zoot.cz"),
          to: [me.seznam],
          date: ago(2 * DAY + 3 * HOUR),
          html: `<p>Bundy, svetry a boty za zlomek ceny. Jen do neděle.</p>`,
        },
      ],
    },
    {
      id: "t_trash_meetup",
      accountId: "acc_personal",
      subject: "Meetup moved to Thursday",
      unread: false,
      pinned: false,
      folder: "trash",
      kind: "person",
      messages: [
        {
          id: "m_trash_meetup_1",
          from: p("Petra Malá", "petra.mala@example.com"),
          to: [me.personal],
          date: ago(5 * DAY),
          html: `<p>Ahoj, sraz přesouváme na čtvrtek, stejné místo. Petra</p>`,
        },
      ],
    },
    {
      id: "t_spam_prize",
      accountId: "acc_seznam",
      subject: "Gratulujeme! Vyhrál jste iPhone 17",
      unread: true,
      pinned: false,
      folder: "spam",
      kind: "notification",
      messages: [
        {
          id: "m_spam_prize_1",
          from: p("Výherní oddělení", "vyhra@cz-promo-win.top"),
          to: [me.seznam],
          date: ago(9 * HOUR),
          html: `<p>Stačí jen potvrdit doručovací údaje a zaplatit poštovné 1 Kč.</p>`,
        },
      ],
    },
    {
      id: "t_spam_invoice",
      accountId: "acc_studio",
      subject: "Faktura č. 2026-0412 k úhradě",
      unread: false,
      pinned: false,
      folder: "spam",
      kind: "person",
      messages: [
        {
          id: "m_spam_invoice_1",
          from: p("Lucie Benešová", "lucie@benesova.example"),
          to: [me.studio],
          date: ago(1 * DAY + 6 * HOUR),
          html: `<p>Dobrý den, v příloze posílám fakturu za ilustrace. Děkuji, Lucie</p>`,
        },
      ],
    },
    {
      id: "t_sent_tomas",
      accountId: "acc_studio",
      subject: "Návrh webu — první verze",
      unread: false,
      pinned: false,
      folder: "sent",
      kind: "person",
      followUpAt: at(1, 9, 0, now),
      awaiting: true,
      messages: [
        {
          id: "m_sent_tomas_1",
          from: me.studio,
          to: [p("Tomáš Malý", "tomas@kavarna-ruze.example")],
          date: ago(4 * DAY + 5 * HOUR),
          tracked: true,
          opens: [],
          html: `<p>Dobrý den, Tomáši,</p><p>posílám odkaz na první verzi návrhu. Budu rád za jakoukoli zpětnou vazbu.</p><p>Daniel</p>`,
        },
      ],
    },
    {
      // No reply yet: a question nobody answered for a week.
      id: "t_sent_pronajem",
      accountId: "acc_seznam",
      subject: "Prohlídka bytu v Dejvicích",
      unread: false,
      pinned: false,
      folder: "sent",
      kind: "person",
      awaiting: true,
      messages: [
        {
          id: "m_sent_pronajem_1",
          from: me.seznam,
          to: [p("Pavel Novotný", "novotny@reality.example")],
          date: ago(7 * DAY + 3 * HOUR),
          html: `<p>Dobrý den, pane Novotný,</p><p>byt v Dejvicích mě moc zaujal. Šlo by se na něj podívat ve čtvrtek nebo v pátek odpoledne?</p><p>Děkuji, Daniel Svoboda</p>`,
        },
      ],
    },
    {
      id: "t_sent_ucetni",
      accountId: "acc_seznam",
      subject: "Re: Srpnové faktury",
      unread: false,
      pinned: false,
      folder: "sent",
      kind: "person",
      messages: [
        {
          id: "m_sent_ucetni_1",
          from: me.seznam,
          to: [p("Martina Dvořáková", "dvorakova@ucetni.example")],
          date: ago(31 * DAY),
          tracked: true,
          opens: [{ at: ago(31 * DAY - 2 * MINUTE), client: "Apple Mail", viaApple: true }],
          html: `<p>Dobrý den, posílám faktury za srpen. Hezký den, Daniel Svoboda</p>`,
        },
      ],
    },
    {
      id: "t_scheduled",
      accountId: "acc_studio",
      subject: "Weekly update — mail client",
      unread: false,
      pinned: false,
      folder: "scheduled",
      kind: "person",
      scheduledAt: nextWeekday(1, 8, now),
      messages: [
        {
          id: "m_sched_1",
          from: me.studio,
          to: [p("Ondřej Kříž", "ondrej@kriz.example"), p("Klára Horáková", "klara@horakova.example")],
          date: now,
          html: `<p>Ahoj oba,</p><p>shrnutí týdne: prototyp Sklo je hotový, ve čtvrtek ho projdeme a rozhodneme branding.</p><p>Daniel</p>`,
        },
      ],
    },
  ];
}

export function buildDrafts(now = Date.now()): Draft[] {
  return [
    {
      id: "d_agent_ucetni",
      accountId: "acc_seznam",
      threadId: "t_ucetni",
      agentId: "ag_claude",
      to: "dvorakova@ucetni.example",
      cc: "",
      subject: "Re: Podklady za září",
      html: `<p>Dobrý den, paní Dvořáková,</p><p>v příloze posílám podklady za září:</p><ul><li>vydané a přijaté faktury</li><li>výpis z účtu z Fio banky</li></ul><p>Cestovné tento měsíc nemám.</p>`,
      updatedAt: now - 46 * MINUTE,
    },
    {
      id: "d_offer",
      accountId: "acc_studio",
      to: "hello@nordic-bakery.example",
      cc: "",
      subject: "Nabídka na redesign webu",
      html: `<p>Dobrý den,</p><p>děkuji za zájem o spolupráci. Posílám orientační nabídku:</p><ul><li>Analýza a návrh struktury</li><li>Design v Figmě (2 kola revizí)</li><li>Vývoj a spuštění</li></ul>`,
      updatedAt: now - 3 * HOUR,
    },
  ];
}

/* ------------------------------- MCP agents ------------------------------- */

export function buildAgents(now = Date.now()): Agent[] {
  return [
    { id: "ag_claude", name: "Claude", app: "Claude Desktop", logo: "claude.ai", permission: "full", accountIds: ["acc_personal", "acc_seznam", "acc_studio"], enabled: true, lastActiveAt: now - 46 * MINUTE },
    { id: "ag_chatgpt", name: "ChatGPT", app: "ChatGPT", logo: "chatgpt.com", permission: "draft", accountIds: ["acc_personal"], enabled: true, lastActiveAt: now - 3 * HOUR },
    { id: "ag_claude_code", name: "Claude Code", app: "Claude Code", logo: "claude.ai", permission: "full", accountIds: ["acc_studio"], enabled: true, lastActiveAt: at(-1, 18, 44, now) },
    { id: "ag_cursor", name: "Cursor", app: "Cursor", logo: "cursor.com", permission: "read", accountIds: ["acc_studio"], enabled: false, lastActiveAt: now - 2 * DAY - 4 * HOUR },
  ];
}

export const agentSessions: AgentSession[] = [
  { id: "s_ucetni", agentId: "ag_claude", title: "Připrav odpověď účetní s podklady za září" },
  { id: "s_cleanup", agentId: "ag_chatgpt", title: "Ukliď notifikace a staré maily v osobní schránce" },
  { id: "s_weekly", agentId: "ag_claude_code", title: "Naplánuj týdenní update pro Ondřeje a Kláru" },
  { id: "s_mama", agentId: "ag_claude", title: "Odpověz mámě, že v neděli přijedu" },
  { id: "s_vercel", agentId: "ag_cursor", title: "Find the latest Vercel preview link" },
];

export function buildAgentEvents(now = Date.now()): AgentEvent[] {
  const ago = (ms: number) => now - ms;
  const sec = 1000;
  return [
    { id: "e1", sessionId: "s_ucetni", at: ago(48 * MINUTE), action: "search", summary: "Searched for **faktury září**", accountId: "acc_seznam" },
    { id: "e2", sessionId: "s_ucetni", at: ago(47 * MINUTE), action: "read", summary: "Read **Podklady za září**", accountId: "acc_seznam", threadId: "t_ucetni" },
    { id: "e3", sessionId: "s_ucetni", at: ago(47 * MINUTE - 20 * sec), action: "read", summary: "Read **Výpis z účtu za září**", accountId: "acc_seznam", threadId: "t_fio" },
    { id: "e4", sessionId: "s_ucetni", at: ago(46 * MINUTE), action: "draft", summary: "Drafted a reply to **Martina Dvořáková**", accountId: "acc_seznam", threadId: "t_ucetni", undoable: true },

    { id: "e5", sessionId: "s_cleanup", at: ago(3 * HOUR + 4 * MINUTE), action: "list", summary: "Listed the **Inbox**", accountId: "acc_personal" },
    { id: "e6", sessionId: "s_cleanup", at: ago(3 * HOUR + 3 * MINUTE), action: "archive", summary: "Archived **Thanks for staying with us**", accountId: "acc_personal", threadId: "t_booking", undoable: true },
    { id: "e7", sessionId: "s_cleanup", at: ago(3 * HOUR + 2 * MINUTE), action: "mark_read", summary: "Marked **Zítra doručíme mezi 8:00 a 9:00** as read", accountId: "acc_personal", threadId: "t_rohlik", undoable: true },
    { id: "e8", sessionId: "s_cleanup", at: ago(3 * HOUR), action: "snooze", summary: "Snoozed **Pojištění auta — prodloužení smlouvy** until tomorrow", accountId: "acc_personal", threadId: "t_insurance", undoable: true },

    { id: "e9", sessionId: "s_weekly", at: at(-1, 18, 40, now), action: "search", summary: "Searched for **mail client**", accountId: "acc_studio" },
    { id: "e10", sessionId: "s_weekly", at: at(-1, 18, 41, now), action: "read", summary: "Read **Re: Sync engine — IMAP IDLE notes**", accountId: "acc_studio", threadId: "t_ondrej" },
    { id: "e11", sessionId: "s_weekly", at: at(-1, 18, 44, now), action: "schedule", summary: "Scheduled **Weekly update — mail client** for Monday 08:00", accountId: "acc_studio", threadId: "t_scheduled", undoable: true },

    { id: "e12", sessionId: "s_mama", at: ago(2 * DAY + 1 * HOUR + 2 * MINUTE), action: "read", summary: "Read **Nedělní oběd**", accountId: "acc_personal", threadId: "t_mama" },
    { id: "e13", sessionId: "s_mama", at: ago(2 * DAY + 1 * HOUR), action: "send", summary: "Sent a reply to **Máma**: „Jasně, přijedu kolem dvanácté a krabici vezmu.“", accountId: "acc_personal", threadId: "t_mama" },

    { id: "e14", sessionId: "s_vercel", at: ago(2 * DAY + 4 * HOUR + 1 * MINUTE), action: "search", summary: "Searched for **deployment ready**", accountId: "acc_studio" },
    { id: "e15", sessionId: "s_vercel", at: ago(2 * DAY + 4 * HOUR), action: "read", summary: "Read **Deployment ready: email-client**", accountId: "acc_studio", threadId: "t_vercel" },
  ];
}
