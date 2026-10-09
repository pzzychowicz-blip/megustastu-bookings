// tests/delete-undo.test.js — v18.5.1 (ROADMAP #17)
//
// `planDelete` and `planUndo` are what Delete does to the list and what Undo
// puts back, moved out of BookingApp. When they moved, the old `delBooking` and
// `undoLastAction` (lifted from the commit before) and the new ones (lifted
// from App.jsx) were run over 120,000 generated cases with the same calls, the
// same return value and the same written list every time; that comparison is
// in REFACTOR_LOG, since it needs the old code. These are the cases that stay:
// one per outcome, each asserting what is ASKED or what is WRITTEN.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { planDelete, planUndo, planCustomerDelete } from "../src/lib/delete-undo.js";
import { undoSnapshots } from "../src/lib/booking-logic.js";
import { guestTagMap, guestTagsOf } from "../src/lib/customers.js";
import { sanitizeVoucher } from "../src/lib/vouchers.js";
import { todayStr } from "../src/lib/day.js";
import { stripComments } from "../scripts/strip-comments.mjs";

const TODAY = todayStr();
const stamp = (action, user) => ({ action, by: user });
const bk = (id, time, tables, extra) => Object.assign(
  { id, name: id.toUpperCase(), phone: "", date: TODAY, time, scheduledTime: time, size: 2, duration: 90, originalDuration: 90,
    status: "confirmed", tables, notes: "", voucherCode: "", guestTags: [], guestTagsAt: 0, history: [] }, extra || {});
const ids = (list) => list.map((b) => b.id);
const byId = (list, id) => list.find((b) => b.id === id);

function del(id, bookings, more) {
  return planDelete(Object.assign({
    id, bookings, viewDate: TODAY, tableBlocks: [], autoOptimizer: false,
    redeemAsked: false, vouchersOn: true, vouchersByCode: {},
  }, more || {}));
}

describe("planDelete", () => {
  it("removes the booking and nobody else", () => {
    const list = [bk("a", "13:00", ["1A"]), bk("b", "14:00", ["2"])];
    const plan = del("a", list);
    expect(plan.skip).toBe(null);
    expect(plan.voucherBack).toBe(undefined);
    expect(plan.transform(list)).toEqual([list[1]]);
  });
  it("a booking that is already gone changes nothing", () => {
    const list = [bk("a", "13:00", ["1A"])];
    expect(ids(del("gone", list).transform(list))).toEqual(["a"]);
  });
  it("the transform is memoised by prev: the undo delta and the write share one pass", () => {
    const list = [bk("a", "13:00", ["1A"]), bk("b", "14:00", ["2"])];
    const plan = del("a", list);
    expect(plan.transform(list)).toBe(plan.transform(list));
    const other = [bk("a", "13:00", ["1A"]), bk("c", "15:00", ["3"])];
    expect(ids(plan.transform(other))).toEqual(["c"]);       // a replay runs on what it is handed
  });
  it("a standing booking's week names the rule and date to park, and still deletes", () => {
    const list = [bk("rR1_" + TODAY, "20:00", ["1A"], { recurringId: "R1", recurringDate: TODAY })];
    const plan = del(list[0].id, list);
    expect(plan.skip).toEqual({ ruleId: "R1", date: TODAY });
    expect(plan.transform(list)).toEqual([]);
  });
  it("money taken for the visit is asked about first, and nothing is planned", () => {
    const list = [bk("a", "13:00", ["1A"], { status: "completed", voucherCode: "USED2345" })];
    const v = sanitizeVoucher({ value: 50, remaining: 40, status: "active", issuedAt: 1,
      redemptions: { a: { amount: 10, at: 1, by: "x" } } }, "USED2345");
    const src = { vouchersByCode: { USED2345: v } };
    expect(del("a", list, src)).toEqual({ voucherBack: { id: "a", from: "delete" } });
    // Answered (`redeemAsked`), or the module off: the delete goes ahead.
    expect(del("a", list, Object.assign({ redeemAsked: true }, src)).transform(list)).toEqual([]);
    expect(del("a", list, Object.assign({ vouchersOn: false }, src)).transform(list)).toEqual([]);
  });
  it("a voucher attached with nothing taken is not asked about", () => {
    const list = [bk("a", "13:00", ["1A"], { voucherCode: "USED2345" })];
    const v = sanitizeVoucher({ value: 50, remaining: 50, status: "active", issuedAt: 1 }, "USED2345");
    expect(del("a", list, { vouchersByCode: { USED2345: v } }).voucherBack).toBe(undefined);
  });
  it("the guest's tags move to their remaining booking when the one holding them goes", () => {
    const list = [
      bk("a", "13:00", ["1A"], { phone: "+34 600 000 001", guestTags: ["g-allergy"], guestTagsAt: 5 }),
      bk("b", "14:00", ["2"], { phone: "+34 600 000 001" }),
    ];
    const after = del("a", list).transform(list);
    expect(ids(after)).toEqual(["b"]);
    expect(guestTagsOf(byId(after, "b"), guestTagMap(after))).toEqual(["g-allergy"]);
  });
  it("with the optimiser on, the day is re-placed in the same write", () => {
    const tomorrow = new Date(TODAY + "T00:00:00Z"); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const T = tomorrow.toISOString().slice(0, 10);
    const list = [bk("a", "13:00", ["1A"], { date: T }), bk("b", "13:00", [], { date: T })];
    const after = del("a", list, { autoOptimizer: true, viewDate: T }).transform(list);
    expect(ids(after)).toEqual(["b"]);
    expect(byId(after, "b").tables.length).toBeGreaterThan(0);
  });
});

