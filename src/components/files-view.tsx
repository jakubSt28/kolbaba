"use client";

import { ChevronDown, Download, LoaderCircle, Paperclip } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useEffect, useMemo, useState } from "react";
import { t, tk } from "@/lib/i18n";
import { api, LIVE } from "@/lib/live";
import { useMail } from "@/lib/store";
import type { FileItem, FileKindFilter } from "@/lib/types";
import { cn, dateGroup, formatListTime } from "@/lib/utils";
import { useNow } from "@/lib/use-now";
import { FileIcon } from "./file-icon";
import { MailboxBadge, menuContentClass, menuItemClass } from "./ui";

/**
 * Files: every attachment across the mailboxes (src/server/mail/files.ts), newest first, by kind and
 * date, with the list's search box finding a file's name or who sent it. A file opens its email.
 */

const KINDS: { id: FileKindFilter; label: string }[] = [
  { id: "all", label: tk("All") },
  { id: "image", label: tk("Images") },
  { id: "pdf", label: tk("PDF") },
  { id: "doc", label: tk("Documents") },
  { id: "sheet", label: tk("Spreadsheets") },
  { id: "zip", label: tk("Archives") },
];

const PERIODS: { id: string; label: string; days: number | null }[] = [
  { id: "any", label: tk("Any time"), days: null },
  { id: "month", label: tk("Last 30 days"), days: 30 },
  { id: "year", label: tk("Last 12 months"), days: 365 },
];

