"use client";

import { Check, ChevronLeft, ChevronsUpDown, ImagePlus, Inbox, Plus, SlidersHorizontal } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Popover } from "radix-ui";
import { useRef, useState } from "react";
import { t, tn } from "@/lib/i18n";
import { LIVE } from "@/lib/live";
import { MAILBOX_HUES, unreadCount, useMail } from "@/lib/store";
import type { Account, MailboxIconName } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ImageCropper } from "./image-cropper";
import { MAILBOX_ICON_LABELS, MAILBOX_ICONS, MailboxBadge, Tooltip, hueStyle, spring } from "./ui";

/** "All mailboxes" or the mailbox's name: the parent filter every folder and category follows. */
export function useScopeLabel() {
  return useMail((s) => s.accounts.find((a) => a.id === s.scope)?.name ?? t("All mailboxes"));
}

/** The badge for the current scope: the mailbox's own, or the inbox tile for all of them. */
export function ScopeBadge({ size = 22, className }: { size?: number; className?: string }) {
  const account = useMail((s) => s.accounts.find((a) => a.id === s.scope));
  if (account) return <MailboxBadge icon={account.icon} hue={account.hue} image={account.image} size={size} className={className} />;
  return <AllMailboxesBadge size={size} className={className} />;
}

export function AllMailboxesBadge({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center rounded-[7px] bg-accent-soft text-accent-text", className)}
      style={{ width: size, height: size }}
    >
      <Inbox size={Math.round(size * 0.6)} strokeWidth={2.2} />
    </span>
  );
}

/** Desktop sidebar: the current mailbox, opening the picker. */
export function MailboxSwitcher({ collapsed = false, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const [open, setOpen] = useState(false);
  const label = useScopeLabel();
  const total = useMail((s) => unreadCount(s.threads, "all"));
  const scoped = useMail((s) => unreadCount(s.threads, s.scope));
  // In one mailbox, a dot says there's unread mail in the others.
  const elsewhere = total - scoped > 0;

  const trigger = (
    <Popover.Trigger asChild>
      <button
        aria-label={t("Mailbox: {name}", { name: label })}
        className={cn(
          "group relative flex h-11 w-full items-center gap-2.5 rounded-[12px] px-2 text-left shadow-[inset_0_0_0_0.5px_var(--line)] transition-colors hover:bg-hover data-[state=open]:bg-hover",
          collapsed && "size-10 justify-center px-0",
        )}
      >
        <ScopeBadge size={collapsed ? 26 : 24} />
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{label}</span>
            <ChevronsUpDown size={14} className="shrink-0 text-ink-3 transition-colors group-hover:text-ink-2" />
          </>
        )}
        {elsewhere && <span className={cn("absolute size-1.5 rounded-full bg-accent", collapsed ? "top-1 right-1" : "top-1.5 left-[30px]")} />}
      </button>
    </Popover.Trigger>
  );

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Fresh import status for the mailbox menus.
        if (next && LIVE) void useMail.getState().refreshAccounts();
      }}
    >
      {collapsed ? (
        <Tooltip label={label} side="right">
          {trigger}
        </Tooltip>
      ) : (
        trigger
      )}
      <Popover.Portal>
        <Popover.Content
          side={collapsed ? "right" : "bottom"}
          align="start"
          sideOffset={6}
          className="glass-strong z-50 w-[288px] origin-[var(--radix-popover-content-transform-origin)] rounded-2xl p-1.5 data-[state=open]:animate-[menu-in_140ms_ease-out]"
        >
          <MailboxPicker
            onPicked={() => {
              setOpen(false);
              onNavigate?.();
            }}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * All mailboxes and each one on its own, with unread counts. Picking one keeps the folder you're in
 * (Archive stays Archive), which is what makes the mailbox the parent filter. Each mailbox has its
 * settings one tap away; the picker swaps to them in place, so it works in a popover and a sheet alike.
 */
