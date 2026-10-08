// tests/guest-tags.test.js — v18.5.0
//
// ── GUEST TAGS: WHAT A GUEST HAS, AND WHAT A SAVE WRITES ────────────────────
// A guest tag is about the person, and a person here is derived from their
// bookings. So a booking may carry a STATEMENT of its guest's tags (`guestTags`
// and when it was made, `guestTagsAt`), and the guest has what their newest
// statement says (`src/lib/customers.js`, "GUEST TAGS"). This file holds that
// model to five things:
//
//   1. the tags shown for a booking are its guest's, whichever booking holds
//      the statement;
//   2. a save writes what the form showed: the guest's tags as they stand, with
//      what was tapped applied, and nothing when nothing was tapped;
//   3. a booking that leaves its guest (deleted, or given another phone) takes
//      nothing from the guest it leaves;
//   4. the history line never names a guest tag (it is copied to the activity
//      log, which Delete customer cannot rewrite);
//   5. Delete customer wipes every field that is personal, and every field of
//      the table is decided as wiped or kept.
//
// 1–3 are run two ways: named cases through the real `applyEdit` and
// `buildBooking`, and a generated run of saves, deletes and erasures on clocks
// that disagree, checked after every step against a plain record of what each
// guest should have. That check is then run on three broken versions of the
// code, and each must fail it.
//
// It reads `App.jsx` comment-stripped for the two places App is wired to this
// (tests/test-hygiene.test.js).

import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stripComments } from "../scripts/strip-comments.mjs";
import { BOOKING_FIELDS, sanitize, draftFromBooking } from "../src/lib/booking-fields.js";
import { applyEdit, buildBooking } from "../src/lib/booking-save.js";
import { undoSnapshots, applyUndo } from "../src/lib/booking-logic.js";
import {
  guestTagMap, guestTagsOf, guestTagBase, guestTagsChange, saveGuestTags, rehomeGuestTags,
  anonymizeBooking, matchesIdentity, normalizePhone, customerIndex,
  bookingTags, tagLine, setCustomerTags, customerTagTap, GUEST_TAGS_UPDATED,
} from "../src/lib/customers.js";
import { cleanTagIds, cleanTagEdits, editTagIds, toggleTagEdit, DEFAULT_TAG_LIST } from "../src/lib/tags.js";
import { EMPTY_FORM } from "../src/lib/constants.js";
import { addDays, todayStr } from "../src/lib/day.js";

afterEach(() => { vi.useRealTimers(); });

const today = todayStr();
// Future dates (tests/CLAUDE.md: derived, never a literal). Each booking gets a
// day of its own unless a case says otherwise, so no save is about tables.
const day = (n) => addDays(today, 10 + n);
const ANA = "+34 600 111 222", BEA = "+34 600 333 444", CARLA = "+34 600 555 666";
const A = "g-allergy", V = "g-vip", N = "g-vegan", GF = "g-gluten-free";
const LIST = DEFAULT_TAG_LIST;

let seq = 0;
function bk(id, o) {
  seq += 1;
  return sanitize(Object.assign({
    id, name: "Guest " + id, phone: "", date: day(seq % 25), time: "20:00", size: 2,
    status: "confirmed", tables: [], history: [],
  }, o), id);
}
// A booking that states its guest's tags.
const says = (id, phone, tags, at, o) => bk(id, Object.assign({ phone, guestTags: tags, guestTagsAt: at }, o));
const byId = (list, id) => list.find((b) => b.id === id);
const shown = (list, id) => guestTagsOf(byId(list, id), guestTagMap(list));
// The bookings whose statement differs between two lists (a created row that
// states something counts).
function statementsWritten(before, after) {
  const was = new Map(before.map((b) => [b.id, b]));
  const key = (b) => (b ? cleanTagIds(b.guestTags).join() + "@" + (Number(b.guestTagsAt) || 0) : "@0");
  return after.filter((b) => key(b) !== key(was.get(b.id))).map((b) => b.id).sort();
}

// The two saves, as App hands them over.
function edit(list, id, changes, more) {
  const plan = applyEdit(Object.assign({
    list, live: list, id, draft: Object.assign(draftFromBooking(byId(list, id)), changes), blocks: [], swap: null,
    autoOptimizer: false, today, nowMins: 12 * 60, phonePrefix: "+34", getUser: () => "t", tagList: LIST,
  }, more));
  expect(plan.refusal).toBeUndefined();
  return plan;
}
function create(list, draft) {
  const plan = buildBooking({
    list, draft: Object.assign({}, EMPTY_FORM, { name: "New Guest", phone: "", date: day(26), time: "20:00" }, draft),
    blocks: [], swap: null, autoOptimizer: false, phonePrefix: "+34", getUser: () => "t",
  });
  expect(plan.refusal).toBeUndefined();
  return plan;
}
const lastSaid = (list, id) => { const h = byId(list, id).history; return h[h.length - 1].action; };

