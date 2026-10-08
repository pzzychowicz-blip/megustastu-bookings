// tests/status-change.test.js — v18.5.0 (ROADMAP #17)
//
// `planStatus`, `planCancel` and `completeCleared` are what a status tap, a
// cancel and "Complete them & seat" do, moved out of BookingApp. When they
// moved they were run against the old `updateStatus`, `doCancelBooking` and
// `seatAfterClearing` (lifted from the commit before) over 250,696 generated
// actions, with the same calls, the same return value and the same written
// list every time; that comparison is in REFACTOR_LOG, since it needs the old
// code. These are the cases that stay: one per outcome, each asserting what is
// ASKED or what is WRITTEN.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { planStatus, planCancel, completeCleared, seatClashSnap } from "../src/lib/status-change.js";
import { voucherDue, voucherHeld, voucherReturnDue, sanitizeVoucher } from "../src/lib/vouchers.js";
import { todayStr } from "../src/lib/day.js";
import { stripComments } from "../scripts/strip-comments.mjs";

const TODAY = todayStr();
const NOW = Date.now();
const stamp = (action, user) => ({ action, by: user });

const bk = (id, time, size, tables, extra) => Object.assign(
  { id, name: id.toUpperCase(), date: TODAY, time, scheduledTime: time, size, duration: 90, originalDuration: 90,
    status: "confirmed", tables, notes: "", voucherCode: "", history: [] }, extra || {});
const byId = (list, id) => list.find((b) => b.id === id);

// A voucher with 50 on it, and what `led` says was taken from it.
const voucher = (code, led, extra) => sanitizeVoucher(Object.assign(
  { value: 50, remaining: 50, status: "active", issuedAt: 1, redemptions: led || {} }, extra || {}), code);
const taken = (id) => ({ [id]: { amount: 10, at: 1, by: "x" } });

// The switch is OFF by default, so a write moves the tapped booking and
// nothing else; the cases about the optimiser turn it on.
function status(id, to, bookings, more) {
  const asked = [];
  const plan = planStatus(Object.assign({
    id, status: to, bookings, viewDate: TODAY, today: TODAY, nowMins: 20 * 60 + 15, now: NOW,
    tableBlocks: [], autoOptimizer: false, getUser: () => { asked.push("user"); return "u@x"; },
    redeemAsked: false, seatAsked: false, vouchersOn: true, vouchersByCode: {}, stamp,
  }, more || {}));
  return { plan, asked };
}