export function FilesView({ mobile = false }: { mobile?: boolean }) {
  const scope = useMail((s) => s.scope);
  const query = useMail((s) => s.query);
  const accounts = useMail((s) => s.accounts);
  const [kind, setKind] = useState<FileKindFilter>("all");
  const [period, setPeriod] = useState("any");
  const [search, setSearch] = useState(query);
  const [state, setState] = useState<{ key: string; files: FileItem[]; next: string | null; loading: boolean; error?: string }>({
    key: "",
    files: [],
    next: null,
    loading: true,
  });
  const now = useNow();

  // The search box types fast; the list follows when it pauses.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query), 250);
    return () => clearTimeout(timer);
  }, [query]);

  const days = PERIODS.find((p) => p.id === period)?.days ?? null;
  const key = JSON.stringify({ scope, kind, search, days });
  const load = async (cursor: string | null) => {
    const params = new URLSearchParams({ scope, kind, q: search.trim() });
    // Rounded to the hour, so the same filters are the same request.
    if (days) params.set("since", String(Math.floor((Date.now() - days * 86_400_000) / 3600_000) * 3600_000));
    if (cursor) params.set("cursor", cursor);
    return api.get<{ files: FileItem[]; nextCursor: string | null }>(`/api/files?${params}`);
  };

  useEffect(() => {
    if (!LIVE) return;
    let live = true;
    setState((s) => ({ ...s, key, loading: true, error: undefined }));
    load(null).then(
      (r) => live && setState({ key, files: r.files, next: r.nextCursor, loading: false }),
      (err: Error) => live && setState({ key, files: [], next: null, loading: false, error: err.message }),
    );
    return () => {
      live = false;
    };
    // `load` reads the same values `key` is made of.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const more = async () => {
    if (!state.next || state.loading) return;
    setState((s) => ({ ...s, loading: true }));
    try {
      const r = await load(state.next);
      setState((s) => (s.key === key ? { ...s, files: [...s.files, ...r.files], next: r.nextCursor, loading: false } : s));
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: (err as Error).message }));
    }
  };

  const groups = useMemo(() => {
    const out: { label: string; files: FileItem[] }[] = [];
    for (const f of state.files) {
      const label = dateGroup(f.date, now);
      const group = out.find((g) => g.label === label);
      if (group) group.files.push(f);
      else out.push({ label, files: [f] });
    }
    return out;
  }, [state.files, now]);

  const periodLabel = PERIODS.find((p) => p.id === period)!.label;
  return (
    <div className={cn(mobile ? "px-2.5" : "")}>
      <div className={cn("flex flex-wrap items-center gap-1.5 pb-2", mobile ? "px-1.5" : "px-2")}>
        {KINDS.map((k) => (
          <button
            key={k.id}
            onClick={() => setKind(k.id)}
            aria-pressed={kind === k.id}
            className={cn(
              "h-7 rounded-full px-2.5 text-[12px] font-medium transition-colors",
              kind === k.id ? "bg-ink text-solid" : "text-ink-2 shadow-[inset_0_0_0_0.5px_var(--line)] hover:bg-hover",
            )}
          >
            {t(k.label)}
          </button>
        ))}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger className="ml-auto flex h-7 items-center gap-1 rounded-full px-2.5 text-[12px] font-medium text-ink-2 shadow-[inset_0_0_0_0.5px_var(--line)] hover:bg-hover data-[state=open]:bg-hover">
            {t(periodLabel)} <ChevronDown size={12} className="opacity-60" />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content align="end" sideOffset={6} className={menuContentClass}>
              {PERIODS.map((p) => (
                <DropdownMenu.Item key={p.id} className={menuItemClass} onSelect={() => setPeriod(p.id)}>
                  {t(p.label)}
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>

      {state.error ? (
        <div className="px-6 py-16 text-center text-[13px] text-ink-3">{state.error}</div>
      ) : !state.loading && state.files.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
          <Paperclip size={22} className="text-ink-3" />
          <div className="text-[15px] font-semibold">{search.trim() ? t("No files match “{query}”.", { query: search.trim() }) : t("No files here")}</div>
          <div className="text-[13px] text-ink-3">{t("Attachments from your mail show up here, newest first.")}</div>
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.label}>
            <div className={cn("px-3 pt-3 pb-1.5 font-medium text-ink-3", mobile ? "text-[12.5px] font-semibold" : "text-[11px]")}>{t(g.label)}</div>
            <div className={cn(mobile && "overflow-hidden rounded-[20px] bg-solid shadow-[var(--shadow-panel)]")}>
              {g.files.map((f) => {
                const account = accounts.find((a) => a.id === f.accountId);
                return (
                  <div
                    key={f.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => void useMail.getState().openThreadById(f.threadId)}
                    onKeyDown={(e) => e.key === "Enter" && void useMail.getState().openThreadById(f.threadId)}
                    className={cn(
                      "group flex cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors hover:bg-hover",
                      mobile ? "[&+&]:border-t [&+&]:border-line" : "rounded-[12px]",
                    )}
                  >
                    <FileIcon kind={f.kind} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-ink">{f.name}</span>
                        <span className="shrink-0 text-[12px] text-ink-3 tabular-nums">{formatListTime(f.date, now)}</span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-ink-3">
                        {scope === "all" && account && accounts.length > 1 && (
                          <MailboxBadge icon={account.icon} hue={account.hue} image={account.image} size={14} className="rounded-[4px]" />
                        )}
                        <span className="min-w-0 truncate">
                          {f.outgoing ? t("You") : f.from.name || f.from.email} · {f.subject || t("(no subject)")}
                        </span>
                        <span className="ml-auto shrink-0 tabular-nums">{f.size}</span>
                      </div>
                    </div>
                    <a
                      href={`${f.url}?download`}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={t("Download {name}", { name: f.name })}
                      className={cn(
                        "flex size-8 shrink-0 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-selected hover:text-ink",
                        !mobile && "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
                      )}
                    >
                      <Download size={15} />
                    </a>
                  </div>
                );
              })}
            </div>
          </section>
        ))
      )}

      {(state.loading || state.next) && !state.error && (
        <div className="flex justify-center py-4">
          {state.loading ? (
            <LoaderCircle size={18} className="animate-spin text-ink-3" />
          ) : (
            <button onClick={() => void more()} className="h-8 rounded-full px-3.5 text-[12.5px] font-medium text-ink shadow-[inset_0_0_0_0.5px_var(--line)] hover:bg-hover">
              {t("Show older")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
