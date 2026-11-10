"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** /admin: give someone Kolbaba Plus for free, or take the gift back. Labels come translated from the page. */
export function PlusGiftButton({ userId, gifted, labels }: { userId: string; gifted: boolean; labels: { give: string; take: string; failed: string } }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    setBusy(true);
    const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/plus`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ gift: !gifted }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return window.alert(labels.failed);
    router.refresh();
  };
  return (
    <button
      onClick={() => void toggle()}
      disabled={busy}
      className="mt-1 rounded-full px-2 py-0.5 text-[11.5px] font-medium text-accent-text shadow-[inset_0_0_0_0.5px_var(--line)] hover:bg-hover disabled:opacity-60"
    >
      {gifted ? labels.take : labels.give}
    </button>
  );
}
