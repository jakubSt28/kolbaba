"use client";

import { ArrowRight, Plus, WandSparkles } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { t, tk, tn } from "@/lib/i18n";
import { normalizeFrom } from "@/lib/rules";
import { useMail, type RuleInput } from "@/lib/store";
import type { MailRule, RuleAction } from "@/lib/types";
import { cn, formatListTime } from "@/lib/utils";
import { openFolderDialog } from "./folders";
import { Group } from "./settings";
import { Segmented, spring } from "./ui";

/**
 * Settings → Mail → Rules: "always do this" for new mail. Kolbaba offers one on its own after the
 * user files the same sender's mail into the same folder a third time; here's the list and an editor
 * for the rest (who it's from, words in the subject, which mailbox; where it goes and whether it's read).
 */

const ACTIONS: { value: RuleAction; label: string }[] = [
  { value: "folder", label: tk("To a folder") },
  { value: "archive", label: tk("Archive") },
  { value: "trash", label: tk("Trash") },
  { value: "inbox", label: tk("Keep in Inbox") },
];

const EMPTY: RuleInput = { accountId: null, from: "", subject: "", action: "folder", folderId: null, markRead: false };

export function RulesSettings() {
  const rules = useMail((s) => s.rules);
  const loadRules = useMail((s) => s.loadRules);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  useEffect(() => {
    void loadRules();
  }, [loadRules]);
  return (
    <Group
      title={t("Rules")}
      info={t("A rule takes care of new mail as it arrives, and what it takes care of doesn't notify you. File the same sender's mail into the same folder three times and Kolbaba offers one on its own.")}
    >
      {rules?.map((r) =>
        editing === r.id ? (
          <RuleForm key={r.id} rule={r} onDone={() => setEditing(null)} />
        ) : (
          <RuleRow key={r.id} rule={r} onEdit={() => setEditing(r.id)} />
        ),
      )}
      {editing === "new" ? (
        <RuleForm onDone={() => setEditing(null)} />
      ) : (
        <button
          onClick={() => setEditing("new")}
          className="flex w-full items-center gap-3 px-4 py-3 text-left text-[13.5px] font-medium text-accent-text transition-colors hover:bg-hover"
        >
          <span className="flex size-7 items-center justify-center rounded-[9px] bg-hover">
            <Plus size={15} />
          </span>
          {rules?.length ? t("New rule") : t("Make a rule")}
        </button>
      )}
    </Group>
  );
}

/** "From alza.cz · “faktura” → Shopping, read" */
function useRuleSentence(rule: Pick<MailRule, "from" | "subject" | "action" | "folderId" | "markRead" | "accountId">) {
  const folders = useMail((s) => s.folders);
  const accounts = useMail((s) => s.accounts);
  const who = rule.from ? (rule.from.startsWith("@") ? t("everyone at {domain}", { domain: rule.from.slice(1) }) : rule.from) : "";
  const when = [who && t("From {who}", { who }), rule.subject && t("subject “{words}”", { words: rule.subject })].filter(Boolean).join(" · ");
  const where =
    rule.action === "folder"
      ? (folders.find((f) => f.id === rule.folderId)?.name ?? t("a folder"))
      : rule.action === "archive"
        ? t("Archive@@folder")
        : rule.action === "trash"
          ? t("Trash")
          : t("Inbox");
  const extra = [rule.markRead && rule.action !== "trash" ? t("marked read") : "", rule.action === "inbox" && !rule.markRead ? t("without a notification") : ""].filter(Boolean).join(", ");
  const mailbox = rule.accountId ? accounts.find((a) => a.id === rule.accountId)?.name : null;
  return { when, where, extra, mailbox };
}

