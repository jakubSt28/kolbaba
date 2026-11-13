"use client";

import { ArrowDown, ArrowUp, CalendarRange, ChevronRight, CircleCheckBig, Ellipsis, Folder, FolderInput, FolderMinus, FolderOpen, FolderPlus, Inbox, List, ListPlus, Pencil, Plus, Trash2, Upload, type LucideIcon } from "lucide-react";
import { motion } from "motion/react";
import { DropdownMenu } from "radix-ui";
import { useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { t } from "@/lib/i18n";
import { dayFrom, viewCount } from "@/lib/tasks/logic";
import { siblingsOf, useTasks } from "@/lib/tasks/store";
import { listView, type TaskList, type TaskPatch, type TaskView } from "@/lib/tasks/types";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { confirmAction } from "../confirm";
import { menuContentClass, menuItemClass, spring, subTriggerClass, Tooltip } from "../ui";
import { isTaskDrag, useTaskDrag, viewTitle } from "./task-list";
import { openTickTickImport } from "./ticktick-import";

/** Today's date in a little calendar page, as TickTick draws Today. */
function TodayIcon({ day }: { day: number }) {
  return (
    <span className="relative inline-flex size-[16px] items-end justify-center rounded-[4px] border-[1.5px] border-current pb-[1px] text-[8.5px] leading-none font-bold tabular-nums">
      <span className="absolute inset-x-0 top-[2.5px] h-[1.3px] bg-current" />
      {day}
    </span>
  );
}

/** A list's emoji, or the list icon. */
export function ListIcon({ list, size = 15 }: { list: Pick<TaskList, "emoji" | "kind">; size?: number }) {
  if (list.emoji) return <span className="text-[14px] leading-none">{list.emoji}</span>;
  const Icon = list.kind === "folder" ? Folder : List;
  return <Icon size={size} strokeWidth={1.9} />;
}

const ICONS: Partial<Record<TaskView, LucideIcon>> = { next7: CalendarRange, inbox: Inbox, completed: CircleCheckBig, trash: Trash2 };

/** What a task dragged onto a view takes on: Today gives it today, a list takes it in, Completed ticks it off, Trash deletes it. */
function dropPatch(view: TaskView): TaskPatch | null {
  if (view === "today") return { due: dayFrom(new Date(), 0) };
  if (view === "inbox") return { listId: null };
  if (view.startsWith("list:")) return { listId: view.slice(5) };
  if (view === "completed") return { completed: true };
  if (view === "trash") return { deleted: true };
  return null;
}

/** A list or folder being named: a new one (no id yet) or one being renamed. */
type Naming = { id?: string; kind: TaskList["kind"]; folderId: string | null } | null;

/** The sidebar while the tasks are open: a new task, Today, the next 7 days and the Inbox, the lists and their folders, then what's done and Trash. */
export function TasksSidebar({ collapsed, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const tasks = useTasks((s) => s.tasks);
  const lists = useTasks((s) => s.lists);
  const view = useTasks((s) => s.view);
  const { setView, focusAdd } = useTasks.getState();
  const now = new Date(useNow());
  const [naming, setNaming] = useState<Naming>(null);

  const go = (v: TaskView) => {
    setView(v);
    onNavigate?.();
  };
  const row = (v: TaskView, opts: { icon?: ReactNode; label?: string; indent?: boolean; trailing?: ReactNode } = {}) => {
    const Icon = ICONS[v];
    return (
      <ViewRow
        key={v}
        view={v}
        collapsed={collapsed}
        active={view === v}
        label={opts.label ?? viewTitle(v, lists)}
        count={v === "completed" || v === "trash" ? undefined : viewCount(tasks, v, now)}
        icon={opts.icon ?? (v === "today" ? <TodayIcon day={now.getDate()} /> : Icon && <Icon size={15} strokeWidth={1.9} />)}
        indent={opts.indent}
        trailing={opts.trailing}
        onClick={() => go(v)}
      />
    );
  };
  const listRow = (list: TaskList, indent = false) =>
    naming?.id === list.id ? (
      <NameInput key={list.id} kind={list.kind} initial={`${list.emoji ? `${list.emoji} ` : ""}${list.name}`} indent={indent} onDone={(name) => {
        setNaming(null);
        if (name) useTasks.getState().renameList(list.id, name);
      }} />
    ) : (
      row(listView(list.id), { icon: <ListIcon list={list} />, label: list.name, indent, trailing: !collapsed && <ListMenu list={list} onRename={() => setNaming({ id: list.id, kind: "list", folderId: list.folderId })} /> })
    );
  const newHere = (folderId: string | null, indent = false) =>
    naming && !naming.id && naming.folderId === folderId && (naming.kind === "list" || folderId === null) ? (
      <NameInput key="new" kind={naming.kind} initial="" indent={indent} onDone={(name) => {
        const { kind } = naming;
        setNaming(null);
        if (!name) return;
        const made = useTasks.getState().addList(kind, name, folderId);
        if (kind === "list") go(listView(made.id));
      }} />
    ) : null;

  const top = siblingsOf(lists, null);

  return (
    <>
      <Tooltip label={t("New task")} shortcut="N" side="right">
        <button
          onClick={() => {
            // A new task goes where it's seen: the Inbox when nothing that adds is open.
            const v = useTasks.getState().view;
            if (v === "completed" || v === "trash") setView("inbox");
            focusAdd();
            onNavigate?.();
          }}
          aria-label={collapsed ? t("New task") : undefined}
          className={cn(
            "press mb-3 flex h-9 shrink-0 items-center justify-center gap-2 rounded-[11px] bg-accent text-[13px] font-medium text-on-accent shadow-[0_1px_2px_rgb(0_0_0/0.12),inset_0_1px_0_rgb(255_255_255/0.18)] [--press-scale:0.97] hover:bg-accent-hover",
            collapsed ? "size-9" : "w-full",
          )}
        >
          <Plus size={16} strokeWidth={2.2} />
          {!collapsed && t("New task")}
        </button>
      </Tooltip>
      <div className={cn("no-scrollbar -mx-2.5 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2.5", collapsed && "items-center")}>
        {row("today")}
        {row("next7")}
        {row("inbox")}

        {collapsed ? (
          <>
            {lists.length > 0 && <div className="my-1.5 h-px w-6 bg-line" />}
            {lists.filter((l) => l.kind === "list").sort((a, b) => a.order - b.order).map((l) => listRow(l))}
          </>
        ) : (
          <>
            <div className="mt-3 flex items-center px-2 pt-1 pb-1 text-[11px] font-medium tracking-[0.01em] text-ink-3">
              <span className="flex-1">{t("Lists")}</span>
              <DropdownMenu.Root modal={false}>
                <Tooltip label={t("New list")} side="right">
                  <DropdownMenu.Trigger aria-label={t("New list")} className="-my-1 flex size-6 items-center justify-center rounded-md text-ink-3 outline-none transition-colors hover:bg-hover hover:text-ink data-[state=open]:bg-hover">
                    <Plus size={14} />
                  </DropdownMenu.Trigger>
                </Tooltip>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content align="end" sideOffset={4} collisionPadding={8} className={menuContentClass}>
                    <DropdownMenu.Item className={menuItemClass} onSelect={() => setNaming({ kind: "list", folderId: null })}>
                      <ListPlus size={14} /> {t("New list")}
                    </DropdownMenu.Item>
                    <DropdownMenu.Item className={menuItemClass} onSelect={() => setNaming({ kind: "folder", folderId: null })}>
                      <FolderPlus size={14} /> {t("New folder")}
                    </DropdownMenu.Item>
                    <DropdownMenu.Separator className="my-1 h-px bg-line" />
                    <DropdownMenu.Item className={menuItemClass} onSelect={() => openTickTickImport()}>
                      <Upload size={14} /> {t("Import from TickTick")}
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            </div>
            {!lists.length && !naming && (
              <button
                onClick={() => setNaming({ kind: "list", folderId: null })}
                className="flex h-[34px] items-center gap-2.5 rounded-[10px] px-1.5 text-left text-[13.5px] text-ink-3 transition-colors hover:bg-hover hover:text-ink-2"
              >
                <span className="inline-flex size-[22px] items-center justify-center">
                  <ListPlus size={15} />
                </span>
                {t("New list")}
              </button>
            )}
            {top.map((item) =>
              item.kind === "folder" ? (
                <FolderGroup
                  key={item.id}
                  folder={item}
                  naming={naming?.id === item.id}
                  onRename={() => setNaming({ id: item.id, kind: "folder", folderId: null })}
                  onRenamed={(name) => {
                    setNaming(null);
                    if (name) useTasks.getState().renameList(item.id, name);
                  }}
                  onNewList={() => setNaming({ kind: "list", folderId: item.id })}
                >
                  {siblingsOf(lists, item.id).map((l) => listRow(l, true))}
                  {newHere(item.id, true)}
                </FolderGroup>
              ) : (
                listRow(item)
              ),
            )}
            {newHere(null)}
          </>
        )}

        <div className={cn("my-2 h-px bg-line", collapsed ? "w-6" : "mx-2")} />
        {row("completed")}
        {row("trash")}
      </div>
    </>
  );
}

/* --------------------------------- Folders --------------------------------- */

function FolderGroup({
  folder,
  naming,
  onRename,
  onRenamed,
  onNewList,
  children,
}: {
  folder: TaskList;
  naming: boolean;
  onRename: () => void;
  onRenamed: (name: string | null) => void;
  onNewList: () => void;
  children: ReactNode;
}) {
  const key = `folder:${folder.id}`;
  const open = useTasks((s) => !s.folded[key]);
  const setFolded = useTasks((s) => s.setFolded);
  return (
    <>
      {naming ? (
        <NameInput kind="folder" initial={`${folder.emoji ? `${folder.emoji} ` : ""}${folder.name}`} onDone={onRenamed} />
      ) : (
        <div className="group/row relative">
          <button
            onClick={() => setFolded(key, open)}
            aria-expanded={open}
            className="relative flex h-[34px] w-full items-center gap-2.5 rounded-[10px] px-1.5 text-left text-[13.5px] text-ink-2 transition-colors hover:bg-hover pointer-coarse:h-10"
          >
            <span className="inline-flex size-[22px] shrink-0 items-center justify-center">{folder.emoji ? <span className="text-[14px] leading-none">{folder.emoji}</span> : open ? <FolderOpen size={15} strokeWidth={1.9} /> : <Folder size={15} strokeWidth={1.9} />}</span>
            <span className="flex-1 truncate">{folder.name}</span>
            <ChevronRight size={14} className={cn("shrink-0 text-ink-3 transition-transform group-hover/row:opacity-0", open && "rotate-90")} />
          </button>
          <ListMenu list={folder} onRename={onRename} onNewList={onNewList} />
        </div>
      )}
      {open && children}
    </>
  );
}

/* ---------------------------------- Menus ---------------------------------- */

/** A list's or folder's ⋯: rename, move, put into a folder, delete. */
function ListMenu({ list, onRename, onNewList }: { list: TaskList; onRename: () => void; onNewList?: () => void }) {
  const lists = useTasks((s) => s.lists);
  const { stepList, moveListTo, deleteList } = useTasks.getState();
  const siblings = siblingsOf(lists, list.folderId);
  const at = siblings.findIndex((l) => l.id === list.id);
  const folders = lists.filter((l) => l.kind === "folder");
  const folder = list.kind === "folder";
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger
        aria-label={t("More for {name}", { name: list.name })}
        onClick={(e) => e.stopPropagation()}
        className="absolute top-1/2 right-1 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-ink-3 opacity-0 outline-none transition-[opacity,background-color] group-hover/row:opacity-100 hover:bg-selected hover:text-ink focus-visible:opacity-100 data-[state=open]:bg-selected data-[state=open]:opacity-100 pointer-coarse:opacity-100"
      >
        <Ellipsis size={14} />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="start" side="right" sideOffset={4} collisionPadding={8} className={cn(menuContentClass, "w-[220px]")}>
          <DropdownMenu.Item className={menuItemClass} onSelect={onRename}>
            <Pencil size={14} /> {t("Rename")}
          </DropdownMenu.Item>
          {folder && onNewList && (
            <DropdownMenu.Item className={menuItemClass} onSelect={onNewList}>
              <ListPlus size={14} /> {t("New list in this folder")}
            </DropdownMenu.Item>
          )}
          <DropdownMenu.Item className={menuItemClass} disabled={at <= 0} onSelect={() => stepList(list.id, -1)}>
            <ArrowUp size={14} /> {t("Move up")}
          </DropdownMenu.Item>
          <DropdownMenu.Item className={menuItemClass} disabled={at < 0 || at >= siblings.length - 1} onSelect={() => stepList(list.id, 1)}>
            <ArrowDown size={14} /> {t("Move down")}
          </DropdownMenu.Item>
          {!folder && (folders.length > 0 || list.folderId) && (
            <DropdownMenu.Sub>
              <DropdownMenu.SubTrigger className={subTriggerClass}>
                <FolderInput size={14} /> <span className="flex-1">{t("Move to folder")}</span>
                <ChevronRight size={14} />
              </DropdownMenu.SubTrigger>
              <DropdownMenu.Portal>
                <DropdownMenu.SubContent sideOffset={4} collisionPadding={8} className={cn(menuContentClass, "w-[200px]")}>
                  {folders.map((f) => (
                    <DropdownMenu.Item key={f.id} className={menuItemClass} disabled={f.id === list.folderId} onSelect={() => moveListTo(list.id, f.id)}>
                      <ListIcon list={f} size={14} /> <span className="truncate">{f.name}</span>
                    </DropdownMenu.Item>
                  ))}
                  {list.folderId && (
                    <DropdownMenu.Item className={menuItemClass} onSelect={() => moveListTo(list.id, null)}>
                      <FolderMinus size={14} /> {t("Out of the folder")}
                    </DropdownMenu.Item>
                  )}
                </DropdownMenu.SubContent>
              </DropdownMenu.Portal>
            </DropdownMenu.Sub>
          )}
          <DropdownMenu.Separator className="my-1 h-px bg-line" />
          <DropdownMenu.Item
            className={menuItemClass}
            onSelect={() =>
              confirmAction({
                title: folder ? t("Take apart {name}?", { name: list.name }) : t("Delete {name}?", { name: list.name }),
                message: folder ? t("Its lists stay, outside the folder.") : t("Its tasks go to Trash, where you can restore them for 30 days."),
                confirmLabel: folder ? t("Take apart") : t("Delete"),
                onConfirm: () => deleteList(list.id),
              })
            }
          >
            {folder ? <FolderMinus size={14} /> : <Trash2 size={14} />} {folder ? t("Take the folder apart") : t("Delete list")}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** Naming a list or folder in its place in the sidebar. An emoji at the start becomes its icon. */
function NameInput({ kind, initial, indent, onDone }: { kind: TaskList["kind"]; initial: string; indent?: boolean; onDone: (name: string | null) => void }) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (name: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(name?.trim() ? name.trim() : null);
  };
  return (
    <div className={cn("flex h-[34px] shrink-0 items-center gap-2.5 rounded-[10px] bg-solid px-1.5 shadow-[inset_0_0_0_1.5px_var(--accent)]", indent && "ml-4")}>
      <span className="inline-flex size-[22px] shrink-0 items-center justify-center text-ink-3">{kind === "folder" ? <Folder size={15} /> : <List size={15} />}</span>
      <input
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") finish(value);
          else if (e.key === "Escape") finish(null);
        }}
        onBlur={() => finish(value)}
        maxLength={90}
        placeholder={kind === "folder" ? t("Folder name") : t("List name")}
        className="h-full min-w-0 flex-1 bg-transparent text-[13.5px] text-ink outline-none placeholder:text-ink-3"
      />
    </div>
  );
}

