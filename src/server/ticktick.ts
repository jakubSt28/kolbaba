import { createHash } from "node:crypto";
import { z } from "zod";
import { splitEmoji } from "@/lib/tasks/logic";
import { cleanRule } from "@/lib/tasks/repeat";
import type { Priority } from "@/lib/tasks/types";
import { db, schema } from "./db";
import { HttpError } from "./http-error";
import { cleanSignatureHtml } from "./mail/email-html";
import { countLiveTasks, listTaskLists, MAX_TASKS } from "./tasks";

/**
 * Moving over from TickTick: its backup (Settings → Account → Backup) is one CSV of every task,
 * done or not, with its folder and list. Lists and folders are made here by name, and ids come
 * from the user and TickTick's own, so importing the same backup twice adds nothing.
 */

export const ImportBody = z.object({
  csv: z.string().min(1).max(4_000_000),
  /** The user's time zone, for tasks with a time (all-day ones are read in the zone they were made in). */
  tz: z.string().max(64).default("UTC"),
});

/** RFC 4180: fields in quotes may hold commas, quotes ("") and line breaks. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const zoneOk = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

/** The day and the time on the clock in a time zone. */
function localParts(iso: string, tz: string): { day: string; time: string } | null {
  const at = new Date(iso.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  if (Number.isNaN(at.getTime())) return null;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return { day: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

const ms = (iso: string) => {
  const at = new Date(iso.replace(/([+-]\d{2})(\d{2})$/, "$1:$2")).getTime();
  return Number.isNaN(at) ? null : at;
};

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * A task's text as editor HTML: lines become paragraphs, "- " lines a list, "- [ ]" lines to-dos.
 * A checklist (TickTick writes its items one after another, ▪ before a done one, ▫ before the rest)
 * becomes to-dos too.
 */
export function contentToHtml(content: string, checklist: boolean): string {
  const text = content.replace(/\r\n?/g, "\n").trim();
  if (!text) return "";
  const todo = (done: boolean, s: string) => `<li data-type="taskItem" data-checked="${done}"><p>${escape(s.trim())}</p></li>`;
  if (checklist && /[▪▫]/.test(text)) {
    const [before, ...items] = text.split(/(?=[▪▫])/);
    const intro = /[▪▫]/.test(before) ? "" : before;
    const list = [...(intro ? [] : [before]), ...items].filter((s) => s.slice(1).trim()).map((s) => todo(s[0] === "▪", s.slice(1)));
    return `${intro ? linesToHtml(intro) : ""}<ul data-type="taskList">${list.join("")}</ul>`;
  }
  return linesToHtml(text);
}

function linesToHtml(text: string) {
  const out: string[] = [];
  let list: { kind: "ul" | "todo"; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    out.push(list.kind === "ul" ? `<ul>${list.items.join("")}</ul>` : `<ul data-type="taskList">${list.items.join("")}</ul>`);
    list = null;
  };
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const todo = /^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    if (todo) {
      if (list?.kind !== "todo") flush();
      list ??= { kind: "todo", items: [] };
      list.items.push(`<li data-type="taskItem" data-checked="${todo[1] !== " "}"><p>${escape(todo[2])}</p></li>`);
    } else if (bullet) {
      if (list?.kind !== "ul") flush();
      list ??= { kind: "ul", items: [] };
      list.items.push(`<li><p>${escape(bullet[1])}</p></li>`);
    } else {
      flush();
      if (line.trim()) out.push(`<p>${escape(line)}</p>`);
    }
  }
  flush();
  return out.join("");
}

const PRIORITY: Record<string, Priority> = { "5": 3, "3": 2, "1": 1 };

/** An id of ours made from the user and something of TickTick's, the same every time. */
const stableId = (prefix: "tsk" | "lst", ...parts: string[]) => `${prefix}_${createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 20)}`;

export interface ImportResult {
  tasks: number;
  lists: number;
  /** Already here from an earlier import. */
  skipped: number;
}

export async function importTickTick(userId: string, csv: string, userZone: string): Promise<ImportResult> {
  const tz = zoneOk(userZone) ? userZone : "UTC";
  const table = parseCsv(csv);
  const at = table.findIndex((r) => r[0] === "Folder Name" && r.includes("Title"));
  if (at < 0) throw new HttpError(400, "That isn't a TickTick backup. In TickTick, open Settings → Account → Backup and generate one.", "bad_file");
  const head = table[at];
  const col = (name: string) => head.indexOf(name);
  const get = (row: string[], name: string) => (col(name) >= 0 ? (row[col(name)] ?? "") : "");
  const rows = table.slice(at + 1).filter((r) => r.length >= head.length - 2 && (get(r, "Title").trim() || get(r, "Content").trim()));

  /* Folders and lists, by name; what's not here yet is made, in the order the backup has them. */
  const have = await listTaskLists(userId);
  let order = have.reduce((m, l) => Math.max(m, l.order), 0);
  const byName = new Map(have.map((l) => [`${l.kind}\n${l.folderId ?? ""}\n${l.emoji ?? ""}${l.name}`, l.id]));
  const made: (typeof schema.taskLists.$inferInsert)[] = [];
  const find = (kind: "list" | "folder", full: string, folderId: string | null) => {
    const key = `${kind}\n${folderId ?? ""}\n${full}`;
    const known = byName.get(key) ?? byName.get(`${kind}\n${folderId ?? ""}\n${splitEmoji(full).emoji ?? ""}${splitEmoji(full).name}`);
    if (known) return known;
    const id = stableId("lst", userId, kind, folderId ?? "", full);
    const { emoji, name } = splitEmoji(full);
    made.push({ id, userId, kind, name: name.slice(0, 80) || full.slice(0, 80), emoji, folderId, sortOrder: (order += 1024) });
    byName.set(key, id);
    return id;
  };
  const listOf = (row: string[]) => {
    const list = get(row, "List Name").trim();
    const folder = get(row, "Folder Name").trim();
    if (!list || (list === "Inbox" && !folder)) return null;
    return find("list", list, folder ? find("folder", folder, null) : null);
  };

  const tasks = rows.map((row, i) => {
    const allDay = get(row, "Is All Day") === "true";
    const when = get(row, "Due Date") || get(row, "Start Date");
    const zone = allDay && zoneOk(get(row, "Timezone")) ? get(row, "Timezone") : tz;
    const local = when ? localParts(when, zone) : null;
    const status = get(row, "Status");
    const done = status === "2" || status === "-1";
    const created = ms(get(row, "Created Time"));
    const notes = contentToHtml(get(row, "Content"), get(row, "Is Check list") === "Y" || get(row, "Kind") === "CHECKLIST");
    return {
      id: stableId("tsk", userId, get(row, "taskId") || String(i), get(row, "Created Time")),
      userId,
      title: get(row, "Title").replace(/\s+/g, " ").trim().slice(0, 500),
      notes: notes ? cleanSignatureHtml(notes) : "",
      priority: PRIORITY[get(row, "Priority")] ?? 0,
      due: local?.day ?? null,
      time: local && !allDay ? local.time : null,
      repeat: local ? cleanRule(get(row, "Repeat")) : null,
      sortOrder: Number(get(row, "Order")) || 0,
      listId: listOf(row),
      completedAt: done ? new Date(ms(get(row, "Completed Time")) ?? created ?? Date.now()) : null,
      createdAt: new Date(created ?? Date.now()),
    };
  });

  const open = tasks.filter((x) => !x.completedAt).length;
  if ((await countLiveTasks(userId)) + open > MAX_TASKS) throw new HttpError(400, "That's a lot of tasks. Tick some off or empty Trash first.", "too_many");

  let added = 0;
  await db().transaction(async (tx) => {
    if (made.length) await tx.insert(schema.taskLists).values(made).onConflictDoNothing();
    for (let i = 0; i < tasks.length; i += 500) {
      const rows = await tx
        .insert(schema.tasks)
        .values(tasks.slice(i, i + 500))
        .onConflictDoNothing()
        .returning({ id: schema.tasks.id });
      added += rows.length;
    }
  });
  return { tasks: added, lists: made.filter((l) => l.kind === "list").length, skipped: tasks.length - added };
}