export function MailboxPicker({ onPicked }: { onPicked: () => void }) {
  const accounts = useMail((s) => s.accounts);
  const threads = useMail((s) => s.threads);
  const scope = useMail((s) => s.scope);
  const setScope = useMail((s) => s.setScope);
  const openAddAccount = useMail((s) => s.openAddAccount);
  const [editing, setEditing] = useState<string | null>(null);
  const editAccount = accounts.find((a) => a.id === editing);

  const pick = (id: string) => {
    if (id !== scope) setScope(id);
    onPicked();
  };

  return (
    <AnimatePresence mode="wait" initial={false}>
      {editAccount ? (
        <motion.div key="edit" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }} transition={{ duration: 0.14 }}>
          <button
            onClick={() => setEditing(null)}
            className="mb-1 flex h-8 items-center gap-0.5 rounded-lg pr-2 pl-0.5 text-[12.5px] font-medium text-ink-2 transition-colors hover:bg-hover hover:text-ink"
          >
            <ChevronLeft size={16} /> {t("Mailboxes")}
          </button>
          <div className="px-1.5 pb-1.5">
            <MailboxCustomizer account={editAccount} onRemoved={() => setEditing(null)} />
          </div>
        </motion.div>
      ) : (
        <motion.div key="list" initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.14 }}>
          <PickerRow
            selected={scope === "all"}
            badge={<ScopeBadgeAll />}
            name={t("All mailboxes")}
            detail={tn(accounts.length, "{n} mailbox", "{n} mailboxes")}
            count={unreadCount(threads, "all")}
            onClick={() => pick("all")}
          />
          {accounts.map((a) => (
            <PickerRow
              key={a.id}
              selected={scope === a.id}
              badge={<MailboxBadge icon={a.icon} hue={a.hue} image={a.image} size={28} className="rounded-[8px]" />}
              name={a.name}
              detail={a.status === "auth_error" ? t("Needs reconnecting") : a.email}
              warn={a.status === "auth_error"}
              count={unreadCount(threads, a.id)}
              onClick={() => pick(a.id)}
              onEdit={() => setEditing(a.id)}
            />
          ))}
          <div className="mx-2 my-1 h-px bg-line" />
          <button
            onClick={() => {
              openAddAccount();
              onPicked();
            }}
            className="flex h-10 w-full items-center gap-2.5 rounded-[10px] px-2 text-[13px] text-ink-2 transition-colors hover:bg-hover hover:text-ink"
          >
            <span className="inline-flex size-7 items-center justify-center rounded-[8px] text-ink-3 shadow-[inset_0_0_0_1px_var(--line)]">
              <Plus size={14} strokeWidth={2.2} />
            </span>
            {t("Add mailbox")}
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ScopeBadgeAll() {
  return (
    <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-[8px] bg-accent-soft text-accent-text">
      <Inbox size={15} strokeWidth={2.2} />
    </span>
  );
}

function PickerRow({
  selected,
  badge,
  name,
  detail,
  warn,
  count,
  onClick,
  onEdit,
}: {
  selected: boolean;
  badge: React.ReactNode;
  name: string;
  detail: string;
  warn?: boolean;
  count: number;
  onClick: () => void;
  onEdit?: () => void;
}) {
  return (
    <div className="group relative">
      <button
        onClick={onClick}
        aria-current={selected || undefined}
        className={cn(
          "flex min-h-12 w-full items-center gap-2.5 rounded-[10px] py-1.5 pl-2 text-left transition-colors hover:bg-hover",
          onEdit ? "pr-10" : "pr-2.5",
          selected && "bg-selected",
        )}
      >
        {badge}
        <span className="min-w-0 flex-1">
          <span className={cn("block truncate text-[13.5px]", selected ? "font-semibold" : "font-medium")}>{name}</span>
          <span className={cn("block truncate text-[11.5px]", warn ? "text-danger" : "text-ink-3")}>{detail}</span>
        </span>
        {count > 0 && <span className="text-[12px] font-medium text-ink-2 tabular-nums">{count}</span>}
        {selected && !onEdit && <Check size={15} className="shrink-0 text-accent-text" strokeWidth={2.4} />}
      </button>
      {onEdit && (
        <button
          onClick={onEdit}
          aria-label={t("{name} settings", { name })}
          className="absolute top-1/2 right-1.5 flex size-7 -translate-y-1/2 items-center justify-center rounded-lg text-ink-3 transition-[opacity,background-color,color] hover:bg-hover hover:text-ink [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100"
        >
          <SlidersHorizontal size={14} />
        </button>
      )}
    </div>
  );
}

/* ----------------------------- Mailbox settings ---------------------------- */