describe("planStatus: the questions, in the order they are asked", () => {
  const open = { OPEN2345: voucher("OPEN2345") };
  const spentHere = { USED2345: voucher("USED2345", taken("a")) };

  it("hands Cancelled to the cancel confirm, before anything else is read", () => {
    const { plan, asked } = status("a", "cancelled", [bk("a", "20:00", 2, [], { voucherCode: "OPEN2345" })], { vouchersByCode: open });
    expect(plan).toStrictEqual({ confirmCancel: true });
    expect(asked).toEqual([]);
  });

  it("asks whether to redeem before a booking with an open voucher completes", () => {
    const list = [bk("a", "20:00", 2, ["2"], { voucherCode: "OPEN2345" })];
    expect(status("a", "completed", list, { vouchersByCode: open }).plan)
      .toStrictEqual({ voucherAsk: { id: "a", status: "completed", from: "status" } });
  });

  it("and writes once that question has been answered", () => {
    const list = [bk("a", "20:00", 2, ["2"], { voucherCode: "OPEN2345" })];
    const { plan } = status("a", "completed", list, { vouchersByCode: open, redeemAsked: true });
    expect(byId(plan.transform(list), "a").status).toBe("completed");
  });

  it("asks whether to restore when a visit that redeemed leaves Completed", () => {
    const list = [bk("a", "20:00", 2, ["2"], { status: "completed", voucherCode: "USED2345" })];
    for (const to of ["confirmed", "pending", "seated"]) {
      expect(status("a", to, list, { vouchersByCode: spentHere }).plan, to)
        .toStrictEqual({ voucherBack: { id: "a", status: to, from: "status" } });
    }
  });

  it("asks neither with the vouchers module off", () => {
    const list = [bk("a", "20:00", 2, ["2"], { voucherCode: "OPEN2345" })];
    const { plan } = status("a", "completed", list, { vouchersByCode: open, vouchersOn: false });
    expect(plan.voucherAsk).toBeUndefined();
    expect(typeof plan.transform).toBe("function");
  });

  it("refuses to seat a booking with no table, with the thing to do", () => {
    expect(status("a", "seated", [bk("a", "20:00", 2, [])]).plan)
      .toStrictEqual({ refuse: "Assign a table before seating this booking." });
  });

  it("asks about the party still seated at the table, with a snapshot of them", () => {
    const list = [bk("a", "20:00", 2, ["2", "3"]), bk("s", "18:30", 4, ["3", "4"], { status: "seated" }), bk("c", "18:00", 2, ["2"])];
    expect(status("a", "seated", list).plan).toStrictEqual({ seatClash: { id: "a", status: "seated", from: "status",
      others: [{ id: "s", name: "S", time: "18:30", tables: ["3"] }] } });
  });

  it("and seats once that question has been answered", () => {
    const list = [bk("a", "20:00", 2, ["3"]), bk("s", "18:30", 4, ["3"], { status: "seated" })];
    const { plan } = status("a", "seated", list, { seatAsked: true });
    expect(byId(plan.transform(list), "a").status).toBe("seated");
  });

  it("puts the money question ahead of both seat checks", () => {
    // Completed with a redemption, no table, and asked to seat: the restore
    // question comes first, so a seat prompt never opens beside a money one.
    const list = [bk("a", "20:00", 2, [], { status: "completed", voucherCode: "USED2345" })];
    expect(status("a", "seated", list, { vouchersByCode: spentHere }).plan.voucherBack).toBeTruthy();
  });

  it("asks who the user is once, and only on the path that writes", () => {
    expect(status("a", "seated", [bk("a", "20:00", 2, [])]).asked).toEqual([]);
    expect(status("a", "seated", [bk("a", "20:00", 2, ["2"])]).asked).toEqual(["user"]);
  });
});

