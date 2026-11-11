import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { BRAND } from "@/lib/brand";
import { translate, translateCount, type Locale } from "@/lib/i18n";
import { FEATURE_GROUPS, FEATURE_LABELS } from "@/lib/usage";
import { adminOverview, isAdmin, type AdminOverview } from "@/server/admin";
import { getUser } from "@/server/auth/session";
import { pageLocale } from "@/server/i18n";
import { usageOverview, type UsageOverview } from "@/server/usage";
import { PlusGiftButton } from "./plus-gift";

export const metadata: Metadata = {
  title: `Admin · ${BRAND.name}`,
  robots: { index: false },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** The operator's overview: who signed up, what they use, and what people tell us. Only for ADMIN_EMAILS. */
export default function AdminPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <main className="canvas min-h-dvh px-4 pt-[max(env(safe-area-inset-top),32px)] pb-[max(var(--safe-bottom),32px)]">
      <Suspense fallback={null}>
        <Overview searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Overview({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const [user, locale, params] = await Promise.all([getUser(), pageLocale(), searchParams]);
  if (!user) redirect("/login?next=/admin");
  // Anyone else gets the same 404 as a page that doesn't exist.
  if (!isAdmin(user.email)) notFound();
  const data = await adminOverview();
  // The operator clicks around the most; ?usage=others leaves admins' own clicks out.
  const others = params.usage === "others";
  const usage = await usageOverview(others ? data.users.filter((u) => isAdmin(u.email)).map((u) => u.id) : []);

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-6">
      <header className="flex items-baseline justify-between gap-4">
        <h1 className="text-[26px] font-bold tracking-[-0.02em]">{translate(locale, "Admin")}</h1>
        <Link href="/" className="text-[13px] font-medium text-accent-text hover:underline">
          {translate(locale, "Back to {app}", { app: BRAND.name })}
        </Link>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={translate(locale, "Users")} value={String(data.users.length)} />
        <Stat label={translate(locale, "Active in the last 7 days")} value={String(data.activeWeek)} />
        <Stat label={translate(locale, "Mailboxes with an error")} value={String(data.mailboxErrors)} warn={data.mailboxErrors > 0} />
        <Stat
          label={translate(locale, "NPS, last 90 days")}
          value={data.nps.score === null ? "—" : String(data.nps.score)}
          hint={translateCount(locale, data.nps.answers, "{n} answer", "{n} answers")}
        />
        <Stat label={translate(locale, "AI, last 30 days")} value={money(data.ai.month)} hint={translate(locale, "Today {cost}", { cost: money(data.ai.today) })} />
        <Stat
          label={translate(locale, "Paying for Plus")}
          value={String(data.plus.paying)}
          hint={[translateCount(locale, data.plus.gifts, "{n} gift", "{n} gifts"), translateCount(locale, data.plus.trials, "{n} trial", "{n} trials")].join(" · ")}
        />
        <Stat
          label={translate(locale, "Hidden cards, 30 days")}
          value={data.cards.month ? percent(locale, data.cards.hidden / data.cards.month) : "—"}
          hint={translate(locale, "{hidden} of {cards} cards", { hidden: String(data.cards.hidden), cards: String(data.cards.month) })}
          warn={data.cards.month >= 50 && data.cards.hidden / data.cards.month > 0.05}
        />
        <Stat label={translate(locale, "Asked for setup help")} value={String(data.waitlist.length)} />
        <Stat
          label={translate(locale, "Opened the calendar")}
          value={data.users.length ? `${data.calendar.opened} · ${percent(locale, data.calendar.opened / data.users.length)}` : "—"}
          hint={translate(locale, "{week} in the last 7 days · {month} in 30", { week: String(data.calendar.week), month: String(data.calendar.month) })}
        />
        <Stat label={translate(locale, "Have a calendar connected")} value={String(data.calendar.connected)} />
      </div>

      <Usage usage={usage} others={others} locale={locale} />
      <Users data={data} locale={locale} />
      <Waitlist data={data} locale={locale} />
      <Feedback data={data} locale={locale} />
    </div>
  );
}

function Stat({ label, value, hint, warn }: { label: string; value: string; hint?: string; warn?: boolean }) {
  return (
    <div className="rounded-[16px] bg-solid px-4 py-3 shadow-[inset_0_0_0_0.5px_var(--line)]">
      <div className="text-[12px] text-ink-3">{label}</div>
      <div className={warn ? "mt-0.5 text-[24px] font-semibold text-danger" : "mt-0.5 text-[24px] font-semibold"}>{value}</div>
      {hint && <div className="text-[11.5px] text-ink-3">{hint}</div>}
    </div>
  );
}

/** Estimated spend, with cents (the amounts are small). */
const money = (usd: number) => `$${usd.toFixed(2)}`;
const percent = (locale: Locale, share: number) => new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }).format(share);
const day = (locale: Locale, ms: number) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "numeric", year: "numeric", timeZone: "Europe/Prague" }).format(ms);

