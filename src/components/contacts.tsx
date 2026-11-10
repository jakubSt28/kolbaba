"use client";

import { Building2, Check, Crown, ExternalLink, Link2, Mail, Merge, Pencil, Phone, Plus, Search, Sparkles, Trash2, UserRoundPlus, X } from "lucide-react";
import { DropdownMenu, Popover } from "radix-ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { t } from "@/lib/i18n";
import { api, LIVE } from "@/lib/live";
import { useMail } from "@/lib/store";
import type { Contact, ContactDetail } from "@/lib/types";
import { useNow } from "@/lib/use-now";
import { cn, formatListTime } from "@/lib/utils";
import { confirmAction } from "./confirm";
import { Toggle } from "./settings";
import { Avatar, MailboxBadge, menuContentClass, menuItemClass } from "./ui";

/**
 * The address book: everyone the user writes to, alphabetically, and one person at a time in the
 * reader: their addresses, phone, company and links, conversations with them across mailboxes, and
 * what their signature says that isn't saved yet.
 */

const display = (c: Pick<Contact, "name" | "emails">) => c.name || c.emails[0] || t("Unnamed");

/** Czech alphabet sections: "Ch" is its own letter, Č Ř Š Ž too; Á is A. */
function letterOf(name: string) {
  const n = name.trim();
  if (/^ch/i.test(n)) return "Ch";
  const first = n.charAt(0).toUpperCase();
  if ("ČŘŠŽ".includes(first)) return first;
  const base = first.normalize("NFD").replace(/\p{M}/gu, "");
  return /[A-Z]/.test(base) ? base : "#";
}

const matches = (c: Contact, q: string) => `${c.name} ${c.emails.join(" ")} ${c.company}`.toLowerCase().includes(q);