describe("planUndo", () => {
  const asked = [];
  const undo = (info, more) => planUndo(Object.assign(
    { info, getUser: () => { asked.push("user"); return "u@x"; }, nowMins: 20 * 60, stamp }, more || {}));

  it("nothing pending is nothing to do, and the user is not asked for", () => {
    asked.length = 0;
    expect(undo(null)).toBe(null);
    expect(undo({ snapshots: [], primaryId: "a", kind: "delete" })).toBe(null);
    expect(asked).toEqual([]);
  });
  it("a delete: the booking is back, with the note on it and its date to go to", () => {
    const prev = [bk("a", "13:00", ["1A"]), bk("b", "14:00", ["2"])];
    const post = [prev[1]];
    const plan = undo({ snapshots: undoSnapshots(prev, post), primaryId: "a", kind: "delete" });
    expect(plan.date).toBe(TODAY);
    const back = plan.transform(post);
    expect(ids(back).sort()).toEqual(["a", "b"]);
    expect(byId(back, "a").history).toEqual([{ action: "deletion undone", by: "u@x" }]);
    expect(byId(back, "b")).toEqual(prev[1]);
  });
  it("a cancel and an edit: the snapshot replaces what is there, each with its own note", () => {
    const prev = [bk("a", "13:00", ["1A"])];
    const cancelled = [Object.assign({}, prev[0], { status: "cancelled" })];
    const c = undo({ snapshots: undoSnapshots(prev, cancelled), primaryId: "a", kind: "cancel" }).transform(cancelled);
    expect(byId(c, "a").status).toBe("confirmed");
    expect(byId(c, "a").history[0].action).toBe("cancellation undone");
    const edited = [Object.assign({}, prev[0], { size: 6 })];
    const e = undo({ snapshots: undoSnapshots(prev, edited), primaryId: "a", kind: "edit" }).transform(edited);
    expect(byId(e, "a").size).toBe(2);
    expect(byId(e, "a").history[0].action).toBe("edit undone");
  });
  it("only the booking acted on gets the note; one the optimiser moved is put back bare", () => {
    const prev = [bk("a", "13:00", ["1A"]), bk("b", "14:00", ["2"])];
    const post = [Object.assign({}, prev[1], { tables: ["1A"] })];
    const back = undo({ snapshots: undoSnapshots(prev, post), primaryId: "a", kind: "delete" }).transform(post);
    expect(byId(back, "b").tables).toEqual(["2"]);
    expect(byId(back, "b").history).toEqual([]);
  });
  it("restores verbatim: a booking made since then keeps its table, and nothing is re-placed", () => {
    const prev = [bk("a", "13:00", ["1A"])];
    const since = [bk("c", "13:00", ["1A"])];
    const back = undo({ snapshots: undoSnapshots(prev, []), primaryId: "a", kind: "delete" }).transform(since);
    expect(byId(back, "a").tables).toEqual(["1A"]);
    expect(byId(back, "c").tables).toEqual(["1A"]);       // the reconciliation effect's to resolve
  });
  it("with no primary among the snapshots, the first one names the date", () => {
    const tomorrow = new Date(TODAY + "T00:00:00Z"); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const T = tomorrow.toISOString().slice(0, 10);
    const plan = undo({ snapshots: [bk("x", "13:00", ["1A"], { date: T })], primaryId: "elsewhere", kind: "edit" });
    expect(plan.date).toBe(T);
  });
});

