"use client";

import { Bell, BellOff, Check, ChevronsUpDown, Crown, Moon, UsersRound, type LucideIcon } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useEffect, useState } from "react";
import { t, tk } from "@/lib/i18n";
import { LIVE } from "@/lib/live";
import { disablePush, pushState, usePush, type PushState } from "@/lib/push-client";
import { inQuietHours, minutesOf } from "@/lib/quiet-hours";
import { useMail } from "@/lib/store";
import { BADGE_MODES, NOTIFY_MODES, type BadgeMode, type Contact, type NotifyMode } from "@/lib/types";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { openInstallGuide, turnOnNotifications, useInstallGuide } from "./install-guide";
import { Group, Row, Toggle } from "./settings";
import { EventReminderSetting } from "./calendar/reminder-setting";
import { NotificationsPreview, PeopleOnlyPreview } from "./settings-previews";
import { MailboxBadge, menuContentClass, menuItemClass, Segmented } from "./ui";

const PUSH_HINTS: Record<PushState, string> = {
  unsupported: tk("Not available in this browser"),
  "install-first": tk("Add Kolbaba to your Home Screen first."),
  denied: tk("Blocked on this device. Turn on to see how to allow them."),
  off: tk("New mail, replies you're waiting for, opens"),
  on: tk("On for this device"),
};

export const NOTIFY_LABELS: Record<NotifyMode, { label: string; hint: string; icon: LucideIcon }> = {
  all: { label: tk("Everything"), hint: tk("Every new email"), icon: Bell },
  people: { label: tk("Only people"), hint: tk("No newsletters or automatic mail from shops, banks and apps"), icon: UsersRound },
  vip: { label: tk("Only VIPs"), hint: tk("Only people you marked as VIP"), icon: Crown },
  none: { label: tk("Nothing"), hint: tk("Mail still arrives, the phone stays quiet"), icon: BellOff },
};

const BADGE_LABELS: Record<BadgeMode, string> = { all: tk("All unread"), people: tk("From people"), none: tk("None@@badge") };

/**
 * Settings → Notifications: this device on or off, what each mailbox may notify about, quiet hours,
 * VIPs, and what the icon's number counts. The server decides each push (src/lib/quiet-hours.ts).
 */
export function NotificationSettings({ mobile = false }: { mobile?: boolean }) {
  const accounts = useMail((s) => s.accounts);
  const setNotifyMode = useMail((s) => s.setNotifyMode);
  const badgeMode = useMail((s) => s.badgeMode);
  const setBadgeMode = useMail((s) => s.setBadgeMode);
  const codeInNotification = useMail((s) => s.codeInNotification);
  const setCodeInNotification = useMail((s) => s.setCodeInNotification);
  return (
    <>
      {LIVE && <PushToggle />}
      <Group
        title={t("What may notify you")}
        info={t("Sign-in codes always come through (except with Nothing), and so do replies in conversations where you turned on “Notify me of replies”.")}
      >
        {accounts.map((a) => (
          <Row key={a.id} label={<span className="flex min-w-0 items-center gap-2"><MailboxBadge icon={a.icon} hue={a.hue} image={a.image} size={18} className="rounded-[6px]" /><span className="truncate">{a.name}</span></span>} hint={t(NOTIFY_LABELS[a.notify ?? "all"].hint)}>
            <NotifyPicker value={a.notify ?? "all"} onChange={(mode) => setNotifyMode(a.id, mode)} />
          </Row>
        ))}
        <div className="px-4 pt-1 pb-3.5">
          <PeopleOnlyPreview />
        </div>
      </Group>
      <QuietHoursSettings mobile={mobile} />
      <VipList />
      <Group footer={t("The number on Kolbaba's icon on your Home Screen or Dock.")}>
        <Row label={t("Icon badge")} stack>
          <Segmented id={`badge-${mobile}`} value={badgeMode} full options={BADGE_MODES.map((v) => ({ value: v, label: t(BADGE_LABELS[v]) }))} onChange={setBadgeMode} />
        </Row>
      </Group>
      <Group footer={t("Off: the notification only says a code came, and you open Kolbaba to see it. Safer on a phone that others can pick up.")}>
        <Row label={t("Show sign-in codes in notifications")} hint={t("Readable even on a locked screen")}>
          <Toggle on={codeInNotification} label={t("Show sign-in codes in notifications")} onChange={setCodeInNotification} />
        </Row>
      </Group>
      <EventReminderSetting />
    </>
  );
}

