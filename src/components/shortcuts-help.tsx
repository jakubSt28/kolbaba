"use client";

import { Dialog } from "radix-ui";
import { t, tk } from "@/lib/i18n";
import { useMail } from "@/lib/store";
import { Kbd } from "./ui";

/** Every keyboard shortcut, by what it's for. Keep in step with src/lib/use-shortcuts.ts. */
const GROUPS: { title: string; keys: [string[], string][] }[] = [
  {
    title: tk("Moving around"),
    keys: [
      [["J", "K"], tk("Next / previous")],
      [["/"], tk("Search")],
      [["⌘K"], tk("Search and commands")],
      [["[", "]"], tk("Previous / next tab")],
      [["Esc"], tk("Close")],
      [["G", "I"], tk("Go to Inbox")],
      [["G", "R"], tk("Go to No reply yet")],
      [["G", "P"], tk("Go to Pinned")],
      [["G", "H"], tk("Go to Snoozed")],
      [["G", "D"], tk("Go to Drafts")],
      [["G", "S"], tk("Go to Sent")],
      [["G", "A"], tk("Go to Archive")],
    ],
  },
  {
    title: tk("Conversation"),
    keys: [
      [["E"], tk("Archive")],
      [["#"], tk("Delete")],
      [["P"], tk("Pin")],
      [["H"], tk("Snooze")],
      [["U"], tk("Read / unread")],
      [["M"], tk("Mute")],
      [["N"], tk("Note")],
      [["!"], tk("Report spam")],
      [["⌘P"], tk("Print")],
      [["Z"], tk("Undo")],
    ],
  },
  {
    title: tk("Writing"),
    keys: [
      [["C"], tk("New message")],
      [["R"], tk("Reply")],
      [["⇧R"], tk("Reply all")],
      [["F"], tk("Forward")],
      [["⌘↵"], tk("Send")],
      [["/"], tk("Blocks and snippets, in the text")],
    ],
  },
  {
    title: tk("Several at once"),
    keys: [
      [["⌘A"], tk("Select all")],
      [["⌘", "click"], tk("Add to the selection")],
      [["⇧", "click"], tk("Select a range")],
      [["⇧U"], tk("Only unread")],
      [["?"], tk("This list")],
      [["⌘,"], tk("Settings")],
    ],
  },
];

export function ShortcutsHost() {
  const open = useMail((s) => s.shortcutsOpen);
  const setOpen = useMail((s) => s.setShortcutsOpen);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/20 data-[state=open]:animate-[fade-in_140ms_ease-out] dark:bg-black/45" />
        <Dialog.Content className="sheet fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-48px)] w-[min(760px,calc(100vw-48px))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[24px] p-6 outline-none data-[state=open]:animate-[menu-in_180ms_ease-out]">
          <Dialog.Title className="text-[20px] font-semibold tracking-[-0.02em]">{t("Keyboard shortcuts")}</Dialog.Title>
          <Dialog.Description className="mt-0.5 text-[13px] text-ink-3">{t("Single keys work whenever you're not typing.")}</Dialog.Description>
          <div className="mt-5 grid grid-cols-2 gap-x-8 gap-y-6">
            {GROUPS.map((g) => (
              <section key={g.title}>
                <h3 className="mb-2 text-[12px] font-medium text-ink-3">{t(g.title)}</h3>
                <ul className="flex flex-col gap-1.5">
                  {g.keys.map(([keys, label]) => (
                    <li key={label} className="flex items-center justify-between gap-3 text-[13px] text-ink">
                      <span className="min-w-0 truncate">{t(label)}</span>
                      <span className="flex shrink-0 items-center gap-1">
                        {keys.map((k) => (
                          <Kbd key={k} className="h-[22px] min-w-[22px] text-[11.5px]">
                            {k === "click" ? t("click") : k}
                          </Kbd>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
