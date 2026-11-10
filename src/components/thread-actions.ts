"use client";

import { t, tn } from "@/lib/i18n";
import { useMail } from "@/lib/store";
import type { Account, Thread } from "@/lib/types";
import { confirmAction } from "./confirm";

/** Gmail can't delete for good with the access we ask for; it empties Trash and Spam itself after 30 days. */
export const canDeleteForever = (thread: Thread, accounts: Account[]) =>
  accounts.find((a) => a.id === thread.accountId)?.provider !== "gmail";

/** Delete for good, after asking: the one action in the app without Undo. */
export function askDeleteForever(ids: string[]) {
  const { threads, accounts, deleteForever } = useMail.getState();
  const deletable = ids.filter((id) => threads[id] && canDeleteForever(threads[id], accounts));
  if (!deletable.length) return;
  confirmAction({
    title: t("Delete forever?"),
    message: tn(
      deletable.length,
      "{n} conversation will be gone from your mailbox for good. This can't be undone.",
      "{n} conversations will be gone from your mailbox for good. This can't be undone.",
    ),
    confirmLabel: t("Delete"),
    onConfirm: () => void deleteForever(deletable),
  });
}

/** The list may show only the first page, so the question names the folder, not a count. */
export function askEmptyBin(folder: "trash" | "spam") {
  // Whole sentences per folder: Czech declines the folder's name.
  const trash = folder === "trash";
  confirmAction({
    title: trash ? t("Empty Trash?") : t("Empty Spam?"),
    message: trash
      ? t("Everything in Trash will be deleted for good. This can't be undone.")
      : t("Everything in Spam will be deleted for good. This can't be undone."),
    confirmLabel: t("Empty"),
    onConfirm: () => void useMail.getState().emptyBin(folder),
  });
}
