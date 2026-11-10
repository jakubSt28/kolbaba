import { tk } from "./i18n";
import type { AgentStep } from "./types";

type Vars = Record<string, string | number>;

export interface StepFormat {
  t: (text: string, vars?: Vars) => string;
  tn: (n: number, one: string, other: string, vars?: Vars) => string;
  /** An ISO date-time as the reader should see it. */
  when: (iso: string) => string;
  /** A folder id ("inbox") as a name. */
  folder: (id: string) => string;
}

/**
 * One AI-activity step as a sentence in the reader's language. Steps are stored as data (what was
 * done to what, with ISO dates), so the app phrases them itself and shows times in the viewer's zone.
 * **bold** marks the object of the action.
 */
export function describeStep(step: AgentStep, { t: tr, tn, when, folder }: StepFormat): string {
  // Asterisks inside a subject would break the **bold** split in the UI.
  const clean = (s: string | null | undefined) => (s ?? "").replace(/\*/g, "").replace(/\s+/g, " ").trim();
  const subject = ("subject" in step && clean(step.subject)) || tr("(no subject)");
  switch (step.kind) {
    case "searched":
      return tr(tk("Searched for **{query}**"), { query: clean(step.query) });
    case "mailboxes":
      return tr(tk("Looked up **mailboxes**"));
    case "listed":
      return tr(tk("Listed **{folder}**"), { folder: clean(folder(step.folder)) });
    case "read":
      return tr(tk("Read **{subject}**"), { subject });
    case "drafted_reply":
      return tr(tk("Drafted a reply to **{who}**"), { who: clean(step.who) });
    case "drafted":
      return step.subject ? tr(tk("Drafted **{subject}**"), { subject }) : tr(tk("Drafted **a new email**"));
    case "edited_draft":
      return tr(tk("Edited draft **{subject}**"), { subject });
    case "deleted_draft":
      return tr(tk("Deleted draft **{subject}**"), { subject });
    case "sent":
    case "scheduled": {
      const who = clean(step.to);
      const to = step.more > 0 ? tn(step.more, "{who} and {n} more", "{who} and {n} more", { who }) : who;
      return step.kind === "scheduled" && step.at
        ? tr(tk("Scheduled **{subject}** to {to} for {when}"), { subject, to, when: when(step.at) })
        : tr(tk("Sent **{subject}** to {to}"), { subject, to });
    }
    case "archived":
      return tr(tk("Archived **{subject}**"), { subject });
    case "moved_to_inbox":
      return tr(tk("Moved **{subject}** to Inbox"), { subject });
    case "marked_read":
      return tr(tk("Marked **{subject}** as read"), { subject });
    case "marked_unread":
      return tr(tk("Marked **{subject}** as unread"), { subject });
    case "pinned":
      return tr(tk("Pinned **{subject}**"), { subject });
    case "unpinned":
      return tr(tk("Unpinned **{subject}**"), { subject });
    case "snoozed":
      return tr(tk("Snoozed **{subject}** until {when}"), { subject, when: when(step.until) });
    case "filed":
      return tr(tk("Moved **{subject}** to {folder}"), { subject, folder: clean(step.folder) });
    case "trashed":
      return tr(tk("Moved **{subject}** to Trash"), { subject });
    case "unsubscribed":
      return tr(tk("Unsubscribed from **{subject}**"), { subject });
    case "noted":
      return tr(tk("Wrote a note on **{subject}**"), { subject });
    case "reminder":
      return step.at
        ? tr(tk("Set a reminder on **{subject}** for {when} if nobody replies"), { subject, when: when(step.at) })
        : tr(tk("Took the reminder off **{subject}**"), { subject });
    case "screened":
      return step.allowed ? tr(tk("Let **{who}** into Inbox"), { who: clean(step.who) }) : tr(tk("Turned **{who}** away"), { who: clean(step.who) });
    case "attachment":
      return tr(tk("Opened attachment **{name}**"), { name: clean(step.name) });
  }
}
