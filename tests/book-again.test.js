// tests/book-again.test.js — v18.5.1 (ROADMAP #17)
//
// `againDraft` is the draft Book Again opens the form with, moved out of
// BookingApp's `bookAgain`. When it moved, the old function (lifted from the
// commit before) and the new one (lifted from App.jsx) were run over 100,000
// generated sources with the same calls and the same draft every time; that
// comparison is in REFACTOR_LOG. These are the cases that stay.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { againDraft } from "../src/lib/booking-save.js";
import { getDur } from "../src/lib/booking-logic.js";
import { sanitizeVoucher } from "../src/lib/vouchers.js";
import { EMPTY_FORM } from "../src/lib/constants.js";
import { todayStr } from "../src/lib/day.js";
import { stripComments } from "../scripts/strip-comments.mjs";

const TODAY = todayStr();
const NOW = Date.now();
const src = (extra) => Object.assign(
  { id: "s1", name: "Ana", phone: "+34 600 000 001", date: TODAY, time: "20:15", scheduledTime: "20:30", size: 4,
    duration: 90, originalDuration: 90, customDur: null, status: "completed", tables: ["2"], preference: "indoor",
    preferredTables: ["2", "3"], notes: "by the window", deposit: 20, voucherCode: "", tags: ["o-birthday"],
    guestTags: ["g-vip"], guestTagsAt: 5, history: [{ action: "created" }] }, extra || {});
const again = (b, ctx) => againDraft(b, Object.assign({ vouchersOn: true, vouchersByCode: {}, bookings: [b], now: NOW }, ctx || {}));

describe("againDraft", () => {
  it("copies who and the plan, and leaves the day, the note and the money behind", () => {
    const d = again(src());
    expect([d.name, d.phone, d.size, d.preference, d.preferredTables]).toEqual(["Ana", "+34 600 000 001", 4, "indoor", ["2", "3"]]);
    expect(d.time).toBe("20:30");                    // the booked time, not the seated-shifted 20:15
    expect([d.date, d.notes, d.status, d.returnOf]).toEqual(["", "", "confirmed", "s1"]);
    expect([d.deposit, d.manualTables, d.voucherCode]).toEqual([EMPTY_FORM.deposit, [], ""]);
    expect([d.tags, d.guestTagEdits]).toEqual([EMPTY_FORM.tags, EMPTY_FORM.guestTagEdits]);
  });
  it("its preferred tables are a copy, never the source's array", () => {
    const s = src();
    expect(again(s).preferredTables).not.toBe(s.preferredTables);
  });
  it("falls back: time when there is no scheduledTime, 13:00 with neither, 2 guests, auto", () => {
    expect(again(src({ scheduledTime: "" })).time).toBe("20:15");
    const d = again(src({ scheduledTime: "", time: "", size: 0, preference: "", preferredTables: undefined }));
    expect([d.time, d.size, d.preference, d.preferredTables]).toEqual(["13:00", 2, "auto", []]);
  });
  it("a planned length rides along only when it is not the size's default, clamped to 15–480", () => {
    const def = getDur(4);
    // Not seated-shifted (time is the booked time), so the planned length is `duration`.
    const at = (dur) => again(src({ time: "20:30", duration: dur, originalDuration: dur })).customDur;
    expect(at(def)).toBe(null);
    expect(at(def + 60)).toBe(def + 60);
    expect(at(2000)).toBe(480);
    expect(at(5)).toBe(15);
  });
  it("a seated-shifted source gives its PLANNED length, not the stay", () => {
    // Booked 20:30 for the default; seated at 20:15, so stored as 20:15 for 15 more.
    const def = getDur(4);
    expect(again(src({ time: "20:15", scheduledTime: "20:30", duration: def + 15, originalDuration: def + 15 })).customDur).toBe(null);
  });

  const voucher = (over) => sanitizeVoucher(Object.assign({ value: 50, remaining: 40, status: "active", issuedAt: 1 }, over || {}), "USED2345");
  it("the voucher follows a COMPLETED visit while it can still be attached", () => {
    const s = src({ voucherCode: "used 2345" });
    expect(again(s, { vouchersByCode: { USED2345: voucher() } }).voucherCode).toBe("USED2345");
  });
  it("and does not from a seated visit, a void voucher, an unknown code, or with the module off", () => {
    const by = { USED2345: voucher() };
    expect(again(src({ voucherCode: "USED2345", status: "seated" }), { vouchersByCode: by }).voucherCode).toBe("");
    expect(again(src({ voucherCode: "USED2345" }), { vouchersByCode: { USED2345: voucher({ status: "void" }) } }).voucherCode).toBe("");
    expect(again(src({ voucherCode: "NOPE0000" }), { vouchersByCode: by }).voucherCode).toBe("");
    expect(again(src({ voucherCode: "USED2345" }), { vouchersByCode: by, vouchersOn: false }).voucherCode).toBe("");
  });
  it("with no `now` handed in, it reads the clock itself: an expired voucher stays behind", () => {
    const s = src({ voucherCode: "USED2345" });
    const ctx = (v) => ({ vouchersOn: true, vouchersByCode: { USED2345: v }, bookings: [s] });
    expect(againDraft(s, ctx(voucher({ expiresAt: Date.now() - 1000 }))).voucherCode).toBe("");
    expect(againDraft(s, ctx(voucher({ expiresAt: Date.now() + 86400000 }))).voucherCode).toBe("USED2345");
  });
  it("nor when it is already on somebody's live booking", () => {
    const s = src({ voucherCode: "USED2345" });
    const live = src({ id: "x9", status: "confirmed", voucherCode: "USED2345" });
    expect(again(s, { vouchersByCode: { USED2345: voucher() }, bookings: [s, live] }).voucherCode).toBe("");
  });

  it("a guest with a phone needs no guestId: the phone is the identity", () => {
    const d = again(src({ guestId: "gold" }));
    expect([d.guestId, d.guestSeed]).toEqual([null, null]);
  });
  it("a phone-less guest is joined: an existing guestId is adopted, else one is minted and seeded", () => {
    expect([again(src({ phone: "", guestId: "gq" })).guestId, again(src({ phone: "", guestId: "gq" })).guestSeed]).toEqual(["gq", null]);
    const d = again(src({ phone: "", guestId: null }));
    expect([d.guestId, d.guestSeed]).toEqual(["gs1", "s1"]);
  });
});