/** Notifications on this device (each phone and computer asks for its own permission). */
function PushToggle() {
  const pushToast = useMail((s) => s.pushToast);
  const push = usePush((s) => s.state);
  const [busy, setBusy] = useState(false);
  const guideOpen = useInstallGuide((s) => !!s.open);
  useEffect(() => {
    // Asked again on coming back from the system's settings, and once the steps to allow them close.
    const check = () => void pushState();
    if (!guideOpen) check();
    const onVisible = () => document.visibilityState === "visible" && check();
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [guideOpen]);
  const toggle = async () => {
    if (!push || busy) return;
    setBusy(true);
    try {
      await (push === "on" ? disablePush() : turnOnNotifications());
    } catch {
      pushToast({ message: t("Couldn't turn on notifications. Try again.") });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Group>
      <Row
        label={t("On this device")}
        preview={<NotificationsPreview />}
        hint={
          push === "install-first" ? (
            <>
              {t(PUSH_HINTS[push])}{" "}
              <button onClick={() => openInstallGuide("ios")} className="font-medium text-accent-text">
                {t("How?")}
              </button>
            </>
          ) : push ? (
            t(PUSH_HINTS[push])
          ) : undefined
        }
      >
        <Toggle
          on={push === "on"}
          label={t("Notifications")}
          disabled={!push || push === "unsupported" || push === "install-first" || busy}
          onChange={() => void toggle()}
        />
      </Row>
    </Group>
  );
}

export function NotifyPicker({ value, onChange }: { value: NotifyMode; onChange: (mode: NotifyMode) => void }) {
  const Icon = NOTIFY_LABELS[value].icon;
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button className="flex h-8 shrink-0 items-center gap-1.5 rounded-[10px] bg-hover pr-2 pl-2.5 text-[13px] font-medium text-ink transition-colors hover:bg-selected data-[state=open]:bg-selected">
          <Icon size={14} />
          {t(NOTIFY_LABELS[value].label)}
          <ChevronsUpDown size={12} className="text-ink-3" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content side="bottom" align="end" sideOffset={6} className={cn(menuContentClass, "z-[60] w-[270px]")}>
          <DropdownMenu.RadioGroup value={value} onValueChange={(v) => onChange(v as NotifyMode)}>
            {NOTIFY_MODES.map((m) => {
              const ItemIcon = NOTIFY_LABELS[m].icon;
              return (
                <DropdownMenu.RadioItem key={m} value={m} className={cn(menuItemClass, "group h-auto items-start py-2")}>
                  <ItemIcon size={14} className="mt-0.5 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{t(NOTIFY_LABELS[m].label)}</span>
                    <span className="block text-[11.5px] leading-snug text-ink-3 group-data-[highlighted]:text-on-accent/75">{t(NOTIFY_LABELS[m].hint)}</span>
                  </span>
                  <DropdownMenu.ItemIndicator className="mt-0.5">
                    <Check size={14} />
                  </DropdownMenu.ItemIndicator>
                </DropdownMenu.RadioItem>
              );
            })}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** A time of day; the field shows it in the device's own 12- or 24-hour format. */
function TimeField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-2 text-[13px] text-ink-3">
      {label}
      <input
        type="time"
        value={value}
        onChange={(e) => minutesOf(e.target.value) !== null && onChange(e.target.value)}
        className="h-8 rounded-[10px] bg-hover px-2.5 text-[16px] font-medium text-ink tabular-nums outline-none focus:shadow-[0_0_0_2px_var(--accent-soft)] md:text-[13.5px]"
      />
    </label>
  );
}

function QuietHoursSettings({ mobile }: { mobile: boolean }) {
  const quiet = useMail((s) => s.quietHours);
  const setQuiet = useMail((s) => s.setQuietHours);
  const now = useNow();
  const active = inQuietHours(quiet, new Date(now));
  return (
    <Group
      title={t("Quiet hours")}
      footer={t("Mail keeps arriving, only the phone stays quiet. VIPs, sign-in codes and conversations with “Notify me of replies” still come through.")}
    >
      <Row
        label={
          <span className="flex items-center gap-2">
            <Moon size={14} className="text-ink-3" />
            {t("Quiet at night")}
          </span>
        }
        hint={quiet.on ? (active ? t("Quiet now, until {time}", { time: quiet.to }) : t("Every day from {from} to {to}", { from: quiet.from, to: quiet.to })) : t("No notifications while you sleep")}
      >
        <Toggle on={quiet.on} label={t("Quiet hours")} onChange={(on) => setQuiet({ ...quiet, on })} />
      </Row>
      {quiet.on && (
        <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3", mobile && "justify-between")}>
          <TimeField label={t("From")} value={quiet.from} onChange={(from) => setQuiet({ ...quiet, from })} />
          <TimeField label={t("Until")} value={quiet.to} onChange={(to) => setQuiet({ ...quiet, to })} />
        </div>
      )}
    </Group>
  );
}

/** Who's a VIP; people become one from their email's menu or in Contacts. */
function VipList() {
  const vips = useMail((s) => s.vips);
  const setVip = useMail((s) => s.setVip);
  const contacts = useMail((s) => s.contacts);
  const loadContacts = useMail((s) => s.loadContacts);
  useEffect(() => {
    if (LIVE && vips.length) void loadContacts();
  }, [vips.length, loadContacts]);
  // One row per person: a contact with two addresses is one VIP.
  const people: { name: string; email: string }[] = [];
  for (const email of vips) {
    const c: Contact | undefined = contacts.find((x) => x.emails.includes(email));
    if (c && people.some((p) => c.emails.includes(p.email))) continue;
    people.push({ name: c?.name ?? "", email: c?.emails[0] ?? email });
  }
  return (
    <Group title={t("VIPs")} footer={people.length ? undefined : t("Nobody yet. Make someone a VIP from the … menu on their email, or in Contacts.")}>
      {people.length ? (
        people.map((p) => (
          <Row key={p.email} label={p.name || p.email} hint={p.name ? p.email : undefined}>
            <button onClick={() => void setVip(p, false)} className="h-8 shrink-0 rounded-[10px] bg-hover px-3 text-[13px] font-medium text-ink transition-colors hover:bg-selected">
              {t("Remove")}
            </button>
          </Row>
        ))
      ) : (
        <Row
          label={
            <span className="flex items-center gap-2">
              <Crown size={14} className="text-ink-3" />
              {t("Their mail always notifies")}
            </span>
          }
          hint={t("Even in quiet hours and in mailboxes set to Only VIPs")}
        />
      )}
    </Group>
  );
}
