"use client";

import {
  Archive,
  CalendarClock,
  CalendarDays,
  Check,
  ChevronDown,
  Clock,
  Copy,
  Eye,
  FilePen,
  Inbox,
  MailMinus,
  MailOpen,
  Pin,
  Search,
  Send,
  Settings2,
  SquareArrowOutUpRight,
  StickyNote,
  Trash2,
  Undo2,
  UserRoundCheck,
  type LucideIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { DropdownMenu, Popover } from "radix-ui";
import { useMemo, useState, useSyncExternalStore } from "react";
import { describeStep, type StepFormat } from "@/lib/agent-steps";
import { BRAND } from "@/lib/brand";
import { intlLocale, t, tk, tn } from "@/lib/i18n";
import { api, LIVE } from "@/lib/live";
import { folderLabel, useMail } from "@/lib/store";
import type { Agent, AgentAction, AgentEvent, AgentPermission, FolderId } from "@/lib/types";
import { useNow } from "@/lib/use-now";
import { cn, dateGroup, formatListTime, initials } from "@/lib/utils";
import { HistoryView } from "./history";
import { confirmAction } from "./confirm";
import { MailboxBadge, Segmented, Tooltip, hueStyle, logoSrc, menuContentClass, menuItemClass, spring } from "./ui";

const MCP_URL = `https://app.${BRAND.name.toLowerCase()}.app/api/mcp`;

const subscribeNever = () => () => {};
/** Live mode serves MCP from this very origin; the prototype shows a placeholder address. */
export function useMcpUrl() {
  return useSyncExternalStore(subscribeNever, () => (LIVE ? `${location.origin}/api/mcp` : MCP_URL), () => MCP_URL);
}

const PERMISSIONS: Record<AgentPermission, { label: string; hint: string }> = {
  read: { label: tk("Read only"), hint: tk("Search and read mail") },
  draft: { label: tk("Organize & draft"), hint: tk("Also archive, delete, file, snooze, add notes and write drafts") },
  full: { label: tk("Full access"), hint: tk("Everything, including sending and unsubscribing") },
};

const ACTIONS: Record<AgentAction, { icon: LucideIcon; tone: "quiet" | "change" | "send" }> = {
  search: { icon: Search, tone: "quiet" },
  list: { icon: Inbox, tone: "quiet" },
  read: { icon: Eye, tone: "quiet" },
  draft: { icon: FilePen, tone: "change" },
  archive: { icon: Archive, tone: "change" },
  mark_read: { icon: MailOpen, tone: "change" },
  snooze: { icon: Clock, tone: "change" },
  pin: { icon: Pin, tone: "change" },
  schedule: { icon: CalendarClock, tone: "send" },
  send: { icon: Send, tone: "send" },
  trash: { icon: Trash2, tone: "change" },
  unsubscribe: { icon: MailMinus, tone: "send" },
  note: { icon: StickyNote, tone: "change" },
  screen: { icon: UserRoundCheck, tone: "change" },
};

/** 09:41 in the app's language (made on first use, once per language). */
const timeFmts = new Map<string, Intl.DateTimeFormat>();
function timeFmt() {
  const locale = intlLocale();
  let f = timeFmts.get(locale);
  if (!f) timeFmts.set(locale, (f = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" })));
  return f;
}

function formatAgo(ts: number, now: number) {
  const diff = now - ts;
  if (diff < 60_000) return t("just now");
  if (diff < 3_600_000) return t("{n} min ago", { n: Math.round(diff / 60_000) });
  if (diff < 86_400_000) return t("{n} h ago", { n: Math.round(diff / 3_600_000) });
  return formatListTime(ts, now);
}

/** Steps the server stored as data are phrased here, with times in the viewer's own zone. */
const STEP_FORMAT: StepFormat = {
  t,
  tn,
  when: (iso) =>
    new Intl.DateTimeFormat(intlLocale(), { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)),
  folder: (id) => folderLabel(id as FolderId),
};

const eventText = (e: AgentEvent) => (e.step ? describeStep(e.step, STEP_FORMAT) : localSummary(e.summary));

/**
 * Older steps (and the demo data) have only an English sentence. Its fixed phrasing is translated here;
 * the **bold** parts (subjects, names, searches) stay as they are, and anything that doesn't match is
 * shown unchanged.
 */
const SUMMARIES: [RegExp, string, string[]][] = [
  [/^Searched for \*\*([^*]+)\*\*$/, tk("Searched for **{query}**"), ["query"]],
  [/^Looked up \*\*mailboxes\*\*$/, tk("Looked up **mailboxes**"), []],
  [/^Listed (?:the )?\*\*(Inbox|Archive|Sent|Pinned|Snoozed)\*\*$/, tk("Listed **{folder}**"), ["folder"]],
  [/^Read \*\*([^*]+)\*\*$/, tk("Read **{subject}**"), ["subject"]],
  [/^Drafted a reply to \*\*([^*]+)\*\*$/, tk("Drafted a reply to **{who}**"), ["who"]],
  [/^Drafted \*\*a new email\*\*$/, tk("Drafted **a new email**"), []],
  [/^Drafted \*\*([^*]+)\*\*$/, tk("Drafted **{subject}**"), ["subject"]],
  [/^Edited draft \*\*([^*]+)\*\*$/, tk("Edited draft **{subject}**"), ["subject"]],
  [/^Deleted draft \*\*([^*]+)\*\*$/, tk("Deleted draft **{subject}**"), ["subject"]],
  [/^Scheduled \*\*([^*]+)\*\* to (.+?)(?: and (\d+) more)? for (.+)$/, tk("Scheduled **{subject}** to {to} for {when}"), ["subject", "to", "more", "when"]],
  [/^Scheduled \*\*([^*]+)\*\* for (.+)$/, tk("Scheduled **{subject}** for {when}"), ["subject", "when"]],
  [/^Sent a reply to \*\*([^*]+)\*\*(.*)$/, tk("Sent a reply to **{who}**{rest}"), ["who", "rest"]],
  [/^Sent \*\*([^*]+)\*\* to (.+?)(?: and (\d+) more)?$/, tk("Sent **{subject}** to {to}"), ["subject", "to", "more"]],
  [/^Archived \*\*([^*]+)\*\*$/, tk("Archived **{subject}**"), ["subject"]],
  [/^Moved \*\*([^*]+)\*\* to Inbox$/, tk("Moved **{subject}** to Inbox"), ["subject"]],
  [/^Marked \*\*([^*]+)\*\* as read$/, tk("Marked **{subject}** as read"), ["subject"]],
  [/^Marked \*\*([^*]+)\*\* as unread$/, tk("Marked **{subject}** as unread"), ["subject"]],
  [/^Pinned \*\*([^*]+)\*\*$/, tk("Pinned **{subject}**"), ["subject"]],
  [/^Unpinned \*\*([^*]+)\*\*$/, tk("Unpinned **{subject}**"), ["subject"]],
  [/^Snoozed \*\*([^*]+)\*\* until (.+)$/, tk("Snoozed **{subject}** until {when}"), ["subject", "when"]],
];

function localSummary(text: string) {
  for (const [pattern, key, names] of SUMMARIES) {
    const m = text.match(pattern);
    if (!m) continue;
    const vars: Record<string, string> = {};
    names.forEach((name, i) => (vars[name] = m[i + 1] ?? ""));
    if (vars.subject === "(no subject)") vars.subject = t("(no subject)");
    if (vars.folder) vars.folder = folderLabel(vars.folder.toLowerCase() as FolderId);
    if (vars.more) vars.to = tn(Number(vars.more), "{who} and {n} more", "{who} and {n} more", { who: vars.to });
    return t(key, vars);
  }
  return text;
}

/** Renders **bold** segments from an event summary. */
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
        part.startsWith("**") ? (
          <strong key={i} className="font-medium text-ink">
            {part.slice(2, -2)}
          </strong>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

export function AgentLogo({ agent, size = 32, className }: { agent: Agent; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center overflow-hidden bg-white shadow-[inset_0_0_0_0.5px_rgb(0_0_0/0.1)]", className)}
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.28) }}
      aria-hidden
    >
      {failed ? (
        <span className="text-[11px] font-semibold text-neutral-700">{initials(agent.name)}</span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoSrc(agent.logo)}
          alt=""
          width={Math.round(size * 0.62)}
          height={Math.round(size * 0.62)}
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}

/** Activity: My history (what you did) and what AI agents did, one switch apart. */
export function ActivityView() {
  const view = useMail((s) => s.activityView);
  const column = "mx-auto w-full max-w-[760px] px-5 md:px-8";
  return (
    <div className="h-full overflow-y-auto">
      <div className={cn(column, "flex flex-wrap items-center justify-between gap-3 pt-7")}>
        <h1 className="text-[24px] font-semibold tracking-[-0.02em]">{t("Activity")}</h1>
        <Segmented
          id="activity-view"
          value={view}
          options={[
            { value: "me", label: t("Me") },
            { value: "agents", label: t("AI agents") },
          ]}
          onChange={(v) => useMail.setState({ activityView: v })}
        />
      </div>
      {view === "me" ? (
        <>
          <p className={cn(column, "mt-1 text-[14px] text-ink-3")}>{t("What you did to your mail in the last 30 days. Undo anything.")}</p>
          <HistoryView column={column} />
        </>
      ) : (
        <AgentActivity column={column} />
      )}
    </div>
  );
}

function AgentActivity({ column }: { column: string }) {
  const agents = useMail((s) => s.agents);
  const sessions = useMail((s) => s.agentSessions);
  const events = useMail((s) => s.agentEvents);
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [changesOnly, setChangesOnly] = useState(false);
  const accounts = useMail((s) => s.accounts);
  // Starts at the mailbox picked in the sidebar; steps that span every mailbox (a search) always show.
  const [mailbox, setMailbox] = useState<string>(() => useMail.getState().scope);
  const now = useNow();

  const groups = useMemo(() => {
    const visible = events.filter((e) => {
      const session = sessions.find((s) => s.id === e.sessionId);
      if (!session) return false;
      if (agentFilter !== "all" && session.agentId !== agentFilter) return false;
      if (mailbox !== "all" && e.accountId && e.accountId !== mailbox) return false;
      if (changesOnly && ACTIONS[e.action].tone === "quiet") return false;
      return true;
    });
    const bySession = sessions
      .map((s) => ({ session: s, events: visible.filter((e) => e.sessionId === s.id).sort((a, b) => a.at - b.at) }))
      .filter((x) => x.events.length)
      .sort((a, b) => b.events[b.events.length - 1].at - a.events[a.events.length - 1].at);
    const days: { label: string; items: typeof bySession }[] = [];
    for (const item of bySession) {
      const label = dateGroup(item.events[item.events.length - 1].at, now);
      const day = days.find((d) => d.label === label);
      if (day) day.items.push(item);
      else days.push({ label, items: [item] });
    }
    return days;
  }, [events, sessions, agentFilter, mailbox, changesOnly, now]);

  if (LIVE && agents.length === 0) {
    return (
      <div className={cn(column, "pb-16")}>
        <p className="mt-1 text-[14px] text-ink-3">{t("Every step your agents take through MCP shows up here, and you can undo it.")}</p>
        <NoAgents />
      </div>
    );
  }
  return (
    <>
      <div className={column}>
        <p className="mt-1 text-[14px] text-ink-3">{t("Every step your agents took through MCP in the last 30 days. Undo anything you don't like.")}</p>
        <AgentsBar agents={agents} now={now} />
      </div>

      {/* Full-bleed so the bar covers the timeline edge to edge while it scrolls underneath. */}
      <div className="sticky top-0 z-10 mt-4 border-b border-line bg-solid/85 backdrop-blur-xl">
        <div className={cn(column, "flex flex-wrap items-center gap-1.5 py-2.5")}>
          <FilterChip active={agentFilter === "all"} onClick={() => setAgentFilter("all")}>
            {t("All agents")}
          </FilterChip>
          {agents.map((a) => (
            <FilterChip key={a.id} active={agentFilter === a.id} onClick={() => setAgentFilter(a.id)}>
              <AgentLogo agent={a} size={16} />
              {a.app}
            </FilterChip>
          ))}
          {accounts.length > 1 && <MailboxFilter value={mailbox} onChange={setMailbox} />}
          <button
            role="switch"
            aria-checked={changesOnly}
            onClick={() => setChangesOnly((v) => !v)}
            className={cn(
              "ml-auto flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium transition-colors",
              changesOnly ? "bg-accent text-on-accent" : "text-ink-2 shadow-[inset_0_0_0_0.5px_var(--line)] hover:bg-hover",
            )}
          >
            {changesOnly && <Check size={13} />}
            {t("Changes only")}
          </button>
        </div>
      </div>

      <div className={cn(column, "pb-16")}>
        {groups.length === 0 ? (
          <div className="py-16 text-center text-[13px] text-ink-3">{t("Nothing here yet.")}</div>
        ) : (
          groups.map((day) => (
            <section key={day.label} className="mt-5">
              <div className="mb-2 px-1 text-[12px] font-medium text-ink-3">{t(day.label)}</div>
              <div className="flex flex-col gap-2.5">
                {day.items.map(({ session, events }) => {
                  const agent = agents.find((a) => a.id === session.agentId)!;
                  return <SessionCard key={session.id} title={session.title} agent={agent} events={events} />;
                })}
              </div>
            </section>
          ))
        )}
      </div>
    </>
  );
}

/** Which mailbox's steps to show. */
function MailboxFilter({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const accounts = useMail((s) => s.accounts);
  const current = accounts.find((a) => a.id === value);
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        className={cn(
          "flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium transition-colors data-[state=open]:bg-hover",
          current ? "bg-ink text-solid" : "text-ink-2 shadow-[inset_0_0_0_0.5px_var(--line)] hover:bg-hover",
        )}
      >
        {current && <MailboxBadge icon={current.icon} hue={current.hue} image={current.image} size={16} className="rounded-[5px]" />}
        {current ? current.name : t("All mailboxes")}
        <ChevronDown size={13} className="opacity-60" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="start" sideOffset={6} className={menuContentClass}>
          <DropdownMenu.Item className={menuItemClass} onSelect={() => onChange("all")}>
            <Inbox size={15} /> {t("All mailboxes")}
            {value === "all" && <Check size={14} className="ml-auto" />}
          </DropdownMenu.Item>
          {accounts.map((a) => (
            <DropdownMenu.Item key={a.id} className={menuItemClass} onSelect={() => onChange(a.id)}>
              <MailboxBadge icon={a.icon} hue={a.hue} image={a.image} size={16} className="rounded-[5px]" /> {a.name}
              {value === a.id && <Check size={14} className="ml-auto" />}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium transition-colors",
        active ? "bg-ink text-solid" : "text-ink-2 shadow-[inset_0_0_0_0.5px_var(--line)] hover:bg-hover",
      )}
    >
      {children}
    </button>
  );
}

/** One quiet line: who is connected. Setup lives behind "Manage" so the timeline gets the attention. */
function AgentsBar({ agents, now }: { agents: Agent[]; now: number }) {
  const connected = agents.filter((a) => a.enabled);
  const latest = [...connected].sort((a, b) => b.lastActiveAt - a.lastActiveAt)[0];
  return (
    <div className="mt-5 flex items-center gap-3 rounded-2xl bg-hover py-2 pr-2 pl-3">
      <div className="flex -space-x-1.5">
        {connected.map((a) => (
          <Tooltip key={a.id} label={a.app} side="top">
            <span className="inline-flex rounded-[8px] ring-2 ring-[var(--solid)]">
              <AgentLogo agent={a} size={24} />
            </span>
          </Tooltip>
        ))}
      </div>
      <div className="min-w-0 flex-1 truncate text-[13px] text-ink-2">
        <span className="font-medium text-ink">
          {tn(connected.length, "{n} agent connected", "{n} agents connected")}
        </span>
        {latest && (
          <span className="text-ink-3">
            {" "}
            · {t("{app} active {ago}", { app: latest.app, ago: formatAgo(latest.lastActiveAt, now) })}
          </span>
        )}
      </div>
      <Popover.Root>
        <Popover.Trigger asChild>
          <button className="flex h-8 shrink-0 items-center gap-1.5 rounded-[10px] bg-solid px-3 text-[12.5px] font-medium text-ink shadow-[0_1px_2px_rgb(16_24_40/0.06),0_0_0_0.5px_var(--line)] transition-colors hover:bg-selected data-[state=open]:bg-selected">
            <Settings2 size={14} /> {t("Manage")}
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="end"
            sideOffset={8}
            collisionPadding={12}
            className="glass-strong z-50 w-[min(400px,calc(100vw-24px))] origin-[var(--radix-popover-content-transform-origin)] rounded-2xl p-2 data-[state=open]:animate-[menu-in_140ms_ease-out]"
          >
            <div className="px-2 pt-1.5 pb-1 text-[11px] font-medium text-ink-3">{t("Connected agents")}</div>
            {agents.map((a) => (
              <div key={a.id}>
                <AgentRow agent={a} now={now} />
                <AgentMailboxes agent={a} />
              </div>
            ))}
            <div className="mx-2 my-2 h-px bg-line" />
            <ConnectRow />
            <button
              onClick={() => useMail.getState().setSettingsOpen(true, "agents")}
              className="mx-2 mt-1 mb-1.5 flex h-8 w-[calc(100%-16px)] items-center justify-center gap-1.5 rounded-[10px] text-[12.5px] font-medium text-accent-text transition-colors hover:bg-hover"
            >
              <Settings2 size={14} /> {t("All agent settings")}
            </button>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}

export function AgentRow({ agent, now }: { agent: Agent; now: number }) {
  const setEnabled = useMail((s) => s.setAgentEnabled);
  const setPermission = useMail((s) => s.setAgentPermission);
  const removeAgent = useMail((s) => s.removeAgent);
  return (
    <div className="flex items-center gap-3 rounded-xl px-2 py-2">
      <AgentLogo agent={agent} size={30} className={cn(!agent.enabled && "opacity-50 grayscale")} />
      <div className="min-w-0 flex-1">
        <div className={cn("truncate text-[13.5px] font-medium", !agent.enabled && "text-ink-3")}>{agent.app}</div>
        <DropdownMenu.Root modal={false}>
          <DropdownMenu.Trigger asChild>
            <button className="-ml-1 flex max-w-full items-center gap-1 rounded-md px-1 text-[12px] text-ink-3 transition-colors hover:bg-hover hover:text-ink data-[state=open]:bg-hover">
              <span className="truncate">
                {agent.enabled
                  ? `${t(PERMISSIONS[agent.permission].label)} · ${t("active {ago}", { ago: formatAgo(agent.lastActiveAt, now) })}`
                  : t("Disconnected")}
              </span>
              <ChevronDown size={12} className="shrink-0" />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content align="start" sideOffset={6} className={cn(menuContentClass, "w-[280px]")}>
              {agent.enabled && (Object.keys(PERMISSIONS) as AgentPermission[]).map((p) => (
                <DropdownMenu.Item
                  key={p}
                  onSelect={() => setPermission(agent.id, p)}
                  className="group flex cursor-pointer items-start gap-2.5 rounded-lg px-2.5 py-2 outline-none data-[highlighted]:bg-accent data-[highlighted]:text-on-accent"
                >
                  <Check size={14} className={cn("mt-0.5 shrink-0", agent.permission === p ? "opacity-100" : "opacity-0")} />
                  <span>
                    <span className="block text-[13px] font-medium">{t(PERMISSIONS[p].label)}</span>
                    <span className="block text-[11.5px] text-ink-3 group-data-[highlighted]:text-on-accent/75">{t(PERMISSIONS[p].hint)}</span>
                  </span>
                </DropdownMenu.Item>
              ))}
              {agent.enabled && <DropdownMenu.Separator className="my-1 h-px bg-line" />}
              <DropdownMenu.Item
                onSelect={() =>
                  confirmAction({
                    title: t("Remove {app}?", { app: agent.app }),
                    message: t("It loses access to your mail for good, and its activity here is deleted. To use it again, connect it again."),
                    confirmLabel: t("Remove"),
                    onConfirm: () => removeAgent(agent.id),
                  })
                }
                className={cn(menuItemClass, "text-danger")}
              >
                <Trash2 size={14} /> {t("Remove {app}", { app: agent.app })}
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
      <button
        role="switch"
        aria-checked={agent.enabled}
        aria-label={t("{app} access", { app: agent.app })}
        onClick={() => setEnabled(agent.id, !agent.enabled)}
        className={cn("relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors", agent.enabled ? "bg-accent" : "bg-selected")}
      >
        <motion.span
          layout
          transition={spring}
          className={cn("absolute top-[2px] size-[18px] rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.2)]", agent.enabled ? "right-[2px]" : "left-[2px]")}
        />
      </button>
    </div>
  );
}

/**
 * The mailboxes one agent may see, as chips to tap on and off. Each agent has its own: Claude can
 * have work mail while ChatGPT only sees the personal one.
 */
/** Let an agent use the calendar, or stop it. Takes effect on its very next tool call. */
function setAgentCalendar(agent: Agent, calendar: boolean) {
  const put = (value: boolean) => useMail.setState((s) => ({ agents: s.agents.map((a) => (a.id === agent.id ? { ...a, calendar: value } : a)) }));
  put(calendar);
  if (!LIVE) return;
  api.patch(`/api/agents/${agent.id}`, { calendar }).catch((err: Error) => {
    put(!calendar);
    useMail.getState().pushToast({ message: err.message });
  });
}

export function AgentMailboxes({ agent }: { agent: Agent }) {
  const accounts = useMail((s) => s.accounts);
  const setMailboxes = useMail((s) => s.setAgentMailboxes);
  if (!accounts.length) return null;
  const on = new Set(agent.accountIds);
  return (
    <div className={cn("flex flex-wrap gap-1.5 pb-2 pl-[50px]", !agent.enabled && "opacity-50")} role="group" aria-label={t("Mailboxes {app} can see", { app: agent.app })}>
      {accounts.map((a) => {
        const shared = on.has(a.id);
        return (
          <button
            key={a.id}
            aria-pressed={shared}
            onClick={() => setMailboxes(agent.id, shared ? agent.accountIds.filter((id) => id !== a.id) : [...agent.accountIds, a.id])}
            className={cn(
              "press flex h-7 max-w-full items-center gap-1.5 rounded-full pr-2.5 pl-1 text-[12px] font-medium transition-colors [--press-scale:0.95]",
              shared ? "bg-accent-soft text-accent-text" : "text-ink-3 shadow-[inset_0_0_0_0.5px_var(--line)] hover:bg-hover hover:text-ink-2",
            )}
          >
            <MailboxBadge icon={a.icon} hue={a.hue} image={a.image} size={20} className={cn("rounded-full", !shared && "opacity-45 grayscale")} />
            <span className="truncate">{a.name}</span>
            {shared && <Check size={12} className="shrink-0" />}
          </button>
        );
      })}
      {!agent.accountIds.some((id) => accounts.some((a) => a.id === id)) && (
        <span className="flex h-7 items-center text-[12px] text-ink-3">{t("Sees no mailbox yet")}</span>
      )}
      {/* The calendar is shared apart from the mailboxes: reading it, and changing it as far as the access level goes. */}
      <button
        aria-pressed={!!agent.calendar}
        onClick={() => setAgentCalendar(agent, !agent.calendar)}
        className={cn(
          "press flex h-7 max-w-full items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium transition-colors [--press-scale:0.95]",
          agent.calendar ? "bg-accent-soft text-accent-text" : "text-ink-3 shadow-[inset_0_0_0_0.5px_var(--line)] hover:bg-hover hover:text-ink-2",
        )}
      >
        <CalendarDays size={13} className="shrink-0" />
        <span className="truncate">{t("Calendar")}</span>
        {agent.calendar && <Check size={12} className="shrink-0" />}
      </button>
    </div>
  );
}

/** Live mode before anything is connected: what this is, the URL, and the two most common setups. */
function NoAgents() {
  return (
    <div className="mt-6 rounded-2xl bg-solid p-5 shadow-[var(--shadow-panel)]">
      <div className="text-[14px] font-semibold">{t("No agents connected yet")}</div>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
        {t("Connect Claude, ChatGPT, Cursor or any MCP client to {brand}. You'll pick what it may do and which mailboxes it sees when you sign in from the agent.", {
          brand: BRAND.name,
        })}
      </p>
      <McpSetup className="mt-4" />
    </div>
  );
}

/** The MCP server's URL to copy, and how the most common clients add it (also in Settings → Agents). */
export function McpSetup({ className }: { className?: string }) {
  const pushToast = useMail((s) => s.pushToast);
  const url = useMcpUrl();
  const copy = (text: string, message: string) => {
    navigator.clipboard?.writeText(text).catch(() => {});
    pushToast({ message });
  };
  const cli = `claude mcp add --transport http ${BRAND.name.toLowerCase()} ${url}`;
  return (
    <div className={className}>
      <button
        onClick={() => copy(url, t("MCP URL copied"))}
        className="flex h-9 w-full items-center justify-between gap-2 rounded-[10px] bg-hover px-3 font-mono text-[12.5px] text-ink-2 transition-colors hover:bg-selected"
      >
        <span className="truncate">{url}</span>
        <Copy size={13} className="shrink-0" />
      </button>
      <ul className="mt-4 flex flex-col gap-2.5 text-[12.5px] leading-snug text-ink-3">
        <li>
          <span className="font-medium text-ink-2">Claude</span> · {t("Settings → Connectors → Add custom connector, then paste the URL.")}
        </li>
        <li className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
          <span className="font-medium text-ink-2">Claude Code</span> ·
          <button
            onClick={() => copy(cli, t("Command copied"))}
            className="flex max-w-full min-w-0 items-center gap-1.5 rounded-md bg-hover px-1.5 py-0.5 font-mono text-[11.5px] text-ink-2 transition-colors hover:bg-selected"
          >
            <span className="truncate">{cli}</span>
            <Copy size={11} className="shrink-0" />
          </button>
        </li>
        <li>
          <span className="font-medium text-ink-2">{t("Others")}</span> · {t("add a remote (HTTP) MCP server with this URL; sign-in happens in the browser.")}
        </li>
      </ul>
    </div>
  );
}

/** What to ask an agent once it's connected: a few prompts to copy, in the reader's language. */
const RECIPES: { title: string; prompt: string }[] = [
  {
    title: tk("Morning triage"),
    prompt: tk("Go through today's mail in Kolbaba. Archive newsletters and notifications I don't need, and give me a short list of what needs my answer."),
  },
  {
    title: tk("Who owes me a reply"),
    prompt: tk("Look at No reply yet in Kolbaba and draft a short, friendly follow-up for each one. Don't send anything."),
  },
  {
    title: tk("Find an invoice"),
    prompt: tk("Find the latest invoice from [company] in Kolbaba and tell me the amount, the due date and the account to pay to."),
  },
  {
    title: tk("Reply in my words"),
    prompt: tk("Draft a reply in Kolbaba to [name]'s last email: [what you want to say]. Keep it short and save it as a draft."),
  },
  {
    title: tk("Notes on a project"),
    prompt: tk("Read everything in Kolbaba about [topic] and add a note to the newest conversation with what was agreed and what comes next."),
  },
];

export function AgentRecipes() {
  const pushToast = useMail((s) => s.pushToast);
  return (
    <ul className="flex flex-col divide-y divide-line">
      {RECIPES.map((r) => (
        <li key={r.title}>
          <button
            onClick={() => {
              navigator.clipboard?.writeText(t(r.prompt)).catch(() => {});
              pushToast({ message: t("Prompt copied. Paste it into your agent.") });
            }}
            className="group flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-hover"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-medium text-ink">{t(r.title)}</span>
              <span className="mt-0.5 block text-[12.5px] leading-snug text-ink-3">{t(r.prompt)}</span>
            </span>
            <Copy size={13} className="mt-1 shrink-0 text-ink-3 opacity-0 transition-opacity group-hover:opacity-100 pointer-coarse:opacity-100" />
          </button>
        </li>
      ))}
    </ul>
  );
}

function ConnectRow() {
  const pushToast = useMail((s) => s.pushToast);
  const url = useMcpUrl();
  return (
    <div className="px-2 pb-1.5">
      <div className="text-[12.5px] font-medium">{t("Connect another agent")}</div>
      <div className="mt-0.5 text-[12px] text-ink-3">{t("Add this MCP server in Claude, ChatGPT, Cursor or any MCP client.")}</div>
      <button
        onClick={() => {
          navigator.clipboard?.writeText(url).catch(() => {});
          pushToast({ message: t("MCP URL copied") });
        }}
        className="mt-2 flex h-8 w-full items-center justify-between gap-2 rounded-[10px] bg-hover px-2.5 font-mono text-[12px] text-ink-2 transition-colors hover:bg-selected"
      >
        <span className="truncate">{url}</span>
        <Copy size={13} className="shrink-0" />
      </button>
    </div>
  );
}

function SessionCard({ title, agent, events }: { title: string; agent: Agent; events: AgentEvent[] }) {
  const first = events[0];
  const last = events[events.length - 1];
  const range = first.at === last.at ? timeFmt().format(first.at) : `${timeFmt().format(first.at)} – ${timeFmt().format(last.at)}`;
  return (
    <motion.article layout="position" transition={spring} className="rounded-2xl bg-solid p-4 shadow-[var(--shadow-panel)]">
      <header className="flex items-start gap-3">
        <AgentLogo agent={agent} size={32} />
        <div className="min-w-0 flex-1">
          <div className="text-[14px] leading-snug font-semibold">{title}</div>
          <div className="mt-0.5 text-[12px] text-ink-3">
            {agent.app} · {range} · {tn(events.length, "{n} step", "{n} steps")}
          </div>
        </div>
      </header>
      <ol className="relative mt-3.5 ml-[15px] border-l border-line pl-5">
        <AnimatePresence initial={false}>
          {events.map((e) => (
            <EventRow key={e.id} event={e} />
          ))}
        </AnimatePresence>
      </ol>
    </motion.article>
  );
}

function EventRow({ event }: { event: AgentEvent }) {
  const openThread = useMail((s) => s.openThread);
  const undo = useMail((s) => s.undoAgentEvent);
  const account = useMail((s) => s.accounts.find((a) => a.id === event.accountId));
  const threadExists = useMail((s) => !!(event.threadId && s.threads[event.threadId]));
  const { icon: Icon, tone } = ACTIONS[event.action];

  return (
    <motion.li layout="position" transition={spring} className="group relative flex min-h-9 items-center gap-3 py-1">
      <span
        className={cn(
          "absolute -left-[33px] flex size-[26px] items-center justify-center rounded-full ring-4 ring-[var(--solid)]",
          tone === "quiet" && "bg-hover text-ink-3",
          tone === "change" && "bg-accent-soft text-accent-text",
          tone === "send" && "bg-warning/18 text-ink",
          event.undone && "opacity-50",
        )}
      >
        <Icon size={13} />
      </span>
      <div className={cn("min-w-0 flex-1 text-[13px] leading-snug text-ink-2", event.undone && "line-through decoration-ink-3/60")}>
        <Rich text={eventText(event)} />
        {account && (
          <span className="ml-1.5 inline-flex translate-y-[-1px] items-center gap-1 align-middle text-[11.5px] text-ink-3 no-underline">
            <span className="hue-dot size-1.5 rounded-full" style={hueStyle(account.hue)} />
            {account.name}
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {event.undone ? (
          <span className="text-[12px] text-ink-3">{t("Undone")}</span>
        ) : (
          <>
            {threadExists && (
              <Tooltip label={t("Open conversation")} side="top">
                <button
                  aria-label={t("Open conversation")}
                  onClick={() => openThread(event.threadId!, { newTab: true })}
                  className="flex size-7 items-center justify-center rounded-full text-ink-3 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-hover hover:text-ink focus-visible:opacity-100"
                >
                  <SquareArrowOutUpRight size={13} />
                </button>
              </Tooltip>
            )}
            {event.undoable && (
              <button
                onClick={() => undo(event.id)}
                className="flex h-7 items-center gap-1 rounded-full px-2.5 text-[12px] font-medium text-ink-2 transition-colors hover:bg-hover hover:text-ink"
              >
                <Undo2 size={12} /> {t("Undo")}
              </button>
            )}
          </>
        )}
        <span className="w-10 text-right text-[12px] text-ink-3 tabular-nums">{timeFmt().format(event.at)}</span>
      </div>
    </motion.li>
  );
}