describe("the wiring", () => {
  const APP = stripComments(readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8")).join("\n").replace(/\s+/g, "");
  it("bookAgain opens the form with againDraft, through openForm, and builds no draft itself", () => {
    const i = APP.indexOf("functionbookAgain(");
    const body = APP.slice(i, APP.indexOf("useWalkin(", i));
    expect(body).toContain("pendingWaitlistRef.current=null;openForm(againDraft(sourceBooking,{vouchersOn:vouchersOn,vouchersByCode:vouchersByCode,bookings:bookings}));setEditId(null);");
    expect(body).not.toContain("EMPTY_FORM");
    expect(body).not.toContain("attachRefusal(");
  });
});

// v18.5.1: `bookingCreate` was asked by one of the three doors to the
// new-booking form. Measured on DEV with it denied: "+ New" refused, Book again
// opened the form and Save wrote a booking.
describe("a new booking needs bookingCreate, whichever door it came through", () => {
  const APP = stripComments(readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8")).join("\n").replace(/\s+/g, "");
  const GATE = 'if(refused("bookingCreate"))return';
  // The function a position in App sits in: the nearest `function name(` before it.
  const ownerOf = (at) => { const m = [...APP.slice(0, at).matchAll(/function([A-Za-z0-9_]+)\(/g)]; return m[m.length - 1][1]; };

  it("the save is the guarantee: doSaveNew asks before it plans anything", () => {
    const i = APP.indexOf("functiondoSaveNew(f0){");
    expect(i).toBeGreaterThan(-1);
    expect(APP.slice(i, i + 80)).toContain("functiondoSaveNew(f0){" + GATE + ";");
  });
  it("every door that opens the form asks, except the edit's, which asks bookingEdit", () => {
    // Calls only: the declaration `function openForm(` is not a door.
    const doors = [...APP.matchAll(/(?<!function)openForm\(/g)].map((m) => ownerOf(m.index));
    expect(doors.sort()).toEqual(["bookAgain", "bookFromWaitlist", "openEdit", "openNewWith"]);
    for (const name of ["bookAgain", "bookFromWaitlist", "openNewWith"]) {
      const i = APP.indexOf("function" + name + "(");
      const body = APP.slice(i, APP.indexOf("openForm(", i));
      expect(body, name).toContain(GATE);
    }
    const e = APP.indexOf("functionopenEdit(");
    expect(APP.slice(e, APP.indexOf("openForm(", e))).toContain('if(refused("bookingEdit"))returnfalse;');
  });
});