/** A mailbox's name, colour, icon or picture. `page` is the roomier layout of the Settings window. */
export function MailboxCustomizer({ account, onRemoved, page = false }: { account: Account; onRemoved?: () => void; page?: boolean }) {
  const updateAccount = useMail((s) => s.updateAccount);
  const setAccountImage = useMail((s) => s.setAccountImage);
  const fileInput = useRef<HTMLInputElement>(null);
  const [cropping, setCropping] = useState<File | null>(null);

  if (cropping) {
    return (
      <ImageCropper
        file={cropping}
        onCancel={() => setCropping(null)}
        onDone={async (dataUrl) => {
          await setAccountImage(account.id, dataUrl);
          setCropping(null);
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2.5">
        <MailboxBadge icon={account.icon} hue={account.hue} image={account.image} size={32} className="rounded-[10px]" />
        <div className="min-w-0 flex-1">
          <input
            value={account.name}
            onChange={(e) => updateAccount(account.id, { name: e.target.value })}
            className="-mx-1 w-full rounded-md bg-transparent px-1 text-[14px] font-medium outline-none focus:bg-hover"
            aria-label={t("Mailbox name")}
          />
          <div className="truncate text-[12px] text-ink-3">{account.email}</div>
          {LIVE && <ImportStatus account={account} />}
        </div>
      </div>
      <div>
        <div className="mb-1.5 text-[11px] font-medium text-ink-3">{t("Colour")}</div>
        <div className={cn("grid grid-cols-6", page ? "w-fit gap-2 sm:grid-cols-12" : "gap-1.5")}>
          {MAILBOX_HUES.map((h) => (
            <button
              key={h}
              aria-label={t("Hue {hue}", { hue: h })}
              onClick={() => updateAccount(account.id, { hue: h })}
              className={cn(
                "hue-dot size-7 rounded-full transition-transform hover:scale-110",
                account.hue === h && "ring-2 ring-ink/70 ring-offset-2 ring-offset-[var(--solid)]",
              )}
              style={hueStyle(h)}
            />
          ))}
        </div>
      </div>
      <div>
        <div className="mb-1.5 text-[11px] font-medium text-ink-3">{t("Icon")}</div>
        <div className={cn("grid grid-cols-8", page ? "w-fit gap-1.5" : "gap-1")}>
          {(Object.keys(MAILBOX_ICONS) as MailboxIconName[]).map((name) => {
            const Icon = MAILBOX_ICONS[name];
            const selected = !account.image && account.icon === name;
            return (
              <Tooltip key={name} label={t(MAILBOX_ICON_LABELS[name])} side="top">
                <button
                  aria-label={t(MAILBOX_ICON_LABELS[name])}
                  aria-pressed={selected}
                  onClick={() => {
                    updateAccount(account.id, { icon: name });
                    if (account.image) void setAccountImage(account.id, null);
                  }}
                  className={cn(
                    "flex items-center justify-center rounded-md transition-colors",
                    page ? "size-8" : "size-7",
                    selected ? "hue-tint" : "text-ink-2 hover:bg-hover",
                  )}
                  style={hueStyle(account.hue)}
                >
                  <Icon size={page ? 15 : 14} />
                </button>
              </Tooltip>
            );
          })}
        </div>
        {/* The icon is the main choice; a picture of your own is the smaller, optional one under it. */}
        {account.image ? (
          <div className="mt-2 flex items-center gap-2 text-[12px]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={account.image} alt="" className="size-6 shrink-0 rounded-[7px] object-cover shadow-[inset_0_0_0_0.5px_rgb(0_0_0/0.08)]" />
            <span className="min-w-0 flex-1 truncate text-ink-2">{t("Your picture is in use")}</span>
            <button onClick={() => fileInput.current?.click()} className="font-medium text-accent-text hover:underline">
              {t("Change")}
            </button>
            <button onClick={() => void setAccountImage(account.id, null)} className="font-medium text-ink-3 hover:text-danger">
              {t("Remove")}
            </button>
          </div>
        ) : (
          <button
            onClick={() => fileInput.current?.click()}
            className="mt-1.5 -ml-1.5 flex h-7 items-center gap-1.5 rounded-md px-1.5 text-[12px] font-medium text-ink-3 transition-colors hover:bg-hover hover:text-ink"
          >
            <ImagePlus size={13} />
            {t("Or upload your own picture")}
          </button>
        )}
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) setCropping(file);
          }}
        />
      </div>
      <DisconnectMailbox account={account} onRemoved={onRemoved} />
    </div>
  );
}

/** Where the import stands: the first 90 days, then all older mail in the background. */
function ImportStatus({ account }: { account: Account }) {
  const label =
    account.status === "syncing"
      ? t("Importing recent mail…")
      : account.status === "ok" && account.historyComplete === false
        ? t("Importing older mail in the background…")
        : null;
  if (!label) return null;
  return (
    <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-ink-3">
      <span className="size-1.5 animate-pulse rounded-full bg-accent" aria-hidden />
      {label}
    </div>
  );
}

/** Two steps, so a stray click can't throw a mailbox away. */
function DisconnectMailbox({ account, onRemoved }: { account: Account; onRemoved?: () => void }) {
  const removeAccount = useMail((s) => s.removeAccount);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className="-mx-1 mt-1 h-8 rounded-[10px] px-1 text-left text-[12.5px] font-medium text-danger transition-colors hover:bg-danger/10"
      >
        {t("Disconnect mailbox…")}
      </button>
    );
  }

  const disconnect = async () => {
    setBusy(true);
    setError(null);
    try {
      await removeAccount(account.id);
      onRemoved?.();
    } catch (err) {
      setError((err as Error).message || t("Couldn't disconnect. Try again."));
      setBusy(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={spring} className="mt-1 rounded-xl bg-danger/8 p-2.5">
      <p className="text-[12px] leading-relaxed text-ink-2">
        {account.provider === "gmail"
          ? t("Kolbaba deletes its copy of {email} and gives up its access at Google. Your mail stays with your provider.", { email: account.email })
          : t("Kolbaba deletes its copy of {email}. Your mail stays with your provider.", { email: account.email })}
      </p>
      {error && <p className="mt-1.5 text-[12px] text-danger">{error}</p>}
      <div className="mt-2 flex gap-1.5">
        <button
          onClick={() => setConfirming(false)}
          className="h-7 flex-1 rounded-[9px] bg-hover text-[12px] font-medium text-ink-2 transition-colors hover:bg-selected"
        >
          {t("Cancel")}
        </button>
        <button
          disabled={busy}
          onClick={disconnect}
          className="h-7 flex-1 rounded-[9px] bg-danger text-[12px] font-medium text-white transition-opacity disabled:opacity-60"
        >
          {busy ? t("Disconnecting…") : t("Disconnect")}
        </button>
      </div>
    </motion.div>
  );
}