function RuleRow({ rule, onEdit }: { rule: MailRule; onEdit: () => void }) {
  const { when, where, extra, mailbox } = useRuleSentence(rule);
  return (
    <button onClick={onEdit} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-hover">
      <WandSparkles size={15} className="shrink-0 text-accent-text" />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-[13.5px] text-ink">
          <span className="truncate">{when}</span>
          <ArrowRight size={13} className="shrink-0 text-ink-3" />
          <span className="font-medium">{where}</span>
          {extra && <span className="text-ink-3">· {extra}</span>}
        </span>
        <span className="block truncate text-[12px] text-ink-3">
          {[
            mailbox,
            rule.applied ? tn(rule.applied, "Took care of {n} email", "Took care of {n} emails") : t("Nothing yet"),
            rule.lastAppliedAt ? t("last {when}", { when: formatListTime(rule.lastAppliedAt) }) : "",
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </span>
    </button>
  );
}

const field =
  "h-9 w-full min-w-0 rounded-[10px] bg-canvas px-3 text-[16px] text-ink shadow-[inset_0_0_0_1px_var(--line)] outline-none transition-shadow placeholder:text-ink-3/70 focus:shadow-[inset_0_0_0_1.5px_var(--accent)] md:text-[13.5px]";

function RuleForm({ rule, onDone }: { rule?: MailRule; onDone: () => void }) {
  const folders = useMail((s) => s.folders);
  const accounts = useMail((s) => s.accounts);
  const saveRule = useMail((s) => s.saveRule);
  const deleteRule = useMail((s) => s.deleteRule);
  const [input, setInput] = useState<RuleInput>(rule ? { accountId: rule.accountId, from: rule.from.startsWith("@") ? rule.from.slice(1) : rule.from, subject: rule.subject, action: rule.action, folderId: rule.folderId, markRead: rule.markRead } : { ...EMPTY, folderId: folders[0]?.id ?? null });
  const [applyNow, setApplyNow] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<RuleInput>) => {
    setError(null);
    setInput((i) => ({ ...i, ...patch }));
  };
  const fromOk = normalizeFrom(input.from) !== null;
  const empty = !input.from.trim() && !input.subject.trim();

  const submit = async () => {
    if (busy) return;
    if (!fromOk) return setError(t("Type an email address or a domain, like petr@firma.cz or alza.cz"));
    if (empty) return setError(t("Say who the mail is from, or what its subject says"));
    if (input.action === "folder" && !input.folderId) return setError(t("Pick a folder"));
    setBusy(true);
    const err = await saveRule(input, { id: rule?.id, applyNow: !rule && applyNow });
    setBusy(false);
    if (err) setError(err);
    else onDone();
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={spring} className="flex flex-col gap-3 px-4 py-3.5">
      <div className="text-[12px] font-medium text-ink-3">{t("When an email comes")}</div>
      <div className="grid gap-2 sm:grid-cols-[88px_1fr] sm:items-center">
        <label htmlFor="rule-from" className="text-[13px] text-ink-2">
          {t("From")}
        </label>
        <input id="rule-from" value={input.from} onChange={(e) => set({ from: e.target.value })} placeholder={t("petr@firma.cz or alza.cz")} autoComplete="off" spellCheck={false} className={cn(field, !fromOk && "shadow-[inset_0_0_0_1.5px_var(--danger)]")} />
        <label htmlFor="rule-subject" className="text-[13px] text-ink-2">
          {t("Subject has")}
        </label>
        <input id="rule-subject" value={input.subject} onChange={(e) => set({ subject: e.target.value })} placeholder={t("invoice (optional)")} autoComplete="off" className={field} />
        {accounts.length > 1 && (
          <>
            <label htmlFor="rule-mailbox" className="text-[13px] text-ink-2">
              {t("Mailbox")}
            </label>
            <select id="rule-mailbox" value={input.accountId ?? ""} onChange={(e) => set({ accountId: e.target.value || null })} className={field}>
              <option value="">{t("Any mailbox")}</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </>
        )}
      </div>

      <div className="mt-1 text-[12px] font-medium text-ink-3">{t("Do this with it")}</div>
      <Segmented id={`rule-action-${rule?.id ?? "new"}`} value={input.action} full options={ACTIONS.map((a) => ({ value: a.value, label: t(a.label) }))} onChange={(action) => set({ action })} />
      <AnimatePresence initial={false}>
        {input.action === "folder" && (
          <motion.div key="folder" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            {folders.length ? (
              <select aria-label={t("Folder")} value={input.folderId ?? ""} onChange={(e) => set({ folderId: e.target.value || null })} className={field}>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            ) : (
              <button onClick={() => openFolderDialog({ mode: "create" })} className="text-[13px] font-medium text-accent-text hover:underline">
                {t("No folders yet. Make one first.")}
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      {input.action !== "trash" && (
        <label className="flex items-center gap-2.5 text-[13px] text-ink select-none">
          <input type="checkbox" checked={input.markRead} onChange={(e) => set({ markRead: e.target.checked })} className="size-4 accent-[var(--accent)]" />
          {t("Mark it as read")}
        </label>
      )}
      {!rule && (
        <label className="flex items-center gap-2.5 text-[13px] text-ink select-none">
          <input type="checkbox" checked={applyNow} onChange={(e) => setApplyNow(e.target.checked)} className="size-4 accent-[var(--accent)]" />
          {t("Also for what's in Inbox now")}
        </label>
      )}
      <p className="text-[12px] leading-relaxed text-ink-3">{t("Mail a rule takes care of doesn't notify you.")}</p>
      {error && <p className="text-[12.5px] text-danger">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {rule && (
          <button
            onClick={() => {
              deleteRule(rule.id);
              onDone();
            }}
            className="mr-auto h-8 rounded-[10px] px-3 text-[13px] font-medium text-danger transition-colors hover:bg-danger/8"
          >
            {t("Delete rule")}
          </button>
        )}
        <button onClick={onDone} className={cn("h-8 rounded-[10px] bg-hover px-3 text-[13px] font-medium text-ink-2 transition-colors hover:bg-selected", !rule && "ml-auto")}>
          {t("Cancel")}
        </button>
        <button onClick={() => void submit()} disabled={busy} className="h-8 rounded-[10px] bg-accent px-3.5 text-[13px] font-medium text-on-accent transition-opacity hover:bg-accent-hover disabled:opacity-60">
          {busy ? t("Saving…") : t("Save rule")}
        </button>
      </div>
    </motion.div>
  );
}