export function ContactsList({ mobile = false }: { mobile?: boolean }) {
  const contacts = useMail((s) => s.contacts);
  const query = useMail((s) => s.query.trim().toLowerCase());
  const openId = useMail((s) => {
    const tab = s.tabs.find((x) => x.id === s.activeTabId);
    return tab?.kind === "contact" ? tab.contactId : null;
  });
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    void useMail.getState().loadContacts();
  }, []);

  const groups = useMemo(() => {
    const shown = (query ? contacts.filter((c) => matches(c, query)) : contacts).slice().sort((a, b) => display(a).localeCompare(display(b), "cs"));
    const out: { letter: string; items: Contact[] }[] = [];
    for (const c of shown) {
      const letter = letterOf(display(c));
      const group = out.find((g) => g.letter === letter);
      if (group) group.items.push(c);
      else out.push({ letter, items: [c] });
    }
    return out;
  }, [contacts, query]);

  return (
    <div className={cn(mobile && "px-2.5")}>
      <div className={cn("pb-1", mobile ? "px-1" : "px-0.5")}>
        {adding ? (
          <NewContact onDone={() => setAdding(false)} />
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="flex h-9 w-full items-center gap-2 rounded-[11px] px-2.5 text-[13px] font-medium text-accent-text transition-colors hover:bg-hover"
          >
            <UserRoundPlus size={15} /> {t("New contact")}
          </button>
        )}
      </div>
      {groups.length === 0 ? (
        <div className="px-6 py-16 text-center">
          <div className="text-[15px] font-semibold">{query ? t("No results") : t("No contacts yet")}</div>
          <div className="mt-1 text-[13px] text-ink-3">
            {query ? t("Nothing matches “{query}”.", { query }) : t("People you write to show up here on their own.")}
          </div>
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.letter}>
            {/* On the phone the letters scroll away like Files' sections: stuck at the top they'd slide over the floating bar. */}
            <div className={cn("px-3 pt-3 pb-1 font-semibold text-ink-3", mobile ? "text-[12.5px]" : "sticky top-0 z-10 text-[11px] backdrop-blur-xl")}>{g.letter}</div>
            <div className={cn(mobile && "overflow-hidden rounded-[20px] bg-solid shadow-[var(--shadow-panel)]")}>
              {g.items.map((c) => (
                <button
                  key={c.id}
                  onClick={() => useMail.getState().openContact(c.id)}
                  className={cn(
                    "flex w-full items-center gap-3 px-3 py-2 text-left transition-colors",
                    mobile ? "[&+&]:border-t [&+&]:border-line active:bg-hover" : "rounded-[12px] hover:bg-hover",
                    !mobile && openId === c.id && "bg-selected hover:bg-selected",
                  )}
                >
                  <Avatar person={{ name: c.name, email: c.emails[0] ?? "" }} size={mobile ? 38 : 32} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-medium text-ink">{display(c)}</div>
                    <div className="truncate text-[12px] text-ink-3">{c.company || (c.name ? c.emails[0] : "")}</div>
                  </div>
                </button>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

function NewContact({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const save = async () => {
    const contact = await useMail.getState().createContact({ name, emails: email.trim() ? [email] : [] });
    if (!contact) return;
    onDone();
    useMail.getState().openContact(contact.id);
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      className="flex flex-col gap-1.5 rounded-[12px] bg-hover p-2"
    >
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={t("Name")} className="h-8 rounded-[8px] bg-solid px-2.5 text-[13px] outline-none" />
      <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="name@example.com" className="h-8 rounded-[8px] bg-solid px-2.5 text-[13px] outline-none" />
      <div className="flex justify-end gap-1.5">
        <button type="button" onClick={onDone} className="h-8 rounded-[10px] px-3 text-[12.5px] font-medium text-ink-2 hover:bg-selected">
          {t("Cancel")}
        </button>
        <button type="submit" disabled={!name.trim() && !email.trim()} className="h-8 rounded-[10px] bg-accent px-3 text-[12.5px] font-medium text-on-accent disabled:opacity-50">
          {t("Add")}
        </button>
      </div>
    </form>
  );
}

/* --------------------------------- Detail --------------------------------- */

/** A VIP's mail notifies even in quiet hours and in mailboxes set to "Only VIPs". */
function VipRow({ contact }: { contact: Contact }) {
  const vip = useMail((s) => contact.emails.some((e) => s.vips.includes(e.toLowerCase())));
  const setVip = useMail((s) => s.setVip);
  return (
    <div className="mt-3 flex items-center gap-3 rounded-[14px] bg-solid px-4 py-3 shadow-[inset_0_0_0_0.5px_var(--line)]">
      <Crown size={15} className={cn("shrink-0", vip ? "fill-current text-pin" : "text-ink-3")} />
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] text-ink">{t("VIP")}</div>
        <div className="text-[12px] leading-snug text-ink-3">{t("Their mail always notifies, even in quiet hours")}</div>
      </div>
      <Toggle on={vip} label={t("VIP")} onChange={(on) => void setVip({ name: contact.name, email: contact.emails[0] }, on)} />
    </div>
  );
}

export function ContactView({ contactId }: { contactId: string }) {
  const summary = useMail((s) => s.contacts.find((c) => c.id === contactId));
  const accounts = useMail((s) => s.accounts);
  const [detail, setDetail] = useState<ContactDetail | null>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const now = useNow();
  // A merge or new address changes which conversations are theirs: the details load again.
  const addresses = summary?.emails.join(",");

  useEffect(() => {
    if (!LIVE) return;
    let live = true;
    api.get<ContactDetail>(`/api/people/${encodeURIComponent(contactId)}`).then(
      (d) => live && setDetail(d),
      (err: Error) => live && setError(err.message),
    );
    return () => {
      live = false;
    };
  }, [contactId, addresses]);

  const contact: Contact | undefined = summary ?? detail ?? undefined;
  if (error) return <div className="p-10 text-center text-[13px] text-ink-3">{error}</div>;
  if (!contact) return null;
  const save = async (patch: Partial<Contact>) => {
    const saved = await useMail.getState().saveContact(contact.id, patch);
    if (saved && detail) setDetail({ ...detail, ...saved });
    return saved;
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[640px] px-6 pt-8 pb-16">
        {/* On a phone the buttons go under the name, so a long name isn't cut short. */}
        <header className="flex flex-wrap items-start gap-x-4 gap-y-3">
          <Avatar person={{ name: contact.name, email: contact.emails[0] ?? "" }} size={56} />
          <div className="min-w-0 flex-1 basis-[calc(100%-72px)] pt-1 sm:basis-0">
            <h1 className="truncate text-[22px] font-semibold tracking-[-0.02em]">{display(contact)}</h1>
            {(contact.jobTitle || contact.company) && (
              <div className="mt-0.5 truncate text-[13.5px] text-ink-2">{[contact.jobTitle, contact.company].filter(Boolean).join(" · ")}</div>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1 pt-1 max-sm:w-full max-sm:pl-[72px]">
            {contact.emails[0] && (
              <button
                onClick={() => useMail.getState().writeTo(contact.emails[0])}
                className="flex h-8 items-center gap-1.5 rounded-full bg-accent px-3.5 text-[12.5px] font-medium text-on-accent hover:bg-accent-hover"
              >
                <Mail size={13} /> {t("Write")}
              </button>
            )}
            <button
              onClick={() => setEditing((e) => !e)}
              aria-pressed={editing}
              aria-label={t("Edit")}
              className={cn("flex size-8 items-center justify-center rounded-full text-ink-2 transition-colors hover:bg-hover", editing && "bg-selected")}
            >
              <Pencil size={14} />
            </button>
            <MoreMenu contact={contact} />
          </div>
        </header>

        {editing ? (
          <EditContact contact={contact} onDone={() => setEditing(false)} save={save} />
        ) : (
          <div className="mt-6 divide-y divide-line overflow-hidden rounded-[14px] bg-solid shadow-[inset_0_0_0_0.5px_var(--line)]">
            {contact.emails.map((email, i) => (
              <InfoRow key={email} icon={<Mail size={15} />} label={i === 0 ? t("Email") : t("Also")}>
                <button onClick={() => useMail.getState().writeTo(email)} className="truncate text-left text-accent-text hover:underline">
                  {email}
                </button>
              </InfoRow>
            ))}
            {contact.phone && (
              <InfoRow icon={<Phone size={15} />} label={t("Phone")}>
                <a href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`} className="text-accent-text hover:underline">
                  {contact.phone}
                </a>
              </InfoRow>
            )}
            {contact.company && (
              <InfoRow icon={<Building2 size={15} />} label={t("Company")}>
                {contact.company}
              </InfoRow>
            )}
            {contact.links.map((link) => (
              <InfoRow key={link} icon={<Link2 size={15} />} label={/linkedin\.com/i.test(link) ? "LinkedIn" : t("Website")}>
                <a href={link} target="_blank" rel="noopener noreferrer" className="flex min-w-0 items-center gap-1 text-accent-text hover:underline">
                  <span className="truncate">{link.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}</span>
                  <ExternalLink size={11} className="shrink-0 opacity-60" />
                </a>
              </InfoRow>
            ))}
            {contact.note && (
              <div className="px-4 py-3 text-[13px] leading-relaxed whitespace-pre-wrap text-ink-2">{contact.note}</div>
            )}
          </div>
        )}

        {!editing && contact.emails[0] && <VipRow contact={contact} />}

        {detail && !editing && <Hints contact={contact} hints={detail.hints} save={save} />}

        <h2 className="mt-8 mb-2 px-1 text-[12px] font-medium text-ink-3">{t("Conversations")}</h2>
        {!detail ? null : detail.threads.length === 0 ? (
          <p className="px-1 text-[13px] text-ink-3">{t("No conversations with them here yet.")}</p>
        ) : (
          <div className="flex flex-col">
            {detail.threads.map((th) => {
              const account = accounts.find((a) => a.id === th.accountId);
              return (
                <button
                  key={th.id}
                  onClick={() => void useMail.getState().openThreadById(th.id)}
                  className="flex items-start gap-3 rounded-[12px] px-3 py-2.5 text-left transition-colors hover:bg-hover"
                >
                  {account && <MailboxBadge icon={account.icon} hue={account.hue} image={account.image} size={18} className="mt-0.5 rounded-[6px]" />}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{th.subject || t("(no subject)")}</span>
                      <span className="shrink-0 text-[12px] text-ink-3 tabular-nums">{formatListTime(th.lastMessageAt, now)}</span>
                    </div>
                    <div className="truncate text-[12.5px] text-ink-3">{th.snippet}</div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function InfoRow({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-[48px] items-center gap-3 px-4 py-2.5 text-[13.5px]">
      <span className="shrink-0 text-ink-3">{icon}</span>
      <span className="w-[76px] shrink-0 text-[12px] text-ink-3">{label}</span>
      <div className="min-w-0 flex-1 truncate text-ink">{children}</div>
    </div>
  );
}

/** What their signatures say that isn't saved: one tap adds it. */
function Hints({ contact, hints, save }: { contact: Contact; hints: ContactDetail["hints"]; save: (p: Partial<Contact>) => Promise<Contact | null> }) {
  const [taken, setTaken] = useState<string[]>([]);
  const items: { key: string; label: string; value: string; add: () => Promise<unknown> }[] = [
    ...hints.phones.map((p) => ({ key: `p:${p}`, label: t("Phone"), value: p, add: () => save({ phone: p }) })),
    ...(hints.company ? [{ key: `c:${hints.company}`, label: t("Company"), value: hints.company, add: () => save({ company: hints.company! }) }] : []),
    ...hints.links.map((l) => ({
      key: `l:${l}`,
      label: /linkedin\.com/i.test(l) ? "LinkedIn" : t("Website"),
      value: l.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""),
      add: () => save({ links: [...contact.links, l] }),
    })),
  ].filter((i) => !taken.includes(i.key));
  if (!items.length) return null;
  return (
    <div className="mt-4 rounded-[14px] bg-accent-soft/60 p-3">
      <div className="mb-1.5 flex items-center gap-1.5 px-1 text-[12px] font-medium text-accent-text">
        <Sparkles size={12} /> {t("From their signature")}
      </div>
      {items.map((i) => (
        <div key={i.key} className="flex items-center gap-3 rounded-[10px] px-1 py-1.5 text-[13px]">
          <span className="w-[76px] shrink-0 text-[12px] text-ink-3">{i.label}</span>
          <span className="min-w-0 flex-1 truncate text-ink">{i.value}</span>
          <button
            onClick={() => void i.add().then((ok) => ok && setTaken((x) => [...x, i.key]))}
            className="flex h-7 shrink-0 items-center gap-1 rounded-full bg-solid px-2.5 text-[12px] font-medium text-ink shadow-[inset_0_0_0_0.5px_var(--line)] hover:bg-hover"
          >
            <Plus size={12} /> {t("Add")}
          </button>
        </div>
      ))}
    </div>
  );
}

function EditContact({ contact, onDone, save }: { contact: Contact; onDone: () => void; save: (p: Partial<Contact>) => Promise<Contact | null> }) {
  const [draft, setDraft] = useState({
    name: contact.name,
    emails: contact.emails.join("\n"),
    phone: contact.phone,
    company: contact.company,
    jobTitle: contact.jobTitle,
    links: contact.links.join("\n"),
    note: contact.note,
  });
  const lines = (s: string) => s.split(/[\n,]/).map((x) => x.trim()).filter(Boolean);
  const field = (key: keyof typeof draft, label: string, opts: { multiline?: boolean; hint?: string; type?: string } = {}) => (
    <label className="flex flex-col gap-1 px-4 py-2.5">
      <span className="text-[12px] text-ink-3">{label}</span>
      {opts.multiline ? (
        <textarea
          value={draft[key]}
          onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
          rows={Math.max(2, draft[key].split("\n").length)}
          className="resize-none bg-transparent text-[13.5px] text-ink outline-none"
        />
      ) : (
        <input type={opts.type ?? "text"} value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} className="bg-transparent text-[13.5px] text-ink outline-none" />
      )}
      {opts.hint && <span className="text-[11.5px] text-ink-3">{opts.hint}</span>}
    </label>
  );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save({ ...draft, emails: lines(draft.emails), links: lines(draft.links) }).then((ok) => ok && onDone());
      }}
      className="mt-6"
    >
      <div className="divide-y divide-line overflow-hidden rounded-[14px] bg-solid shadow-[inset_0_0_0_0.5px_var(--line)]">
        {field("name", t("Name"))}
        {field("emails", t("Email addresses"), { multiline: true, hint: t("One per line. The first is the one to write to.") })}
        {field("phone", t("Phone"), { type: "tel" })}
        {field("company", t("Company"))}
        {field("jobTitle", t("Job title"))}
        {field("links", t("Links"), { multiline: true, hint: t("LinkedIn, a website… one per line.") })}
        {field("note", t("Note"), { multiline: true })}
      </div>
      <div className="mt-3 flex justify-end gap-1.5">
        <button type="button" onClick={onDone} className="h-8 rounded-[10px] px-3 text-[12.5px] font-medium text-ink-2 hover:bg-hover">
          {t("Cancel")}
        </button>
        <button type="submit" className="flex h-8 items-center gap-1.5 rounded-[10px] bg-accent px-3.5 text-[12.5px] font-medium text-on-accent hover:bg-accent-hover">
          <Check size={13} /> {t("Save")}
        </button>
      </div>
    </form>
  );
}

function MoreMenu({ contact }: { contact: Contact }) {
  const [merging, setMerging] = useState(false);
  // Open the picker only once the menu has closed: its focus going back to ⋯ would close it again.
  const mergeNext = useRef(false);
  return (
    <Popover.Root open={merging} onOpenChange={setMerging}>
      <DropdownMenu.Root>
        <Popover.Anchor asChild>
          <DropdownMenu.Trigger aria-label={t("More")} className="flex size-8 items-center justify-center rounded-full text-ink-2 transition-colors hover:bg-hover data-[state=open]:bg-hover">
            <span className="text-[16px] leading-none">⋯</span>
          </DropdownMenu.Trigger>
        </Popover.Anchor>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={6}
            className={menuContentClass}
            onCloseAutoFocus={(e) => {
              if (!mergeNext.current) return;
              mergeNext.current = false;
              e.preventDefault();
              setMerging(true);
            }}
          >
            <DropdownMenu.Item className={menuItemClass} onSelect={() => (mergeNext.current = true)}>
              <Merge size={15} /> {t("Merge with…")}
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className={cn(menuItemClass, "text-danger data-[highlighted]:bg-danger")}
              onSelect={() =>
                confirmAction({
                  title: t("Remove {name} from contacts?", { name: display(contact) }),
                  message: t("Their mail stays. Sending them another email won't add them back."),
                  confirmLabel: t("Remove"),
                  onConfirm: () => useMail.getState().deleteContact(contact.id),
                })
              }
            >
              <Trash2 size={15} /> {t("Remove from contacts")}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={6} className="glass-strong z-50 w-[300px] rounded-xl p-2">
          <MergePicker contact={contact} onDone={() => setMerging(false)} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Two entries for one person (work and personal address): pick the other one to join this. */
function MergePicker({ contact, onDone }: { contact: Contact; onDone: () => void }) {
  const contacts = useMail((s) => s.contacts);
  const [q, setQ] = useState("");
  const others = contacts.filter((c) => c.id !== contact.id && (!q.trim() || matches(c, q.trim().toLowerCase()))).slice(0, 6);
  return (
    <div>
      <p className="px-1.5 pb-2 text-[12px] leading-snug text-ink-3">{t("Their addresses and details join {name}.", { name: display(contact) })}</p>
      <label className="flex h-8 items-center gap-2 rounded-[9px] bg-hover px-2.5 text-ink-3">
        <Search size={13} />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Find a contact")} className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none" />
        {q && (
          <button onClick={() => setQ("")} aria-label={t("Clear")}>
            <X size={13} />
          </button>
        )}
      </label>
      <div className="mt-1.5 flex flex-col">
        {others.map((c) => (
          <button
            key={c.id}
            onClick={() => {
              onDone();
              void useMail.getState().mergeContacts(contact.id, c.id);
            }}
            className="flex items-center gap-2.5 rounded-[9px] px-1.5 py-1.5 text-left hover:bg-hover"
          >
            <Avatar person={{ name: c.name, email: c.emails[0] ?? "" }} size={26} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium">{display(c)}</div>
              <div className="truncate text-[11.5px] text-ink-3">{c.emails.join(", ")}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
