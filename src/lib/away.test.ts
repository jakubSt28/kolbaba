import { describe, expect, it } from "vitest";
import { awayActive, awayByMailbox, awayRepliesOf, placeAway } from "./away";
import type { AwayReply } from "./types";

const reply = (over: Partial<AwayReply>): AwayReply => ({
  id: "r",
  name: "",
  on: false,
  from: null,
  until: null,
  subject: "",
  message: "Away",
  accountIds: [],
  onlyKnown: false,
  ...over,
});

describe("out-of-office replies", () => {
  it("keep the single reply from before as the first one", () => {
    expect(awayRepliesOf({}, ["a"])).toEqual([]);
    expect(awayRepliesOf({ away: { on: false, from: null, until: null, subject: "", message: "  ", accountIds: null, onlyKnown: false } }, ["a"])).toEqual([]);
    const [old] = awayRepliesOf({ away: { on: false, from: null, until: null, subject: "OOO", message: "Back Monday", accountIds: null, onlyKnown: true } }, ["a", "b"]);
    expect(old).toMatchObject({ id: "away", name: "", on: false, message: "Back Monday", accountIds: ["a", "b"], onlyKnown: true });
    expect(awayRepliesOf({ awayReplies: [], away: { on: true, from: null, until: null, subject: "", message: "x", accountIds: null, onlyKnown: false } }, ["a"])).toEqual([]);
  });

  it("answer only when on, in a mailbox and inside their dates", () => {
    const now = 1_000_000;
    expect(awayActive(reply({ on: true, accountIds: ["a"] }), now)).toBe(true);
    expect(awayActive(reply({ on: true, accountIds: [] }), now)).toBe(false);
    expect(awayActive(reply({ on: false, accountIds: ["a"] }), now)).toBe(false);
    expect(awayActive(reply({ on: true, accountIds: ["a"], from: now + 1 }), now)).toBe(false);
    expect(awayActive(reply({ on: true, accountIds: ["a"], until: now - 1 }), now)).toBe(false);
  });

  it("give each mailbox one reply: turning one on takes its mailboxes from the others", () => {
    const holiday = reply({ id: "holiday", on: true, accountIds: ["home", "work"] });
    const talk = reply({ id: "talk", on: false, accountIds: ["work"] });
    const saved = reply({ id: "saved", accountIds: ["home"] });
    const { replies, moved } = placeAway([holiday, talk, saved], { ...talk, on: true });
    expect(moved.map((r) => r.id)).toEqual(["holiday"]);
    expect(replies.find((r) => r.id === "holiday")).toMatchObject({ on: true, accountIds: ["home"] });
    expect(replies.find((r) => r.id === "talk")).toMatchObject({ on: true, accountIds: ["work"] });
    // An off reply keeps the mailboxes it'll use next time.
    expect(replies.find((r) => r.id === "saved")).toMatchObject({ on: false, accountIds: ["home"] });

    // Left with none, a reply turns off but remembers its mailboxes.
    const after = placeAway(replies, { ...holiday, id: "talk", on: true, accountIds: ["home", "work"] }).replies;
    expect(after.find((r) => r.id === "holiday")).toMatchObject({ on: false, accountIds: ["home"] });
  });

  it("adds a new reply at the end, and picks the first reply on for a mailbox", () => {
    const a = reply({ id: "a", on: true, accountIds: ["home"] });
    const { replies } = placeAway([a], reply({ id: "b" }));
    expect(replies.map((r) => r.id)).toEqual(["a", "b"]);
    const map = awayByMailbox([a, reply({ id: "c", on: true, accountIds: ["home", "work"] })]);
    expect(map.get("home")?.id).toBe("a");
    expect(map.get("work")?.id).toBe("c");
  });
});