/** Plus as the operator needs it: who pays (until when), who has it from us, who's trying it. */
function plusLabel(locale: Locale, u: AdminOverview["users"][number]) {
  const p = u.plus;
  if (p.source === "subscription") {
    const what = p.interval === "year" ? translate(locale, "Paying yearly") : translate(locale, "Paying monthly");
    if (p.pastDue) return `${what} · ${translate(locale, "payment failed")}`;
    if (p.cancelsAtEnd && p.periodEnd) return `${what} · ${translate(locale, "ends {date}", { date: day(locale, p.periodEnd) })}`;
    return what;
  }
  if (p.source === "gift") return translate(locale, "Gift");
  if (p.level === "trial") return translate(locale, "Trial until {date}", { date: day(locale, p.trialEndsAt!) });
  return p.trialUsed ? translate(locale, "Trial ended") : translate(locale, "Free");
}

const formatDate = (locale: Locale, d: Date | null) =>
  d ? new Intl.DateTimeFormat(locale, { day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Prague" }).format(d) : "—";

/** What people use, by area of the app: everything in the list shows, so unused features stand out too. */
function Usage({ usage, others, locale }: { usage: UsageOverview; others: boolean; locale: Locale }) {
  const byFeature = new Map(usage.stats.map((s) => [s.feature, s]));
  const percent = new Intl.NumberFormat(locale, { style: "percent" });
  const filter = (active: boolean) =>
    active ? "rounded-[8px] bg-solid px-2.5 py-1 font-medium text-ink shadow-[0_1px_2px_rgb(0_0_0/0.08),0_0_0_0.5px_var(--line)]" : "rounded-[8px] px-2.5 py-1 text-ink-2 hover:text-ink";
  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 pb-2">
        <h2 className="text-[13px] font-semibold text-ink-2">
          {translate(locale, "Feature usage")}
          <span className="font-normal text-ink-3"> · {translate(locale, "last 30 days")}</span>
        </h2>
        <nav className="flex rounded-[10px] bg-hover p-0.5 text-[12.5px]">
          <Link href="/admin" replace scroll={false} className={filter(!others)}>
            {translate(locale, "Everyone")}
          </Link>
          <Link href="/admin?usage=others" replace scroll={false} className={filter(others)}>
            {translate(locale, "Without admins")}
          </Link>
        </nav>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {FEATURE_GROUPS.map((group) => {
          const rows = group.features
            .map((feature) => ({ feature, users: 0, week: 0, month: 0, ...byFeature.get(feature) }))
            .sort((a, b) => b.month - a.month || b.users - a.users);
          return (
            <div key={group.title} className="overflow-hidden rounded-[16px] bg-solid shadow-[inset_0_0_0_0.5px_var(--line)]">
              <table className="w-full text-left text-[13px]">
                <thead className="text-[11.5px] text-ink-3">
                  <tr className="border-b border-line">
                    <th className="px-4 py-2.5 font-semibold text-ink-2">{translate(locale, group.title)}</th>
                    <th className="w-[38%] px-2 py-2.5 font-medium">{translate(locale, "People")}</th>
                    <th className="px-2 py-2.5 text-right font-medium">{translate(locale, "7 days")}</th>
                    <th className="py-2.5 pr-4 pl-2 text-right font-medium">{translate(locale, "30 days")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((r) => {
                    const share = usage.activeUsers ? r.users / usage.activeUsers : 0;
                    return (
                      <tr key={r.feature} className={r.month ? "" : "text-ink-3"}>
                        <td className="px-4 py-2">{translate(locale, FEATURE_LABELS[r.feature])}</td>
                        <td className="px-2 py-2">
                          <div className="flex items-center gap-2">
                            <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-hover">
                              <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.round(share * 100)}%` }} />
                            </span>
                            <span className="w-[68px] shrink-0 text-right text-[12px] whitespace-nowrap text-ink-2 tabular-nums">
                              {r.users ? `${r.users} · ${percent.format(share)}` : "—"}
                            </span>
                          </div>
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums">{r.week || "—"}</td>
                        <td className="py-2 pr-4 pl-2 text-right font-medium tabular-nums">{r.month || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
      <p className="px-1 pt-2 text-[11.5px] text-ink-3">
        {translateCount(locale, usage.activeUsers, "Counts of opens and uses. The bar is the share of the {n} person who used anything in the last 30 days.", "Counts of opens and uses. The bar is the share of the {n} people who used anything in the last 30 days.")}
      </p>
    </section>
  );
}

function Users({ data, locale }: { data: AdminOverview; locale: Locale }) {
  return (
    <section>
      <h2 className="px-1 pb-2 text-[13px] font-semibold text-ink-2">{translate(locale, "Registered users")}</h2>
      <div className="overflow-x-auto rounded-[16px] bg-solid shadow-[inset_0_0_0_0.5px_var(--line)]">
        <table className="w-full min-w-[1240px] text-left text-[13px]">
          <thead className="text-[11.5px] text-ink-3">
            <tr className="border-b border-line">
              <th className="px-4 py-2.5 font-medium">{translate(locale, "User")}</th>
              <th className="px-3 py-2.5 font-medium">{translate(locale, "Signed up")}</th>
              <th className="px-3 py-2.5 font-medium">{translate(locale, "Last active")}</th>
              <th className="px-3 py-2.5 font-medium">{translate(locale, "Last MCP use")}</th>
              <th className="px-3 py-2.5 font-medium">{translate(locale, "Mailboxes")}</th>
              <th className="px-3 py-2.5 font-medium">{translate(locale, "Devices")}</th>
              <th className="px-3 py-2.5 font-medium">{translate(locale, "AI agents")}</th>
              <th className="px-3 py-2.5 font-medium">{translate(locale, "Calendar")}</th>
              <th className="px-3 py-2.5 font-medium">{translate(locale, "Smart categories")}</th>
              <th className="px-3 py-2.5 font-medium">Plus</th>
              <th className="px-3 py-2.5 font-medium">{translate(locale, "AI, 30 days")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {data.users.map((u) => (
              <tr key={u.id} className="align-top">
                <td className="px-4 py-3">
                  <div className="font-medium text-ink">{u.email}</div>
                  {u.name && <div className="text-[12px] text-ink-3">{u.name}</div>}
                </td>
                <td className="px-3 py-3 whitespace-nowrap text-ink-2 tabular-nums">{formatDate(locale, u.createdAt)}</td>
                <td className="px-3 py-3 whitespace-nowrap text-ink-2 tabular-nums">{formatDate(locale, u.lastSeenAt)}</td>
                <td className="px-3 py-3 whitespace-nowrap text-ink-2 tabular-nums">
                  {formatDate(locale, u.lastMcp?.at ?? null)}
                  {u.lastMcp?.app && <div className="text-[11.5px] text-ink-3">{u.lastMcp.app}</div>}
                </td>
                <td className="px-3 py-3">
                  {u.mailboxes.length ? (
                    <ul className="flex flex-col gap-0.5">
                      {u.mailboxes.map((m) => (
                        <li key={m.email} className="flex items-center gap-1.5 text-ink-2">
                          <span
                            className={m.status === "ok" ? "size-1.5 rounded-full bg-success" : m.status === "syncing" ? "size-1.5 rounded-full bg-ink-3" : "size-1.5 rounded-full bg-danger"}
                            title={m.status}
                          />
                          <span className="truncate">{m.email}</span>
                          <span className="text-[11.5px] text-ink-3">{m.provider}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-ink-3">—</span>
                  )}
                </td>
                <td className="px-3 py-3 whitespace-nowrap text-ink-2 tabular-nums">
                  {u.devices.signedIn || "—"}
                  {u.devices.signedIn > 0 && (
                    <div className="text-[11.5px] text-ink-3">
                      {u.devices.notifications
                        ? translate(locale, "{n} with notifications", { n: String(u.devices.notifications) })
                        : translate(locale, "No notifications")}
                    </div>
                  )}
                </td>
                <td className="px-3 py-3 text-ink-2 tabular-nums">{u.agents || "—"}</td>
                <td className="px-3 py-3 whitespace-nowrap text-ink-2">
                  <CalendarUse u={u} locale={locale} />
                </td>
                <td className="px-3 py-3 text-ink-2">
                  {u.smartCategories ? translate(locale, "On") : translate(locale, "Off")}
                  {u.cards.month > 0 && (
                    <div className="text-[11.5px] whitespace-nowrap text-ink-3">
                      {translate(locale, "{hidden} of {cards} cards hidden", { hidden: String(u.cards.hidden), cards: String(u.cards.month) })}
                    </div>
                  )}
                </td>
                <td className="px-3 py-3 text-ink-2">
                  <div className="whitespace-nowrap">{plusLabel(locale, u)}</div>
                  {u.plus.source !== "subscription" && (
                    <PlusGiftButton
                      userId={u.id}
                      gifted={u.plus.source === "gift"}
                      labels={{ give: translate(locale, "Give Plus for free"), take: translate(locale, "Take the gift back"), failed: translate(locale, "That didn't work. Try again.") }}
                    />
                  )}
                </td>
                <td className="px-3 py-3 whitespace-nowrap text-ink-2 tabular-nums">
                  {u.ai.month ? money(u.ai.month) : "—"}
                  {u.ai.today > 0 && <div className="text-[11.5px] text-ink-3">{translate(locale, "Today {cost}", { cost: money(u.ai.today) })}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const CALENDAR_KINDS: Record<string, string> = { google: "Google", microsoft: "Microsoft", caldav: "CalDAV", feed: ".ics", local: "Kolbaba" };

/** Has this person ever opened the calendar, how often lately, and what they connected. */
function CalendarUse({ u, locale }: { u: AdminOverview["users"][number]; locale: Locale }) {
  const c = u.calendar;
  if (!c.firstOpenedAt && !c.calendars) return <span className="text-ink-3">{translate(locale, "Never opened")}</span>;
  return (
    <>
      {c.days
        ? translateCount(locale, c.days, "{n} day of the last 30", "{n} days of the last 30")
        : c.firstOpenedAt
          ? translate(locale, "Not in the last 30 days")
          : translate(locale, "Never opened")}
      <div className="text-[11.5px] text-ink-3">
        {[
          c.firstOpenedAt ? translate(locale, "first {date}", { date: day(locale, c.firstOpenedAt.getTime()) }) : null,
          c.lastOpenedAt && c.days ? translate(locale, "last {date}", { date: day(locale, c.lastOpenedAt.getTime()) }) : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </div>
      <div className="text-[11.5px] text-ink-3">
        {[
          c.calendars ? `${translateCount(locale, c.calendars, "{n} calendar", "{n} calendars")} (${c.kinds.map((k) => CALENDAR_KINDS[k] ?? k).join(", ")})` : translate(locale, "No calendar connected"),
          c.eventsMade ? translateCount(locale, c.eventsMade, "{n} event made", "{n} events made") : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </div>
    </>
  );
}

function runsOnLabel(locale: Locale, runsOn: AdminOverview["waitlist"][number]["runsOn"]) {
  if (runsOn === "vps") return "VPS";
  return runsOn === "home" ? translate(locale, "At home") : translate(locale, "Not sure yet");
}

function Waitlist({ data, locale }: { data: AdminOverview; locale: Locale }) {
  const sources = new Map<string, number>();
  for (const w of data.waitlist) {
    const source = w.ref ?? translate(locale, "No source");
    sources.set(source, (sources.get(source) ?? 0) + 1);
  }
  return (
    <section>
      <h2 className="px-1 pb-2 text-[13px] font-semibold text-ink-2">{translate(locale, "Help with your own server")}</h2>
      {data.waitlist.length > 0 && (
        <p className="px-1 pb-2 text-[12.5px] text-ink-3 tabular-nums">
          {[...sources].sort((a, b) => b[1] - a[1]).map(([source, count]) => `${source} ${count}`).join(" · ")}
        </p>
      )}
      {data.waitlist.length ? (
        <div className="overflow-x-auto rounded-[16px] bg-solid shadow-[inset_0_0_0_0.5px_var(--line)]">
          <table className="w-full min-w-[720px] text-left text-[13px]">
            <thead className="text-[11.5px] text-ink-3">
              <tr className="border-b border-line">
                <th className="px-4 py-2.5 font-medium">{translate(locale, "Email")}</th>
                <th className="px-3 py-2.5 font-medium">{translate(locale, "Joined")}</th>
                <th className="px-3 py-2.5 font-medium">{translate(locale, "Where it will run")}</th>
                <th className="px-3 py-2.5 font-medium">{translate(locale, "Language")}</th>
                <th className="px-3 py-2.5 font-medium">{translate(locale, "Source")}</th>
                <th className="px-3 py-2.5 font-medium">{translate(locale, "What it's for")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.waitlist.map((w) => (
                <tr key={w.id} className="align-top">
                  <td className="px-4 py-3 font-medium">
                    <a href={`mailto:${w.email}`} className="text-ink hover:underline">
                      {w.email}
                    </a>
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap text-ink-2 tabular-nums">{formatDate(locale, w.createdAt)}</td>
                  <td className="px-3 py-3 whitespace-nowrap text-ink-2">{runsOnLabel(locale, w.runsOn)}</td>
                  <td className="px-3 py-3 text-ink-2 uppercase">{w.lang}</td>
                  <td className="px-3 py-3 whitespace-nowrap text-ink-2">{w.ref ?? "—"}</td>
                  <td className="px-3 py-3 whitespace-pre-wrap text-ink-2">{w.note || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="px-1 text-[13px] text-ink-3">{translate(locale, "Nothing yet.")}</p>
      )}
    </section>
  );
}

function Feedback({ data, locale }: { data: AdminOverview; locale: Locale }) {
  return (
    <section>
      <h2 className="px-1 pb-2 text-[13px] font-semibold text-ink-2">{translate(locale, "Feedback")}</h2>
      {data.feedback.length ? (
        <ul className="divide-y divide-line overflow-hidden rounded-[16px] bg-solid shadow-[inset_0_0_0_0.5px_var(--line)]">
          {data.feedback.map((f) => (
            <li key={f.id} className="flex gap-3 px-4 py-3">
              <span
                className={
                  f.kind === "idea"
                    ? "flex h-6 shrink-0 items-center rounded-full bg-accent-soft px-2 text-[11.5px] font-medium text-accent-text"
                    : "flex h-6 w-9 shrink-0 items-center justify-center rounded-full bg-hover text-[12px] font-semibold tabular-nums"
                }
              >
                {f.kind === "idea" ? translate(locale, "Idea") : f.score}
              </span>
              <div className="min-w-0 flex-1">
                {f.text ? <p className="text-[13.5px] leading-relaxed whitespace-pre-wrap text-ink">{f.text}</p> : <p className="text-[13px] text-ink-3">{translate(locale, "No comment")}</p>}
                <div className="mt-1 text-[11.5px] text-ink-3">
                  {[f.email ?? translate(locale, "Deleted account"), f.device, formatDate(locale, f.createdAt), f.contact ? translate(locale, "May be contacted") : null].filter(Boolean).join(" · ")}
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-1 text-[13px] text-ink-3">{translate(locale, "Nothing yet.")}</p>
      )}
    </section>
  );
}