describe("planStatus: what a status tap writes", () => {
  it("seats a party that arrives early at the minute it sat down, the booked end kept", () => {
    const list = [bk("a", "20:30", 2, ["2"], { duration: 150, originalDuration: 150 })];
    const { plan } = status("a", "seated", list);
    expect(byId(plan.transform(list), "a")).toStrictEqual(Object.assign({}, list[0], {
      status: "seated", time: "20:15", duration: 165, originalDuration: 165, customDur: 165,
      history: [{ action: "status → seated", by: "u@x" }, { action: "seated early: time adjusted 20:30 → 20:15", by: "u@x" }],
    }));
    expect([plan.flashes, plan.flashKind]).toEqual([true, "saved"]);
  });

  it("a seat never lets the optimiser move anybody else; a completion does", () => {
    // On today with the switch on, the pass moves a party of two off table 7.
    const list = [bk("a", "20:00", 2, ["2"]), bk("o", "13:00", 2, ["7"])];
    const seat = status("a", "seated", list, { autoOptimizer: true }).plan.transform(list);
    expect(byId(seat, "o")).toBe(list[1]);
    const done = status("a", "completed", list, { autoOptimizer: true });
    expect(byId(done.plan.transform(list), "o").tables).not.toEqual(["7"]);
    expect([done.plan.flashes, done.plan.flashKind]).toEqual([true, null]);
  });

  it("cuts a seated visit's length to the stay when it completes, and stamps the stay", () => {
    const list = [bk("a", "19:00", 2, ["2"], { status: "seated" })];
    const a = byId(status("a", "completed", list, { nowMins: 20 * 60 + 10 }).plan.transform(list), "a");
    expect([a.status, a.duration, a.customDur, a.stayedMin]).toEqual(["completed", 70, 70, 70]);
    expect(a.history).toEqual([{ action: "status → completed", by: "u@x" }]);
  });

  it("leaves the length alone when a booking completes without having been seated", () => {
    const list = [bk("a", "13:00", 2, ["2"])];
    const a = byId(status("a", "completed", list, { nowMins: 21 * 60 }).plan.transform(list), "a");
    expect([a.status, a.duration, a.customDur, a.stayedMin]).toEqual(["completed", 90, undefined, undefined]);
  });

  it("puts the booked plan back when a seated party is walked back", () => {
    const seated = bk("a", "20:15", 2, ["2"], { scheduledTime: "20:30", duration: 165, originalDuration: 165, status: "seated" });
    for (const to of ["confirmed", "pending"]) {
      const { plan } = status("a", to, [seated]);
      const a = byId(plan.transform([seated]), "a");
      expect([a.status, a.time, a.duration, a.originalDuration, a.customDur], to).toEqual([to, "20:30", 150, 150, 150]);
      expect(a.history[1]).toEqual({ action: "un-seated: time restored 20:15 → 20:30, length 165 → 150 min", by: "u@x" });
      expect(plan.flashes).toBe(false);
    }
  });

  it("carries the booking's notes for the seat note, at its booked time", () => {
    const list = [bk("a", "20:30", 4, ["2", "3"], { notes: " nut allergy " })];
    expect(status("a", "seated", list).plan.seatNote)
      .toStrictEqual({ id: "a", name: "A", size: 4, time: "20:30", tables: ["2", "3"], notes: "nut allergy", guestTags: [], occasionTags: [] });
    expect(status("a", "completed", list).plan.seatNote).toBe(null);
  });

  it("v18.5.0: carries the party's tags, the guest's read from another of their bookings", () => {
    const tagList = { v: 1, guest: [{ id: "g-allergy", label: "Allergy" }], occasion: [{ id: "o-birthday", label: "Birthday" }] };
    const list = [
      bk("a", "20:30", 2, ["2"], { phone: "+34 600 111 222", tags: ["o-birthday"] }),
      bk("old", "20:30", 2, [], { phone: "+34 600 111 222", date: "2026-01-05", status: "completed", guestTags: ["g-allergy"], guestTagsAt: 5 }),
    ];
    const note = status("a", "seated", list, { tagList }).plan.seatNote;
    expect([note.guestTags, note.occasionTags, note.notes]).toEqual([["Allergy"], ["Birthday"], ""]);
    // Without the list there is nothing to name a tag with, and no note: no popover.
    expect(status("a", "seated", list).plan.seatNote).toBe(null);
  });

  it("runs on the list it is handed, so a parked write replays on fresh data", () => {
    const list = [bk("a", "20:00", 2, ["2"])];
    const { plan } = status("a", "completed", list);
    const fresh = [bk("a", "20:00", 2, ["4"], { name: "Renamed" }), bk("n", "21:00", 2, ["3"])];
    const out = plan.transform(fresh);
    expect([byId(out, "a").name, byId(out, "a").tables, byId(out, "a").status]).toEqual(["Renamed", ["4"], "completed"]);
    expect(byId(out, "n")).toBe(fresh[1]);
  });

  it("writes nothing for a booking that is no longer in the list", () => {
    const list = [bk("b", "20:00", 2, ["2"])];
    const out = status("gone", "completed", list).plan.transform(list);
    expect(out.length).toBe(1);
    expect(out[0]).toBe(list[0]);
  });
});

describe("planCancel", () => {
  const cancel = (id, noShow, bookings, more) => planCancel(Object.assign({
    id, noShow, bookings, viewDate: TODAY, tableBlocks: [], autoOptimizer: false, getUser: () => "u@x",
    redeemAsked: false, vouchersOn: true, vouchersByCode: {}, stamp,
  }, more || {}));

  it("asks whether to restore before a visit that redeemed is cancelled", () => {
    const list = [bk("a", "20:00", 2, ["2"], { status: "completed", voucherCode: "USED2345" })];
    const by = { USED2345: voucher("USED2345", taken("a")) };
    expect(cancel("a", undefined, list, { vouchersByCode: by }))
      .toStrictEqual({ voucherBack: { id: "a", status: "cancelled", noShow: false, from: "cancel" } });
    expect(cancel("a", true, list, { vouchersByCode: by }).voucherBack.noShow).toBe(true);
    expect(typeof cancel("a", true, list, { vouchersByCode: by, redeemAsked: true }).transform).toBe("function");
  });

  it("cancels with one history line, and no no-show key", () => {
    const list = [bk("a", "20:00", 2, ["2"]), bk("b", "20:00", 2, ["3"])];
    const out = cancel("a", false, list).transform(list);
    expect(byId(out, "a")).toStrictEqual(Object.assign({}, list[0], { status: "cancelled", history: [{ action: "cancelled", by: "u@x" }] }));
    expect(byId(out, "b")).toBe(list[1]);
  });

  it("a no-show is a cancellation with the flag and its own history word", () => {
    const list = [bk("a", "20:00", 2, ["2"])];
    const a = byId(cancel("a", true, list).transform(list), "a");
    expect([a.status, a.noShow, a.history]).toEqual(["cancelled", true, [{ action: "no show", by: "u@x" }]]);
  });

  it("computes once per list: the undo's copy and the write's are the same object", () => {
    const list = [bk("a", "20:00", 2, ["2"])];
    const plan = cancel("a", false, list);
    expect(plan.transform(list)).toBe(plan.transform(list));
    const fresh = list.slice();
    expect(plan.transform(fresh)).not.toBe(plan.transform(list));
  });
});