/* ----------------------------------- Rows ----------------------------------- */

function ViewRow({
  view,
  icon,
  label,
  count,
  active,
  collapsed,
  indent,
  trailing,
  onClick,
}: {
  view: TaskView;
  icon: ReactNode;
  label: string;
  count?: number;
  active: boolean;
  collapsed?: boolean;
  indent?: boolean;
  trailing?: ReactNode;
  onClick: () => void;
}) {
  const [over, setOver] = useState(false);
  const dropTo = dropPatch(view);
  const accepts = (e: DragEvent) => !!dropTo && isTaskDrag(e) && !!useTaskDrag.getState().id;
  const button = (
    <div
      className="group/row relative"
      onDragEnter={(e) => accepts(e) && setOver(true)}
      onDragOver={(e) => {
        if (!accepts(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(e) => {
        setOver(false);
        if (!accepts(e) || !dropTo) return;
        e.preventDefault();
        const id = useTaskDrag.getState().id!;
        useTaskDrag.setState({ id: null, over: null });
        const tasks = useTasks.getState();
        if (dropTo.deleted) tasks.remove(id);
        else if (dropTo.completed) tasks.complete(id, true);
        else tasks.update(id, dropTo);
      }}
    >
      {over && <div className="pointer-events-none absolute inset-0 rounded-[10px] bg-accent-soft shadow-[inset_0_0_0_1.5px_var(--accent)]" />}
      {active && <motion.div layoutId="sidebar-active" transition={spring} className="absolute inset-0 rounded-[10px] bg-selected shadow-[inset_0_0_0_0.5px_var(--line)]" />}
      <button
        onClick={onClick}
        aria-current={active ? "page" : undefined}
        aria-label={collapsed ? label : undefined}
        className={cn(
          "relative flex h-[34px] w-full items-center gap-2.5 rounded-[10px] px-1.5 text-left text-[13.5px] transition-colors hover:bg-hover pointer-coarse:h-10",
          active ? "font-medium text-ink" : "text-ink-2",
          indent && !collapsed && "pl-5",
          collapsed && "w-9 justify-center px-0",
        )}
      >
        <span className="inline-flex size-[22px] shrink-0 items-center justify-center">{icon}</span>
        {!collapsed && <span className="flex-1 truncate">{label}</span>}
        {!collapsed && !!count && <span className={cn("text-[12px] text-ink-3 tabular-nums", trailing && "group-hover/row:opacity-0 pointer-coarse:opacity-0")}>{count}</span>}
        {collapsed && !!count && view === "today" && <span className="absolute top-1 right-1 size-1.5 rounded-full bg-accent" />}
      </button>
      {trailing}
    </div>
  );
  return collapsed ? (
    <Tooltip label={label} side="right">
      {button}
    </Tooltip>
  ) : (
    button
  );
}
