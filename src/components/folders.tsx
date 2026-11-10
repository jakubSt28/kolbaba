"use client";

import { Check, ChevronRight, Folder, FolderInput, FolderPlus, LoaderCircle, Trash2 } from "lucide-react";
import { ContextMenu, Dialog, DropdownMenu } from "radix-ui";
import { useState, type ReactElement } from "react";
import { create } from "zustand";
import { t } from "@/lib/i18n";
import { ownFolderId, useMail } from "@/lib/store";
import type { MailFolder } from "@/lib/types";
import { cn } from "@/lib/utils";
import { confirmAction } from "./confirm";
import { Tooltip, hueStyle, menuContentClass, menuItemClass, subTriggerClass } from "./ui";

/** The colours a folder can have (the same set new folders get theirs from). */
export const FOLDER_HUES = [262, 160, 28, 205, 330, 95, 0, 50, 290, 130, 230, 15];

/** A folder's mark: the folder shape in its colour. */
export function FolderIcon({ hue, size = 15, className }: { hue: number; size?: number; className?: string }) {
  return <Folder size={size} strokeWidth={1.9} className={cn("hue-text shrink-0", className)} style={hueStyle(hue)} fill="currentColor" fillOpacity={0.18} />;
}

/* --------------------------------- Dialog --------------------------------- */

type DialogRequest = { mode: "create"; moveIds?: string[] } | { mode: "edit"; id: string };

const useFolderDialog = create<{ request: DialogRequest | null }>(() => ({ request: null }));

/** New folder (optionally filing these conversations in it right away), or rename / recolour / delete one. */
export function openFolderDialog(request: DialogRequest) {
  useFolderDialog.setState({ request });
}

const closeDialog = () => useFolderDialog.setState({ request: null });
export const closeFolderDialog = closeDialog;