describe("completeCleared", () => {
  it("completes the listed parties that are still seated, and nobody else", () => {
    const list = [
      bk("s", "19:00", 2, ["3"], { status: "seated" }),
      bk("c", "19:00", 2, ["4"]),                           // listed, but not seated
      bk("t", "19:00", 2, ["5A"], { status: "seated" }),    // seated, but not listed
    ];
    const out = completeCleared({ ids: ["s", "c", "nobody"], today: TODAY, nowM: 20 * 60 + 10, user: "u@x", stamp })(list);
    expect(byId(out, "s")).toStrictEqual(Object.assign({}, list[0], {
      status: "completed", duration: 70, customDur: 70, stayedMin: 70,
      history: [{ action: "status → completed (table cleared to seat another party)", by: "u@x" }],
    }));
    expect(byId(out, "c")).toBe(list[1]);
    expect(byId(out, "t")).toBe(list[2]);
  });
});

describe("the two money questions (lib/vouchers.js)", () => {
  const list = [
    bk("a", "20:00", 2, ["2"], { voucherCode: "OPEN2345" }),
    bk("d", "20:00", 2, ["3"], { status: "completed", voucherCode: "USED2345" }),
    bk("n", "20:00", 2, ["4"]),
    bk("m", "20:00", 2, ["4"], { voucherCode: "GONE2345" }),
  ];
  const by = {
    OPEN2345: voucher("OPEN2345"),
    USED2345: voucher("USED2345", taken("d")),
  };
  const src = (o) => Object.assign({ bookings: list, vouchersByCode: by, vouchersOn: true, now: NOW }, o || {});

  it("voucherDue: an open voucher, on the way into Completed, not yet settled by this booking", () => {
    expect(voucherDue(src(), "a", "completed")).toBe(by.OPEN2345);
    expect(voucherDue(src(), "a", "seated")).toBe(null);
    expect(voucherDue(src(), "n", "completed")).toBe(null);          // no voucher
    expect(voucherDue(src(), "m", "completed")).toBe(null);          // a number not in the list
    expect(voucherDue(src(), "d", "completed")).toBe(null);          // already settled against it
    expect(voucherDue(src({ vouchersOn: false }), "a", "completed")).toBe(null);
  });

  it("voucherDue: a void, spent or expired voucher has nothing to ask about", () => {
    const states = [{ status: "void" }, { remaining: 0 }, { expiresAt: NOW - 1 }];
    states.forEach((st) => {
      expect(voucherDue(src({ vouchersByCode: { OPEN2345: voucher("OPEN2345", {}, st) } }), "a", "completed"), JSON.stringify(st)).toBe(null);
    });
    // The same voucher a millisecond before it expires is still open.
    expect(voucherDue(src({ vouchersByCode: { OPEN2345: voucher("OPEN2345", {}, { expiresAt: NOW + 1000 }) } }), "a", "completed")).toBeTruthy();
  });

  it("voucherHeld: money taken for THIS booking, whatever its status", () => {
    expect(voucherHeld(src(), "d")).toBe(by.USED2345);
    expect(voucherHeld(src(), "a")).toBe(null);                      // attached, nothing taken
    expect(voucherHeld(src(), "nobody")).toBe(null);
    expect(voucherHeld(src({ vouchersOn: false }), "d")).toBe(null);
  });

  it("voucherReturnDue: only a booking LEAVING Completed", () => {
    for (const to of ["confirmed", "pending", "seated", "cancelled"]) expect(voucherReturnDue(src(), "d", to), to).toBe(by.USED2345);
    expect(voucherReturnDue(src(), "d", "completed")).toBe(null);
    const notDone = [Object.assign({}, list[1], { status: "seated" })];
    expect(voucherReturnDue(src({ bookings: notDone }), "d", "confirmed")).toBe(null);
  });
});