// ═════════════════════════════════════════════════════════════════════════════
describe("the ids a booking carries, and the taps a form holds", () => {
  it("ids are well-formed, unique and sorted, whatever order they were tapped in", () => {
    expect(cleanTagIds([V, A, V, 3, "bad id", null, ""])).toEqual([A, V]);
    expect(cleanTagIds("g-vip")).toEqual([]);
  });
  it("the last tap on a tag wins", () => {
    expect(cleanTagEdits(["+" + A, "-" + A, "x", "+" + V])).toEqual(["-" + A, "+" + V]);
  });
  it("edits are applied to whatever the guest has by then", () => {
    expect(editTagIds([V], ["+" + A, "-" + V])).toEqual([A]);
    expect(editTagIds([V, N], ["+" + A])).toEqual([A, N, V]);
    expect(editTagIds([], ["-" + V])).toEqual([]);
  });
  it("a second tap on a chip leaves the form as it was opened", () => {
    expect(toggleTagEdit(toggleTagEdit([], [V], V), [V], V)).toEqual([]);
    expect(toggleTagEdit(toggleTagEdit([], [], A), [], A)).toEqual([]);
    expect(toggleTagEdit([], [V], V)).toEqual(["-" + V]);
    expect(toggleTagEdit([], [V], A)).toEqual(["+" + A]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("the tags shown for a booking are its guest's", () => {
  it("the newest statement wins, on whichever booking it sits", () => {
    const list = [says("a1", ANA, [A], 100), says("a2", ANA, [V], 300), bk("a3", { phone: ANA }), says("a4", ANA, [N], 200)];
    ["a1", "a2", "a3", "a4"].forEach((id) => expect(shown(list, id)).toEqual([V]));
  });
  it("the same stamp on two bookings: the higher id, on every device", () => {
    const list = [says("a1", ANA, [A], 100), says("a2", ANA, [V], 100)];
    expect(shown(list, "a1")).toEqual([V]);
    expect(shown(list.slice().reverse(), "a1")).toEqual([V]);
  });
  it("a newest statement of no tags is a removal, not a gap", () => {
    const list = [says("a1", ANA, [A], 100), says("a2", ANA, [], 200)];
    expect(shown(list, "a1")).toEqual([]);
  });
  it("another guest's statements are not theirs", () => {
    const list = [says("a1", ANA, [A], 100), bk("b1", { phone: BEA })];
    expect(shown(list, "b1")).toEqual([]);
  });
  it("a phone written two ways is one guest", () => {
    const list = [says("a1", "+34600111222", [A], 100), bk("a2", { phone: "+34 600 111 222" })];
    expect(shown(list, "a2")).toEqual([A]);
  });
  it("a joined phone-less guest: every booking of the group", () => {
    const list = [says("g1", "", [A], 100, { guestId: "gg1" }), bk("g2", { guestId: "gg1" }), bk("x", {})];
    expect(shown(list, "g2")).toEqual([A]);
    expect(shown(list, "x")).toEqual([]);
  });
  it("a group that later gave a number is one guest under it, both ways round", () => {
    // g3 carries both keys, which is what folds the group into the phone.
    const list = [says("g1", "", [A], 100, { guestId: "gg1" }), bk("g3", { phone: ANA, guestId: "gg1" }), says("a9", ANA, [V], 200)];
    ["g1", "g3", "a9"].forEach((id) => expect(shown(list, id)).toEqual([V]));
  });
  it("a booking that is nobody's shows its own statement", () => {
    const list = [says("x", "", [A], 100), bk("y", {})];
    expect(shown(list, "x")).toEqual([A]);
    expect(shown(list, "y")).toEqual([]);
  });
  it("the stored order of the ids does not matter", () => {
    const list = [bk("a1", { phone: ANA, guestTags: [V, A], guestTagsAt: 5 })];
    expect(shown(list, "a1")).toEqual([A, V]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("a form nobody tapped writes no guest tags", () => {
  const list = [says("a1", ANA, [A], 100), bk("a2", { phone: ANA }), says("b1", BEA, [V], 50), says("x", "", [N], 70)];

  it("an edit of each booking, with a field changed", () => {
    list.forEach((b) => {
      const plan = edit(list, b.id, { notes: "by the window" });
      expect(statementsWritten(list, plan.fin), b.id).toEqual([]);
      expect(lastSaid(plan.fin, b.id)).toBe("edited: notes updated");
    });
  });
  it("the edit form opens with no taps, whatever the booking states", () => {
    list.forEach((b) => expect(draftFromBooking(b).guestTagEdits, b.id).toEqual([]));
  });
  it("a booking whose statement has since been replaced, saved unchanged: the old tags do not come back", () => {
    // a1 said Allergy; a2 later took it off. A form on a1 that opened with a1's
    // own statement as its taps would put it back on the next Save.
    const old = [says("a1", ANA, [A], 100), says("a2", ANA, [], 200)];
    const plan = edit(old, "a1", { notes: "n" });
    expect(statementsWritten(old, plan.fin)).toEqual([]);
    expect(shown(plan.fin, "a1")).toEqual([]);
  });
  it("a new booking for a known guest states nothing, and shows what they have", () => {
    const plan = create(list, { phone: ANA });
    expect(statementsWritten(list, plan.fin)).toEqual([]);
    expect(byId(plan.fin, plan.id).guestTagsAt).toBeUndefined();
    expect(shown(plan.fin, plan.id)).toEqual([A]);
  });
  it("the transform returns the list it would have without tags (same object, no extra pass)", () => {
    const cand = list.map((b) => (b.id === "a2" ? Object.assign({}, b, { notes: "n" }) : b));
    expect(saveGuestTags(list, cand, "a2", [], null, 1)).toBe(cand);
    expect(saveGuestTags(list, cand, "a2", undefined, null, 1)).toBe(cand);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("a tap writes one booking, and the guest has what the form showed", () => {
  it("a tag added on an edit: this booking states the guest's tags plus it", () => {
    const list = [says("a1", ANA, [A], 100), bk("a2", { phone: ANA })];
    const plan = edit(list, "a2", { guestTagEdits: ["+" + V] });
    expect(statementsWritten(list, plan.fin)).toEqual(["a2"]);
    expect(byId(plan.fin, "a2").guestTags).toEqual([A, V]);
    expect(byId(plan.fin, "a1")).toStrictEqual(list[0]);
    ["a1", "a2"].forEach((id) => expect(shown(plan.fin, id)).toEqual([A, V]));
  });
  it("a tag taken off that another booking states: a newer statement without it", () => {
    const list = [says("a1", ANA, [A, V], 100), bk("a2", { phone: ANA })];
    const plan = edit(list, "a2", { guestTagEdits: ["-" + A] });
    expect(statementsWritten(list, plan.fin)).toEqual(["a2"]);
    expect(byId(plan.fin, "a1").guestTags).toEqual([A, V]);
    expect(shown(plan.fin, "a1")).toEqual([V]);
  });
  it("taps that come to what the guest already has write nothing", () => {
    const list = [says("a1", ANA, [A], 100), bk("a2", { phone: ANA })];
    const plan = edit(list, "a2", { guestTagEdits: ["+" + A], notes: "n" });
    expect(statementsWritten(list, plan.fin)).toEqual([]);
    expect(lastSaid(plan.fin, "a2")).toBe("edited: notes updated");
  });
  it("a new booking with a tap, for a known guest", () => {
    const list = [says("a1", ANA, [A], 100)];
    const plan = create(list, { phone: ANA, guestTagEdits: ["+" + V] });
    expect(statementsWritten(list, plan.fin)).toEqual([plan.id]);
    expect(shown(plan.fin, "a1")).toEqual([A, V]);
  });
  it("a new booking with a tap, for nobody known", () => {
    const plan = create([], { phone: CARLA, guestTagEdits: ["+" + GF] });
    expect(byId(plan.fin, plan.id).guestTags).toEqual([GF]);
    expect(byId(plan.fin, plan.id).guestTagsAt).toBeGreaterThan(0);
  });
  it("a booking with no phone holds its own", () => {
    const list = [bk("x", {})];
    const plan = edit(list, "x", { guestTagEdits: ["+" + A] });
    expect(shown(plan.fin, "x")).toEqual([A]);
    const again = edit(plan.fin, "x", { guestTagEdits: ["-" + A, "+" + V] });
    expect(shown(again.fin, "x")).toEqual([V]);
  });
  it("the stamp is above the one it replaces when this device's clock is behind", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(5000));
    const far = 9000000000000;   // a statement stamped by a clock far ahead
    const list = [says("a1", ANA, [A], far), bk("a2", { phone: ANA, date: day(3) })];
    const plan = edit(list, "a2", { guestTagEdits: ["+" + V] });
    expect(byId(plan.fin, "a2").guestTagsAt).toBe(far + 1);
    expect(shown(plan.fin, "a1")).toEqual([A, V]);
  });
  it("a replay on fresh data applies the taps to the tags as they are by then", () => {
    const list = [says("a1", ANA, [A], 100), bk("a2", { phone: ANA })];
    const plan = edit(list, "a2", { guestTagEdits: ["+" + V] });
    // Meanwhile another device took Allergy off and added Vegan, on a1.
    const fresh = [Object.assign({}, list[0], { guestTags: [N], guestTagsAt: 9000000000000 }), list[1]];
    const replayed = plan.next(fresh);
    expect(shown(replayed, "a1")).toEqual([N, V]);
    expect(statementsWritten(fresh, replayed)).toEqual(["a2"]);
  });
  it("the same prev gives the same list (a held write replays to what was shown)", () => {
    const list = [says("a1", ANA, [A], 100), bk("a2", { phone: ANA })];
    const plan = edit(list, "a2", { guestTagEdits: ["+" + V] });
    expect(JSON.stringify(plan.next(list.map((b) => Object.assign({}, b))))).toBe(JSON.stringify(plan.fin));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("what a form starts from when the guest in it changes", () => {
  const list = [says("a1", ANA, [A], 100), bk("a2", { phone: ANA }), says("b1", BEA, [V], 50), says("x", "", [N], 70)];

  it("a new booking: the tags of the guest whose number is typed, or none", () => {
    expect(guestTagBase(list, null, { phone: ANA })).toEqual([A]);
    expect(guestTagBase(list, null, { phone: CARLA })).toEqual([]);
    expect(guestTagBase(list, null, { phone: "" })).toEqual([]);
  });
  it("an edit that keeps its guest: that guest's", () => {
    expect(guestTagBase(list, "a2", { phone: ANA })).toEqual([A]);
    expect(guestTagBase(list, "x", { phone: "" })).toEqual([N]);
  });
  it("a number given to a booking that had none: what it had, plus what that guest has", () => {
    expect(guestTagBase(list, "x", { phone: BEA })).toEqual([N, V]);
    expect(guestTagBase(list, "x", { phone: CARLA })).toEqual([N]);
  });
  it("a booking moved to another known guest: both, where they can be seen and tapped off", () => {
    expect(guestTagBase(list, "a2", { phone: BEA })).toEqual([A, V]);
  });
  it("picking a phone-less guest from the name list: their tags", () => {
    expect(guestTagBase(list, null, { phone: "", guestId: "gx", guestSeed: "x" })).toEqual([N]);
  });
  it("guestTagsChange is the history line's question: do these taps change that?", () => {
    expect(guestTagsChange(list, "a2", { phone: ANA }, [])).toBe(false);
    expect(guestTagsChange(list, "a2", { phone: ANA }, ["+" + A])).toBe(false);
    expect(guestTagsChange(list, "a2", { phone: ANA }, ["+" + V])).toBe(true);
    expect(guestTagsChange(list, "a2", { phone: BEA }, ["-" + A])).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("a booking that leaves its guest takes nothing from them", () => {
  it("deleted while holding the newest statement: the most recent remaining booking holds it", () => {
    const list = [
      says("a1", ANA, [V], 100, { date: day(1) }), bk("a2", { phone: ANA, date: day(5) }),
      bk("a3", { phone: ANA, date: day(3) }), says("a4", ANA, [A], 300, { date: day(2) }),
    ];
    const after = rehomeGuestTags(list, list.filter((b) => b.id !== "a4"), "a4");
    expect(statementsWritten(list.filter((b) => b.id !== "a4"), after)).toEqual(["a2"]);
    expect([byId(after, "a2").guestTags, byId(after, "a2").guestTagsAt]).toEqual([[A], 300]);
    ["a1", "a2", "a3"].forEach((id) => expect(shown(after, id)).toEqual([A]));
  });
  it("…and Undo puts the deleted booking back and the heir as it was", () => {
    const list = [bk("a2", { phone: ANA, date: day(5) }), says("a4", ANA, [A], 300, { date: day(2) })];
    const after = rehomeGuestTags(list, list.filter((b) => b.id !== "a4"), "a4");
    const snaps = undoSnapshots(list, after);
    expect(snaps.map((b) => b.id).sort()).toEqual(["a2", "a4"]);
    expect(applyUndo(after, snaps).slice().sort((x, y) => x.id.localeCompare(y.id))).toStrictEqual(list);
  });
  it("deleted while another booking holds it, or stating nothing: the list it was given", () => {
    const list = [says("a1", ANA, [V], 100), bk("a2", { phone: ANA }), says("a4", ANA, [A], 300)];
    const without = (id) => list.filter((b) => b.id !== id);
    const w1 = without("a1"), w2 = without("a2");
    expect(rehomeGuestTags(list, w1, "a1")).toBe(w1);
    expect(rehomeGuestTags(list, w2, "a2")).toBe(w2);
  });
  it("the guest's only booking, deleted: there is nobody left to hold it", () => {
    const list = [says("a1", ANA, [A], 100), bk("b1", { phone: BEA })];
    const w = list.filter((b) => b.id !== "a1");
    expect(rehomeGuestTags(list, w, "a1")).toBe(w);
  });
  it("given another guest's number while holding the statement: the guest it leaves keeps theirs", () => {
    const list = [
      says("a1", ANA, [A], 300, { date: day(2) }), bk("a2", { phone: ANA, date: day(4) }),
      says("b1", BEA, [V], 50, { date: day(6) }),
    ];
    const plan = edit(list, "a1", { phone: BEA });
    expect(statementsWritten(list, plan.fin)).toEqual(["a1", "a2"]);
    expect(shown(plan.fin, "a2")).toEqual([A]);                 // Ana, through her remaining booking
    expect(byId(plan.fin, "a2").guestTagsAt).toBe(300);
    expect(shown(plan.fin, "a1")).toEqual([A, V]);              // the booking, and Bea with it
    expect(shown(plan.fin, "b1")).toEqual([A, V]);
    // An ordinary edit: Undo restores both rows it wrote.
    expect(plan.changed).toBe(true);
    expect(undoSnapshots(list, plan.fin).map((b) => b.id).sort()).toEqual(["a1", "a2"]);
  });
  it("…and the tag can be tapped off in that same save, without touching the guest it leaves", () => {
    const list = [says("a1", ANA, [A], 300, { date: day(2) }), bk("a2", { phone: ANA, date: day(4) }), says("b1", BEA, [V], 50, { date: day(6) })];
    const plan = edit(list, "a1", { phone: BEA, guestTagEdits: ["-" + A] });
    expect(shown(plan.fin, "a2")).toEqual([A]);
    expect(shown(plan.fin, "b1")).toEqual([V]);
  });
  it("a number corrected on a guest's only booking: its tags stay, and nothing is restated", () => {
    const list = [says("a1", ANA, [A], 300)];
    const plan = edit(list, "a1", { phone: CARLA });
    expect(statementsWritten(list, plan.fin)).toEqual([]);
    expect(shown(plan.fin, "a1")).toEqual([A]);
  });
  it("a booking that did not hold the statement, moved: the guest it leaves is not written", () => {
    const list = [says("a1", ANA, [A], 300), bk("a2", { phone: ANA }), bk("b1", { phone: BEA })];
    const plan = edit(list, "a2", { phone: BEA });
    expect(statementsWritten(list, plan.fin)).toEqual(["a2"]);
    expect(shown(plan.fin, "a1")).toEqual([A]);
    expect(shown(plan.fin, "b1")).toEqual([A]);
  });
  it("a group that follows the booking to its new number is not the guest it leaves", () => {
    // g3 is what joins the group gg1 to Ana's number; a9 is Ana's by phone alone.
    const list = [
      bk("g1", { guestId: "gg1", date: day(1) }), says("g3", ANA, [A], 300, { guestId: "gg1", date: day(2) }),
      bk("a9", { phone: ANA, date: day(3) }),
    ];
    const plan = edit(list, "g3", { phone: CARLA });
    expect(shown(plan.fin, "a9")).toEqual([A]);       // left behind, and holding the statement now
    expect(byId(plan.fin, "a9").guestTagsAt).toBe(300);
    expect(byId(plan.fin, "g1")).toStrictEqual(list[0]);   // came along: not written
    expect(shown(plan.fin, "g1")).toEqual([A]);
    expect(shown(plan.fin, "g3")).toEqual([A]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("the history line names an occasion tag and never a guest tag", () => {
  const list = [says("a1", ANA, [A], 100), bk("a2", { phone: ANA, tags: ["o-anniversary"] })];
  const guestLabels = LIST.guest.map((t) => t.label);

  it("an occasion tag set, changed and cleared", () => {
    expect(lastSaid(edit(list, "a1", { tags: ["o-birthday"] }).fin, "a1")).toBe("edited: occasion tags: Birthday");
    expect(lastSaid(edit(list, "a2", { tags: ["o-birthday", "o-anniversary"] }).fin, "a2")).toBe("edited: occasion tags: Birthday, Anniversary");
    expect(lastSaid(edit(list, "a2", { tags: [] }).fin, "a2")).toBe("edited: occasion tags: cleared");
  });
  it("an occasion tag the list no longer has, or no list at all: the change is said, without a name", () => {
    expect(lastSaid(edit(list, "a1", { tags: ["o-gone"] }).fin, "a1")).toBe("edited: occasion tags updated");
    expect(lastSaid(edit(list, "a1", { tags: ["o-birthday"] }, { tagList: undefined }).fin, "a1")).toBe("edited: occasion tags updated");
  });
  it("the same occasion tags in another order are no change", () => {
    const plan = edit(list, "a2", { tags: ["o-anniversary"] });
    expect(plan.changed).toBe(false);
  });
  it("a guest tag change says only that there was one", () => {
    const plan = edit(list, "a2", { guestTagEdits: ["+" + V, "-" + A] });
    expect(lastSaid(plan.fin, "a2")).toBe("edited: guest tags updated");
    expect(plan.changed).toBe(true);
  });
  it("every history line these saves write is free of every guest tag's name", () => {
    const plans = [
      edit(list, "a2", { guestTagEdits: ["+" + V] }),
      edit(list, "a2", { guestTagEdits: ["-" + A], notes: "n", tags: ["o-birthday"] }),
      edit(list, "a1", { phone: BEA, guestTagEdits: ["+" + GF] }),
      create(list, { phone: ANA, guestTagEdits: ["+" + N, "-" + A] }),
      create(list, { phone: CARLA, guestTagEdits: LIST.guest.map((t) => "+" + t.id) }),
    ];
    const said = plans.flatMap((p) => p.fin.flatMap((b) => b.history.map((h) => h.action)));
    expect(said.length).toBeGreaterThan(4);
    expect(said.filter((s) => guestLabels.some((l) => s.toLowerCase().includes(l.toLowerCase())))).toEqual([]);
    // And no id either: an id is the label's shadow ("g-allergy").
    expect(said.filter((s) => /\bg-[a-z]/.test(s))).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ── Delete customer ─────────────────────────────────────────────────────────
// What `anonymizeBooking` does to each field of the table. A row added to
// `BOOKING_FIELDS` is in neither list and fails here until somebody decides
// whether it says anything about the person.
const WIPED = {
  name: "Data removed", phone: "", notes: "", history: [], guestId: null, anonymized: true,
  tags: [], guestTags: [], guestTagsAt: 0,
};
const STATS = "what the day and range statistics count; says when and how many, not who";
const PLACED = "where the party was put, and how; a table is not a person";
const KEPT = {
  id: "the booking stays, for the statistics, and every other record names it by this",
  date: STATS, time: STATS, scheduledTime: STATS, size: STATS, duration: STATS, originalDuration: STATS,
  status: STATS, customDur: STATS, stayedMin: STATS,
  tables: PLACED, _manual: PLACED, _locked: PLACED, _conflict: PLACED,
  preference: "the zone asked for, which the zone statistics count",
  preferredTables: "tables asked for; kept with `tables`, and it names no one",
  returnOf: "the id of the booking this one repeated, which is anonymised in the same write",
  noShow: "kept on purpose (Patryk, v17.0.0): the phone-less no-show tile counts it",
  deposit: "money taken, which the day's deposits line counts",
  voucherCode: "the voucher's own ledger names this booking by id; the code is the voucher's",
  recurringId: "what stops the weekly generator making this occurrence again",
  recurringDate: "what stops the weekly generator making this occurrence again",
  updatedAt: "the write path's stamp, which the server's compare-and-swap needs",
};
const RICH = sanitize({
  id: "rich", name: "Ana Ruiz", phone: ANA, date: day(1), time: "20:30", scheduledTime: "20:15",
  size: 4, duration: 105, originalDuration: 100, preference: "outdoor", notes: "nut allergy, window seat",
  status: "cancelled", tables: ["7"], customDur: 105, _manual: true, _locked: true, _conflict: true,
  preferredTables: ["7"], returnOf: "src1",
  history: [{ at: "2026-09-01T10:00:00.000Z", by: "t", action: "created" }],
  noShow: true, deposit: 20, voucherCode: "ABCD2345", recurringId: "rule1", recurringDate: day(1),
  anonymized: false, guestId: "gana", stayedMin: 80, updatedAt: 1790000000000,
  tags: ["o-birthday"], guestTags: [A, V], guestTagsAt: 1790000000001,
}, "rich");

describe("Delete customer: every field is wiped, or kept for a reason", () => {
  const KEYS = BOOKING_FIELDS.map((r) => r.key);
  const gone = anonymizeBooking(RICH);

  it("every row of the table is in exactly one list", () => {
    expect(Object.keys(WIPED).concat(Object.keys(KEPT)).sort()).toEqual([...KEYS].sort());
    Object.values(KEPT).forEach((why) => expect(why.length).toBeGreaterThan(10));
  });
  it("the fixture holds a value of its own in every field, so a wipe can be told from a default", () => {
    const empty = sanitize({}, "rich");
    expect(KEYS.filter((k) => k !== "id" && k !== "anonymized" && JSON.stringify(RICH[k]) === JSON.stringify(empty[k]))).toEqual([]);
  });
  it("a wiped field holds what the list says, and a kept one what it held", () => {
    Object.keys(WIPED).forEach((k) => expect(gone[k], k).toStrictEqual(WIPED[k]));
    Object.keys(KEPT).forEach((k) => expect(gone[k], k).toStrictEqual(RICH[k]));
    expect(Object.keys(gone)).toEqual(KEYS);
  });
  it("nothing typed about the person is left anywhere in the row", () => {
    const left = JSON.stringify(gone);
    ["Ana", "Ruiz", "600 111 222", "600111222", "nut allergy", "window", "gana", A, V, "o-birthday", "created"].forEach((s) => {
      expect(left.includes(s), s).toBe(false);
    });
  });
  it("the guest has no tags afterwards, on any of their bookings", () => {
    const list = [says("a1", ANA, [A], 100), says("a2", ANA, [V], 300, { guestId: "gg1" }), bk("g1", { guestId: "gg1", tags: ["o-birthday"] }), says("b1", BEA, [N], 50)];
    const ident = { phone: ANA, guestIds: ["gg1"] };
    const after = list.map((b) => (matchesIdentity(b, ident) ? anonymizeBooking(b) : b));
    ["a1", "a2", "g1"].forEach((id) => {
      expect(shown(after, id), id).toEqual([]);
      expect([byId(after, id).guestTags, byId(after, id).guestTagsAt, byId(after, id).tags], id).toEqual([[], 0, []]);
    });
    expect(Object.keys(guestTagMap(after))).toEqual([normalizePhone(BEA)]);
    expect(byId(after, "b1")).toBe(list[3]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("what a screen shows for a booking: bookingTags and tagLine", () => {
  const list = [says("a1", ANA, [V, A], 100), bk("a2", { phone: ANA, tags: ["o-anniversary", "o-birthday"] }), bk("b1", { phone: BEA })];
  const map = guestTagMap(list);

  it("the guest's tags and the booking's own, as labels in the tag list's order", () => {
    expect(bookingTags(byId(list, "a2"), map, LIST)).toEqual({ guest: ["Allergy", "VIP"], occasion: ["Birthday", "Anniversary"] });
    expect(bookingTags(byId(list, "a1"), map, LIST)).toEqual({ guest: ["Allergy", "VIP"], occasion: [] });
    expect(bookingTags(byId(list, "b1"), map, LIST)).toEqual({ guest: [], occasion: [] });
  });
  it("a tag the list no longer has is not shown, and no list shows nothing", () => {
    const short = { v: 1, guest: [{ id: V, label: "VIP" }], occasion: [] };
    expect(bookingTags(byId(list, "a2"), map, short)).toEqual({ guest: ["VIP"], occasion: [] });
    expect(bookingTags(byId(list, "a2"), map, null)).toEqual({ guest: [], occasion: [] });
    expect(bookingTags(null, map, LIST)).toEqual({ guest: [], occasion: [] });
  });
  it("one line: guest tags, then occasion", () => {
    expect(tagLine(bookingTags(byId(list, "a2"), map, LIST))).toBe("Allergy, VIP · Birthday, Anniversary");
    expect(tagLine(bookingTags(byId(list, "a1"), map, LIST))).toBe("Allergy, VIP");
    expect(tagLine({ guest: [], occasion: ["Birthday"] })).toBe("Birthday");
    expect(tagLine(bookingTags(byId(list, "b1"), map, LIST))).toBe("");
    expect(tagLine(null)).toBe("");
  });
  it("each surface that shows a booking's tags reads them through bookingTags", () => {
    // The six Patryk chose (2026-10-08). A surface that stops showing tags, or
    // starts reading them its own way, fails here.
    const src = (n) => stripComments(readFileSync(fileURLToPath(new URL("../src/components/" + n, import.meta.url)), "utf8")).join("\n");
    expect(src("ListView.jsx")).toContain("bookingTags(b, guestTags, tagList)");
    expect(src("DaySheet.jsx")).toContain("tagLine(bookingTags(b, guestTags, tagList))");
    const timeline = src("TimelineView.jsx");
    expect((timeline.match(/tags=\{tagLine\(bookingTags\(b, guestTags, tagList\)\)\}/g) || []).length).toBe(2);   // a placed block, an unplaced one
    expect(timeline).toContain('(tags ? ", tagged " + tags.replace(" · ", ", ") : "")');
    expect(timeline).toContain("title={leaving || !tags ? undefined : tags}");
    expect(src("SeatNoteModal.jsx")).toContain("(note.guestTags || []).concat(note.occasionTags || [])");
    // The form shows the taps applied to whoever the draft names now.
    const form = src("BookingFormModal.jsx");
    expect(form).toContain("guestTagBase(bookings,editId,{phone:tagPhone,guestId:tagGuestId,guestSeed:form.guestSeed})");
    expect(form).toContain("editTagIds(guestTagsBase,form.guestTagEdits)");
    expect(form).toContain("toggleTagEdit(f.guestTagEdits,guestTagsBase,id)");
    // Customers: the map's own key, the one `customerIndex` files the row under.
    expect(src("CustomersSettings.jsx")).toContain("(guestTags && guestTags[c.key]) || []");
  });
  it("no component reads a statement off a booking: the guest's tags are usually on another one", () => {
    const dir = fileURLToPath(new URL("../src/components/", import.meta.url));
    const reads = readdirSync(dir).filter((n) => /\.jsx$/.test(n)).filter((n) => {
      const code = stripComments(readFileSync(dir + n, "utf8")).join("\n");
      return /\bb\.guestTags(At)?\b/.test(code);
    });
    expect(reads).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("the seat note, when the form's Save seats the party", () => {
  // Today, so the party can be seated; a table, so nothing refuses the seat.
  const seatable = (o) => bk("s1", Object.assign({ date: today, time: "20:00", tables: ["3"], _manual: true, _locked: true }, o));

  it("carries a tag tapped in the same save, and the guest's from another booking", () => {
    const list = [seatable({ phone: ANA }), says("a9", ANA, [A], 100, { date: day(3) })];
    const plan = edit(list, "s1", { status: "seated", guestTagEdits: ["+" + V], tags: ["o-birthday"] }, { nowMins: 20 * 60 });
    expect([plan.seatNote.guestTags, plan.seatNote.occasionTags, plan.seatNote.notes]).toEqual([["Allergy", "VIP"], ["Birthday"], ""]);
  });
  it("is not raised for an untagged party with no note, or by a save that does not seat", () => {
    expect(edit([seatable({})], "s1", { status: "seated" }, { nowMins: 20 * 60 }).seatNote).toBe(null);
    const list = [seatable({ phone: ANA }), says("a9", ANA, [A], 100, { date: day(3) })];
    expect(edit(list, "s1", { notes: "n" }, { nowMins: 20 * 60 }).seatNote).toBe(null);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("a tag tapped on a customer, in Settings → Customers", () => {
  const entry = { at: "x", by: "t", action: GUEST_TAGS_UPDATED };
  const keyOf = (list, phone) => Object.keys(customerIndex(list)).find((k) => k === normalizePhone(phone));

  it("writes where the newest statement already is, above it, with one history line", () => {
    const list = [says("a1", ANA, [A], 100, { date: day(1) }), bk("a2", { phone: ANA, date: day(9) }), bk("b1", { phone: BEA })];
    const next = setCustomerTags(list, keyOf(list, ANA), ["+" + V], 50, entry);
    expect(statementsWritten(list, next)).toEqual(["a1"]);
    expect([byId(next, "a1").guestTags, byId(next, "a1").guestTagsAt]).toEqual([[A, V], 101]);
    expect(byId(next, "a1").history.map((h) => h.action)).toEqual([GUEST_TAGS_UPDATED]);
    expect(byId(next, "a2")).toBe(list[1]);
    expect(shown(next, "a2")).toEqual([A, V]);
  });
  it("a customer with no statement gets one on their most recent booking", () => {
    const list = [bk("a1", { phone: ANA, date: day(1) }), bk("a2", { phone: ANA, date: day(9) }), bk("a3", { phone: ANA, date: day(4) })];
    const next = setCustomerTags(list, keyOf(list, ANA), ["+" + V], 7000, entry);
    expect(statementsWritten(list, next)).toEqual(["a2"]);
    expect(byId(next, "a2").guestTagsAt).toBe(7000);
  });
  it("a tap that changes nothing, or a customer with no bookings left, returns the list itself", () => {
    const list = [says("a1", ANA, [A], 100)];
    expect(setCustomerTags(list, keyOf(list, ANA), ["+" + A], 500, entry)).toBe(list);
    expect(setCustomerTags(list, keyOf(list, ANA), ["-" + V], 500, entry)).toBe(list);
    expect(setCustomerTags(list, normalizePhone(CARLA), ["+" + V], 500, entry)).toBe(list);
    expect(setCustomerTags(list, "", ["+" + V], 500, entry)).toBe(list);
  });
  it("a joined guest with no phone is a customer too", () => {
    const list = [bk("g1", { guestId: "gg1", date: day(1) }), bk("g2", { guestId: "gg1", date: day(2) })];
    const next = setCustomerTags(list, "gg1", ["+" + N], 10, entry);
    ["g1", "g2"].forEach((id) => expect(shown(next, id)).toEqual([N]));
  });
  it("the tap is a transform: a replay on fresh data applies it to the tags as they are by then", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(4000));
    const list = [says("a1", ANA, [A], 100)];
    const tap = customerTagTap(normalizePhone(ANA), "+" + V, entry);
    vi.setSystemTime(new Date(999999));                      // the replay runs later; the stamp is the tap's
    expect(byId(tap(list), "a1").guestTagsAt).toBe(4000);
    const fresh = [says("a1", ANA, [N], 9000)];             // another device changed them meanwhile
    expect([byId(tap(fresh), "a1").guestTags, byId(tap(fresh), "a1").guestTagsAt]).toEqual([[N, V], 9001]);
    expect(JSON.stringify(tap(list))).toBe(JSON.stringify(tap(list)));
  });
  it("its history line is the form's, and names no tag", () => {
    expect(GUEST_TAGS_UPDATED).toBe("guest tags updated");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ── App's two wires ─────────────────────────────────────────────────────────
// The lib functions above do nothing until App calls them. Its save is run for
// real in tests/save-path.test.js; the delete and Delete customer are not, so
// they are read.
describe("App is wired to it", () => {
  const app = stripComments(readFileSync(fileURLToPath(new URL("../src/App.jsx", import.meta.url)), "utf8")).join("\n");

  it("Delete customer anonymises through anonymizeBooking, and nothing else in src marks a booking anonymised", () => {
    const fn = app.slice(app.indexOf("function deleteCustomer("));
    expect(fn.slice(0, fn.indexOf("\n  }\n"))).toContain("return anonymizeBooking(b);");
    expect(app).not.toMatch(/anonymized\s*:\s*true/);
  });
  it("the one place that drops a booking from the list hands its statement on", () => {
    const drops = app.match(/\.filter\(function\(x\)\{return x\.id!==id;\}\)/g) || [];
    expect(drops.length).toBe(1);
    expect(app).toContain("rehomeGuestTags(b,b.filter(function(x){return x.id!==id;}),id)");
  });
  it("a customer's tap asks for the capability a booking edit asks for, and goes through customerTagTap", () => {
    const fn = app.slice(app.indexOf("function saveCustomerTag("));
    const body = fn.slice(0, fn.indexOf("\n  }\n"));
    expect(body).toContain('if(refused("bookingEdit")) return false;');
    expect(body).toContain("saveBookings(customerTagTap(key,edit,histEntry(GUEST_TAGS_UPDATED,getUser())))");
  });
  it("one tag map is made in App and handed to each view", () => {
    expect((app.match(/guestTagMap\(/g) || []).length).toBe(1);
    expect((app.match(/guestTags=\{guestTags\}/g) || []).length).toBe(4);   // timeline, list, day sheet, settings
  });
  it("the edit is handed the tag list, for the occasion tag's name", () => {
    const call = app.slice(app.indexOf("applyEdit({"));
    expect(call.slice(0, call.indexOf("});"))).toContain("tagList:tagList");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ── THE GENERATED RUN ───────────────────────────────────────────────────────
// Bookings are made, edited, deleted and their guests erased, in an order a
// seeded generator picks, and a plain record is kept beside them of what each
// guest should have: a map from the guest to their tags, changed only by what
// was tapped. After every step, every booking must show what the record says.
//
// The clock is the generator's too, and it does not run forward: each save
// reads a time from a small range, so saves are stamped out of order and with
// equal times. A device with a slow clock is the ordinary case here.
//
// `impl` is the code under test, so the same run can be pointed at a broken
// copy of it (below).
const REAL = { guestTagMap, guestTagBase, saveGuestTags, rehomeGuestTags };
const GUEST_IDS = LIST.guest.map((t) => t.id);
const PHONES = [ANA, BEA, CARLA, "+34 600 777 888"];

function mulberry(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// The record's name for a booking's guest: the phone, or the booking itself
// when it has none (a booking with no phone is its own guest).
const guestOf = (b) => (b.phone ? normalizePhone(b.phone) : "#" + b.id);

// One run. Returns the first step at which a booking shows something other
// than the record, or null; `count` gathers what the run did.
function run(impl, seed, steps, count) {
  const rnd = mulberry(seed);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const record = new Map();
  let list = [];
  let made = 0;
  const bump = (k) => { count[k] = (count[k] || 0) + 1; };

  // What somebody taps in a form opened on `base`: up to three chips.
  function taps(base) {
    let edits = [];
    const n = Math.floor(rnd() * 4);
    for (let i = 0; i < n; i++) edits = toggleTagEdit(edits, base, pick(GUEST_IDS));
    return edits;
  }
  function check(step, what) {
    const map = impl.guestTagMap(list);
    for (const b of list) {
      if (b.anonymized) continue;
      const want = record.get(guestOf(b)) || [];
      const got = guestTagsOf(b, map);
      if (got.join() !== want.join()) return "seed " + seed + " step " + step + " (" + what + "): " + b.id + " shows [" + got + "], the record says [" + want + "]";
    }
    return null;
  }

  for (let step = 0; step < steps; step++) {
    const now = 1000 + Math.floor(rnd() * 40);
    const live = list.filter((b) => !b.anonymized);
    const roll = rnd();
    let what;
    if (!live.length || roll < 0.3) {
      what = "create";
      const phone = rnd() < 0.2 ? "" : pick(PHONES);
      made += 1;
      const row = sanitize({ id: "n" + String(made).padStart(3, "0"), name: "G", phone, date: addDays(today, 1 + Math.floor(rnd() * 30)), time: "20:00", size: 2, status: "confirmed", tables: [], history: [] }, "n" + made);
      const base = impl.guestTagBase(list, null, { phone });
      const edits = taps(base);
      const top = Math.max(0, ...list.filter((b) => guestOf(b) === guestOf(row)).map((b) => b.guestTagsAt));
      const next = impl.saveGuestTags(list, list.concat([row]), row.id, edits, null, now);
      const wrote = statementsWritten(list, next);
      if (wrote.length > 1 || (wrote.length && wrote[0] !== row.id)) return "seed " + seed + " step " + step + ": a create wrote statements on " + wrote;
      const g = guestOf(row);
      const want = editTagIds(record.get(g) || [], edits);
      if (want.join() !== (record.get(g) || []).join()) { bump("a save that changed a guest's tags"); if (top >= now) bump("…on a clock at or behind the statement it replaced"); }
      else if (wrote.length) return "seed " + seed + " step " + step + ": a create that changed nothing wrote a statement";
      if (record.has(g) && edits.length) bump("taps on a guest who already had a statement");
      record.set(g, want);
      list = next;
    } else if (roll < 0.7) {
      what = "edit";
      const b = pick(live);
      const base = impl.guestTagBase(list, b.id, { phone: b.phone, guestId: b.guestId });
      const edits = rnd() < 0.35 ? [] : taps(base);
      const top = Math.max(0, ...list.filter((x) => guestOf(x) === guestOf(b)).map((x) => x.guestTagsAt));
      const cand = list.map((x) => (x.id === b.id ? Object.assign({}, x, { notes: x.notes + "." }) : x));
      const next = impl.saveGuestTags(list, cand, b.id, edits, null, now);
      const wrote = statementsWritten(list, next);
      if (wrote.length > 1 || (wrote.length && wrote[0] !== b.id)) return "seed " + seed + " step " + step + ": an edit wrote statements on " + wrote;
      const g = guestOf(b);
      const want = editTagIds(record.get(g) || [], edits);
      if (want.join() !== (record.get(g) || []).join()) { bump("a save that changed a guest's tags"); if (top >= now) bump("…on a clock at or behind the statement it replaced"); }
      else if (wrote.length) return "seed " + seed + " step " + step + ": an edit that changed nothing wrote a statement";
      if (!edits.length) bump("an edit with nothing tapped");
      record.set(g, want);
      list = next;
    } else if (roll < 0.93) {
      what = "delete";
      const b = pick(live);
      const without = list.filter((x) => x.id !== b.id);
      const next = impl.rehomeGuestTags(list, without, b.id);
      const wrote = statementsWritten(without, next);
      if (wrote.length > 1) return "seed " + seed + " step " + step + ": a delete wrote statements on " + wrote;
      if (wrote.length) bump("a delete that handed the statement on");
      if (!next.some((x) => !x.anonymized && guestOf(x) === guestOf(b))) record.delete(guestOf(b));
      list = next;
    } else {
      what = "erase";
      const b = pick(live);
      const ident = b.phone ? { phone: b.phone } : null;
      list = list.map((x) => ((ident ? matchesIdentity(x, ident) : x.id === b.id) ? anonymizeBooking(x) : x));
      record.delete(guestOf(b));
      bump("a guest erased");
      const left = list.filter((x) => x.anonymized && (x.guestTags.length || x.guestTagsAt || x.tags.length));
      if (left.length) return "seed " + seed + " step " + step + ": an erased booking still states tags";
    }
    bump(what);
    const bad = check(step, what);
    if (bad) return bad;
  }
  return null;
}
function runAll(impl, seeds, steps) {
  const count = {};
  for (let seed = 1; seed <= seeds; seed++) {
    const bad = run(impl, seed, steps, count);
    if (bad) return { bad, count };
  }
  return { bad: null, count };
}

describe("a generated run of saves, deletes and erasures, on clocks that disagree", () => {
  const SEEDS = 400, STEPS = 60;
  const real = runAll(REAL, SEEDS, STEPS);

  it("every booking shows what its guest's record says, after every one of " + SEEDS * STEPS + " steps", () => {
    expect(real.bad).toBeNull();
  });
  it("and the run did the things it is here for (counted, not assumed)", () => {
    expect(real.count).toMatchInlineSnapshot(`
      {
        "a delete that handed the statement on": 552,
        "a guest erased": 1497,
        "a save that changed a guest's tags": 10149,
        "an edit with nothing tapped": 4800,
        "create": 8696,
        "delete": 4964,
        "edit": 8843,
        "erase": 1497,
        "taps on a guest who already had a statement": 1679,
        "…on a clock at or behind the statement it replaced": 3295,
      }
    `);
  });

  // ── The same run, on code that is wrong ───────────────────────────────────
  // If the run passed on these it would be checking nothing.
  it("fails when a deleted booking's statement is not handed on", () => {
    const broken = Object.assign({}, REAL, { rehomeGuestTags: (before, after) => after });
    expect(runAll(broken, SEEDS, STEPS).bad).toMatch(/\(delete\)/);
  });
  it("fails when a statement is stamped with this device's clock as it reads", () => {
    const broken = Object.assign({}, REAL, {
      saveGuestTags: (prev, cand, id, edits, seed, now) => {
        const out = saveGuestTags(prev, cand, id, edits, seed, now);
        const was = cand.find((b) => b.id === id), is = out.find((b) => b.id === id);
        if (!is || is.guestTagsAt === was.guestTagsAt) return out;
        return out.map((b) => (b.id === id ? Object.assign({}, b, { guestTagsAt: now }) : b));
      },
    });
    expect(runAll(broken, SEEDS, STEPS).bad).toMatch(/shows \[/);
  });
  it("fails when the form's taps are saved as the guest's whole set", () => {
    const broken = Object.assign({}, REAL, {
      saveGuestTags: (prev, cand, id, edits, seed, now) => {
        if (!cleanTagEdits(edits).length) return saveGuestTags(prev, cand, id, edits, seed, now);
        const top = Math.max(0, ...prev.map((b) => b.guestTagsAt));
        return cand.map((b) => (b.id === id ? Object.assign({}, b, { guestTags: editTagIds([], edits), guestTagsAt: Math.max(now, top + 1) }) : b));
      },
    });
    expect(runAll(broken, SEEDS, STEPS).bad).toMatch(/shows \[/);
  });
});