export function FolderDialogHost() {
  const request = useFolderDialog((s) => s.request);
  const folder = useMail((s) => (request?.mode === "edit" ? s.folders.find((f) => f.id === request.id) : undefined));
  return (
    <Dialog.Root open={!!request} onOpenChange={(o) => !o && closeDialog()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/20 data-[state=open]:animate-[fade-in_140ms_ease-out] dark:bg-black/45" />
        <Dialog.Content
          aria-describedby={undefined}
          className="glass-strong fixed top-1/2 left-1/2 z-50 w-[min(400px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 rounded-[22px] p-5 outline-none data-[state=open]:animate-[dialog-in_180ms_cubic-bezier(0.32,0.72,0,1)]"
        >
          {request && <FolderForm key={request.mode === "edit" ? request.id : "new"} request={request} folder={folder} />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function FolderForm({ request, folder }: { request: DialogRequest; folder?: MailFolder }) {
  const folders = useMail((s) => s.folders);
  const [name, setName] = useState(folder?.name ?? "");
  const [hue, setHue] = useState(folder?.hue ?? FOLDER_HUES.find((h) => !folders.some((f) => f.hue === h)) ?? FOLDER_HUES[0]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const editing = request.mode === "edit";

  const submit = async () => {
    const clean = name.trim();
    if (!clean) return setError(t("Give the folder a name"));
    if (folders.some((f) => f.id !== folder?.id && f.name.toLowerCase() === clean.toLowerCase())) return setError(t("You already have a folder with that name"));
    setBusy(true);
    try {
      const { createFolder, updateFolder, moveToFolder } = useMail.getState();
      if (editing && folder) {
        await updateFolder(folder.id, { ...(clean !== folder.name ? { name: clean } : {}), ...(hue !== folder.hue ? { hue } : {}) });
      } else {
        const created = await createFolder(clean, hue);
        if (request.mode === "create" && request.moveIds?.length) moveToFolder(request.moveIds, created.id);
      }
      closeDialog();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const remove = () => {
    if (!folder) return;
    closeDialog();
    confirmAction({
      title: t("Delete {folder}?", { folder: folder.name }),
      message: t("The folder goes, in every mailbox. Its mail moves to Archive; nothing is deleted."),
      confirmLabel: t("Delete folder"),
      onConfirm: () => void useMail.getState().deleteFolder(folder.id),
    });
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Dialog.Title className="text-[15.5px] font-semibold tracking-[-0.01em]">{editing ? t("Edit folder") : t("New folder")}</Dialog.Title>
      <div className="mt-4 flex items-center gap-3 rounded-[12px] bg-canvas px-3 shadow-[inset_0_0_0_1px_var(--line)] focus-within:shadow-[inset_0_0_0_1.5px_var(--accent)]">
        <FolderIcon hue={hue} size={18} />
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          autoFocus
          maxLength={60}
          placeholder={t("Folder name")}
          aria-label={t("Folder name")}
          className="h-11 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-ink-3"
        />
      </div>
      {error && <p className="mt-1.5 text-[12px] text-danger">{error}</p>}
      <div className="mt-4 text-[12px] font-medium text-ink-3">{t("Colour")}</div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {FOLDER_HUES.map((h) => (
          <button
            key={h}
            type="button"
            onClick={() => setHue(h)}
            aria-label={t("Colour {n}", { n: FOLDER_HUES.indexOf(h) + 1 })}
            aria-pressed={hue === h}
            className="flex size-8 items-center justify-center rounded-full"
          >
            <span className={cn("hue-dot flex size-6 items-center justify-center rounded-full text-white", hue === h && "ring-2 ring-ink/60 ring-offset-2 ring-offset-[var(--solid)]")} style={hueStyle(h)}>
              {hue === h && <Check size={13} strokeWidth={3} />}
            </span>
          </button>
        ))}
      </div>
      <div className="mt-5 flex items-center gap-2">
        {editing && (
          <button type="button" onClick={remove} className="flex h-9 items-center gap-1.5 rounded-[11px] px-3 text-[13px] font-medium text-danger hover:bg-hover">
            <Trash2 size={14} /> {t("Delete")}
          </button>
        )}
        <span className="flex-1" />
        <button type="button" onClick={closeDialog} className="h-9 rounded-[11px] bg-hover px-3.5 text-[13px] font-medium text-ink-2 hover:bg-selected">
          {t("Cancel")}
        </button>
        <button type="submit" disabled={busy} className="flex h-9 items-center gap-1.5 rounded-[11px] bg-accent px-4 text-[13px] font-medium text-on-accent hover:bg-accent-hover disabled:opacity-60">
          {busy && <LoaderCircle size={13} className="animate-spin" />}
          {editing ? t("Save") : request.mode === "create" && request.moveIds?.length ? t("Create and move") : t("Create")}
        </button>
      </div>
    </form>
  );
}

/* ---------------------------------- Menus --------------------------------- */

/** The folders these conversations can go to: all but the one they're all in already. */
function useTargets(ids: string[]) {
  const folders = useMail((s) => s.folders);
  const current = useMail((s) => {
    const own = ids.map((id) => s.threads[id]?.folderId ?? null);
    return own.length && own.every((f) => f === own[0]) ? own[0] : null;
  });
  return folders.filter((f) => f.id !== current);
}

function FolderItems({ ids, Item }: { ids: string[]; Item: typeof DropdownMenu.Item | typeof ContextMenu.Item }) {
  const targets = useTargets(ids);
  return (
    <>
      {targets.map((f) => (
        <Item key={f.id} className={menuItemClass} onSelect={() => useMail.getState().moveToFolder(ids, f.id)}>
          <FolderIcon hue={f.hue} size={14} />
          <span className="min-w-0 flex-1 truncate">{f.name}</span>
        </Item>
      ))}
      <Item className={menuItemClass} onSelect={() => openFolderDialog({ mode: "create", moveIds: ids })}>
        <FolderPlus size={14} /> {t("New folder…")}
      </Item>
    </>
  );
}

/** "Move to…" inside a dropdown (the reader's More menu). */
export function MoveToFolderSub({ ids }: { ids: string[] }) {
  return (
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger className={subTriggerClass}>
        <FolderInput size={14} /> <span className="flex-1">{t("Move to folder")}</span> <ChevronRight size={14} className="opacity-60" />
      </DropdownMenu.SubTrigger>
      <DropdownMenu.Portal>
        <DropdownMenu.SubContent sideOffset={6} collisionPadding={8} className={cn(menuContentClass, "max-h-[60vh] overflow-y-auto")}>
          <FolderItems ids={ids} Item={DropdownMenu.Item} />
        </DropdownMenu.SubContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Sub>
  );
}

/** "Move to…" inside a list row's context menu. */
export function MoveToFolderContextSub({ ids }: { ids: string[] }) {
  return (
    <ContextMenu.Sub>
      <ContextMenu.SubTrigger className={subTriggerClass}>
        <FolderInput size={14} /> <span className="flex-1">{t("Move to folder")}</span> <ChevronRight size={14} className="opacity-60" />
      </ContextMenu.SubTrigger>
      <ContextMenu.Portal>
        <ContextMenu.SubContent sideOffset={6} collisionPadding={8} className={cn(menuContentClass, "max-h-[60vh] overflow-y-auto")}>
          <FolderItems ids={ids} Item={ContextMenu.Item} />
        </ContextMenu.SubContent>
      </ContextMenu.Portal>
    </ContextMenu.Sub>
  );
}

/** A button (multi-select bar) that opens the list of folders. */
export function MoveToFolderMenu({ ids, children, side = "top", align = "center" }: { ids: string[]; children: ReactElement; side?: "top" | "bottom"; align?: "start" | "center" | "end" }) {
  return (
    <DropdownMenu.Root modal={false}>
      <Tooltip label={t("Move to folder")} side="top">
        <DropdownMenu.Trigger asChild>{children}</DropdownMenu.Trigger>
      </Tooltip>
      <DropdownMenu.Portal>
        <DropdownMenu.Content side={side} align={align} sideOffset={6} collisionPadding={8} className={cn(menuContentClass, "max-h-[60vh] overflow-y-auto")} onClick={(e) => e.stopPropagation()}>
          <div className="px-2.5 pt-1.5 pb-1 text-[11px] font-medium text-ink-3">{t("Move to folder")}</div>
          <FolderItems ids={ids} Item={DropdownMenu.Item} />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** The folder a view shows, if it's one of the user's own. */
export function useOwnFolder(view: string): MailFolder | undefined {
  const id = ownFolderId(view);
  return useMail((s) => (id ? s.folders.find((f) => f.id === id) : undefined));
}