describe("seatClashSnap", () => {
  it("keeps the four things the prompt prints, and blanks a missing name or time", () => {
    expect(seatClashSnap([{ booking: { id: "s", name: "Sol", time: "19:00", notes: "x" }, tables: ["3"] }, { booking: { id: "t" }, tables: ["4", "5A"] }]))
      .toStrictEqual([{ id: "s", name: "Sol", time: "19:00", tables: ["3"] }, { id: "t", name: "", time: "", tables: ["4", "5A"] }]);
  });
});

describe("BookingApp's three functions are the gate, the plan and the side effects", () => {
  const APP = stripComments(readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "src", "App.jsx"), "utf8")).join("\n").replace(/[ \t]+/g, "").replace(/\n+/g, "\n");
  const slice = (from, to) => { const at = APP.indexOf(from); expect(at, from).toBeGreaterThan(-1); return APP.slice(at, APP.indexOf(to, at)); };

  it("updateStatus", () => {
    const body = slice("functionupdateStatus(", "functionsettleVoucher(");
    expect(body.startsWith('functionupdateStatus(id,status){if(refused("bookingStatus"))return;\nconstplan=planStatus({')).toBe(true);
    expect(body).toContain("redeemAsked:redeemAskedRef.current,seatAsked:seatAskedRef.current,");
    expect(body).toContain([
      "if(plan.confirmCancel){setConfirmCancel(id);return;}",
      "if(plan.voucherAsk){setVoucherAsk(plan.voucherAsk);returnfalse;}",
      "if(plan.voucherBack){setVoucherBack(plan.voucherBack);returnfalse;}",
      "if(plan.refuse){flashRefusal(plan.refuse);returnfalse;}",
      "if(plan.seatClash){setSeatClash(plan.seatClash);returnfalse;}",
      "constok=saveBookings(plan.transform,false,goneReport(id));",
      "if(ok&&plan.flashes)flash(plan.flashKind);",
      "if(plan.seatNote)setSeatNote(plan.seatNote);",
      "returnok;",
      "}",
    ].join("\n"));
    // The decisions left with the plan: nothing here reads a booking.
    for (const gone of ["bookings.find", "histEntry(", "bookingsAfterAction(", "applySeatedShift(", "unseatRestore(", "seatRefusal("]) {
      expect(body, gone).not.toContain(gone);
    }
  });

  it("doCancelBooking", () => {
    const body = slice("functiondoCancelBooking(", "functionundoDelta(");
    expect(body.startsWith("functiondoCancelBooking(id,noShow){\nconstplan=planCancel({")).toBe(true);
    expect(body).toContain("if(plan.voucherBack){\nsetConfirmCancel(null);\nsetVoucherBack(plan.voucherBack);\nreturnfalse;\n}");
    expect(body).toContain([
      "constpost=plan.transform(bookings);",
      "constok=saveBookings(plan.transform,false,goneReport(id));",
      "wa.autoHandleCancelIntent(id);",
      "setConfirmCancel(null);",
      "if(ok){",
      "flash();",
      'armUndo(undoDelta(bookings,post),id,"cancel",!!noShow);',
      "}",
    ].join("\n"));
    expect(body).not.toContain("histEntry(");
    // The cancel reads no clock (lint flags `Date.now()` on this path as a
    // render-time call, and the walk-back question never needed one).
    expect(body).not.toContain("Date.now()");
  });

  it("seatAfterClearing hands the completion to completeCleared", () => {
    const body = slice("functionseatAfterClearing(", "functionupdateStatus(");
    expect(body).toContain("saveBookings(completeCleared({ids:ids,today:today,nowM:nowM,user:user}));");
    expect(body).not.toContain("completedSeatedPatch(");
  });

  it("the old names are one-line wrappers over lib/vouchers.js", () => {
    expect(APP).toContain("functionvoucherToAsk(id,status){returnvoucherDue(voucherSrc(),id,status);}");
    expect(APP).toContain("functionvoucherHeldBy(id){returnvoucherHeld(voucherSrc(),id);}");
    expect(APP).toContain("functionvoucherToRestore(id,status){returnvoucherReturnDue(voucherSrc(),id,status);}");
  });
});