// What App still does itself, read from its source (no DOM here).
describe("the wiring", () => {
  const APP = stripComments(readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8")).join("\n").replace(/\s+/g, "");
  const slice = (from, to) => { const i = APP.indexOf(from); return APP.slice(i, APP.indexOf(to, i)); };

  it("delBooking asks planDelete, parks the skipDate before the write and stops when it is refused", () => {
    const body = slice("functiondelBooking(", "constanyModal");
    expect(body.startsWith('functiondelBooking(id){if(refused("bookingDelete"))returnfalse;')).toBe(true);
    const skipAt = body.indexOf("constokSkip=addSkipDate(plan.skip.ruleId,plan.skip.date,true);");
    const saveAt = body.indexOf("constok=saveBookings(plan.transform);");
    expect(skipAt).toBeGreaterThan(-1);
    expect(saveAt).toBeGreaterThan(skipAt);
    expect(body.slice(skipAt, saveAt)).toContain("if(!okSkip){setWriteWarning(");
    expect(body).toContain('if(ok){flash();armUndo(undoDelta(bookings,postDel),id,"delete",false);}');
    expect(body).not.toContain("rehomeGuestTags(");
    expect(body).not.toContain("bookingsAfterAction(");
  });
  it("undoLastAction asks planUndo and never re-places the day", () => {
    const body = slice("functionundoLastAction(", "functionmanualAssign(");
    expect(body).toContain("constplan=planUndo({info:undoInfo,getUser:getUser,nowMins:nowMins});");
    expect(body).toContain("constok=saveBookings(plan.transform);");
    expect(body).toContain("setViewDate(plan.date);");
    expect(body).not.toContain("bookingsAfterAction(");
    expect(body).not.toContain("applyUndo(");
  });
});

// v18.6.0: Delete customer. The rules are paused before the anonymise and
// removed after it lands; a discard resumes the ones this delete paused.
describe("planCustomerDelete", () => {
  const PHONE = "+34 600 555 186";
  const rule = (id, extra) => Object.assign({ id, name: "Ana", phone: PHONE, active: true, weekday: 5, time: "20:00", size: 2 }, extra || {});
  const book = (id, extra) => Object.assign({ id, name: "Ana", phone: PHONE, date: "2026-10-17", time: "20:00", size: 2, status: "confirmed", notes: "nut allergy", history: [] }, extra || {});
  const rules = [rule("RA"), rule("RP", { active: false }), rule("RX", { phone: "+34 600 000 999" })];
  const list = [book("b1", { recurringId: "RA" }), book("b2"), book("x1", { name: "Other", phone: "+34 600 000 999" })];
  const plan = planCustomerDelete(rules, list, { phone: PHONE });

  it("removes every rule of the customer, and pauses only the ones running now", () => {
    expect(plan.remove).toEqual(["RA", "RP"]);
    expect(plan.pause).toEqual(["RA"]);
  });
  it("anonymises their bookings and nobody else's", () => {
    const out = plan.transform(list);
    expect(out[0].name).toBe("Data removed");
    expect(out[0].phone).toBe("");
    expect(out[1].name).toBe("Data removed");
    expect(out[2]).toBe(list[2]);
  });
  it("a customer with no standing booking has nothing to pause or remove", () => {
    const p = planCustomerDelete(rules, list, { phone: "+34 600 000 111" });
    expect(p.remove).toEqual([]);
    expect(p.pause).toEqual([]);
    expect(planCustomerDelete(null, list, { phone: PHONE }).pause).toEqual([]);
  });
  it("App erases nothing until the write has landed, and resumes the paused rules on a discard", () => {
    const APP = stripComments(readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8")).join("\n").replace(/\s+/g, "");
    const at = APP.indexOf("functiondeleteCustomer(");
    const body = APP.slice(at, APP.indexOf("functionopenNewWith(", at));
    const landed = body.indexOf("onLanded:function(){");
    const discarded = body.indexOf("onDiscarded:function(){if(plan.pause.length)setRulesActive(plan.pause,true);}");
    expect(landed).toBeGreaterThan(body.indexOf("saveBookings(plan.transform,false,{"));
    expect(discarded).toBeGreaterThan(landed);
    for (const erase of ["removeRules(plan.remove)", "saveWaitlist(", "wa.eraseConversation(key)", "redactGuest("]) {
      const i = body.indexOf(erase);
      expect(i, erase).toBeGreaterThan(landed);
      expect(i, erase).toBeLessThan(discarded);
      expect(body.indexOf(erase, i + 1), erase + " once").toBe(-1);
    }
  });
});
