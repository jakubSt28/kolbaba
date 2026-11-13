import { like } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "./db";
import { listTasks } from "./tasks";
import { contentToHtml, importTickTick, parseCsv } from "./ticktick";

const DOMAIN = "ticktick-test.invalid";
let me = "";

beforeEach(async () => {
  await db().delete(schema.users).where(like(schema.users.email, `%@${DOMAIN}`));
  [{ id: me }] = await db().insert(schema.users).values({ email: `me@${DOMAIN}` }).returning();
});

afterAll(async () => {
  await db().delete(schema.users).where(like(schema.users.email, `%@${DOMAIN}`));
});

const HEAD = ["Folder Name", "List Name", "Title", "Kind", "Tags", "Content", "Is Check list", "Start Date", "Due Date", "Reminder", "Repeat", "Priority", "Status", "Created Time", "Completed Time", "Order", "Timezone", "Is All Day", "Is Floating", "Column Name", "Column Order", "View Mode", "taskId", "parentId", "projectKind"];
const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
type Row = Partial<Record<(typeof HEAD)[number], string>>;
/** A backup the way TickTick writes one: a few lines about itself, then the tasks. */
const backup = (rows: Row[]) =>
  [
    '﻿"Date: 2026-11-13+0000"',
    '"Version: 7.2"',
    '"Status: \n0 Normal\n-1 Abandoned \n2 Completed"',
    HEAD.map(q).join(","),
    ...rows.map((r, i) => HEAD.map((h) => q(r[h] ?? (h === "taskId" ? String(i + 1) : h === "Status" ? "0" : h === "Kind" ? "TEXT" : ""))).join(",")),
  ].join("\n");

describe("TickTick's backup", () => {
  it("is read as CSV, quotes and line breaks in fields too", () => {
    expect(parseCsv('a,"b ""c""","d\ne"\n1,2,3')).toEqual([
      ["a", 'b "c"', "d\ne"],
      ["1", "2", "3"],
    ]);
  });

  it("turns text into paragraphs, lists and to-dos, and a checklist into to-dos", () => {
    expect(contentToHtml("First line\n\n- one\n- two\n<b>", false)).toBe("<p>First line</p><ul><li><p>one</p></li><li><p>two</p></li></ul><p>&lt;b&gt;</p>");
    expect(contentToHtml("▪Done thing▫Open thing", true)).toBe('<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Done thing</p></li><li data-type="taskItem" data-checked="false"><p>Open thing</p></li></ul>');
    expect(contentToHtml("", false)).toBe("");
  });

  it("comes over with its folders, lists, days, times, priorities and repeats, once", async () => {
    const csv = backup([
      { "List Name": "Inbox", Title: "Call the plumber", Priority: "5", "Due Date": "2026-11-12T23:00:00+0000", "Start Date": "2026-11-12T23:00:00+0000", "Is All Day": "true", Timezone: "Europe/Prague", "Created Time": "2026-11-01T08:00:00+0000" },
      { "List Name": "✅Errands", Title: "Dentist", Priority: "3", "Due Date": "2026-11-14T08:30:00+0000", "Is All Day": "false", Timezone: "Europe/Prague", Content: "Ask about\nThursday", "Created Time": "2026-11-02T08:00:00+0000" },
      { "Folder Name": "🌙Someday", "List Name": "🏡Garden", Title: "Plant tulips", Status: "2", "Completed Time": "2026-10-20T10:00:00+0000", "Created Time": "2026-10-01T08:00:00+0000" },
      { "List Name": "🔁Routines", Title: "Pay the rent", Repeat: "FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=25", "Due Date": "2026-11-24T23:00:00+0000", "Is All Day": "true", Timezone: "Europe/Prague", "Created Time": "2026-01-01T08:00:00+0000" },
      { "List Name": "✅Errands", Title: "Packing", Kind: "CHECKLIST", "Is Check list": "Y", Content: "▪Passport▫Charger", "Created Time": "2026-11-03T08:00:00+0000" },
    ]);
    expect(await importTickTick(me, csv, "Europe/Prague")).toEqual({ tasks: 5, lists: 3, skipped: 0 });
    const { tasks, lists } = await listTasks(me);
    expect(lists.map((l) => [l.kind, l.emoji, l.name, l.folderId ? lists.find((f) => f.id === l.folderId)?.name : null])).toEqual([
      ["list", "✅", "Errands", null],
      ["folder", "🌙", "Someday", null],
      ["list", "🏡", "Garden", "Someday"],
      ["list", "🔁", "Routines", null],
    ]);
    const find = (title: string) => tasks.find((x) => x.title === title)!;
    expect(find("Call the plumber")).toMatchObject({ listId: null, priority: 3, due: "2026-11-13", time: null });
    expect(find("Dentist")).toMatchObject({ priority: 2, due: "2026-11-14", time: "09:30", notes: "<p>Ask about</p><p>Thursday</p>" });
    expect(find("Plant tulips").completedAt).toBe(Date.parse("2026-10-20T10:00:00Z"));
    expect(find("Pay the rent")).toMatchObject({ due: "2026-11-25", repeat: "FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=25" });
    expect(find("Packing").notes).toContain('data-checked="true"');
    // The same backup again: nothing new.
    expect(await importTickTick(me, csv, "Europe/Prague")).toEqual({ tasks: 0, lists: 0, skipped: 5 });
    expect((await listTasks(me)).lists).toHaveLength(4);
  });

  it("says so when the file isn't one", async () => {
    await expect(importTickTick(me, "name,email\nMia,mia@example.com", "Europe/Prague")).rejects.toMatchObject({ status: 400, code: "bad_file" });
  });
});
