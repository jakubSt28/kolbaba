import { describe, expect, it } from "vitest";
import { bundleOf, bundleSenders, foldPinned, withBundles } from "./bundles";
import type { ListItem } from "./store";
import type { Thread } from "./types";

const now = Date.parse("2026-10-20T09:00:00Z");
const mine = new Set(["me@kolbaba.test"]);
let seq = 0;

function thread(kind: Thread["kind"], patch: Partial<Thread> = {}, from = `news${seq}@shop.cz`): Thread {
  const id = `t${seq++}`;
  return {
    id,
    accountId: "acc",
    subject: `Subject ${id}`,
    unread: true,
    pinned: false,
    folder: "inbox",
    kind,
    messages: [{ id: `m${id}`, from: { name: `Sender ${id}`, email: from }, to: [{ name: "", email: "me@kolbaba.test" }], date: now - seq * 60_000, html: "", snippet: "Weekly news" }],
    ...patch,
  };
}
const items = (threads: Thread[]): ListItem[] => threads.map((t) => ({ type: "thread", id: t.id, thread: t }));

describe("bundles", () => {
  it("fold newsletters and automatic mail, never people", () => {
    expect(bundleOf(thread("newsletter"), mine, now)).toBe("newsletter");
    expect(bundleOf(thread("notification"), mine, now)).toBe("notification");
    expect(bundleOf(thread("person"), mine, now)).toBeNull();
  });

  it("leave out what still needs you", () => {
    expect(bundleOf(thread("newsletter", { pinned: true }), mine, now)).toBeNull();
    expect(bundleOf(thread("newsletter", { watched: true }), mine, now)).toBeNull();
    expect(bundleOf(thread("notification", { followUpAt: now - 1000 }), mine, now)).toBeNull();
    expect(bundleOf(thread("notification", { wokeAt: now - 3600_000 }), mine, now)).toBeNull();
    const replied = thread("notification");
    replied.messages.push({ ...replied.messages[0], id: "mine", from: { name: "Me", email: "me@kolbaba.test" } });
    expect(bundleOf(replied, mine, now)).toBeNull();
    const toPay = thread("notification", { insight: { category: "invoice", key: "k", merchant: "ČEZ", amount: 1200, currency: "CZK", at: now, invoice: { number: null, dueAt: null, status: "due", variableSymbol: null } } });
    expect(bundleOf(toPay, mine, now)).toBeNull();
    const code = thread("notification", { subject: "Váš ověřovací kód" });
    code.messages[0].snippet = "Váš kód je 482913";
    code.messages[0].date = now - 60_000;
    expect(bundleOf(code, mine, now)).toBeNull();
  });

  it("put the row where its newest conversation was, and need two to fold", () => {
    const person = thread("person");
    const a = thread("newsletter");
    const b = thread("newsletter");
    const lone = thread("notification");
    const out = withBundles(items([person, a, b, lone]), { open: [], mine, now });
    expect(out.map((i) => i.id)).toEqual([person.id, "bundle:newsletter", lone.id]);
    const bundle = out[1];
    expect(bundle.type === "bundle" && bundle.threads.map((t) => t.id)).toEqual([a.id, b.id]);
  });

  it("list an open bundle's conversations after its row only when asked to", () => {
    const a = thread("newsletter");
    const b = thread("newsletter");
    expect(withBundles(items([a, b]), { open: ["newsletter"], mine, now }).map((i) => i.id)).toEqual(["bundle:newsletter"]);
    expect(withBundles(items([a, b]), { open: ["newsletter"], mine, now, members: true }).map((i) => i.id)).toEqual(["bundle:newsletter", a.id, b.id]);
  });

  it("name a few senders and count the rest", () => {
    const list = [thread("newsletter", {}, "a@x.cz"), thread("newsletter", {}, "b@x.cz"), thread("newsletter", {}, "c@x.cz"), thread("newsletter", {}, "d@x.cz")];
    const { names, more } = bundleSenders(list, mine, 2);
    expect(names).toHaveLength(2);
    expect(more).toBe(2);
  });
});

describe("pinned in Inbox", () => {
  const pins = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}` }));
  const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

  it("show the newest three and fold the rest", () => {
    const { shown, hidden, foldable } = foldPinned(pins(20), false);
    expect(ids(shown)).toEqual(["p0", "p1", "p2"]);
    expect(hidden).toHaveLength(17);
    expect(foldable).toBe(true);
  });

  it("never fold away just one", () => {
    expect(foldPinned(pins(4), false)).toEqual({ shown: pins(4), hidden: [], foldable: false });
    expect(foldPinned(pins(5), false).hidden).toHaveLength(2);
  });

  it("show them all once unfolded, with a row to fold them again", () => {
    expect(foldPinned(pins(20), true)).toEqual({ shown: pins(20), hidden: [], foldable: true });
  });

  it("keep the open one in sight, in its place", () => {
    expect(ids(foldPinned(pins(20), false, "p9").shown)).toEqual(["p0", "p1", "p2", "p9"]);
    expect(foldPinned(pins(5), false, "p4")).toEqual({ shown: pins(5), hidden: [], foldable: false });
  });
});
